import { ThemeToggle } from "./theme";
import { useEffect, useMemo, useState } from "react";
import { control, useConcord } from "./store";
import { NetworkGraph } from "./components/NetworkGraph";
import { DealInspector } from "./components/DealInspector";
import { Approvals, Blotter, EventTape, OnboardDialog, PnlTable, PriceIndex } from "./components/Panels";
import { usdK } from "./format";
import { CompanyConsole } from "./components/CompanyConsole";

const readView = () => "";

const LIVE_STAGES = new Set(["negotiating", "agreed", "mandate", "signing", "submitted", "settling", "awaiting-approval"]);

export default function OperatorApp() {
  const s = useConcord();
  const [pinned, setPinned] = useState<string>();
  const [onboard, setOnboard] = useState(false);
  const [viewAs, setViewAs] = useState(readView);
  const switchView = (id: string) => setViewAs(id);
  // Lets the demo recorder (scripts/record-demo.mjs) focus a specific deal in the inspector.
  useEffect(() => { (window as unknown as { __concordSelect?: (id?: string) => void }).__concordSelect = setPinned; }, []);

  // Follow the most recent interesting deal unless the user pinned one.
  const follow = useMemo(() => {
    const ds = Object.values(s.dealMap).sort((a, b) => b.updatedAt - a.updatedAt);
    return (ds.find((d) => LIVE_STAGES.has(d.stage)) ?? ds[0])?.id;
  }, [s.dealMap]);
  const selected = pinned ?? follow;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setPinned(undefined); setOnboard(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const volume = Object.values(s.dealMap).reduce((a, d) => a + (["settled", "delivering", "delivered"].includes(d.stage) ? d.valueUsd ?? 0 : 0), 0);
  const settled = Object.values(s.dealMap).filter((d) => ["settled", "delivering", "delivered"].includes(d.stage)).length;
  const blocked = s.companies.reduce((a, c) => a + c.stats.violations, 0);

  const switcher = (
    <select className="viewas" value={viewAs} onChange={(e) => switchView(e.target.value)}>
      <option value="">View as: Network operator</option>
      {s.companies.map((c) => <option key={c.id} value={c.id}>View as: {c.name}</option>)}
    </select>
  );

  if (viewAs) {
    return (
      <div className="app company">
        <header className="top">
          <div className="brand"><span className="word">Concord</span><span className="tag">company console</span></div>
          <div className="chips">
            <span className="chip" style={{ color: s.connected ? "var(--green)" : "var(--red)" }}><i className="dot live" /> <b>T{s.tick}</b></span>
            <span className="chip" style={{ color: s.config.hspMode === "live" ? "var(--green)" : "var(--amber)" }}>HSP <b>{s.config.hspMode === "live" ? "LIVE · QA" : "SIMULATED"}</b></span>
            <span className="chip">LEDGER <b>{s.config.ledger ? `HSK ${s.config.chainId}` : "LOCAL"}</b></span>
          </div>
          <div className="spacer" />
          {switcher}
          <ThemeToggle />
        </header>
        <CompanyConsole s={s} companyId={viewAs} />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand"><span className="word">Concord</span><span className="tag">network operator</span></div>
        <div className="chips">
          <span className="chip" style={{ color: s.connected ? "var(--green)" : "var(--red)" }}><i className="dot live" /> <b>T{s.tick}</b></span>
          <span className="chip" style={{ color: s.config.hspMode === "live" ? "var(--green)" : "var(--amber)" }}>HSP <b>{s.config.hspMode === "live" ? "LIVE · QA" : "SIMULATED"}</b></span>
          <span className="chip">LEDGER <b>{s.config.ledger ? `HSK ${s.config.chainId}` : "LOCAL"}</b></span>
          <span className="chip">AGENTS <b className={s.config.llm ? "violet" : ""}>{s.config.llm ? s.config.model : "rule-based"}</b></span>
          <span className="chip">SETTLED <b className="gold">{settled} · {usdK(volume)}</b></span>
          <span className="chip">BLOCKED <b className={blocked ? "red" : ""}>{blocked}</b></span>
        </div>
        <div className="spacer" />
        {switcher}
        <ThemeToggle />
        <div className="seg">
          <button className={!s.running ? "on" : ""} onClick={() => control({ action: s.running ? "pause" : "resume" })}>{s.running ? "❚❚" : "▶"}</button>
          {[1, 2, 4].map((v) => <button key={v} className={s.speed === v ? "on" : ""} onClick={() => control({ action: "speed", value: v })}>{v}×</button>)}
        </div>
        <button className="btn" onClick={() => control({ action: "spike", company: "monsoon-cafe", sku: "roasted-coffee" })}>Demand shock</button>
        <button className="btn danger" onClick={() => control({ action: "rogue" })}>Inject rogue agent</button>
        <button className="btn primary" onClick={() => setOnboard(true)}>+ Onboard company</button>
      </header>

      <div className="main">
        <div className="left">
          <section className="panel">
            <div className="ph">Live trade network<span className="r dim">{s.companies.length} companies · {s.companies.reduce((a, c) => a + (c.buys.length ? 1 : 0) + (c.sells.length ? 1 : 0), 0)} agents · <a href="/.well-known/agent-card.json" target="_blank">agent directory ↗</a></span></div>
            <NetworkGraph s={s} selected={selected} onSelect={setPinned} />
          </section>
          <div className="lower">
            <section className="panel">
              <div className="ph">Fair price index<span className="r dim">rolling median of settled trades · ±{(s.config.fairBand * 100).toFixed(0)}% band</span></div>
              <div className="pb" style={{ overflow: "hidden" }}><PriceIndex s={s} /></div>
            </section>
            <section className="panel">
              <div className="ph">Deal blotter</div>
              <div className="pb"><Blotter s={s} selected={selected} onSelect={setPinned} /></div>
            </section>
          </div>
        </div>
        <div className="right">
          <Approvals s={s} />
          <section className="panel">
            <div className="ph">Deal inspector<span className="r">{pinned ? <a onClick={() => setPinned(undefined)} style={{ cursor: "pointer" }}>pinned · follow live ↻</a> : <span className="dim">following live</span>}</span></div>
            <div className="pb"><DealInspector s={s} dealId={selected} /></div>
          </section>
          <section className="panel">
            <div className="ph">Event tape</div>
            <div className="pb"><EventTape s={s} onSelect={setPinned} /></div>
          </section>
        </div>
      </div>

      <section className="panel">
        <div className="ph">Company ledger · P&amp;L<span className="r dim">every seller profits · every buyer stays supplied · violators priced out</span></div>
        <div className="pb"><PnlTable s={s} /></div>
      </section>

      {onboard && <OnboardDialog s={s} onClose={() => setOnboard(false)} />}
    </div>
  );
}
