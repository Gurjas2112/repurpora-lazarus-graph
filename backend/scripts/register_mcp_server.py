"""Register (or update) an external MCP server in the registry - same validation as the admin API.

usage: uv run python scripts/register_mcp_server.py "<name>" <https-url> [--secret SECRET_NAME] [--tools a,b] [--desc "..."]
The token itself is never passed here: put it in the vault/env under SECRET_NAME.
"""
import argparse

from repurpora.db import conn
from repurpora.mcp_registry import validate_url

ap = argparse.ArgumentParser()
ap.add_argument("name")
ap.add_argument("url")
ap.add_argument("--secret")
ap.add_argument("--tools", default="")
ap.add_argument("--desc", default=None)
a = ap.parse_args()
validate_url(a.url)
tools = [t.strip() for t in a.tools.split(",") if t.strip()]
with conn() as c:
    row = c.execute(
        "insert into mcp_servers(name, url, description, auth_mode, auth_secret_name, allowed_tools, created_by) "
        "values (%s,%s,%s,%s,%s,%s,'script') on conflict (name) do update set url=excluded.url, "
        "description=excluded.description, auth_mode=excluded.auth_mode, auth_secret_name=excluded.auth_secret_name, "
        "allowed_tools=excluded.allowed_tools, updated_at=now() returning id",
        (a.name, a.url, a.desc, "bearer_secret" if a.secret else "none", a.secret, tools)).fetchone()
print(f"registered '{a.name}' id={row[0]}")
