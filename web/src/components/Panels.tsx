import { Fragment, useState } from "react";
import type { State } from "../store";
import { approve } from "../store";
import { api } from "../auth";
import { agentName, num, pct, short, time, usd, usdK } from "../format";
import { STAGE_COLOR } from "./NetworkGraph";

export function PriceIndex({ s }: { s: State }) {
  return (
    <div className="idx">
      {s.skus.map((k) => {
        const ser = s.refSeries[k.id] ?? [];
        const W = 200, H = 70;
        const vals = ser.flatMap((p) => [p.lo, p.hi, p.trade ?? p.ref]);
        const min = Math.min(...vals, k.band.lo) * 0.995, max = Math.max(...vals, k.band.hi) * 1.005;
        const x = (i: number) => (ser.length < 2 ? 0 : (i / (ser.length - 1)) * W);
        const y = (v: number) => H - ((v - min) / (max - min || 1)) * H;
        const band = ser.length > 1 ? `M ${ser.map((p, i) => `${x(i)} ${y(p.hi)}`).join(" L ")} L ${[...ser].reverse().map((p, i) => `${x(ser.length - 1 - i)} ${y(p.lo)}`).join(" L ")} Z` : "";
        const line = ser.map((p, i) => `${x(i)},${y(p.ref)}`).join(" ");
        const drift = (k.ref - k.refPrice) / k.refPrice;
        return (
          <div key={k.id}>
            <div className="k">{k.name}</div>
            <div className="v">{usd(k.ref)}<span className="s"> /{k.unit}</span></div>
            <div className="s">band {usd(k.band.lo)}–{usd(k.band.hi)} · <span className={drift >= 0 ? "amber" : "green"}>{pct(drift)}</span></div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
              <path d={band} fill="rgba(114,214,156,0.08)" stroke="none" />
              <polyline points={line} fill="none" stroke="var(--text)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
              {ser.map((p, i) => (p.trade ? <circle key={i} cx={x(i)} cy={y(p.trade)} r={2.2} fill="var(--gold)" /> : null))}
            </svg>
          </div>
        );
      })}
    </div>
  );
}

export function Blotter({ s, selected, onSelect }: { s: State; selected?: string; onSelect: (id: string) => void }) {
  const names = Object.fromEntries(s.companies.map((c) => [c.id, c.name]));
  const deals = Object.values(s.dealMap).sort((a, b) => b.createdAt - a.createdAt).slice(0, 80);
  return (
    <table className="blotter">
      <thead><tr><th>Time</th><th>Buyer</th><th>Seller</th><th>SKU</th><th>Qty</th><th>Price</th><th>Value</th><th>Stage</th></tr></thead>
      <tbody>
        {deals.map((d) => (
          <tr key={d.id} className={selected === d.id ? "sel" : ""} onClick={() => onSelect(d.id)}>
            <td className="dim">{time(d.createdAt)}</td>
            <td>{names[d.buyer]?.split(" ")[0]}</td>
            <td>{d.seller ? names[d.seller]?.split(" ")[0] : <span className="dim">—</span>}</td>
            <td>{d.sku}</td>
            <td>{num(d.qty)}</td>
            <td>{usd(d.unitPrice)}</td>
            <td>{d.valueUsd ? usdK(d.valueUsd) : "—"}</td>
            <td><span className="stage" style={{ ["--c" as string]: STAGE_COLOR[d.stage] }}>{d.stage}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const KIND_COLOR: Record<string, string> = {
  a2a: "var(--cyan)", rule: "var(--green)", payment: "var(--gold)", inventory: "var(--muted)", ledger: "var(--violet)",
  system: "var(--text)", approval: "var(--amber)", deal: "var(--cyan)", llm: "var(--violet)",
};

export function EventTape({ s, onSelect }: { s: State; onSelect: (id: string) => void }) {
  const names = Object.fromEntries(s.companies.map((c) => [c.id, c.name]));
  const evs = s.events.filter((e) => e.kind !== "a2a").slice(-160).reverse();
  return (
    <div className="tape">
      {evs.map((e) => (
        <div key={e.seq} className={e.severity ?? ""} onClick={() => e.dealId && onSelect(e.dealId)} style={{ cursor: e.dealId ? "pointer" : "default" }}>
          <span className="dim">{time(e.ts)}</span>
          <span className="k" style={{ color: e.severity === "danger" ? "var(--red)" : KIND_COLOR[e.kind] }}>{e.kind}</span>
          <span className="x" title={e.title}>{e.company ? <span className="dim">{agentName(e.company, names)} · </span> : null}{e.title}</span>
        </div>
      ))}
    </div>
  );
}

export function PnlTable({ s }: { s: State }) {
  const rows = [...s.companies].sort((a, b) => a.tier - b.tier);
  return (
    <table className="pnl">
      <thead>
        <tr><th>Company</th><th>Role</th><th>Treasury</th><th>Revenue</th><th>Gross margin</th><th>GM %</th><th>Procurement spend</th><th>Lost sales</th><th>Trades</th><th>Violations</th><th>Reputation</th><th>Payee (registry)</th></tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const gm = c.pnl.revenue - c.pnl.cogs;
          const rep = c.stats.trades + c.stats.violations === 0 ? 1 : c.stats.trades / (c.stats.trades + c.stats.violations);
          return (
            <tr key={c.id}>
              <td>{c.name} {c.policy.strategy === "rogue" && <span className="role rogue">UNTRUSTED</span>}</td>
              <td className="dim">{c.role}</td>
              <td>{usd(c.cash, 0)}</td>
              <td>{c.pnl.revenue ? usd(c.pnl.revenue, 0) : <span className="dim">—</span>}</td>
              <td className={gm > 0 ? "green" : "dim"}>{c.pnl.revenue ? usd(gm, 0) : "—"}</td>
              <td className="dim">{c.pnl.revenue ? `${((gm / c.pnl.revenue) * 100).toFixed(1)}%` : "—"}</td>
              <td>{c.pnl.spend ? usd(c.pnl.spend, 0) : <span className="dim">—</span>}</td>
              <td className={c.pnl.lostSales ? "amber" : "dim"}>{c.pnl.lostSales ? usd(c.pnl.lostSales, 0) : "—"}</td>
              <td>{c.stats.trades}</td>
              <td className={c.stats.violations ? "red" : "dim"}>{c.stats.violations}</td>
              <td><span className="rep"><i style={{ width: `${rep * 100}%`, background: rep > 0.9 ? "var(--green)" : rep > 0.5 ? "var(--amber)" : "var(--red)" }} /></span>{(rep * 100).toFixed(0)}%</td>
              <td className="dim">{short(c.wallet)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Approvals({ s, company, onDecide = approve }: { s: State; company?: string; docked?: boolean; onDecide?: (id: string, ok: boolean) => Promise<void> }) {
  const names = Object.fromEntries(s.companies.map((c) => [c.id, c.name]));
  const list = s.approvals.filter((a) => !company || a.company === company);
  if (!list.length) return null;
  const title = { deal: "Deal exceeds auto-approve limit", sign: "Approve wallet signature", submit: "Approve submission to HSP gateway" };
  return (
    <div className="approvals">
      {list.map((a) => (
        <div className="apv" key={a.id}>
          <div className="t">{title[a.stage]} · {names[a.company]}</div>
          <dl className="kv">
            {Object.entries(a.summary).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{typeof v === "number" ? (k.toLowerCase().includes("usd") || k === "unitPrice" ? usd(v) : num(v)) : String(v)}</dd></Fragment>))}
          </dl>
          <div className="acts">
            <button className="btn ghost" onClick={() => onDecide(a.id, false)}>Decline</button>
            <button className="btn primary" onClick={() => onDecide(a.id, true)}>Approve</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function OnboardDialog({ s, onClose }: { s: State; onClose: () => void }) {
  const [name, setName] = useState("Colaba Coffee Collective");
  const [sector, setSector] = useState("Café · 3 outlets");
  const [buys, setBuys] = useState<string[]>(["roasted-coffee", "oat-milk"]);
  const [sells, setSells] = useState<string[]>([]);
  const [demand, setDemand] = useState(3);
  const [limit, setLimit] = useState(1500);
  const [err, setErr] = useState("");
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const submit = async () => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const body = {
      id, name, sector, buys, sells,
      inventory: Object.fromEntries([...buys.map((b) => [b, demand * 12]), ...sells.map((x) => [x, 300])]),
      demand: buys.length ? Object.fromEntries(buys.map((b) => [b, b === "oat-milk" ? demand * 1.6 : demand])) : undefined,
      replenish: sells.length && !buys.length ? Object.fromEntries(sells.map((x) => [x, 15])) : undefined,
      cash: 15000,
      policy: { autoApproveUsd: limit },
    };
    const r = await api("/api/companies", "admin", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) return setErr((await r.json()).error);
    onClose();
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Onboard a company</h3>
        <div className="muted" style={{ fontSize: 12 }}>Concord generates a wallet, spins up its procurement and/or sales agents with A2A Agent Cards, and registers its payee on the HSK ledger.</div>
        <div className="row2">
          <div className="field"><label>Company</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label>Sector</label><input value={sector} onChange={(e) => setSector(e.target.value)} /></div>
        </div>
        <div className="field"><label>Buys (procurement agent)</label>
          <div className="checks">{s.skus.map((k) => <label key={k.id} className={buys.includes(k.id) ? "on" : ""}><input type="checkbox" checked={buys.includes(k.id)} onChange={() => toggle(buys, setBuys, k.id)} />{k.name}</label>)}</div>
        </div>
        <div className="field"><label>Sells (sales agent)</label>
          <div className="checks">{s.skus.map((k) => <label key={k.id} className={sells.includes(k.id) ? "on" : ""}><input type="checkbox" checked={sells.includes(k.id)} onChange={() => toggle(sells, setSells, k.id)} />{k.name}</label>)}</div>
        </div>
        <div className="row2">
          <div className="field"><label>Consumption / tick</label><input type="number" value={demand} onChange={(e) => setDemand(Number(e.target.value))} /></div>
          <div className="field"><label>Auto-approve limit (USD)</label><input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></div>
        </div>
        {err && <div className="red" style={{ marginTop: 10 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit}>Deploy agents</button>
        </div>
      </div>
    </div>
  );
}
