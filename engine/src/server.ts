import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { world } from "./sim/world.js";
import { a2aRouter, agentCard } from "./protocol/a2a.js";
import { sellerHandle } from "./agents/seller.js";
import { buyerHandle, procure } from "./agents/buyer.js";
import { demandSpike, injectRogue, onboard, seedWorld, startEconomy } from "./sim/economy.js";
import { hsp } from "./hsp/index.js";
import { ledger } from "./chain/ledger.js";
import { adminToken, requireAdmin, requireCompany, tokenFor } from "./auth.js";
import type { Company, Deal } from "./protocol/types.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(a2aRouter({ seller: sellerHandle, buyer: buyerHandle }));

// Network directory: all agent cards on Concord (public by design — that is how agents discover each other).
app.get("/.well-known/agent-card.json", (_req, res) => {
  res.json({
    name: "Concord Network Directory",
    description: "Fair-dealing B2B trade protocol for autonomous procurement and sales agents, settled via HSP on HashKey Chain.",
    agents: [...world.companies.values()].flatMap((c) => [
      ...(c.buys.length ? [agentCard(c.id, "buyer")] : []),
      ...(c.sells.length ? [agentCard(c.id, "seller")] : []),
    ]),
  });
});

// ---------------------------------------------------------------- public

const SETTLED = new Set(["settled", "delivering", "delivered"]);

app.get("/api/public/stats", (_req, res) => {
  const deals = [...world.deals.values()].filter((d) => SETTLED.has(d.stage));
  res.json({
    companies: world.companies.size,
    agents: [...world.companies.values()].reduce((a, c) => a + (c.buys.length ? 1 : 0) + (c.sells.length ? 1 : 0), 0),
    settled: deals.length,
    volumeUsd: deals.reduce((a, d) => a + (d.valueUsd ?? 0), 0),
    violationsBlocked: [...world.companies.values()].reduce((a, c) => a + c.stats.violations, 0),
    skus: [...world.skus.values()].map((s) => ({ id: s.id, name: s.name, unit: s.unit, ref: world.refPrice(s.id) })),
    hspMode: config.hspMode,
    ledger: config.ledgerAddress ?? null,
  });
});

/** Self-serve onboarding: creates the company, its agents and wallet, and returns its workspace token. */
app.post("/api/onboard", (req, res) => {
  try {
    const b = req.body ?? {};
    const name = String(b.name ?? "").trim().slice(0, 60);
    if (name.length < 2) throw new Error("company name required");
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    const skus = new Set(world.skus.keys());
    const buys = (b.buys ?? []).filter((s: string) => skus.has(s));
    const sells = (b.sells ?? []).filter((s: string) => skus.has(s));
    if (!buys.length && !sells.length) throw new Error("pick at least one product to buy or sell");
    const c = onboard({
      id: world.companies.has(id) ? `${id}-${Date.now().toString(36).slice(-4)}` : id,
      name,
      sector: String(b.sector ?? "").slice(0, 60),
      buys,
      sells,
      inventory: b.inventory,
      demand: b.demand,
      replenish: sells.length && !buys.length ? Object.fromEntries(sells.map((s: string) => [s, Number(b.capacity ?? 15)])) : undefined,
      cash: Math.min(100000, Math.max(1000, Number(b.cash ?? 15000))),
      policy: b.policy,
    });
    res.json({ company: c, token: tokenFor(c.id) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** The demo workspace (a seeded café) for visitors who want to look around before onboarding. */
app.post("/api/demo-login", (_req, res) => res.json({ token: tokenFor("bandra-brew"), companyId: "bandra-brew" }));

// ---------------------------------------------------------------- company workspace (tenant-scoped)

const EMPTY_POLICY = { reorderPoint: {}, reorderQty: {}, maxUnitPrice: {}, unitCost: {}, targetMargin: 0, autoApproveUsd: 0, strategy: "fair", guardrails: true };

/** What one company may see of another: identity, catalogue and public reputation. Never stock, cash or policy. */
function publicProfile(c: Company) {
  return {
    id: c.id, name: c.name, sector: c.sector, role: c.role, tier: c.tier, wallet: c.wallet, sells: c.sells, buys: c.buys,
    stats: c.stats, policy: EMPTY_POLICY, inventory: {}, reserved: {}, incoming: {}, cash: 0,
    pnl: { revenue: 0, cogs: 0, spend: 0, lostSales: 0 }, createdAt: c.createdAt,
  };
}

/** A deal as seen by one party: competing quotes and the counterparty's surplus are hidden from sellers. */
function dealFor(d: Deal, cid: string) {
  if (d.buyer === cid) return { ...d, sellerSurplus: undefined };
  return { ...d, quotes: d.quotes.filter((q) => q.seller === cid), buyerSurplus: undefined };
}

app.get("/api/me", requireCompany, (_req, res) => {
  const cid = res.locals.companyId as string;
  const me = world.companies.get(cid);
  if (!me) return res.status(404).json({ error: "company not found" });
  const mine = (agent?: string) => agent?.split(".")[0] === cid;
  const snap = world.snapshot();
  res.json({
    ...snap,
    companies: [...world.companies.values()].map((c) => (c.id === cid ? c : publicProfile(c))),
    deals: [...world.deals.values()].filter((d) => d.buyer === cid || d.seller === cid).slice(-150).map((d) => dealFor(d, cid)),
    events: world.events.filter((e) => (e.kind === "a2a" ? mine(e.company) || mine(e.counterparty) : mine(e.company) || (e.kind !== "rule" && mine(e.counterparty)))).slice(-400),
    approvals: snap.approvals.filter((a) => a.company === cid),
    ledger: [],
    me: cid,
  });
});

// A company edits its own agent policy. Guardrails and strategy are protocol-controlled and cannot be changed here.
function patchPolicy(c: Company, body: any) {
  const { autoApproveUsd, targetMargin, maxUnitPrice, reorderPoint, reorderQty } = body ?? {};
  const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (pos(autoApproveUsd)) c.policy.autoApproveUsd = autoApproveUsd;
  if (pos(targetMargin) && targetMargin <= 1) c.policy.targetMargin = targetMargin;
  for (const [field, val] of [["maxUnitPrice", maxUnitPrice], ["reorderPoint", reorderPoint], ["reorderQty", reorderQty]] as const)
    if (val && typeof val === "object")
      for (const [sku, v] of Object.entries(val)) if (c.buys.includes(sku) && pos(v)) (c.policy[field] as Record<string, number>)[sku] = v;
  world.emitEvent({ kind: "system", title: `${c.name} updated agent policy`, company: c.id, severity: "info" });
  world.emit("tick", world.tick);
  return c.policy;
}

app.patch("/api/me/policy", requireCompany, (req, res) => {
  res.json(patchPolicy(world.companies.get(res.locals.companyId)!, req.body));
});

app.post("/api/me/approvals/:id", requireCompany, (req, res) => {
  const a = world.approvals.get(String(req.params.id));
  if (!a || a.company !== res.locals.companyId) return res.status(404).json({ error: "not found" });
  a.resolve(Boolean(req.body?.approve));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- operator (network control room)

app.get("/api/state", requireAdmin, (_req, res) => res.json(world.snapshot()));

app.get("/api/events", requireAdmin, (req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const write = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  write("snapshot", world.snapshot());
  const onEvent = (e: unknown) => write("event", e);
  const onDeal = (d: unknown) => write("deal", d);
  const onTick = () => write("tick", { tick: world.tick, companies: [...world.companies.values()], skus: world.snapshot().skus, running: world.running, speed: world.speed });
  const onApprovals = () => write("approvals", world.snapshot().approvals);
  world.on("event", onEvent);
  world.on("deal", onDeal);
  world.on("tick", onTick);
  world.on("approvals", onApprovals);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(ping);
    world.off("event", onEvent);
    world.off("deal", onDeal);
    world.off("tick", onTick);
    world.off("approvals", onApprovals);
  });
});

app.post("/api/companies", requireAdmin, (req, res) => {
  try {
    const c = onboard(req.body);
    res.json({ company: c, token: tokenFor(c.id) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.patch("/api/companies/:id/policy", requireAdmin, (req, res) => {
  const c = world.companies.get(String(req.params.id));
  if (!c) return res.status(404).json({ error: "not found" });
  res.json(patchPolicy(c, req.body));
});

app.post("/api/approvals/:id", requireAdmin, (req, res) => {
  const a = world.approvals.get(String(req.params.id));
  if (!a) return res.status(404).json({ error: "not found" });
  a.resolve(Boolean(req.body?.approve));
  res.json({ ok: true });
});

app.post("/api/control", requireAdmin, (req, res) => {
  const { action, value, company, sku } = req.body ?? {};
  if (action === "pause") world.running = false;
  if (action === "resume") world.running = true;
  if (action === "speed") world.speed = Math.max(0.25, Math.min(8, Number(value) || 1));
  if (action === "rogue") injectRogue();
  if (action === "spike") demandSpike(company ?? "monsoon-cafe", sku ?? "roasted-coffee");
  if (action === "procure" && company && sku) {
    const c = world.companies.get(company);
    if (c) void procure(c, sku);
  }
  world.emit("tick", world.tick);
  res.json({ ok: true, running: world.running, speed: world.speed });
});

app.get("/api/health", (_req, res) => res.json({ ok: true, hsp: hsp.mode, ledger: ledger.enabled, tick: world.tick }));

app.listen(config.port, () => {
  console.log(`Concord engine on ${config.publicUrl}  (HSP: ${hsp.mode}, ledger: ${ledger.enabled ? config.ledgerAddress : "local"}, LLM: ${config.anthropicKey ? config.model : "heuristic"})`);
  console.log(`Operator console token: ${adminToken}  (stored in engine/.data/tokens.json)`);
  seedWorld();
  startEconomy();
});
