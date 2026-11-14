// Which admin-approved external MCP servers the user enabled for their chats (per browser).
const KEY = "repurpora:mcp_servers";
const EVT = "repurpora:mcp-selection";

export function getMcpSelection(): number[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => Number.isInteger(x)) : [];
  } catch {
    return [];
  }
}

export function setMcpSelection(ids: number[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: selection lasts for this page only */
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: ids }));
}

export function onMcpSelection(cb: (ids: number[]) => void) {
  const h = (e: Event) => cb((e as CustomEvent<number[]>).detail);
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}
