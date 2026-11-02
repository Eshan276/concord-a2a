import type { State } from "../store";
import type { Deal, RuleCheck, WorldEvent } from "../types";
import { agentName, short, time, usd } from "../format";
import { STAGE_COLOR } from "./NetworkGraph";

const HSP_STEPS = ["payment-required", "payment-submitted", "payment-verified", "payment-processing", "payment-included", "payment-safe", "payment-finalized"];
const MSG_COLOR: Record<string, string> = {
  RFQ: "var(--cyan)", QUOTE: "var(--cyan)", COUNTER: "var(--violet)", ACCEPT: "var(--green)", REJECT: "var(--red)",
  PAYMENT_CONDITIONS: "var(--gold)", PAYMENT_PROOF: "var(--gold)", DELIVERY: "var(--green)", ERROR: "var(--red)",
};

function Rationale({ text }: { text?: string }) {
  if (!text) return null;
  const m = text.match(/^\[(llm|heuristic)\]\s*(.*)$/s);
  return (
    <div className="why">
      {m && <span className={`src ${m[1]}`}>{m[1] === "llm" ? "LLM" : "RULE-BASED"}</span>}
      {m ? m[2] : text}
    </div>
  );
}

function Zopa({ d, s, viewer }: { d: Deal; s: State; viewer?: string }) {
  const buyer = s.companies.find((c) => c.id === d.buyer);
  const seller = s.companies.find((c) => c.id === d.seller);
  const sku = s.skus.find((k) => k.id === d.sku);
  if (!buyer || !sku) return null;
  const ref = d.refPriceAtDeal ?? sku.band.ref;
  const lo = ref * (1 - s.config.fairBand), hi = ref * (1 + s.config.fairBand);
  // A company only sees its own private numbers; the operator view sees both sides.
  const walk = !viewer || viewer === d.buyer ? buyer.policy.maxUnitPrice[d.sku] : undefined;
  const cost = !viewer || viewer === d.seller ? seller?.policy.unitCost[d.sku] : undefined;
  const vals = [lo, hi, ref, walk, cost, ...d.rounds.map((r) => r.unitPrice), ...d.quotes.map((q) => q.unitPrice)].filter((v): v is number => typeof v === "number");
  const min = Math.min(...vals) * 0.97, max = Math.max(...vals) * 1.03;
  const W = 420, x = (v: number) => ((v - min) / (max - min)) * W;
  const rowY = (by: string) => (by.endsWith(".seller") ? 30 : 60);
  return (
    <div className="zopa">
      <svg viewBox={`0 0 ${W} 92`} preserveAspectRatio="none">
        <defs>
          <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="5" stroke="rgba(231,185,90,0.35)" strokeWidth="1.5" />
          </pattern>
        </defs>
        <rect x={x(lo)} y={14} width={x(hi) - x(lo)} height={60} fill="rgba(114,214,156,0.07)" stroke="rgba(114,214,156,0.35)" strokeDasharray="2 3" />
        {cost !== undefined && walk !== undefined && walk > cost && (
          <rect x={x(cost)} y={40} width={x(walk) - x(cost)} height={10} fill="url(#hatch)" />
        )}
        <line x1={x(ref)} x2={x(ref)} y1={10} y2={78} stroke="var(--text)" strokeOpacity={0.5} />
        <text x={x(ref)} y={88} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="IBM Plex Mono">ref {ref.toFixed(2)}</text>
        <text x={x(lo) + 3} y={10} fontSize="9" fill="var(--green)" fontFamily="IBM Plex Mono" opacity={0.8}>fair band</text>
        {cost !== undefined && <g><line x1={x(cost)} x2={x(cost)} y1={36} y2={54} stroke="var(--red)" strokeWidth={2} /><text x={x(cost)} y={88} textAnchor="middle" fontSize="9" fill="var(--red)" fontFamily="IBM Plex Mono">cost</text></g>}
        {walk !== undefined && <g><line x1={x(walk)} x2={x(walk)} y1={36} y2={54} stroke="var(--cyan)" strokeWidth={2} /><text x={x(walk)} y={88} textAnchor="middle" fontSize="9" fill="var(--cyan)" fontFamily="IBM Plex Mono">walk-away</text></g>}
        {d.quotes.filter((q) => q.violations.length).map((q) => (
          <g key={q.seller} transform={`translate(${x(q.unitPrice)},30)`}>
            <path d="M-4 -4 L4 4 M4 -4 L-4 4" stroke="var(--red)" strokeWidth={2} />
          </g>
        ))}
        <polyline fill="none" stroke="var(--muted)" strokeOpacity={0.5} strokeWidth={1}
          points={d.rounds.map((r) => `${x(r.unitPrice)},${rowY(r.by)}`).join(" ")} />
        {d.rounds.map((r, i) => (
          <circle key={i} cx={x(r.unitPrice)} cy={rowY(r.by)} r={3.5} fill={r.by.endsWith(".seller") ? "var(--violet)" : "var(--cyan)"} />
        ))}
        {d.unitPrice !== undefined && (
          <g transform={`translate(${x(d.unitPrice)},45)`}>
            <rect x={-6} y={-6} width={12} height={12} transform="rotate(45)" fill="var(--gold)" stroke="var(--bg)" />
          </g>
        )}
        {viewer && <text x={W - 2} y={10} textAnchor="end" fontSize="9" fill="var(--dim)" fontFamily="IBM Plex Mono">counterparty {viewer === d.buyer ? "cost" : "walk-away"}: private</text>}
        <text x={2} y={33} fontSize="9" fill="var(--violet)" fontFamily="IBM Plex Mono">seller</text>
        <text x={2} y={63} fontSize="9" fill="var(--cyan)" fontFamily="IBM Plex Mono">buyer</text>
      </svg>
    </div>
  );
}

function RuleGroups({ events }: { events: WorldEvent[] }) {
  const groups = events.filter((e) => e.kind === "rule" && Array.isArray(e.data?.checks));
  if (!groups.length) return <div className="dim" style={{ fontSize: 12 }}>No rule evaluations yet.</div>;
  return (
    <>
      {groups.map((g) => {
        const checks = g.data.checks as RuleCheck[];
        const bad = checks.some((c) => !c.pass && c.severity !== "info" && c.severity !== "escalate");
        return (
          <div key={g.seq} className={`rgroup ${bad ? "bad" : ""}`}>
            <div className="h">{g.title}</div>
            {checks.map((c, i) => (
              <div className="rule" key={i}>
                <span className="ic" style={{ color: c.pass ? (c.severity === "info" ? "var(--dim)" : "var(--green)") : c.severity === "escalate" ? "var(--amber)" : "var(--red)" }}>
                  {c.pass ? (c.severity === "info" ? "·" : "✓") : c.severity === "escalate" ? "!" : "✗"}
                </span>
                <span className="nm">{c.rule}</span>
                <span className="dt">{c.detail}</span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

export function DealInspector({ s, dealId, viewer }: { s: State; dealId?: string; viewer?: string }) {
  const d = dealId ? s.dealMap[dealId] : undefined;
  if (!d) return <div className="empty">Select a deal from the blotter or a live lane in the network.</div>;
  const names = Object.fromEntries(s.companies.map((c) => [c.id, c.name]));
  const sku = s.skus.find((k) => k.id === d.sku);
  const mine = (agent?: string) => !viewer || agent?.split(".")[0] === viewer;
  const allEvs = s.events.filter((e) => e.dealId === d.id);
  // Each company only sees its own rule evaluations and the messages it sent or received.
  const evs = viewer ? allEvs.filter((e) => (e.kind === "a2a" ? mine(e.company) || mine(e.counterparty) : mine(e.company))) : allEvs;
  const msgs = evs.filter((e) => e.kind === "a2a");
  const quotes = viewer && viewer !== d.buyer ? d.quotes.filter((q) => q.seller === viewer) : d.quotes;
  const hist = d.hsp?.statusHistory.map((h) => h.status) ?? [];
  const cur = d.hsp?.status;
  const failed = cur === "payment-failed";
  const reached = (st: string) => st === "payment-required" ? Boolean(d.hsp) : hist.includes(st);
  const total = (d.buyerSurplus ?? 0) + (d.sellerSurplus ?? 0);

  return (
    <div className="insp">
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <span className="badge" style={{ color: STAGE_COLOR[d.stage], borderColor: STAGE_COLOR[d.stage] }}>{d.stage.toUpperCase()}</span>
        <span className={`badge ${d.urgency === "critical" ? "crit" : d.urgency === "elevated" ? "elev" : "norm"}`}>{d.urgency.toUpperCase()}</span>
        <span className="mono dim" style={{ marginLeft: "auto", fontSize: 10.5 }}>{d.id}</span>
      </div>
      <h2>{sku?.name} × {d.qty} {sku?.unit}</h2>
      <div className="sub">{names[d.buyer]} ← {d.seller ? names[d.seller] : "awaiting quotes"}{d.note ? <span className="amber"> · {d.note}</span> : null}</div>

      <div className="sect">
        <div className="t">Negotiation · zone of agreement</div>
        <Zopa d={d} s={s} viewer={viewer} />
        {d.unitPrice !== undefined && viewer && (
          <div style={{ fontSize: 12 }} className="mono">
            {usd(d.unitPrice)} × {d.qty} = <span className="gold">{usd(d.valueUsd)}</span> ·{" "}
            {viewer === d.buyer ? <span className="cyan">we saved {usd(d.buyerSurplus)} vs our walk-away</span> : <span className="violet">we earned {usd(d.sellerSurplus)} over cost</span>}
          </div>
        )}
        {d.unitPrice !== undefined && !viewer && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }} className="mono">
              <span className="cyan">buyer saves {usd(d.buyerSurplus)}</span>
              <span className="gold">{usd(d.unitPrice)} × {d.qty} = {usd(d.valueUsd)}</span>
              <span className="violet">seller earns {usd(d.sellerSurplus)}</span>
            </div>
            {total > 0 && (
              <div className="split">
                <i style={{ width: `${((d.buyerSurplus ?? 0) / total) * 100}%`, background: "var(--cyan)" }} />
                <i style={{ width: `${((d.sellerSurplus ?? 0) / total) * 100}%`, background: "var(--violet)" }} />
              </div>
            )}
            <div className="dim" style={{ fontSize: 11 }}>Both sides end strictly better off: a positive-sum trade, enforced by <span className="mono">MUTUAL_SURPLUS</span>.</div>
          </>
        )}
        {quotes.length > 0 && (
          <table className="blotter" style={{ marginTop: 10 }}>
            <thead><tr><th>Quote</th><th>Price</th><th>Lead</th><th>Verdict</th></tr></thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.seller} style={{ cursor: "default" }}>
                  <td>{names[q.seller] ?? q.seller}</td>
                  <td>{usd(q.unitPrice)}</td>
                  <td>{q.leadTicks}t</td>
                  <td style={{ whiteSpace: "normal" }}>{q.violations.length ? <span className="red">✗ {q.violations.join(", ")}</span> : q.accepted ? <span className="green">selected</span> : <span className="dim">passed</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="sect">
        <div className="t">HSP settlement {d.hsp && <span className={`badge ${d.hsp.mode === "live" ? "live" : "sim"}`}>{d.hsp.mode === "live" ? "LIVE · HSP QA" : "SIMULATED GATEWAY"}</span>}</div>
        {d.hsp ? (
          <>
            <div className="steps">
              {HSP_STEPS.map((st) => (
                <div key={st} className={`step ${reached(st) ? "done" : ""} ${cur === st && !st.endsWith("finalized") ? "cur" : ""}`}>{st.replace("payment-", "")}</div>
              ))}
              {failed && <div className="step fail">failed</div>}
            </div>
            <dl className="kv">
              <dt>flow_id</dt><dd>{d.hsp.flowId}</dd>
              <dt>payment_request_id</dt><dd>{d.hsp.paymentRequestId}</dd>
              <dt>cart_hash</dt><dd>{short(d.hsp.cartHash)}</dd>
              <dt>token_total_raw</dt><dd>{d.hsp.tokenTotalRaw ?? "—"} <span className="dim">raw units · {d.hsp.token} on {d.hsp.network}</span></dd>
              <dt>payer → pay_to</dt><dd>{short(d.hsp.payer)} → {short(d.hsp.payTo)}</dd>
              <dt>tx</dt><dd>{d.hsp.txHash ? <a href={`https://testnet-explorer.hsk.xyz/tx/${d.hsp.txHash}`} target="_blank">{short(d.hsp.txHash)}</a> : <span className="dim">{d.hsp.mode === "sim" ? "none (simulated, not broadcast)" : "pending broadcast"}</span>}</dd>
              <dt>attribution</dt><dd>{d.hsp.attributionVerified === undefined ? "—" : d.hsp.attributionVerified ? <span className="green">verified · {s.config.merchantName}</span> : <span className="red">not verified</span>}</dd>
              <dt>HSK ledger</dt><dd>{d.ledgerTx ? <a href={`${s.config.explorer}/tx/${d.ledgerTx}`} target="_blank">{short(d.ledgerTx)}</a> : <span className="dim">{s.config.ledger ? "anchoring…" : "local (ledger not configured)"}</span>}</dd>
            </dl>
          </>
        ) : <div className="dim" style={{ fontSize: 12 }}>No payment mandate yet.</div>}
      </div>

      <div className="sect">
        <div className="t">Rule engine · audit trail</div>
        <RuleGroups events={evs} />
      </div>

      <div className="sect">
        <div className="t">A2A transcript · signed envelopes</div>
        {msgs.map((m) => {
          const b = m.data?.body ?? {};
          const price = b.unitPrice !== undefined ? usd(b.unitPrice) : b.amountUsd !== undefined ? `${b.amountUsd} USD via HSP` : b.qty !== undefined ? `${b.qty} units` : "";
          return (
            <div className="msg" key={m.seq}>
              <div className="ty" style={{ color: MSG_COLOR[b.type] ?? "var(--muted)" }}>{b.type}</div>
              <div>
                <div className="who">{agentName(m.company, names)} → {agentName(m.counterparty, names)} <span className="dim mono" style={{ fontSize: 10 }}>{time(m.ts)}</span></div>
                <div className="body mono">{price}{b.urgency ? ` · urgency ${b.urgency}` : ""}{b.reason ? <span className="red"> {b.reason}</span> : null}{b.status ? ` · ${b.status}` : ""}</div>
                <Rationale text={b.rationale} />
                <div className="hash">sha256 {short(m.data?.hash)} · EIP-191 signed</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
