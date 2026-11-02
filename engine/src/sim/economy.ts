import { ledger } from "../chain/ledger.js";
import { isProcuring, procure } from "../agents/buyer.js";
import { releaseReservation } from "../agents/seller.js";
import { accountFor } from "../wallet.js";
import { world } from "./world.js";
import { basePolicy, ROGUE, SEED, SKUS } from "./catalog.js";
import type { Company, Policy } from "../protocol/types.js";
import { config } from "../config.js";
import { r2 } from "../util.js";

const ROLE_CODE = { buyer: 1, seller: 2, both: 3 } as const;

export interface OnboardInput extends Partial<Omit<Company, "policy">> {
  id: string;
  name: string;
  policy?: Partial<Policy>;
}

/** Onboard a company: create its wallet, spin up its buyer/seller agents, register it on the ledger. */
export function onboard(input: OnboardInput): Company {
  if (world.companies.has(input.id)) throw new Error(`company ${input.id} exists`);
  const sells = input.sells ?? [];
  const buys = input.buys ?? [];
  const role = input.role ?? (sells.length && buys.length ? "both" : sells.length ? "seller" : "buyer");
  const c: Company = {
    id: input.id,
    name: input.name,
    sector: input.sector ?? "",
    role,
    tier: input.tier ?? (role === "buyer" ? 2 : role === "both" ? 1 : 0),
    wallet: accountFor(input.id).address,
    sells,
    buys,
    inventory: { ...(input.inventory ?? {}) },
    reserved: {},
    incoming: {},
    demand: input.demand,
    recipe: input.recipe,
    replenish: input.replenish,
    policy: basePolicy(input.policy ?? {}),
    cash: input.cash ?? 10000,
    pnl: { revenue: 0, cogs: 0, spend: 0, lostSales: 0 },
    stats: { trades: 0, violations: 0, onTime: 0 },
    createdAt: Date.now(),
  };
  // Sensible defaults so a freshly onboarded buyer actually trades.
  for (const s of buys) {
    const ref = world.skus.get(s)?.refPrice ?? 1;
    c.policy.maxUnitPrice[s] ??= r2(ref * 1.2);
    c.policy.reorderPoint[s] ??= Math.max(10, (c.demand?.[s] ?? 2) * 8);
    c.policy.reorderQty[s] ??= Math.max(20, (c.demand?.[s] ?? 2) * 15);
  }
  for (const s of sells) c.policy.unitCost[s] ??= r2((world.skus.get(s)?.refPrice ?? 1) * 0.8);
  world.companies.set(c.id, c);
  world.emitEvent({ kind: "system", title: `${c.name} joined Concord (${role})`, company: c.id, severity: "success", data: { wallet: c.wallet, sells, buys } });
  void ledger.registerCompany(c.id, c.name, c.wallet, ROLE_CODE[role]);
  return c;
}

export function seedWorld() {
  for (const s of SKUS) world.skus.set(s.id, s);
  for (const s of SEED) onboard(s as OnboardInput);
}

export function injectRogue() {
  if (world.companies.has(ROGUE.id)) return world.companies.get(ROGUE.id)!;
  return onboard(ROGUE as OnboardInput);
}

export function demandSpike(companyId: string, sku: string) {
  const c = world.companies.get(companyId);
  if (!c) return;
  c.inventory[sku] = Math.max(0, Math.floor((c.inventory[sku] ?? 0) * 0.15));
  world.emitEvent({ kind: "inventory", title: `Demand spike at ${c.name}: ${sku} nearly sold out`, company: c.id, severity: "warn" });
}

function step() {
  world.tick++;
  for (const c of world.companies.values()) {
    for (const [s, n] of Object.entries(c.replenish ?? {})) {
      const cap = (c.policy.reorderQty[s] ?? 0) + 3000;
      c.inventory[s] = Math.min(cap, (c.inventory[s] ?? 0) + n);
    }
    if (c.recipe) {
      const r = c.recipe;
      let make = r.ratePerTick;
      for (const [s, per] of Object.entries(r.inputs)) make = Math.min(make, Math.floor((c.inventory[s] ?? 0) / per));
      if (make > 0) {
        for (const [s, per] of Object.entries(r.inputs)) c.inventory[s] = r2((c.inventory[s] ?? 0) - per * make);
        c.inventory[r.output] = (c.inventory[r.output] ?? 0) + make;
      }
    }
    for (const [s, n] of Object.entries(c.demand ?? {})) {
      const want = n * (0.7 + Math.random() * 0.6);
      const have = c.inventory[s] ?? 0;
      const sold = Math.min(have, want);
      c.inventory[s] = r2(have - sold);
      if (sold < want) {
        c.pnl.lostSales = r2(c.pnl.lostSales + (want - sold) * (world.skus.get(s)?.refPrice ?? 1) * 2.5);
      }
    }
  }
  // Deliveries land.
  for (const d of world.deals.values()) {
    if (d.stage === "delivering" && d.deliverAtTick !== undefined && world.tick >= d.deliverAtTick && d.seller) {
      const b = world.companies.get(d.buyer)!;
      releaseReservation(d.seller, d.sku, d.qty);
      b.inventory[d.sku] = (b.inventory[d.sku] ?? 0) + d.qty;
      b.incoming[d.sku] = Math.max(0, (b.incoming[d.sku] ?? 0) - d.qty);
      world.companies.get(d.seller)!.stats.onTime++;
      d.stage = "delivered";
      world.touch(d);
      world.emitEvent({ kind: "inventory", title: `Delivered ${d.qty} ${d.sku} to ${b.name}`, company: d.buyer, counterparty: d.seller, dealId: d.id, severity: "success" });
    }
  }
  // Reorder points → autonomous procurement.
  for (const c of world.companies.values()) {
    for (const s of c.buys) {
      const pos = (c.inventory[s] ?? 0) + (c.incoming[s] ?? 0);
      if (pos <= (c.policy.reorderPoint[s] ?? 0) && !isProcuring(c.id, s)) void procure(c, s);
    }
  }
  world.emit("tick", world.tick);
}

let timer: NodeJS.Timeout | undefined;
export function startEconomy() {
  const loop = () => {
    if (world.running) step();
    timer = setTimeout(loop, config.tickMs / world.speed);
  };
  if (!timer) loop();
}
