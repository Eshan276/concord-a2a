// Records the Concord demo video from the live app.
//   1. ./dev.sh running (engine :8787, web :5173)
//   2. node scripts/tts.mjs            (optional: ElevenLabs voiceover → exact scene timing)
//   3. node scripts/record-demo.mjs    → demo-out/concord-demo.mp4
// Drives headless Chrome over CDP, injects captions + a visible cursor, captures a screencast,
// then muxes frames + voiceover + a soft ambient bed with ffmpeg.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const OUT = root + "demo-out/";
const FRAMES = OUT + "frames/";
const APP = "http://localhost:5173";
const W = 1920, H = 1080, PORT = 9444;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const scenes = JSON.parse(readFileSync(root + "scripts/narration.json", "utf8"));
const durFile = OUT + "audio/durations.json";
const audioDur = existsSync(durFile) ? JSON.parse(readFileSync(durFile, "utf8")) : {};
const hasAudio = Object.keys(audioDur).length === scenes.length;
const sceneLen = (id) => {
  const s = scenes.find((x) => x.id === id);
  const est = s.text.split(/\s+/).length / 2.55;
  return (audioDur[id] ?? est) + 0.9;
};
const adminToken = JSON.parse(readFileSync(root + "engine/.data/tokens.json", "utf8")).admin;

// ---------------------------------------------------------------- chrome + CDP
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
const chrome = spawn("google-chrome-stable", [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", `--window-size=${W},${H}`,
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/concord-rec-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
let page;
for (let i = 0; i < 40 && !page; i++) {
  await sleep(250);
  try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let msgId = 0;
const pending = new Map();
const frames = [];
ws.onmessage = async (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? d); pending.delete(d.id); return; }
  if (d.method === "Page.screencastFrame") {
    const { data, metadata, sessionId } = d.params;
    const n = frames.length;
    writeFileSync(`${FRAMES}${String(n).padStart(6, "0")}.jpg`, Buffer.from(data, "base64"));
    frames.push(metadata.timestamp);
    send("Page.screencastFrameAck", { sessionId });
  }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++msgId; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) console.warn("  js error:", r.exceptionDetails.exception?.description?.slice(0, 200));
  return r.result?.value;
};

await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.enable");
await send("Runtime.enable");

// ---------------------------------------------------------------- overlay helpers (survive reloads)
const OVERLAY = `(() => {
  if (window.__demo) return;
  const css = \`
  #dm-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483646;font-family:"IBM Plex Sans",sans-serif}
  #dm-cur{position:absolute;left:0;top:0;width:22px;height:22px;transform:translate(960px,540px);transition:transform .7s cubic-bezier(.45,0,.2,1);filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))}
  #dm-cur svg{width:22px;height:22px}
  .dm-ripple{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid #e7b95a;animation:dmr .6s ease-out forwards}
  @keyframes dmr{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
  #dm-cap{position:absolute;left:40px;bottom:40px;max-width:980px;padding:16px 22px 18px;border-radius:12px;background:rgba(10,12,15,.86);border:1px solid rgba(231,185,90,.35);backdrop-filter:blur(8px);box-shadow:0 20px 60px rgba(0,0,0,.45);opacity:0;transform:translateY(12px);transition:all .5s ease}
  #dm-cap.on{opacity:1;transform:none}
  #dm-cap .c{font:500 11px "IBM Plex Mono",monospace;letter-spacing:.16em;text-transform:uppercase;color:#e7b95a;margin-bottom:6px}
  #dm-cap .l{font:400 25px/1.25 Fraunces,Georgia,serif;color:#f1ede4}
  #dm-card{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:18px;text-align:center;background:radial-gradient(ellipse at 50% 40%,rgba(231,185,90,.10),transparent 60%),#0a0c0f;opacity:0;transition:opacity .7s ease}
  #dm-card.on{opacity:1}
  #dm-card .b{font:400 92px/1 Fraunces,Georgia,serif;color:#f1ede4;letter-spacing:-.02em}
  #dm-card .b em{color:#e7b95a}
  #dm-card .s{font:500 15px "IBM Plex Mono",monospace;letter-spacing:.2em;text-transform:uppercase;color:#9097a1}
  \`;
  const mount = () => {
    if (document.getElementById("dm-layer")) return;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const L = document.createElement("div"); L.id = "dm-layer";
    L.innerHTML = '<div id="dm-card"><div class="b"></div><div class="s"></div></div><div id="dm-cap"><div class="c"></div><div class="l"></div></div><div id="dm-cur"><svg viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#f1ede4" stroke="#0a0c0f" stroke-width="1.4" stroke-linejoin="round"/></svg></div>';
    document.body.appendChild(L);
  };
  let cx = 960, cy = 540;
  window.__demo = {
    mount,
    cap(c, l) { mount(); const e = document.getElementById("dm-cap"); if (!c) { e.classList.remove("on"); return; } e.querySelector(".c").textContent = c; e.querySelector(".l").textContent = l; e.classList.add("on"); },
    card(b, s) { mount(); const e = document.getElementById("dm-card"); if (!b) { e.classList.remove("on"); return; } e.querySelector(".b").innerHTML = b; e.querySelector(".s").textContent = s || ""; e.classList.add("on"); },
    async move(x, y) { mount(); cx = x; cy = y; document.getElementById("dm-cur").style.transform = \`translate(\${x}px,\${y}px)\`; await new Promise(r => setTimeout(r, 750)); },
    find(sel, text, idx = 0) {
      const els = [...document.querySelectorAll(sel)].filter(e => !text || e.textContent.includes(text));
      return els[idx] || null;
    },
    async click(sel, text, idx) {
      const el = this.find(sel, text, idx); if (!el) return false;
      el.scrollIntoView({ block: "nearest" });
      const r = el.getBoundingClientRect();
      await this.move(r.left + r.width / 2, r.top + r.height / 2);
      const rp = document.createElement("div"); rp.className = "dm-ripple"; rp.style.left = cx + "px"; rp.style.top = cy + "px";
      document.getElementById("dm-layer").appendChild(rp); setTimeout(() => rp.remove(), 700);
      await new Promise(r => setTimeout(r, 120)); el.click(); return true;
    },
    async type(sel, text, idx = 0) {
      const el = this.find(sel, null, idx); if (!el) return;
      const r = el.getBoundingClientRect(); await this.move(r.left + 30, r.top + r.height / 2);
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      el.focus(); let v = "";
      for (const ch of text) { v += ch; set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); await new Promise(r => setTimeout(r, 55)); }
    },
    async scroll(sel, to, ms) {
      const el = sel ? document.querySelector(sel) : document.scrollingElement;
      if (!el) return; const from = el.scrollTop, t0 = performance.now();
      await new Promise(res => { const f = (t) => { const k = Math.min(1, (t - t0) / ms); const e = k < .5 ? 2*k*k : 1 - Math.pow(-2*k+2, 2)/2; el.scrollTop = from + (to - from) * e; k < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
    },
    async admin(path, body) {
      const t = localStorage.getItem("concord.admin-token");
      const r = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + t }, body: JSON.stringify(body) } : { headers: { authorization: "Bearer " + t } });
      return r.json();
    },
  };
  if (document.readyState !== "loading") mount(); else addEventListener("DOMContentLoaded", mount);
})();`;
await send("Page.addScriptToEvaluateOnNewDocument", { source: OVERLAY });

// ---------------------------------------------------------------- fresh world + session setup
console.log("restarting engine for a clean world…");
const now = new Date();
utimesSync(root + "engine/src/server.ts", now, now);
await sleep(1500);
for (let i = 0; i < 40; i++) {
  try { const h = await (await fetch("http://localhost:8787/api/health")).json(); if (h.tick <= 3) break; } catch {}
  await sleep(500);
}
await send("Page.navigate", { url: `${APP}/#/` });
await sleep(1500);
await js(`localStorage.setItem("concord.theme","dark"); localStorage.removeItem("concord.company-token"); localStorage.setItem("concord.admin-token", ${JSON.stringify(adminToken)}); true`);
await send("Page.navigate", { url: `${APP}/#/` });
await sleep(2500);
await js(`window.__demo.mount(); window.__demo.card('Concord', 'agents that trade fairly'); true`);
await sleep(600);

// ---------------------------------------------------------------- record
const timeline = [];
await send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
const t0 = Date.now();
await sleep(400);

const waitFor = async (expr, timeoutMs) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const v = await js(expr); if (v) return v; await sleep(700); }
  return null;
};

async function scene(id, fn) {
  const s = scenes.find((x) => x.id === id);
  const start = (Date.now() - t0) / 1000;
  timeline.push({ id, start });
  const len = sceneLen(id);
  console.log(`▶ ${id} @${start.toFixed(1)}s (${len.toFixed(1)}s)`);
  if (!["s01-title", "s12-end"].includes(id)) await js(`window.__demo.cap(${JSON.stringify(s.chip)}, ${JSON.stringify(s.line)}); true`);
  const deadline = Date.now() + len * 1000;
  await fn(deadline);
  const left = deadline - Date.now();
  if (left > 0) await sleep(left);
}

await scene("s01-title", async (dl) => {
  await js(`window.__demo.card('Your supply chain,<br><em>negotiated by agents.</em>', 'Concord · A2A × HSP × HashKey Chain'); true`);
  await sleep(dl - Date.now() - 900);
  await js(`window.__demo.card(null); true`);
});

await scene("s02-landing", async (dl) => {
  await js(`window.__demo.move(1200, 700)`);
  await sleep(2500);
  await js(`window.__demo.scroll(".lp", document.querySelector("#how").offsetTop - 80, 3500)`);
  await sleep(2500);
  await js(`window.__demo.scroll(".lp", document.querySelector("#fair").offsetTop - 80, 3000)`);
  await sleep(Math.max(0, dl - Date.now() - 2600));
  await js(`window.__demo.scroll(".lp", 0, 1800)`);
});

await scene("s03-onboard", async () => {
  await js(`window.__demo.click(".hero-cta .btn", "Onboard")`);
  await sleep(900);
  await js(`window.__demo.type(".ob-card input", "Colaba Coffee Collective", 0)`);
  await js(`window.__demo.type(".ob-card input", "Café · 3 outlets", 1)`);
  await js(`window.__demo.click(".type", "Café")`);
  await js(`window.__demo.click(".ob-nav .btn.primary")`);
  await sleep(2200);
  await js(`window.__demo.click(".ob-nav .btn.primary")`);
  await sleep(2200);
  await js(`window.__demo.click(".ob-nav .btn.primary")`);
  await sleep(3900);
  await js(`window.__demo.click(".ob-card .btn.primary", "Enter")`);
});

await scene("s04-warehouse", async () => {
  await sleep(1500);
  await js(`window.__demo.move(700, 420)`);
  await sleep(3000);
  await js(`window.__demo.move(1500, 640)`);
});

await scene("s05-deal", async () => {
  await js(`window.__demo.click(".tabs button", "Operations")`);
  await sleep(1500);
  await js(`window.__demo.click(".blotter tbody tr", null, 0)`);
  await sleep(1200);
  await js(`window.__demo.move(1680, 260)`);
  await sleep(4000);
  await js(`window.__demo.move(1680, 450)`);
  await sleep(3000);
  await js(`window.__demo.scroll(".console .ccol:last-child .panel .pb", 420, 2500)`);
});

await scene("s06-network", async () => {
  await js(`window.__demo.cap(null); location.hash = "#/operator"; true`);
  await sleep(1200);
  await js(`window.__demo.cap(${JSON.stringify(scenes[5].chip)}, ${JSON.stringify(scenes[5].line)}); window.__demo.admin("/api/control", { action: "speed", value: 2 }); true`);
  await js(`window.__demo.move(720, 330)`);
});

await scene("s07-rogue", async () => {
  await js(`window.__demo.click(".top .btn.danger", "rogue")`);
  await sleep(1500);
  await js(`window.__demo.move(720, 450)`);
});

await scene("s08-gouge", async (dl) => {
  await js(`window.__demo.click(".top .btn", "Demand shock")`);
  const id = await waitFor(`window.__demo.admin("/api/state").then(s => (s.deals.find(d => d.urgency === "critical" && d.quotes.some(q => q.seller === "apex-rapid" && q.violations.length)) || s.deals.find(d => d.quotes.some(q => q.seller === "apex-rapid" && q.violations.includes("NO_DISTRESS_SURGE"))) || {}).id)`, Math.max(4000, dl - Date.now() - 3000));
  if (id) {
    await js(`window.__concordSelect(${JSON.stringify(id)}); true`);
    await js(`window.__demo.move(1700, 300)`);
    await sleep(2500);
    await js(`window.__demo.move(1700, 420)`);
  }
});

await scene("s09-switch", async (dl) => {
  const id = await waitFor(`window.__demo.admin("/api/state").then(s => (s.deals.find(d => (d.note || "").includes("mandate tampering")) || {}).id)`, Math.max(4000, dl - Date.now() - 4000));
  if (id) {
    await js(`window.__concordSelect(${JSON.stringify(id)}); true`);
    await sleep(800);
    await js(`(() => { const t = [...document.querySelectorAll(".insp .rgroup.bad")].pop(); t && t.scrollIntoView({ block: "center", behavior: "smooth" }); return 1 })()`);
    await js(`window.__demo.move(1680, 520)`);
  }
});

await scene("s10-approval", async () => {
  const has = await waitFor(`document.querySelector(".apv .btn.primary") ? 1 : 0`, 6000);
  if (has) { await sleep(1500); await js(`window.__demo.click(".apv .btn.primary")`); }
  await js(`window.__concordSelect(undefined); true`);
});

await scene("s11-pnl", async () => {
  await js(`window.__demo.move(900, 960)`);
  await sleep(3000);
  await js(`window.__demo.move(1500, 960)`);
});

await scene("s12-end", async () => {
  await js(`window.__demo.cap(null); window.__demo.card('Concord', 'A2A agents · HSP settlement · HashKey Chain'); true`);
});
await sleep(800);

await send("Page.stopScreencast");
await sleep(500);
const total = (Date.now() - t0) / 1000;
ws.close();
chrome.kill();
writeFileSync(OUT + "timeline.json", JSON.stringify({ total, timeline }, null, 2));
console.log(`captured ${frames.length} frames over ${total.toFixed(1)}s`);

// ---------------------------------------------------------------- encode
const list = [];
for (let i = 0; i < frames.length; i++) {
  const d = i + 1 < frames.length ? frames[i + 1] - frames[i] : 0.5;
  list.push(`file '${FRAMES}${String(i).padStart(6, "0")}.jpg'`, `duration ${Math.max(0.001, d).toFixed(4)}`);
}
list.push(`file '${FRAMES}${String(frames.length - 1).padStart(6, "0")}.jpg'`);
writeFileSync(OUT + "frames.txt", list.join("\n"));
const silent = OUT + "video-silent.mp4";
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", OUT + "frames.txt", "-vf", `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", silent]);

const offset = frames.length ? 0 : 0;
const inputs = ["-y", "-loglevel", "error", "-i", silent];
const filters = [];
let n = 1;
const voiceLabels = [];
if (hasAudio) {
  for (const t of timeline) {
    inputs.push("-i", `${OUT}audio/${t.id}.mp3`);
    const ms = Math.round((t.start + 0.35 + offset) * 1000);
    filters.push(`[${n}:a]adelay=${ms}|${ms},volume=1.0[v${n}]`);
    voiceLabels.push(`[v${n}]`);
    n++;
  }
}
// Soft ambient bed: low sine chord with slow tremolo, faded in/out.
inputs.push("-f", "lavfi", "-i", `sine=frequency=110:duration=${total}`, "-f", "lavfi", "-i", `sine=frequency=164.8:duration=${total}`, "-f", "lavfi", "-i", `sine=frequency=220:duration=${total}`);
filters.push(`[${n}:a][${n + 1}:a][${n + 2}:a]amix=inputs=3,tremolo=f=0.15:d=0.5,lowpass=f=900,volume=${hasAudio ? 0.05 : 0.09},afade=t=in:d=3,afade=t=out:st=${Math.max(0, total - 4)}:d=4[bed]`);
const mixIn = [...voiceLabels, "[bed]"].join("");
filters.push(`${mixIn}amix=inputs=${voiceLabels.length + 1}:normalize=0,alimiter=limit=0.95[aout]`);
execFileSync("ffmpeg", [...inputs, "-filter_complex", filters.join(";"), "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", OUT + "concord-demo.mp4"]);
console.log(`✓ ${OUT}concord-demo.mp4 (${hasAudio ? "with voiceover" : "captions + ambient bed; run scripts/tts.mjs for voiceover"})`);
process.exit(0);
