import type { Company, RuleCheck, SkuId, Urgency } from "../protocol/types.js";
import { world } from "../sim/world.js";
import { config } from "../config.js";
import { r2 } from "../util.js";

// Deterministic fair-dealing rules. The LLM proposes, these rules decide.
// Every rule returns a human-readable check that is streamed to the control room.

const $ = (n: number) => `$${r2(n).toFixed(2)}`;
const EPS = 0.005; // half a cent: tolerance for cent rounding
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export const allPass = (checks: RuleCheck[]) => checks.every((c) => c.pass || c.severity === "info");
export const blocking = (checks: RuleCheck[]) => checks.filter((c) => !c.pass && c.severity !== "info" && c.severity !== "escalate");
export const escalations = (checks: RuleCheck[]) => checks.filter((c) => !c.pass && c.severity === "escalate");

/** FAIR_PRICE_BAND — price must sit within ±band of the on-chain reference price. */
function fairBand(sku: SkuId, price: number): RuleCheck {
  const { ref, lo, hi } = world.band(sku);
  const dev = (price - ref) / ref;
  return {
    rule: "FAIR_PRICE_BAND",
    pass: price >= lo - EPS && price <= hi + EPS,
    severity: "block",
    detail: `${$(price)} vs ref ${$(ref)} (${dev >= 0 ? "+" : ""}${pct(dev)}, band ±${pct(config.fairBand)})`,
  };
}

/** NO_DISTRESS_SURGE — a buyer close to stock-out may not be charged a premium above reference. */
function noDistressSurge(sku: SkuId, price: number, urgency: Urgency): RuleCheck {
  const ref = world.refPrice(sku);
  const cap = ref * (1 + config.distressBand);
  if (urgency !== "critical")
    return { rule: "NO_DISTRESS_SURGE", pass: true, severity: "info", detail: `urgency ${urgency} — not applicable` };
  return {
    rule: "NO_DISTRESS_SURGE",
    pass: price <= cap + EPS,
    severity: "block",
    detail: `buyer is near stock-out; cap ${$(cap)} (ref +${pct(config.distressBand)}), quoted ${$(price)}`,
  };
}

/** Seller-side checks applied to an outgoing (or, receiver-side, incoming) quote. */
export function checkQuote(seller: Company, sku: SkuId, qty: number, price: number, urgency: Urgency): RuleCheck[] {
  const avail = world.available(seller, sku);
  const cost = seller.policy.unitCost[sku];
  const checks: RuleCheck[] = [fairBand(sku, price), noDistressSurge(sku, price, urgency)];
  checks.push({
    rule: "STOCK_BACKED",
    pass: qty <= avail,
    severity: "block",
    detail: `quoting ${qty} with ${avail} unreserved on hand`,
  });
  if (cost !== undefined)
    checks.push({
      rule: "COST_FLOOR",
      pass: price >= cost,
      severity: "block",
      detail: `price ${$(price)} ≥ unit cost ${$(cost)} (no sale at a loss)`,
    });
  return checks;
}

/** Receiver-side verification a buyer runs on an incoming quote (it cannot see seller cost/stock). */
export function verifyIncomingQuote(sku: SkuId, price: number, urgency: Urgency): RuleCheck[] {
  return [fairBand(sku, price), noDistressSurge(sku, price, urgency)];
}

/** Buyer-side checks on a counter-offer — no predatory lowballing either. */
export function checkCounter(buyer: Company, sku: SkuId, price: number): RuleCheck[] {
  const { lo } = world.band(sku);
  const max = buyer.policy.maxUnitPrice[sku] ?? Infinity;
  return [
    { rule: "NO_LOWBALL", pass: price >= lo, severity: "block", detail: `counter ${$(price)} ≥ band floor ${$(lo)}` },
    { rule: "WALK_AWAY", pass: price <= max, severity: "block", detail: `counter ${$(price)} ≤ walk-away ${$(max)}` },
  ];
}

/** Closing rule: both sides must end up strictly better off. */
export function checkMutualSurplus(buyer: Company, seller: Company, sku: SkuId, qty: number, price: number) {
  const walk = buyer.policy.maxUnitPrice[sku] ?? price;
  const cost = seller.policy.unitCost[sku] ?? 0;
  const buyerSurplus = r2((walk - price) * qty);
  const sellerSurplus = r2((price - cost) * qty);
  const value = r2(price * qty);
  const checks: RuleCheck[] = [
    {
      rule: "MUTUAL_SURPLUS",
      pass: buyerSurplus >= 0 && sellerSurplus > 0,
      severity: "block",
      detail: `buyer saves ${$(buyerSurplus)} vs walk-away · seller earns ${$(sellerSurplus)} over cost`,
    },
    {
      rule: "BUDGET",
      pass: value <= buyer.cash,
      severity: "block",
      detail: `deal ${$(value)} within treasury ${$(buyer.cash)}`,
    },
    {
      rule: "HUMAN_APPROVAL",
      pass: value <= buyer.policy.autoApproveUsd,
      severity: "escalate",
      detail: value <= buyer.policy.autoApproveUsd
        ? `${$(value)} ≤ auto-approve limit ${$(buyer.policy.autoApproveUsd)}`
        : `${$(value)} exceeds auto-approve ${$(buyer.policy.autoApproveUsd)} — needs a human`,
    },
  ];
  return { checks, buyerSurplus, sellerSurplus, value };
}

/** Payment-mandate verification: what the receiving agent asks us to sign must match what we agreed. */
export function verifyMandate(args: {
  expectedPayee: string;
  payTo: string;
  expectedUsd: number;
  mandateUsd: number;
  network: string;
  allowedNetworks: string[];
}): RuleCheck[] {
  return [
    {
      rule: "PAYEE_MATCHES_REGISTRY",
      pass: args.payTo.toLowerCase() === args.expectedPayee.toLowerCase(),
      severity: "block",
      detail: `pay_to ${short(args.payTo)} vs registered payee ${short(args.expectedPayee)}`,
    },
    {
      rule: "AMOUNT_MATCHES_DEAL",
      pass: Math.abs(args.mandateUsd - args.expectedUsd) < 0.005,
      severity: "block",
      detail: `mandate ${args.mandateUsd.toFixed(4)} USD vs agreed ${args.expectedUsd.toFixed(4)} USD`,
    },
    {
      rule: "NETWORK_ALLOWED",
      pass: args.allowedNetworks.includes(args.network),
      severity: "block",
      detail: `${args.network} ∈ [${args.allowedNetworks.join(", ")}]`,
    },
  ];
}

/** Locked-quote check after prepare_payment: raw token amount must match the mandate (+ gas if payer-borne). */
export function verifyLockedQuote(tokenTotalRaw: string, decimals: number, mandateUsd: number, maxGasUsd = 0.05): RuleCheck {
  const tokens = Number(BigInt(tokenTotalRaw)) / 10 ** decimals;
  const ok = tokens + 1e-9 >= mandateUsd && tokens <= mandateUsd + maxGasUsd + 1e-9;
  return {
    rule: "LOCKED_QUOTE_SANE",
    pass: ok,
    severity: "block",
    detail: `token_total_raw ${tokenTotalRaw} (= ${tokens} tokens) vs mandate ${mandateUsd} (+≤${maxGasUsd} gas)`,
  };
}

export const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
