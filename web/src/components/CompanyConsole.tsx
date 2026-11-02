import { useEffect, useMemo, useState } from "react";
import type { State } from "../store";
import type { Company } from "../types";
import { num, short, time, usd, usdK } from "../format";
import { DealInspector } from "./DealInspector";
import { Approvals } from "./Panels";
import { approve, approveAsCompany } from "../store";
import { api } from "../auth";
import { STAGE_COLOR } from "./NetworkGraph";

const OPEN = new Set(["rfq", "negotiating", "agreed", "mandate", "awaiting-approval", "signing", "submitted", "settling", "settled", "delivering"]);

function burnRate(c: Company, sku: string) {
  return c.demand?.[sku] ?? 0;
}

function Kpi({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="kpi">
      <div className="k">{k}</div>
      <div className={`v ${tone ?? ""}`}>{v}</div>
    </div>
  );
}

function PolicyEditor({ c, asCompany }: { c: Company; asCompany: boolean }) {
  const [draft, setDraft] = useState(() => structuredClone(c.policy));
  const [saved, setSaved] = useState("");
  useEffect(() => setDraft(structuredClone(c.policy)), [c.id]);
  const save = async () => {
    const r = await api(asCompany ? "/api/me/policy" : `/api/companies/${c.id}/policy`, asCompany ? "company" : "admin", {
      method: "PATCH",
      body: JSON.stringify({ autoApproveUsd: draft.autoApproveUsd, targetMargin: draft.targetMargin, maxUnitPrice: draft.maxUnitPrice, reorderPoint: draft.reorderPoint, reorderQty: draft.reorderQty }),
    });
    setSaved(r.ok ? "Policy pushed to agents" : "Rejected");
    setTimeout(() => setSaved(""), 2500);
  };
  const numIn = (val: number, on: (v: number) => void, step = 1) => (
    <input type="number" step={step} value={val} onChange={(e) => on(Number(e.target.value))} />
  );
  return (
    <div className="policy">
      <div className="prow"><label>Auto-approve limit</label>{numIn(draft.autoApproveUsd, (v) => setDraft({ ...draft, autoApproveUsd: v }), 50)}<span className="dim">USD / deal</span></div>
      {c.sells.length > 0 && (
        <div className="prow"><label>Target margin</label>{numIn(Math.round(draft.targetMargin * 100), (v) => setDraft({ ...draft, targetMargin: v / 100 }))}<span className="dim">% over cost</span></div>
      )}
      {c.buys.map((sku) => (
        <div key={sku} className="pgroup">
          <div className="pt">{sku.replace("-", " ")}</div>
          <div className="prow"><label>Walk-away price</label>{numIn(draft.maxUnitPrice[sku] ?? 0, (v) => setDraft({ ...draft, maxUnitPrice: { ...draft.maxUnitPrice, [sku]: v } }), 0.05)}<span className="dim">USD / unit</span></div>
          <div className="prow"><label>Reorder point</label>{numIn(draft.reorderPoint[sku] ?? 0, (v) => setDraft({ ...draft, reorderPoint: { ...draft.reorderPoint, [sku]: v } }))}<span className="dim">units</span></div>
          <div className="prow"><label>Reorder quantity</label>{numIn(draft.reorderQty[sku] ?? 0, (v) => setDraft({ ...draft, reorderQty: { ...draft.reorderQty, [sku]: v } }))}<span className="dim">units</span></div>
        </div>
      ))}
      <div className="prow locked"><label>Fair-dealing guardrails</label><span className="green mono">ENFORCED</span><span className="dim">protocol-level, not editable</span></div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <button className="btn primary" onClick={save}>Update agent policy</button>
        <span className="green" style={{ fontSize: 12 }}>{saved}</span>
      </div>
    </div>
  );
}

export function CompanyConsole({ s, companyId, asCompany = false }: { s: State; companyId: string; asCompany?: boolean }) {
  const c = s.companies.find((x) => x.id === companyId);
  const [pinned, setPinned] = useState<string>();
  const names = Object.fromEntries(s.companies.map((x) => [x.id, x.name]));

  const deals = useMemo(
    () => Object.values(s.dealMap).filter((d) => d.buyer === companyId || d.seller === companyId).sort((a, b) => b.createdAt - a.createdAt),
    [s.dealMap, companyId],
  );
  const follow = deals.find((d) => OPEN.has(d.stage))?.id ?? deals[0]?.id;
  const selected = pinned && deals.some((d) => d.id === pinned) ? pinned : follow;

  const counterparties = useMemo(() => {
    const m = new Map<string, { id: string; bought: number; sold: number; volume: number }>();
    for (const d of deals) {
      if (!d.seller || !["settled", "delivering", "delivered"].includes(d.stage)) continue;
      const other = d.buyer === companyId ? d.seller : d.buyer;
      const row = m.get(other) ?? { id: other, bought: 0, sold: 0, volume: 0 };
      if (d.buyer === companyId) row.bought++; else row.sold++;
      row.volume += d.valueUsd ?? 0;
      m.set(other, row);
    }
    // Also list suppliers we could buy from, even before the first trade.
    for (const sku of c?.buys ?? []) for (const sup of s.companies) if (sup.id !== companyId && sup.sells.includes(sku) && !m.has(sup.id)) m.set(sup.id, { id: sup.id, bought: 0, sold: 0, volume: 0 });
    return [...m.values()].sort((a, b) => b.volume - a.volume);
  }, [deals, s.companies, companyId, c]);

  if (!c) return <div className="empty">Company not found.</div>;
  const gm = c.pnl.revenue - c.pnl.cogs;
  const rep = c.stats.trades + c.stats.violations === 0 ? 1 : c.stats.trades / (c.stats.trades + c.stats.violations);
  const myEvents = s.events.filter((e) => e.company?.split(".")[0] === companyId || e.counterparty?.split(".")[0] === companyId).filter((e) => e.kind !== "a2a").slice(-120).reverse();
  const skus = [...new Set([...c.buys, ...c.sells])];

  return (
    <div className="console">
      <div className="ccol">
        <section className="panel">
          <div className="ph">Company<span className="r dim">{c.role}</span></div>
          <div className="pb" style={{ padding: "14px 16px" }}>
            <div className="cname">{c.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>{c.sector}</div>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>payee (registry)</dt><dd>{short(c.wallet)}</dd>
              {c.buys.length > 0 && <><dt>procurement agent</dt><dd><a href={`/agents/${c.id}.buyer/.well-known/agent-card.json`} target="_blank">{c.id}.buyer ↗</a></dd></>}
              {c.sells.length > 0 && <><dt>sales agent</dt><dd><a href={`/agents/${c.id}.seller/.well-known/agent-card.json`} target="_blank">{c.id}.seller ↗</a></dd></>}
            </dl>
            <div className="kpis">
              <Kpi k="Treasury" v={usdK(c.cash)} />
              {c.sells.length > 0 ? <Kpi k="Gross margin" v={usdK(gm)} tone={gm > 0 ? "green" : ""} /> : <Kpi k="Spend" v={usdK(c.pnl.spend)} />}
              <Kpi k="Trades" v={String(c.stats.trades || deals.filter((d) => d.stage === "delivered").length)} />
              <Kpi k="Reputation" v={`${(rep * 100).toFixed(0)}%`} tone={rep > 0.9 ? "green" : "red"} />
              {c.pnl.lostSales > 0 && <Kpi k="Lost sales" v={usdK(c.pnl.lostSales)} tone="amber" />}
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="ph">Inventory &amp; agents</div>
          <div className="pb" style={{ padding: "6px 16px 12px" }}>
            {skus.map((sku) => {
              const inv = c.inventory[sku] ?? 0;
              const rp = c.policy.reorderPoint[sku];
              const burn = burnRate(c, sku);
              const busy = deals.find((d) => d.sku === sku && d.buyer === companyId && OPEN.has(d.stage));
              const scale = Math.max(inv + (c.incoming[sku] ?? 0), (rp ?? 0) * 2.6, 1);
              return (
                <div className="sku" key={sku}>
                  <div className="row"><b>{sku.replace("-", " ")}</b><span className="mono">{num(inv)}{c.reserved[sku] ? <span className="dim"> · {num(c.reserved[sku])} reserved</span> : null}</span></div>
                  <div className="bar" style={{ height: 6 }}>
                    <i style={{ width: `${Math.min(100, (inv / scale) * 100)}%`, background: rp !== undefined && inv <= rp ? "var(--amber)" : "var(--cyan)" }} />
                    {c.incoming[sku] ? <span className="inc" style={{ left: `${(inv / scale) * 100}%`, width: `${((c.incoming[sku] ?? 0) / scale) * 100}%` }} /> : null}
                    {rp !== undefined && <span className="rp" style={{ left: `${(rp / scale) * 100}%` }} />}
                  </div>
                  <div className="row dim mono" style={{ fontSize: 10.5 }}>
                    <span>{rp !== undefined ? `reorder at ${num(rp)}` : c.sells.includes(sku) ? "for sale" : ""}{burn ? ` · ${(inv / burn).toFixed(0)} ticks of cover` : ""}</span>
                    <span style={{ color: busy ? STAGE_COLOR[busy.stage] : undefined }}>{busy ? `agent: ${busy.stage}` : c.buys.includes(sku) ? "agent: idle" : ""}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel" style={{ flex: 1 }}>
          <div className="ph">Agent policy</div>
          <div className="pb" style={{ padding: "8px 16px 14px" }}><PolicyEditor c={c} asCompany={asCompany} /></div>
        </section>
      </div>

      <div className="ccol">
        <Approvals s={s} company={companyId} docked onDecide={asCompany ? approveAsCompany : approve} />
        <section className="panel" style={{ flex: 1.4 }}>
          <div className="ph">Our deals<span className="r dim">{deals.length} total · buy &amp; sell side</span></div>
          <div className="pb">
            <table className="blotter">
              <thead><tr><th>Time</th><th>Side</th><th>Counterparty</th><th>SKU</th><th>Qty</th><th>Price</th><th>Value</th><th>Stage</th></tr></thead>
              <tbody>
                {deals.slice(0, 80).map((d) => {
                  const buy = d.buyer === companyId;
                  const other = buy ? d.seller : d.buyer;
                  return (
                    <tr key={d.id} className={selected === d.id ? "sel" : ""} onClick={() => setPinned(d.id)}>
                      <td className="dim">{time(d.createdAt)}</td>
                      <td className={buy ? "cyan" : "violet"}>{buy ? "BUY" : "SELL"}</td>
                      <td>{other ? names[other] : <span className="dim">sourcing…</span>}</td>
                      <td>{d.sku}</td>
                      <td>{num(d.qty)}</td>
                      <td>{usd(d.unitPrice)}</td>
                      <td>{d.valueUsd ? usdK(d.valueUsd) : "—"}</td>
                      <td><span className="stage" style={{ ["--c" as string]: STAGE_COLOR[d.stage] }}>{d.stage}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!deals.length && <div className="empty">No deals yet. Your agents start sourcing as soon as stock drops below a reorder point.</div>}
          </div>
        </section>
        <section className="panel" style={{ flex: 1 }}>
          <div className="ph">Counterparties<span className="r dim">on-chain reputation</span></div>
          <div className="pb">
            <table className="blotter">
              <thead><tr><th>Company</th><th>Relationship</th><th>Volume</th><th>Violations</th><th>Status</th></tr></thead>
              <tbody>
                {counterparties.map((r) => {
                  const o = s.companies.find((x) => x.id === r.id);
                  if (!o) return null;
                  const q = o.stats.violations >= 3;
                  return (
                    <tr key={r.id} style={{ cursor: "default" }}>
                      <td>{o.name}</td>
                      <td className="dim">{r.bought ? `supplier · ${r.bought} buys` : r.sold ? `customer · ${r.sold} sales` : "eligible supplier"}</td>
                      <td>{r.volume ? usdK(r.volume) : "—"}</td>
                      <td className={o.stats.violations ? "red" : "dim"}>{o.stats.violations}</td>
                      <td>{q ? <span className="red">quarantined</span> : o.stats.violations ? <span className="amber">watch</span> : <span className="green">good standing</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="ccol">
        <section className="panel" style={{ flex: 1.6 }}>
          <div className="ph">Deal detail<span className="r dim">your view · counterparty data private</span></div>
          <div className="pb"><DealInspector s={s} dealId={selected} viewer={companyId} /></div>
        </section>
        <section className="panel" style={{ flex: 1 }}>
          <div className="ph">Activity</div>
          <div className="pb">
            <div className="tape">
              {myEvents.map((e) => (
                <div key={e.seq} className={e.severity ?? ""} onClick={() => e.dealId && setPinned(e.dealId)} style={{ cursor: e.dealId ? "pointer" : "default" }}>
                  <span className="dim">{time(e.ts)}</span>
                  <span className="k">{e.kind}</span>
                  <span className="x" title={e.title}>{e.title}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
