import { useState } from "react";
import { getToken, go, setToken } from "../auth";
import OperatorApp from "../App";

export function OperatorGate() {
  const [token, set] = useState(getToken("admin"));
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  if (token) return <OperatorApp />;
  const submit = async () => {
    const r = await fetch("/api/state", { headers: { authorization: `Bearer ${draft.trim()}` } });
    if (!r.ok) return setErr("That token was rejected.");
    setToken("admin", draft.trim());
    set(draft.trim());
  };
  return (
    <div className="boot">
      <div className="gate">
        <div className="brand"><span className="word">Concord</span><span className="tag">network operator</span></div>
        <p className="muted">The control room sees every company on the network, so it's restricted to the network operator. The token is printed when the engine starts.</p>
        <div className="field"><label>Operator token</label><input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="adm_…" /></div>
        {err && <div className="red" style={{ marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={() => go("")}>Back</button>
          <button className="btn primary" onClick={submit}>Enter control room</button>
        </div>
      </div>
    </div>
  );
}
