import { ThemeToggle } from "../theme";
import { useEffect, useState } from "react";
import { go, setToken } from "../auth";

interface Sku { id: string; name: string; unit: string; ref: number }

const TYPES = [
  { id: "cafe", label: "Café / retailer", d: "Buys roasted coffee and oat milk", buys: ["roasted-coffee", "oat-milk"], sells: [] as string[] },
  { id: "roaster", label: "Roaster / manufacturer", d: "Buys beans and bags, sells roasted coffee", buys: ["green-beans", "kraft-bags"], sells: ["roasted-coffee"] },
  { id: "supplier", label: "Supplier / producer", d: "Sells raw goods to the network", buys: [] as string[], sells: ["green-beans"] },
];

const DEPLOY = [
  "Generating secp256k1 wallet for your agents",
  "Publishing A2A Agent Cards to the network directory",
  "Registering payee on ConcordLedger (HashKey Chain)",
  "Connecting settlement to HSP gateway",
  "Loading fair-dealing guardrails",
  "Agents online",
];

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [type, setType] = useState("cafe");
  const [buys, setBuys] = useState<string[]>(TYPES[0].buys);
  const [sells, setSells] = useState<string[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({ "roasted-coffee": 3, "oat-milk": 5, "green-beans": 8, "kraft-bags": 8 });
  const [walk, setWalk] = useState<Record<string, number>>({});
  const [autoApprove, setAutoApprove] = useState(1500);
  const [margin, setMargin] = useState(15);
  const [err, setErr] = useState("");
  const [deployed, setDeployed] = useState(0);

  useEffect(() => {
    fetch("/api/public/stats").then((r) => r.json()).then((s) => {
      setSkus(s.skus);
      setWalk(Object.fromEntries(s.skus.map((k: Sku) => [k.id, Math.round(k.ref * 1.18 * 100) / 100])));
    });
  }, []);

  const pickType = (id: string) => {
    const t = TYPES.find((x) => x.id === id)!;
    setType(id); setBuys(t.buys); setSells(t.sells);
  };
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const skuName = (id: string) => skus.find((k) => k.id === id)?.name ?? id;

  const submit = async () => {
    setErr("");
    setStep(3);
    const body = {
      name, sector: sector || TYPES.find((t) => t.id === type)?.label, buys, sells,
      inventory: Object.fromEntries([...buys.map((b) => [b, Math.round((usage[b] ?? 3) * 6)]), ...sells.map((x) => [x, 250])]),
      demand: buys.length && type === "cafe" ? Object.fromEntries(buys.map((b) => [b, usage[b] ?? 3])) : undefined,
      policy: {
        autoApproveUsd: autoApprove,
        targetMargin: margin / 100,
        maxUnitPrice: Object.fromEntries(buys.map((b) => [b, walk[b]])),
        reorderPoint: Object.fromEntries(buys.map((b) => [b, Math.round((usage[b] ?? 3) * 8)])),
        reorderQty: Object.fromEntries(buys.map((b) => [b, Math.round((usage[b] ?? 3) * 15)])),
      },
    };
    const r = await fetch("/api/onboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) { setErr(j.error); setStep(0); return; }
    for (let i = 1; i <= DEPLOY.length; i++) { await new Promise((res) => setTimeout(res, 520)); setDeployed(i); }
    setToken("company", j.token);
  };

  const canNext = step === 0 ? name.trim().length >= 2 : step === 1 ? buys.length + sells.length > 0 : true;

  return (
    <div className="ob">
      <div className="ob-side">
        <div className="brand" onClick={() => go("")} style={{ cursor: "pointer" }}><span className="word">Concord</span></div>
        <ol className="ob-steps">
          {["Company", "Products", "Agent guardrails", "Deploy agents"].map((t, i) => (
            <li key={t} className={i === step ? "cur" : i < step ? "done" : ""}><span>{i < step ? "✓" : i + 1}</span>{t}</li>
          ))}
        </ol>
        <div><ThemeToggle /></div>
        <div className="ob-note dim">Your workspace is private. Other companies only see your name, catalogue and on-chain reputation, never your stock, costs or limits.</div>
      </div>

      <div className="ob-main">
        {step === 0 && (
          <div className="ob-card">
            <h2>Tell us about your company</h2>
            <p className="muted">We'll deploy a procurement agent, a sales agent, or both, depending on what you do.</p>
            <div className="field"><label>Company name</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Colaba Coffee Collective" /></div>
            <div className="field"><label>Sector (optional)</label><input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="e.g. Café · 3 outlets" /></div>
            <div className="field"><label>What kind of business?</label>
              <div className="types">
                {TYPES.map((t) => (
                  <button key={t.id} className={`type ${type === t.id ? "on" : ""}`} onClick={() => pickType(t.id)}>
                    <b>{t.label}</b><span>{t.d}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="ob-card">
            <h2>What do you buy and sell?</h2>
            <p className="muted">Reference prices come from real settlements on the network.</p>
            <div className="field"><label>We buy (procurement agent)</label>
              <div className="checks">{skus.map((k) => <label key={k.id} className={buys.includes(k.id) ? "on" : ""}><input type="checkbox" checked={buys.includes(k.id)} onChange={() => toggle(buys, setBuys, k.id)} />{k.name} <span className="dim mono">${k.ref.toFixed(2)}/{k.unit}</span></label>)}</div>
            </div>
            {buys.map((b) => (
              <div className="row2" key={b}>
                <div className="field"><label>{skuName(b)}: usage per tick</label><input type="number" value={usage[b] ?? 3} onChange={(e) => setUsage({ ...usage, [b]: Number(e.target.value) })} /></div>
                <div className="field"><label>{skuName(b)}: walk-away price (USD)</label><input type="number" step="0.05" value={walk[b] ?? 0} onChange={(e) => setWalk({ ...walk, [b]: Number(e.target.value) })} /></div>
              </div>
            ))}
            <div className="field"><label>We sell (sales agent)</label>
              <div className="checks">{skus.map((k) => <label key={k.id} className={sells.includes(k.id) ? "on" : ""}><input type="checkbox" checked={sells.includes(k.id)} onChange={() => toggle(sells, setSells, k.id)} />{k.name}</label>)}</div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="ob-card">
            <h2>Set your agents' guardrails</h2>
            <p className="muted">You decide how much autonomy they get. You can change these later in your workspace.</p>
            <div className="row2">
              <div className="field"><label>Auto-approve deals up to (USD)</label><input type="number" value={autoApprove} onChange={(e) => setAutoApprove(Number(e.target.value))} /></div>
              {sells.length > 0 && <div className="field"><label>Target margin over cost (%)</label><input type="number" value={margin} onChange={(e) => setMargin(Number(e.target.value))} /></div>}
            </div>
            <div className="locked-rules">
              <div className="lr-h">Protocol rules: always on, can't be switched off</div>
              {["Fair price band ±15% of on-chain reference", "No surge pricing on a buyer in distress", "Both sides must gain from every deal", "Quotes must be backed by real stock", "Payment mandate must match the deal and the registered payee"].map((r) => (
                <div key={r} className="lr"><span className="green">✓</span>{r}</div>
              ))}
            </div>
            {err && <div className="red" style={{ marginTop: 12 }}>{err}</div>}
          </div>
        )}

        {step === 3 && (
          <div className="ob-card deploy">
            <h2>{deployed >= DEPLOY.length ? `${name} is live on Concord` : "Deploying your agents…"}</h2>
            <div className="dlist">
              {DEPLOY.map((d, i) => (
                <div key={d} className={`dl ${i < deployed ? "done" : i === deployed ? "cur" : ""}`}>
                  <span className="dk">{i < deployed ? "✓" : i === deployed ? <i className="spin" /> : "·"}</span>{d}
                </div>
              ))}
            </div>
            {deployed >= DEPLOY.length && <button className="btn primary lg" onClick={() => go("app")}>Enter your workspace →</button>}
          </div>
        )}

        {step < 3 && (
          <div className="ob-nav">
            {step > 0 ? <button className="btn ghost" onClick={() => setStep(step - 1)}>← Back</button> : <button className="btn ghost" onClick={() => go("")}>Cancel</button>}
            {step < 2 ? <button className="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue →</button> : <button className="btn primary" onClick={submit}>Deploy agents</button>}
          </div>
        )}
      </div>
    </div>
  );
}
