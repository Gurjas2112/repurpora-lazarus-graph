"""Registry of external MCP servers the agent may use as an MCP *client*.

Security model (tool output is untrusted text entering the agent's context; a URL is an SSRF vector):
* Servers are registered by **admins only**. Users can only choose among enabled servers, per chat.
* URLs must be HTTPS; a hostname must not resolve to a private, loopback or link-local address. The exception is
  hosts explicitly listed in ``MCP_OUTBOUND_ALLOWED_HOSTS``, for development.
* Credentials are never stored: ``auth_secret_name`` names a secret resolved from the vault or environment at call time.
* Per-server ``allowed_tools`` allow-list (empty = all listed tools). Calls are capped per run, time-limited and audited.
* Tool outputs are sanitised for embedded instructions and enter the brief only as trust-tagged evidence.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import re
import socket
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

log = logging.getLogger(__name__)
TOOL_LIST_TTL_S = 300
CALL_TIMEOUT_S = 30
_tool_cache: dict[int, tuple[float, list[dict]]] = {}


@dataclass
class McpServer:
    id: int
    name: str
    url: str
    description: str | None = None
    auth_mode: str = "none"
    auth_secret_name: str | None = None
    allowed_tools: list[str] = field(default_factory=list)
    enabled: bool = True

    @property
    def slug(self) -> str:
        return re.sub(r"[^a-z0-9]+", "_", self.name.lower()).strip("_")[:24] or f"s{self.id}"


class UnsafeUrl(ValueError):
    pass


def validate_url(url: str) -> str:
    """Reject non-HTTPS URLs and hosts resolving to internal addresses (SSRF), unless explicitly allow-listed."""
    u = urlparse((url or "").strip())
    allowed = {h.strip().lower() for h in os.getenv("MCP_OUTBOUND_ALLOWED_HOSTS", "").split(",") if h.strip()}
    host = (u.hostname or "").lower()
    if not host:
        raise UnsafeUrl("URL has no host")
    if host in allowed:
        return url.strip()
    if u.scheme != "https":
        raise UnsafeUrl("only https:// MCP servers are allowed")
    if u.username or u.password:
        raise UnsafeUrl("credentials in the URL are not allowed; use auth_secret_name")
    try:
        infos = socket.getaddrinfo(host, u.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeUrl(f"host does not resolve: {host}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise UnsafeUrl(f"{host} resolves to a non-public address ({ip})")
    return url.strip()


# --------------------------------------------------------------------- storage --

_COLS = "id, name, url, description, auth_mode, auth_secret_name, allowed_tools, enabled"


def _row(r) -> McpServer:
    return McpServer(id=r[0], name=r[1], url=r[2], description=r[3], auth_mode=r[4], auth_secret_name=r[5],
                     allowed_tools=list(r[6] or []), enabled=r[7])


def list_servers(enabled_only: bool = False) -> list[McpServer]:
    from repurpora.db import conn

    with conn() as c:
        rows = c.execute(f"select {_COLS} from mcp_servers {'where enabled' if enabled_only else ''} order by name").fetchall()
    return [_row(r) for r in rows]


def get_servers(ids: list[int]) -> list[McpServer]:
    if not ids:
        return []
    from repurpora.db import conn

    with conn() as c:
        rows = c.execute(f"select {_COLS} from mcp_servers where enabled and id = any(%s)", (list(ids),)).fetchall()
    return [_row(r) for r in rows]


# ---------------------------------------------------------------------- client --

def _headers(server: McpServer) -> dict[str, str]:
    if server.auth_mode == "bearer_secret" and server.auth_secret_name:
        from repurpora.vault import get_secret

        token = get_secret(server.auth_secret_name)
        if not token:
            raise RuntimeError(f"secret '{server.auth_secret_name}' is not configured")
        return {"Authorization": f"Bearer {token}"}
    return {}


async def _with_session(server: McpServer, fn):
    import httpx
    from mcp.client.session import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    validate_url(server.url)
    async with httpx.AsyncClient(headers=_headers(server), timeout=CALL_TIMEOUT_S) as hc:
        async with streamable_http_client(server.url, http_client=hc) as (r, w, *_):
            async with ClientSession(r, w) as sess:
                await sess.initialize()
                return await fn(sess)


def _run(coro):
    try:
        return asyncio.run(asyncio.wait_for(coro, CALL_TIMEOUT_S + 5))
    except RuntimeError as exc:  # already inside an event loop -> run in a fresh thread
        if "event loop" not in str(exc):
            raise
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(1) as ex:
            return ex.submit(asyncio.run, asyncio.wait_for(coro, CALL_TIMEOUT_S + 5)).result()


def list_tools(server: McpServer, use_cache: bool = True) -> list[dict[str, Any]]:
    """Tools the server exposes, filtered by the server's allow-list. Cached for 5 minutes."""
    hit = _tool_cache.get(server.id)
    if use_cache and hit and time.time() - hit[0] < TOOL_LIST_TTL_S:
        return hit[1]

    async def go(sess):
        res = await sess.list_tools()
        return [{"name": t.name, "title": t.title, "description": (t.description or "")[:500],
                 "input_schema": t.input_schema if hasattr(t, "input_schema") else t.inputSchema,
                 "read_only": bool(t.annotations and getattr(t.annotations, "read_only_hint", False))}
                for t in res.tools]

    tools = _run(_with_session(server, go))
    if server.allowed_tools:
        tools = [t for t in tools if t["name"] in set(server.allowed_tools)]
    _tool_cache[server.id] = (time.time(), tools)
    return tools


def call_tool(server: McpServer, name: str, arguments: dict[str, Any]) -> tuple[str, bool]:
    """Returns (text_content, is_error)."""
    if server.allowed_tools and name not in server.allowed_tools:
        raise PermissionError(f"tool '{name}' not allow-listed on server '{server.name}'")

    async def go(sess):
        res = await sess.call_tool(name, arguments)
        parts = [getattr(c, "text", "") for c in (res.content or []) if getattr(c, "text", None)]
        return "\n".join(parts)[:8000], bool(getattr(res, "is_error", False) or getattr(res, "isError", False))

    return _run(_with_session(server, go))


def clear_cache(server_id: int | None = None) -> None:
    if server_id is None:
        _tool_cache.clear()
    else:
        _tool_cache.pop(server_id, None)
