import { EventEmitter } from "node:events";
import type { Company, Deal, Sku, SkuId } from "../protocol/types.js";
import { median } from "../util.js";
import { config } from "../config.js";

export type EventKind = "a2a" | "rule" | "payment" | "inventory" | "ledger" | "system" | "approval" | "deal" | "llm";

export interface WorldEvent {
  seq: number;
  ts: number;
  tick: number;
  kind: EventKind;
  title: string;
  company?: string;
  counterparty?: string;
  dealId?: string;
  severity?: "info" | "success" | "warn" | "danger";
  data?: unknown;
}

export interface Approval {
  id: string;
  dealId: string;
  company: string;
  stage: "deal" | "sign" | "submit";
  summary: Record<string, unknown>;
  createdAt: number;
  resolve: (ok: boolean) => void;
}

class World extends EventEmitter {
  tick = 0;
  running = true;
  speed = 1;
  skus = new Map<SkuId, Sku>();
  companies = new Map<string, Company>();
  deals = new Map<string, Deal>();
  events: WorldEvent[] = [];
  approvals = new Map<string, Approval>();
  priceHistory = new Map<SkuId, { tick: number; price: number }[]>();
  settledPrices = new Map<SkuId, number[]>();
  ledger: { kind: string; ts: number; tx?: string; anchored: boolean; data: unknown }[] = [];
  private seq = 0;

  emitEvent(e: Omit<WorldEvent, "seq" | "ts" | "tick">) {
    const ev: WorldEvent = { ...e, seq: ++this.seq, ts: Date.now(), tick: this.tick };
    this.events.push(ev);
    if (this.events.length > 3000) this.events.splice(0, this.events.length - 3000);
    this.emit("event", ev);
    return ev;
  }

  touch(deal: Deal) {
    deal.updatedAt = Date.now();
    this.emit("deal", deal);
  }

  /** Fair reference price: rolling median of the last 9 settlements, seeded from catalog. */
  refPrice(sku: SkuId): number {
    const xs = this.settledPrices.get(sku) ?? [];
    const seed = this.skus.get(sku)!.refPrice;
    if (xs.length < 3) return seed;
    return median(xs.slice(-9));
  }

  recordSettledPrice(sku: SkuId, price: number) {
    const xs = this.settledPrices.get(sku) ?? [];
    xs.push(price);
    this.settledPrices.set(sku, xs.slice(-50));
    const h = this.priceHistory.get(sku) ?? [];
    h.push({ tick: this.tick, price: this.refPrice(sku) });
    this.priceHistory.set(sku, h.slice(-200));
  }

  band(sku: SkuId) {
    const ref = this.refPrice(sku);
    return { ref, lo: ref * (1 - config.fairBand), hi: ref * (1 + config.fairBand) };
  }

  available(c: Company, sku: SkuId) {
    return Math.max(0, Math.floor((c.inventory[sku] ?? 0) - (c.reserved[sku] ?? 0)));
  }

  sellersOf(sku: SkuId, exclude?: string) {
    return [...this.companies.values()].filter((c) => c.sells.includes(sku) && c.id !== exclude);
  }

  /** Last 400 events plus every event of deals that are still open, so a fresh dashboard can audit them. */
  private snapshotEvents() {
    const open = new Set([...this.deals.values()].filter((d) => !["delivered", "failed", "rejected"].includes(d.stage)).map((d) => d.id));
    const recent = this.events.slice(-400);
    const first = recent[0]?.seq ?? 0;
    return [...this.events.filter((e) => e.seq < first && e.dealId && open.has(e.dealId)), ...recent];
  }

  snapshot() {
    return {
      tick: this.tick,
      running: this.running,
      speed: this.speed,
      config: {
        hspMode: config.hspMode,
        merchantName: config.merchantName,
        amountScale: config.hspAmountScale,
        fairBand: config.fairBand,
        llm: Boolean(config.anthropicKey),
        model: config.anthropicKey ? config.model : "heuristic",
        ledger: config.ledgerAddress ?? null,
        chainId: config.chainId,
        explorer: config.explorer,
      },
      skus: [...this.skus.values()].map((s) => ({ ...s, ref: this.refPrice(s.id), band: this.band(s.id) })),
      companies: [...this.companies.values()],
      deals: [...this.deals.values()].slice(-150),
      events: this.snapshotEvents(),
      approvals: [...this.approvals.values()].map(({ resolve, ...a }) => a),
      priceHistory: Object.fromEntries(this.priceHistory),
      ledger: this.ledger.slice(-100),
    };
  }
}

export const world = new World();
world.setMaxListeners(100);
