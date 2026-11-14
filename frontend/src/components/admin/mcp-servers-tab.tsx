"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, LoaderCircle, Plug, Trash2, XCircle } from "lucide-react";
import { useAuth } from "@/providers/Auth";
import { adminFetch } from "@/lib/admin-api";

type Server = {
  id: number;
  name: string;
  url: string;
  description: string | null;
  auth_mode: "none" | "bearer_secret";
  auth_secret_name: string | null;
  allowed_tools: string[];
  enabled: boolean;
};
type TestResult = { ok: boolean; ms: number; error?: string; tools?: { name: string; title?: string; read_only?: boolean }[] };

const EMPTY = { name: "", url: "", description: "", auth_mode: "none" as const, auth_secret_name: "", allowed_tools: "" };

export function McpServersTab() {
  const { session } = useAuth();
  const [servers, setServers] = useState<Server[] | null>(null);
  const [form, setForm] = useState<typeof EMPTY | { auth_mode: "bearer_secret" } & Omit<typeof EMPTY, "auth_mode">>(EMPTY);
  const [tests, setTests] = useState<Record<number, TestResult | "running">>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    adminFetch<Server[]>(session, "/mcp-servers").then(setServers).catch((e) => toast.error(e.message));
  }, [session]);
  useEffect(load, [load]);

  const payload = (s: Partial<Server> & { allowed_tools: string[] }) => JSON.stringify(s);

  const create = async () => {
    setSaving(true);
    try {
      await adminFetch(session, "/mcp-servers", {
        method: "POST",
        body: payload({
          name: form.name.trim(),
          url: form.url.trim(),
          description: form.description.trim() || null,
          auth_mode: form.auth_mode,
          auth_secret_name: form.auth_mode === "bearer_secret" ? form.auth_secret_name.trim() : null,
          allowed_tools: form.allowed_tools.split(",").map((t) => t.trim()).filter(Boolean),
          enabled: true,
        }),
      });
      toast.success(`Registered ${form.name}`);
      setForm(EMPTY);
      load();
    } catch (e) {
      toast.error("Rejected", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (s: Server) => {
    try {
      await adminFetch(session, `/mcp-servers/${s.id}`, { method: "PUT", body: payload({ ...s, enabled: !s.enabled }) });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (s: Server) => {
    if (!window.confirm(`Remove MCP server "${s.name}"? Agents will stop using it immediately.`)) return;
    try {
      await adminFetch(session, `/mcp-servers/${s.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const test = async (s: Server) => {
    setTests((t) => ({ ...t, [s.id]: "running" }));
    try {
      const r = await adminFetch<TestResult>(session, `/mcp-servers/${s.id}/test`, { method: "POST" });
      setTests((t) => ({ ...t, [s.id]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [s.id]: { ok: false, ms: 0, error: (e as Error).message } }));
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3" data-testid="admin-mcp">
      <section className="space-y-3 lg:col-span-2">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Approved external MCP servers</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The research agent can act as an MCP client for these servers when a user enables them in chat (Tools menu).
            HTTPS only, internal addresses blocked, credentials resolved from the vault by name, at most 3 calls per run,
            outputs sanitised and cited as <i>external</i> evidence.
          </p>
        </div>
        {servers === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Loading…</p>
        ) : servers.length === 0 ? (
          <p className="rounded-2xl border bg-white p-5 text-sm text-muted-foreground">No servers registered yet.</p>
        ) : (
          servers.map((s) => {
            const t = tests[s.id];
            return (
              <div key={s.id} className="rounded-2xl border bg-white p-5 shadow-sm" data-testid={`admin-mcp-server-${s.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Plug className="size-4 text-teal-700" />
                      <span className="font-semibold">{s.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${s.enabled ? "bg-teal-50 text-teal-800" : "bg-gray-100 text-gray-500"}`}>
                        {s.enabled ? "enabled" : "disabled"}
                      </span>
                    </div>
                    <code className="mt-1 block text-xs text-muted-foreground">{s.url}</code>
                    <div className="mt-1 text-xs text-muted-foreground">
                      auth: {s.auth_mode === "bearer_secret" ? `bearer from vault secret ${s.auth_secret_name}` : "none"} ·{" "}
                      tools: {s.allowed_tools.length ? s.allowed_tools.join(", ") : "all listed"}
                    </div>
                    {s.description && <p className="mt-1 text-sm">{s.description}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => test(s)} data-testid={`admin-mcp-test-${s.id}`} className="rounded-md border px-3 py-1.5 text-xs">
                      {t === "running" ? "Testing…" : "Test connection"}
                    </button>
                    <button onClick={() => toggle(s)} className="rounded-md border px-3 py-1.5 text-xs">{s.enabled ? "Disable" : "Enable"}</button>
                    <button onClick={() => remove(s)} aria-label={`Delete ${s.name}`} className="rounded-md border px-2 py-1.5 text-muted-foreground hover:text-[#d03b3b]">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
                {t && t !== "running" && (
                  <div className={`mt-3 rounded-lg border p-3 text-xs ${t.ok ? "border-teal-200 bg-teal-50" : "border-[#d03b3b]/30 bg-[#d03b3b]/5"}`}
                    data-testid={`admin-mcp-test-result-${s.id}`}>
                    {t.ok ? (
                      <>
                        <div className="flex items-center gap-1 font-medium text-teal-800">
                          <CheckCircle2 className="size-4" /> initialize + tools/list OK · {t.tools?.length} tools · {t.ms} ms
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {t.tools?.map((tool) => (
                            <code key={tool.name} className="rounded border bg-white px-1.5 py-0.5">
                              {tool.name}{tool.read_only ? " · ro" : ""}
                            </code>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-1 text-[#d03b3b]"><XCircle className="size-4" /> {t.error}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
      <section className="h-fit rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Register a server</h2>
        <div className="space-y-3 text-sm">
          {(
            [
              ["name", "Name", "e.g. Licensed PharmaDB"],
              ["url", "Streamable HTTP URL (https)", "https://…/mcp"],
              ["description", "Description", "What it provides"],
              ["allowed_tools", "Allowed tools (comma separated, empty = all)", "lookup, search"],
            ] as const
          ).map(([k, label, ph]) => (
            <label key={k} className="block">
              <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
              <input className="w-full rounded-lg border px-3 py-2" placeholder={ph} value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })} aria-label={label} />
            </label>
          ))}
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Authentication</span>
            <select className="w-full rounded-lg border px-3 py-2" value={form.auth_mode} aria-label="Authentication"
              onChange={(e) => setForm({ ...form, auth_mode: e.target.value as "none" | "bearer_secret" })}>
              <option value="none">None</option>
              <option value="bearer_secret">Bearer token from vault secret</option>
            </select>
          </label>
          {form.auth_mode === "bearer_secret" && (
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Vault secret name (not the token itself)</span>
              <input className="w-full rounded-lg border px-3 py-2 font-mono" placeholder="PHARMADB_MCP_TOKEN" value={form.auth_secret_name}
                onChange={(e) => setForm({ ...form, auth_secret_name: e.target.value.toUpperCase() })} aria-label="Vault secret name" />
            </label>
          )}
          <button onClick={create} disabled={saving || !form.name || !form.url} data-testid="admin-mcp-create"
            className="w-full rounded-lg bg-teal-700 px-4 py-2 font-medium text-white disabled:opacity-50">
            {saving ? "Validating…" : "Register server"}
          </button>
        </div>
      </section>
    </div>
  );
}
