"use client";

import { useEffect, useRef, useState } from "react";
import { Wrench, Check, LoaderCircle } from "lucide-react";
import { authHeaders, useAuth } from "@/providers/Auth";
import { getMcpSelection, onMcpSelection, setMcpSelection } from "@/lib/mcp-selection";

type ApprovedServer = { id: number; name: string; description: string | null; allowed_tools: string[] };
const AUX = process.env.NEXT_PUBLIC_MOCK_API_URL || "http://localhost:8081";

/** Lets the user opt in to admin-approved external MCP servers for their research runs. */
export function McpToolsPicker() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState<ApprovedServer[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected(getMcpSelection());
    return onMcpSelection(setSelected);
  }, []);

  useEffect(() => {
    if (!open || servers || !session) return;
    fetch(`${AUX}/mcp-servers`, { headers: authHeaders(session) })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: ApprovedServer[]) => {
        setServers(list);
        // drop selections for servers an admin has since disabled
        const live = getMcpSelection().filter((id) => list.some((s) => s.id === id));
        setMcpSelection(live);
      })
      .catch(() => setServers([]));
  }, [open, servers, session]);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const toggle = (id: number) =>
    setMcpSelection(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="External MCP tools"
        data-testid="mcp-tools-picker"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-gray-100"
      >
        <Wrench className="size-4" />
        <span className="hidden md:inline">Tools</span>
        {selected.length > 0 && (
          <span className="rounded-full bg-teal-600 px-1.5 text-[10px] font-semibold text-white">{selected.length}</span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="External MCP servers" data-testid="mcp-tools-panel"
          className="absolute right-0 z-30 mt-2 w-80 rounded-xl border bg-white p-3 shadow-lg">
          <div className="mb-2 text-sm font-semibold">External MCP servers</div>
          <p className="mb-3 text-xs text-muted-foreground">
            Admin-approved servers the research agent may call for this browser&apos;s chats. Results are cited as
            external evidence.
          </p>
          {servers === null ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" /> Loading…</p>
          ) : servers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No servers approved yet. An admin can add one under Admin → MCP servers.</p>
          ) : (
            <ul className="space-y-1.5">
              {servers.map((s) => {
                const on = selected.includes(s.id);
                return (
                  <li key={s.id}>
                    <button onClick={() => toggle(s.id)} role="checkbox" aria-checked={on} data-testid={`mcp-server-${s.id}`}
                      className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left ${on ? "border-teal-500 bg-teal-50" : "hover:bg-gray-50"}`}>
                      <span className={`mt-0.5 grid size-4 place-items-center rounded border ${on ? "border-teal-600 bg-teal-600 text-white" : ""}`}>
                        {on && <Check className="size-3" />}
                      </span>
                      <span>
                        <span className="block text-sm font-medium">{s.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {s.description || "External MCP server"}
                          {s.allowed_tools.length ? ` · ${s.allowed_tools.length} allowed tools` : " · all listed tools"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
