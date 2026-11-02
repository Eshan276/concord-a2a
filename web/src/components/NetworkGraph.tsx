import { useEffect, useMemo, useRef, useState } from "react";
import type { State } from "../store";
import type { Company, Deal } from "../types";
import { num, usdK } from "../format";

const TIERS = ["Producers & importers", "Processors", "Retail"];
const ACTIVE = new Set(["rfq", "negotiating", "agreed", "mandate", "awaiting-approval", "signing", "submitted", "settling", "settled", "delivering"]);
export const STAGE_COLOR: Record<string, string> = {
  rfq: "var(--cyan)", negotiating: "var(--cyan)", agreed: "var(--violet)", mandate: "var(--violet)",
  "awaiting-approval": "var(--amber)", signing: "var(--gold)", submitted: "var(--gold)", settling: "var(--gold)",
  settled: "var(--gold)", delivering: "var(--green)", delivered: "var(--green)", failed: "var(--red)", rejected: "var(--dim)",
};

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, set] = useState({ w: 900, h: 520 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => set({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function layout(companies: Company[], w: number, h: number) {
  const cols = [0.15, 0.5, 0.85];
  const pos: Record<string, { x: number; y: number; compact?: boolean }> = {};
  for (let t = 0; t < 3; t++) {
    const col = companies.filter((c) => Math.min(2, c.tier) === t);
    const top = 70, bottom = h - 50;
    const compact = (bottom - top) / Math.max(1, col.length) < 132;
    col.forEach((c, i) => {
      pos[c.id] = { x: w * cols[t], y: top + ((i + 0.5) * (bottom - top)) / col.length, compact };
    });
  }
  return pos;
}

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = (b.x - a.x) * 0.5;
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export function NetworkGraph({ s, selected, onSelect }: { s: State; selected?: string; onSelect: (dealId: string) => void }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const pos = useMemo(() => layout(s.companies, w, h), [s.companies.map((c) => c.id + c.tier).join(), w, h]);

  // Potential trade lanes: seller → buyer for every SKU they share.
  const lanes = useMemo(() => {
    const out: { from: string; to: string; key: string }[] = [];
    for (const sel of s.companies) for (const b of s.companies)
      if (sel.id !== b.id && sel.sells.some((k) => b.buys.includes(k))) out.push({ from: sel.id, to: b.id, key: `${sel.id}>${b.id}` });
    return out;
  }, [s.companies]);

  const activeDeals = useMemo(() => {
    const m = new Map<string, Deal>();
    for (const d of Object.values(s.dealMap)) if (d.seller && ACTIVE.has(d.stage)) {
      const k = `${d.seller}>${d.buyer}`;
      const prev = m.get(k);
      if (!prev || prev.updatedAt < d.updatedAt) m.set(k, d);
    }
    return m;
  }, [s.dealMap]);

  const busy = useMemo(() => {
    const set = new Set<string>();
    for (const d of activeDeals.values()) { set.add(d.buyer); if (d.seller) set.add(d.seller); }
    for (const d of Object.values(s.dealMap)) if (d.stage === "rfq" || d.stage === "negotiating") set.add(d.buyer);
    return set;
  }, [activeDeals, s.dealMap]);

  const alerts = useMemo(() => {
    const now = Date.now();
    const set = new Set<string>();
    for (const p of s.pulses) if (p.kind === "violation" && now - p.born < 1500) set.add(p.from);
    return set;
  }, [s.pulses]);

  const path = (from: string, to: string) => {
    const a = pos[from], b = pos[to];
    if (!a || !b) return "";
    // Lanes always drawn seller(left) → buyer(right); pulses may travel either way.
    return edgePath(a, b);
  };

  return (
    <div className="net" ref={ref}>
      <div className="grid-bg" />
      {TIERS.map((t, i) => <div key={t} className="tier-label" style={{ left: `${[15, 50, 85][i]}%` }}>{t}</div>)}
      <svg>
        {lanes.map((l) => {
          const d = activeDeals.get(l.key);
          const p = path(l.from, l.to);
          if (!p) return null;
          return (
            <g key={l.key} style={{ cursor: d ? "pointer" : "default" }} onClick={() => d && onSelect(d.id)}>
              <path d={p} className={`lane ${d ? "active" : ""}`} style={d ? { stroke: STAGE_COLOR[d.stage], opacity: selected === d.id ? 1 : 0.75 } : undefined} />
            </g>
          );
        })}
        {[...activeDeals.values()].map((d) => {
          const a = pos[d.seller!], b = pos[d.buyer];
          if (!a || !b) return null;
          const price = d.unitPrice ?? d.rounds[d.rounds.length - 1]?.unitPrice;
          return (
            <text key={d.id} className="lane-label" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} textAnchor="middle" style={{ fill: STAGE_COLOR[d.stage] }}>
              {d.stage.replace("-", " ")}{price ? ` · $${price.toFixed(2)}` : ""}
            </text>
          );
        })}
      </svg>
      {s.pulses.map((p) => {
        const a = pos[p.from], b = pos[p.to];
        if (!a || !b) return null;
        return <div key={p.id} className={`pulse ${p.kind}`} style={{ offsetPath: `path('${edgePath(a, b)}')` }} />;
      })}
      {s.companies.map((c) => {
        const p = pos[c.id];
        if (!p) return null;
        const rogue = c.policy.strategy === "rogue";
        const quarantined = c.stats.violations >= 3;
        const skus = [...new Set([...c.buys, ...c.sells])].slice(0, 3);
        const margin = c.pnl.revenue - c.pnl.cogs;
        return (
          <div key={c.id} className={`node ${p.compact ? "compact" : ""} ${busy.has(c.id) ? "busy" : ""} ${alerts.has(c.id) ? "alert" : ""} ${quarantined ? "quarantined" : ""}`} style={{ left: p.x, top: p.y }}>
            <div className="nm">
              {c.name}
              <span className={`role ${rogue ? "rogue" : ""}`}>{rogue ? "UNTRUSTED" : c.role.toUpperCase()}</span>
            </div>
            <div className="sec">{quarantined ? <span className="red">Quarantined · {c.stats.violations} violations</span> : c.sector}</div>
            {skus.map((k) => {
              const inv = c.inventory[k] ?? 0;
              const rp = c.policy.reorderPoint[k];
              const scale = Math.max(inv + (c.incoming[k] ?? 0), (rp ?? 0) * 2.6, 1);
              const low = rp !== undefined && inv <= rp;
              const crit = rp !== undefined && inv <= rp * 0.35;
              return (
                <div className="inv" key={k}>
                  <span>{k.replace("-", " ")}</span>
                  <div className="bar">
                    <i style={{ width: `${Math.min(100, (inv / scale) * 100)}%`, background: crit ? "var(--red)" : low ? "var(--amber)" : c.buys.includes(k) ? "var(--cyan)" : "var(--muted)" }} />
                    {c.incoming[k] ? <span className="inc" style={{ left: `${Math.min(100, (inv / scale) * 100)}%`, width: `${Math.min(100, ((c.incoming[k] ?? 0) / scale) * 100)}%` }} /> : null}
                    {rp !== undefined && <span className="rp" style={{ left: `${(rp / scale) * 100}%` }} />}
                  </div>
                  <span style={{ textAlign: "right" }}>{num(inv)}</span>
                </div>
              );
            })}
            <div className="foot">
              <span>{usdK(c.cash)}</span>
              <span className={margin > 0 ? "green" : "dim"}>{c.sells.length ? `GM ${usdK(margin)}` : `spend ${usdK(c.pnl.spend)}`}</span>
              <span className="dim">{c.stats.trades}✓ {c.stats.violations ? <b className="red">{c.stats.violations}✗</b> : null}</span>
            </div>
          </div>
        );
      })}
      <div className="legend">
        <span><i className="dot cyan" /> A2A message</span>
        <span><i className="dot gold" /> HSP settlement</span>
        <span><i className="dot green" /> goods delivered</span>
        <span><i className="dot red" /> rule violation</span>
        <span style={{ marginLeft: 10 }}>▏ reorder point · ░ in transit</span>
      </div>
    </div>
  );
}
