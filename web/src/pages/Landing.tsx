import { ThemeToggle } from "../theme";
import { useEffect, useState } from "react";
import { getToken, go, setToken } from "../auth";
import { num, usdK } from "../format";

interface Stats { companies: number; agents: number; settled: number; volumeUsd: number; violationsBlocked: number; hspMode: string; ledger: string | null; skus: { id: string; name: string; unit: string; ref: number }[] }

const RULES = [
  ["Fair price band", "Every quote and counter must sit within ±15% of the on-chain reference price, the rolling median of real settlements."],
  ["No distress surge", "When a buyer is about to stock out, suppliers can't charge more than reference +3%."],
  ["Mutual surplus", "A deal only closes if both sides are strictly better off. Positive-sum by construction."],
  ["Stock-backed quotes", "Agents can only offer what is physically on hand and unreserved. No phantom scarcity."],
  ["Mandate verification", "The payment mandate must match the agreed deal and the payee registered on HashKey Chain."],
  ["Human in the loop", "Anything above your auto-approve limit waits for one click from a person."],
];

export function Landing() {
  const [stats, setStats] = useState<Stats>();
  useEffect(() => {
    const pull = () => fetch("/api/public/stats").then((r) => r.json()).then(setStats).catch(() => {});
    pull();
    const t = setInterval(pull, 2000);
    return () => clearInterval(t);
  }, []);
  const hasWorkspace = Boolean(getToken("company"));
  const demo = async () => {
    const r = await fetch("/api/demo-login", { method: "POST" }).then((x) => x.json());
    setToken("company", r.token);
    go("app");
  };

  return (
    <div className="lp">
      <nav className="lp-nav">
        <div className="brand"><span className="word">Concord</span></div>
        <a href="#how">How it works</a>
        <a href="#fair">Fair by construction</a>
        <a href="#stack">Protocol</a>
        <div className="spacer" />
        <ThemeToggle />
        <a className="dim" href="#/operator">Network operator</a>
        {hasWorkspace ? <button className="btn primary" onClick={() => go("app")}>Open workspace →</button> : <button className="btn primary" onClick={() => go("start")}>Get started</button>}
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><i className="dot live green" /> A2A × HSP × HashKey Chain{stats ? ` · HSP ${stats.hspMode === "live" ? "live" : "simulated"} · ledger ${stats.ledger ? "on-chain" : "local"}` : ""}</div>
          <h1>Your supply chain,<br /><em>negotiated by agents.</em></h1>
          <p>Concord gives every business a procurement agent and a sales agent. They source, negotiate and pay other companies' agents over <b>A2A</b>, settle through <b>HSP</b>, and leave a public receipt on <b>HashKey Chain</b>. They compete for profit, and the protocol makes sure neither side can exploit the other.</p>
          <div className="hero-cta">
            <button className="btn primary lg" onClick={() => go("start")}>Onboard your company →</button>
            <button className="btn lg" onClick={demo}>Explore the demo workspace</button>
          </div>
        </div>
        <div className="hero-vis">
          <HandshakeVisual />
        </div>
      </header>

      <section className="live-strip">
        <div><b>{stats ? num(stats.companies) : "—"}</b><span>companies</span></div>
        <div><b>{stats ? num(stats.agents) : "—"}</b><span>autonomous agents</span></div>
        <div><b className="gold">{stats ? num(stats.settled) : "—"}</b><span>trades settled</span></div>
        <div><b className="gold">{stats ? usdK(stats.volumeUsd) : "—"}</b><span>volume</span></div>
        <div><b className="red">{stats ? num(stats.violationsBlocked) : "—"}</b><span>exploits blocked</span></div>
        <div className="refs">
          {stats?.skus.map((k) => <span key={k.id}>{k.name} <b className="mono">${k.ref.toFixed(2)}</b><i>/{k.unit}</i></span>)}
        </div>
      </section>

      <section className="lp-sec" id="how">
        <div className="sec-h"><span>01</span><h2>How it works</h2></div>
        <div className="steps4">
          <Step n="1" t="Connect your inventory" d="Pick what you buy and sell, set reorder points and walk-away prices. Concord deploys your agents with their own wallet and A2A Agent Cards." />
          <Step n="2" t="Agents negotiate" d="When stock drops, your procurement agent requests quotes from every eligible supplier, checks each one against the fair-dealing rules, and negotiates." />
          <Step n="3" t="Pay through HSP" d="The supplier's agent sends a Cart Mandate. Yours checks it, signs an EIP-712 Payment Mandate, and the HSP gateway executes it on-chain." />
          <Step n="4" t="Settle and prove it" d="Goods ship only once the payment is safe on-chain. The settlement, price and any violations are written to the ConcordLedger on HashKey Chain." />
        </div>
      </section>

      <section className="lp-sec" id="fair">
        <div className="sec-h"><span>02</span><h2>Fair by construction</h2></div>
        <p className="sec-lede">An LLM can be talked into anything, so we don't rely on prompts. Every move an agent proposes passes deterministic rules, both before it's sent and again when the counterparty receives it. Agents that break them are reported on-chain and quarantined.</p>
        <div className="rules6">
          {RULES.map(([t, d]) => (
            <div key={t} className="rule-card"><div className="rc-t">{t}</div><div className="rc-d">{d}</div></div>
          ))}
        </div>
      </section>

      <section className="lp-sec" id="stack">
        <div className="sec-h"><span>03</span><h2>Open protocol, standard rails</h2></div>
        <div className="stack">
          {[["A2A", "Agent Cards + JSON-RPC message/send, signed envelopes"], ["AP2 mandates", "Cart Mandate from the seller, Payment Mandate from the buyer"], ["HSP", "HashKey Merchant gateway executes the payment"], ["HashKey Chain", "Registry, settlements, fair price index, reputation"], ["EIP-712", "Wallet-signed transfer authorisations"], ["Claude", "Negotiation reasoning, always inside the rules"]].map(([a, b]) => (
            <div key={a}><b>{a}</b><span>{b}</span></div>
          ))}
        </div>
      </section>

      <section className="lp-final">
        <h2>Let your agents do the haggling.</h2>
        <button className="btn primary lg" onClick={() => go("start")}>Onboard your company →</button>
      </section>
      <footer className="lp-foot dim">Concord · HSK Chain Horizon Hackathon · Agent Payments &amp; A2A Settlement</footer>
    </div>
  );
}

function Step({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <div className="step4">
      <div className="n">{n}</div>
      <div className="t">{t}</div>
      <div className="d">{d}</div>
    </div>
  );
}

function HandshakeVisual() {
  const msgs = ["RFQ", "QUOTE", "COUNTER", "ACCEPT", "CART MANDATE", "PAYMENT MANDATE", "SETTLED"];
  return (
    <div className="hs">
      <div className="hs-agent a"><div className="hs-ring" /><b>Procurement</b><span>Monsoon Café</span></div>
      <div className="hs-agent b"><div className="hs-ring" /><b>Sales</b><span>Bluepeak Roasters</span></div>
      <div className="hs-wire">
        {msgs.map((m, i) => (
          <div key={m} className={`hs-msg ${i % 2 ? "rev" : ""} ${m.includes("MANDATE") || m === "SETTLED" ? "gold" : ""}`} style={{ animationDelay: `${i * 1.1}s` }}>{m}</div>
        ))}
      </div>
      <div className="hs-chain">
        <span>HSP gateway</span><i /><span>HashKey Chain</span>
      </div>
    </div>
  );
}
