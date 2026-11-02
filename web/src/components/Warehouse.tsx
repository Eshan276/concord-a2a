import { useMemo } from "react";
import type { State } from "../store";
import type { Company, Deal } from "../types";
import { num, usdK } from "../format";

// A gamified view of a company's operation: stock as crates on shelves, inbound trucks,
// the two agents "talking", XP, levels, badges and quests — all derived from real engine state.

const SKU_HUE: Record<string, string> = {
  "green-beans": "#7fbf7a", "kraft-bags": "#c9a36b", "oat-milk": "#e9e2cf", "roasted-coffee": "#a8683f",
};
const LEVELS = ["Market Stall", "Corner Shop", "Local Favourite", "Regional Player", "Supply Ace", "Network Legend"];

function xpOf(c: Company, deals: Deal[]) {
  const settled = deals.filter((d) => ["settled", "delivering", "delivered"].includes(d.stage)).length;
  return Math.max(0, settled * 60 + c.stats.onTime * 25 - c.stats.violations * 150);
}

function Crate({ hue, state }: { hue: string; state: "full" | "reserved" | "empty" | "ghost" }) {
  return <i className={`crate ${state}`} style={{ ["--hue" as string]: hue }} />;
}

export function Warehouse({ s, companyId }: { s: State; companyId: string }) {
  const c = s.companies.find((x) => x.id === companyId);
  const deals = useMemo(() => Object.values(s.dealMap).filter((d) => d.buyer === companyId || d.seller === companyId), [s.dealMap, companyId]);
  if (!c) return null;
  const names = Object.fromEntries(s.companies.map((x) => [x.id, x.name]));
  const skus = [...new Set([...c.buys, ...c.sells])];

  const xp = xpOf(c, deals);
  const level = Math.min(LEVELS.length - 1, Math.floor(Math.sqrt(xp / 120)));
  const nextAt = 120 * (level + 1) ** 2, prevAt = 120 * level ** 2;
  const health = c.buys.length
    ? c.buys.reduce((a, k) => a + Math.min(1, (c.inventory[k] ?? 0) / Math.max(1, (c.policy.reorderPoint[k] ?? 1) * 1.5)), 0) / c.buys.length
    : 1;

  const inbound = deals.filter((d) => d.buyer === companyId && ["submitted", "settling", "settled", "delivering"].includes(d.stage));
  const outbound = deals.filter((d) => d.seller === companyId && ["settled", "delivering"].includes(d.stage));
  const settledCount = deals.filter((d) => ["settled", "delivering", "delivered"].includes(d.stage)).length;
  const savings = deals.filter((d) => d.buyer === companyId).reduce((a, d) => a + (d.buyerSurplus ?? 0), 0);
  const earned = deals.filter((d) => d.seller === companyId).reduce((a, d) => a + (d.sellerSurplus ?? 0), 0);

  const lastSaid = (side: "buyer" | "seller") =>
    [...s.events].reverse().find((e) => e.company === `${companyId}.${side}` && (e.kind === "a2a" || e.kind === "payment" || e.kind === "deal"));

  const badges = [
    { id: "fair", icon: "⚖", name: "Fair Trader", hint: "No rule violations, ≥3 trades", got: c.stats.violations === 0 && settledCount >= 3 },
    { id: "stock", icon: "◆", name: "Always Stocked", hint: "Zero lost sales", got: c.pnl.lostSales === 0 && settledCount >= 2 },
    { id: "deal", icon: "✦", name: "Deal Maker", hint: "10 settled trades", got: settledCount >= 10 },
    { id: "chain", icon: "⛓", name: "On-Chain Native", hint: "First HSP settlement", got: settledCount >= 1 },
    { id: "save", icon: "↓", name: "Sharp Buyer", hint: "Save $500 vs walk-away", got: savings >= 500 },
    { id: "earn", icon: "↑", name: "Healthy Margins", hint: "Earn $1k over cost", got: earned >= 1000 },
  ].filter((b) => (b.id === "save" ? c.buys.length : b.id === "earn" ? c.sells.length : true));

  const quests = [
    { name: "Settle 5 trades through HSP", cur: settledCount, max: 5 },
    { name: "Keep supply health above 80%", cur: Math.round(health * 100), max: 80 },
    { name: "Build a 100% reputation over 10 trades", cur: c.stats.violations ? 0 : Math.min(10, c.stats.trades || settledCount), max: 10 },
  ];

  return (
    <div className="wh">
      <div className="wh-top">
        <div className="lvl">
          <div className="lvl-badge">{level + 1}</div>
          <div>
            <div className="lvl-name">{LEVELS[level]}</div>
            <div className="xpbar"><i style={{ width: `${Math.min(100, ((xp - prevAt) / (nextAt - prevAt)) * 100)}%` }} /></div>
            <div className="dim mono" style={{ fontSize: 10.5 }}>{num(xp)} XP · {num(nextAt - xp)} to {LEVELS[Math.min(LEVELS.length - 1, level + 1)]}</div>
          </div>
        </div>
        <div className="gauge">
          <svg viewBox="0 0 120 70">
            <path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke="var(--track)" strokeWidth="10" strokeLinecap="round" />
            <path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke={health > 0.8 ? "var(--green)" : health > 0.45 ? "var(--amber)" : "var(--red)"} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${health * 157} 157`} />
          </svg>
          <div className="gv">{Math.round(health * 100)}<span>%</span></div>
          <div className="gk">supply health</div>
        </div>
        <div className="wh-stats">
          <div><b className="gold">{settledCount}</b><span>settled</span></div>
          <div><b className="cyan">{usdK(savings)}</b><span>saved</span></div>
          <div><b className="violet">{usdK(earned)}</b><span>earned</span></div>
          <div><b className={c.stats.violations ? "red" : "green"}>{c.stats.violations}</b><span>violations</span></div>
        </div>
      </div>

      <div className="floor">
        <div className="bots">
          {c.buys.length > 0 && <Bot name="Procurement agent" color="var(--cyan)" said={lastSaid("buyer")?.title} who={lastSaid("buyer")?.counterparty ? names[lastSaid("buyer")!.counterparty!.split(".")[0]] : undefined} />}
          {c.sells.length > 0 && <Bot name="Sales agent" color="var(--violet)" said={lastSaid("seller")?.title} who={lastSaid("seller")?.counterparty ? names[lastSaid("seller")!.counterparty!.split(".")[0]] : undefined} />}
        </div>
        <div className="bays">
          {skus.map((k) => {
            const inv = c.inventory[k] ?? 0, res = c.reserved[k] ?? 0, inc = c.incoming[k] ?? 0;
            const rp = c.policy.reorderPoint[k];
            const capacity = Math.max(inv + inc, (rp ?? inv / 2) * 2.6, 1);
            const per = capacity / 64;
            const full = Math.round(inv / per), reserved = Math.min(full, Math.round(res / per)), ghost = Math.round(inc / per);
            const rpIdx = rp !== undefined ? Math.round(rp / per) : -1;
            const status = rp === undefined ? "ok" : inv <= rp * 0.35 ? "crit" : inv <= rp ? "low" : "ok";
            const sku = s.skus.find((x) => x.id === k);
            return (
              <div key={k} className={`bay ${status}`}>
                <div className="bay-h">
                  <span>{sku?.name ?? k}</span>
                  <span className="mono">{num(inv)} {sku?.unit}</span>
                </div>
                <div className="shelf">
                  {Array.from({ length: 64 }, (_, i) => (
                    <span key={i} className="slot">
                      {i < full ? <Crate hue={SKU_HUE[k] ?? "#888"} state={i < reserved ? "reserved" : "full"} /> : i < full + ghost ? <Crate hue={SKU_HUE[k] ?? "#888"} state="ghost" /> : <Crate hue="#888" state="empty" />}
                      {i === rpIdx && <b className="rpmark" title="reorder point" />}
                    </span>
                  ))}
                </div>
                <div className="bay-f mono">
                  {status === "crit" ? <span className="red">⚠ stock-out risk — agent sourcing</span> : status === "low" ? <span className="amber">below reorder point</span> : <span className="dim">{c.sells.includes(k) ? "for sale" : "healthy"}</span>}
                  <span className="dim">{res ? `${num(res)} reserved · ` : ""}{inc ? `${num(inc)} inbound` : ""}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="road">
          <div className="lane-line" />
          {inbound.map((d, i) => {
            const pct = d.stage === "submitted" ? 12 : d.stage === "settling" ? 28 : d.stage === "settled" ? 45 : 72;
            return (
              <div key={d.id} className="truck in" style={{ left: `${pct}%`, top: 6 + (i % 2) * 26 }}>
                <span className="cab">▰</span><span className="box" style={{ background: SKU_HUE[d.sku] }}>{num(d.qty)}</span>
                <span className="tl">{names[d.seller ?? ""] ?? "…"} → you · {d.stage === "delivering" ? "on the road" : "paying via HSP"}</span>
              </div>
            );
          })}
          {outbound.map((d, i) => (
            <div key={d.id} className="truck out" style={{ right: `${d.stage === "delivering" ? 60 : 20}%`, top: 6 + ((i + 1) % 2) * 26 }}>
              <span className="box" style={{ background: SKU_HUE[d.sku] }}>{num(d.qty)}</span><span className="cab">▰</span>
              <span className="tl">you → {names[d.buyer]}</span>
            </div>
          ))}
          {!inbound.length && !outbound.length && <div className="road-idle dim"><span style={{ background: "var(--panel-2)", padding: "2px 10px", borderRadius: 4 }}>No trucks on the road. Agents dispatch them when a deal settles.</span></div>}
        </div>
      </div>

      <div className="wh-bottom">
        <div className="badges">
          <div className="t">Badges</div>
          <div className="bgrid">
            {badges.map((b) => (
              <div key={b.id} className={`bdg ${b.got ? "got" : ""}`} title={b.hint}>
                <span className="bi">{b.icon}</span>
                <span className="bn">{b.name}</span>
                <span className="bh">{b.got ? "unlocked" : b.hint}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="quests">
          <div className="t">Quests</div>
          {quests.map((q) => (
            <div key={q.name} className="q">
              <div className="qh"><span>{q.name}</span><span className="mono dim">{Math.min(q.cur, q.max)}/{q.max}</span></div>
              <div className="xpbar thin"><i style={{ width: `${Math.min(100, (q.cur / q.max) * 100)}%`, background: q.cur >= q.max ? "var(--green)" : undefined }} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const SAY: Record<string, string> = {
  RFQ: "Asking suppliers for quotes", QUOTE: "Quoted a price", COUNTER: "Making a counter-offer", ACCEPT: "Accepting the terms",
  REJECT: "Walking away from a deal", PAYMENT_CONDITIONS: "Sent payment conditions (HSP Cart Mandate)", PAYMENT_PROOF: "Paid via HSP, proof sent",
  DELIVERY: "Delivery on its way", ERROR: "Something went wrong",
};
const humanize = (t?: string) => (t ? SAY[t] ?? t.replace(/^payment-/, "Payment ") : t);

function Bot({ name, color, said, who }: { name: string; color: string; said?: string; who?: string }) {
  return (
    <div className="bot">
      <div className="bot-face" style={{ borderColor: color, color }}>
        <i /><i />
      </div>
      <div>
        <div className="bot-name" style={{ color }}>{name}</div>
        <div className="bubble">{said ? <>{humanize(said)}{who ? <span className="dim"> · {who}</span> : null}</> : <span className="dim">Watching stock levels…</span>}</div>
      </div>
    </div>
  );
}
