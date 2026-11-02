import { ThemeToggle } from "../theme";
import { useEffect, useState } from "react";
import { clearToken, getToken, go } from "../auth";
import { useCompanyState } from "../store";
import { CompanyConsole } from "../components/CompanyConsole";
import { Warehouse } from "../components/Warehouse";

export function Workspace() {
  const token = getToken("company");
  const { state, error } = useCompanyState(token);
  const [tab, setTab] = useState<"warehouse" | "ops">("warehouse");

  useEffect(() => {
    if (!token || error === "unauthorized") { clearToken("company"); go(""); }
  }, [token, error]);

  if (!state) return <div className="boot"><span className="word">Concord</span><span className="dim">Connecting to your agents…</span></div>;
  const me = state.companies.find((c) => c.id === state.me);
  const pending = state.approvals.length;

  return (
    <div className="app company">
      <header className="top">
        <div className="brand" onClick={() => go("")} style={{ cursor: "pointer" }}><span className="word">Concord</span></div>
        <div className="ws-co"><b>{me?.name}</b><span className="dim">{me?.sector}</span></div>
        <div className="tabs">
          <button className={tab === "warehouse" ? "on" : ""} onClick={() => setTab("warehouse")}>Warehouse</button>
          <button className={tab === "ops" ? "on" : ""} onClick={() => setTab("ops")}>Operations{pending ? <i className="pill">{pending}</i> : null}</button>
        </div>
        <div className="spacer" />
        <span className="chip" style={{ color: state.config.hspMode === "live" ? "var(--green)" : "var(--amber)" }}>HSP <b>{state.config.hspMode === "live" ? "LIVE" : "SIMULATED"}</b></span>
        <span className="chip">LEDGER <b>{state.config.ledger ? `HSK ${state.config.chainId}` : "LOCAL"}</b></span>
        <span className="chip" style={{ color: error ? "var(--red)" : "var(--green)" }}><i className="dot live" /> <b>{error ? "offline" : `T${state.tick}`}</b></span>
        <ThemeToggle />
        <button className="btn ghost" onClick={() => { clearToken("company"); go(""); }}>Sign out</button>
      </header>
      {tab === "warehouse" ? (
        <div className="ws-body">
          {pending > 0 && (
            <div className="ws-alert" onClick={() => setTab("ops")}>
              <b>{pending} deal{pending > 1 ? "s" : ""} waiting for your approval</b><span>Your agents negotiated terms above your auto-approve limit. Review →</span>
            </div>
          )}
          <Warehouse s={state} companyId={state.me} />
        </div>
      ) : (
        <CompanyConsole s={state} companyId={state.me} asCompany />
      )}
    </div>
  );
}
