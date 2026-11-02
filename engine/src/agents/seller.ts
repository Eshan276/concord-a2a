import type { Address } from "viem";
import { config } from "../config.js";
import { hsp, settlementToken } from "../hsp/index.js";
import { buildCartMandate } from "../hsp/types.js";
import { accountFor } from "../wallet.js";
import { blocking, checkQuote } from "../rules/engine.js";
import { world } from "../sim/world.js";
import type { Company, ConcordBody, Envelope, RuleCheck, SkuId, Urgency } from "../protocol/types.js";
import { r2 } from "../util.js";
import { sellerOpen, sellerRespond } from "./strategy.js";

// Sales agent: reacts to Concord messages arriving over A2A.

interface Neg { buyer: string; sku: SkuId; qty: number; urgency: Urgency; last: number; agreed?: number; leadTicks: number; flowId?: string; paymentRequestId?: string; delivered?: boolean }
const negs = new Map<string, Neg>(); // key: seller|rfqId

function emitChecks(seller: Company, rfqId: string, title: string, checks: RuleCheck[]) {
  const bad = blocking(checks).length > 0;
  world.emitEvent({ kind: "rule", title, company: `${seller.id}.seller`, dealId: rfqId, severity: bad ? "warn" : "success", data: { checks } });
}

/** Sender-side guardrails: clamp an LLM/heuristic price into the legal region instead of sending a violation. */
function guard(seller: Company, rfqId: string, sku: SkuId, qty: number, price: number, urgency: Urgency) {
  let checks = checkQuote(seller, sku, qty, price, urgency);
  if (!seller.policy.guardrails || blocking(checks).length === 0) {
    emitChecks(seller, rfqId, "Outgoing quote checked", checks);
    return price;
  }
  const { ref, lo, hi } = world.band(sku);
  const cap = urgency === "critical" ? Math.min(hi, ref * (1 + config.distressBand)) : hi;
  // floor to the cent so rounding can never push a corrected price back over the cap
  const fixed = Math.floor(Math.min(cap, Math.max(lo, price, seller.policy.unitCost[sku] ?? 0)) * 100) / 100;
  checks = checkQuote(seller, sku, qty, fixed, urgency);
  emitChecks(seller, rfqId, `Guardrail corrected price ${price} → ${fixed}`, checks);
  return fixed;
}

export async function sellerHandle(env: Envelope): Promise<ConcordBody> {
  const seller = world.companies.get(env.to.split(".")[0])!;
  const key = `${seller.id}|${env.rfqId}`;
  const b = env.body;

  if (b.type === "RFQ") {
    if (!seller.sells.includes(b.sku)) return { type: "REJECT", reason: `we do not supply ${b.sku}` };
    const qty = Math.min(b.qty, world.available(seller, b.sku));
    if (qty <= 0) return { type: "REJECT", reason: "no unreserved stock" };
    const move = await sellerOpen(seller, b.sku, qty, b.urgency);
    const price = guard(seller, env.rfqId, b.sku, qty, move.unitPrice, b.urgency);
    const leadTicks = seller.tier === 0 ? 3 : 2;
    negs.set(key, { buyer: env.from, sku: b.sku, qty, urgency: b.urgency, last: price, leadTicks });
    return { type: "QUOTE", sku: b.sku, qty, unitPrice: price, leadTicks, rationale: `[${move.source}] ${move.rationale}` };
  }

  const n = negs.get(key);
  if (!n) return { type: "ERROR", reason: "unknown negotiation" };

  if (b.type === "COUNTER") {
    const move = await sellerRespond(seller, n.sku, n.qty, n.last, b.unitPrice, b.round);
    if (move.action === "accept") {
      n.agreed = b.unitPrice;
      return { type: "ACCEPT", unitPrice: b.unitPrice, qty: n.qty, rationale: `[${move.source}] ${move.rationale}` };
    }
    if (move.action === "reject") return { type: "REJECT", reason: `[${move.source}] ${move.rationale}` };
    n.last = guard(seller, env.rfqId, n.sku, n.qty, move.unitPrice, n.urgency);
    return { type: "COUNTER", unitPrice: n.last, round: b.round, rationale: `[${move.source}] ${move.rationale}` };
  }

  if (b.type === "ACCEPT") {
    // Buyer accepts our standing price (or confirms the counter we accepted) → issue HSP payment conditions.
    const price = n.agreed ?? n.last;
    if (Math.abs(b.unitPrice - price) > 1e-9 || b.qty !== n.qty) return { type: "REJECT", reason: "acceptance does not match offer" };
    if (world.available(seller, n.sku) < n.qty) return { type: "REJECT", reason: "stock no longer available" };
    n.agreed = price;
    seller.reserved[n.sku] = (seller.reserved[n.sku] ?? 0) + n.qty;

    const token = await settlementToken();
    const dealValue = r2(price * n.qty);
    const amountUsd = Math.max(0.01, r2(dealValue * config.hspAmountScale));
    // A rogue seller tries to divert funds to an unregistered address.
    const payTo: Address = seller.policy.strategy === "rogue" ? accountFor(`${seller.id}-offshore`).address : (seller.wallet as Address);
    const paymentRequestId = `PR-${env.rfqId}`;
    const sku = world.skus.get(n.sku)!;
    const cart = buildCartMandate({
      id: `CM-${env.rfqId}`,
      paymentRequestId,
      merchantName: config.merchantName,
      token,
      payTo,
      label: `${sku.name} ×${n.qty} ${sku.unit} @ $${price.toFixed(2)} — ${seller.name}`,
      amountUsd,
    });
    const order = await hsp.createOrder({ merchantName: config.merchantName, payTo, cartMandate: cart });
    n.flowId = order.flowId;
    n.paymentRequestId = order.paymentRequestId;
    world.emitEvent({
      kind: "payment", title: "Cart Mandate created via HSP", company: `${seller.id}.seller`, dealId: env.rfqId, severity: "info",
      data: { flowId: order.flowId, paymentRequestId: order.paymentRequestId, amountUsd, dealValue, network: token.network, coin: token.coin, mode: hsp.mode },
    });
    return { type: "PAYMENT_CONDITIONS", cartMandate: cart, flowId: order.flowId, paymentRequestId: order.paymentRequestId, paymentUrl: order.paymentUrl, payTo, amountUsd, dealValueUsd: dealValue };
  }

  if (b.type === "REJECT") {
    if (n.agreed && !n.delivered) seller.reserved[n.sku] = Math.max(0, (seller.reserved[n.sku] ?? 0) - n.qty);
    negs.delete(key);
    return { type: "REJECT", reason: "acknowledged" };
  }

  if (b.type === "PAYMENT_PROOF") {
    if (b.flowId !== n.flowId) return { type: "ERROR", reason: "proof does not match our order" };
    // Never trust the buyer's word — verify independently against the HSP gateway.
    const q = await hsp.query({ flowId: n.flowId, expectedMerchantName: config.merchantName });
    const settled = q.status === "payment-safe" || q.status === "payment-finalized";
    world.emitEvent({
      kind: "payment", title: `Seller verified payment: ${q.status}`, company: `${seller.id}.seller`, dealId: env.rfqId,
      severity: settled ? "success" : "warn", data: { status: q.status, attributionVerified: q.attributionVerified, txHash: q.txHash },
    });
    if (!settled || q.attributionVerified === false) return { type: "ERROR", reason: `payment not settled (${q.status})` };
    const value = r2((n.agreed ?? n.last) * n.qty);
    seller.cash = r2(seller.cash + value);
    seller.pnl.revenue = r2(seller.pnl.revenue + value);
    seller.pnl.cogs = r2(seller.pnl.cogs + (seller.policy.unitCost[n.sku] ?? 0) * n.qty);
    seller.stats.trades++;
    n.delivered = true;
    return { type: "DELIVERY", qty: n.qty, etaTicks: n.leadTicks };
  }

  return { type: "ERROR", reason: `unsupported ${b.type}` };
}

/** Called by the economy when a shipment leaves the seller's warehouse. */
export function releaseReservation(sellerId: string, sku: SkuId, qty: number) {
  const s = world.companies.get(sellerId);
  if (!s) return;
  s.reserved[sku] = Math.max(0, (s.reserved[sku] ?? 0) - qty);
  s.inventory[sku] = Math.max(0, (s.inventory[sku] ?? 0) - qty);
}
