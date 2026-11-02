export const usd = (n?: number, d = 2) =>
  n === undefined || Number.isNaN(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const usdK = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : usd(n, 0));
export const num = (n?: number, d = 0) => (n === undefined ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
export const pct = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(d)}%`;
export const short = (a?: string) => (!a ? "—" : a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export const time = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
export const agentName = (agent: string | undefined, names: Record<string, string>) => {
  if (!agent) return "";
  const [c, side] = agent.split(".");
  return `${names[c] ?? c}${side ? ` · ${side === "seller" ? "Sales" : "Procurement"}` : ""}`;
};
