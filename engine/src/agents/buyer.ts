import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";
import { allowedNetworks, hsp, settlementToken } from "../hsp/index.js";
import { TERMINAL, mandateNetwork, mandatePayTo, mandateTotalUsd, type Eip712Payload } from "../hsp/types.js";
import { ledger } from "../chain/ledger.js";
import { seal, send } from "../protocol/a2a.js";
import { blocking, checkCounter, checkMutualSurplus, escalations, verifyIncomingQuote, verifyLockedQuote, verifyMandate } from "../rules/engine.js";
import { requestApproval } from "../sim/approvals.js";
import { world } from "../sim/world.js";
import { accountFor } from "../wallet.js";
import type { Company, ConcordBody, Deal, Envelope, RuleCheck, SkuId, Urgency } from "../protocol/types.js";
import { r2, rid, sleep } from "../util.js";
import { buyerRespond } from "./strategy.js";

// Procurement agent: RFQ fan-out → receiver-side verification → negotiation → mandate verification
// → HSP prepare / sign / finalize / submit → independent settlement polling → delivery.

const inflight = new Set<string>(); // buyerId|sku
const cooldownUntil = new Map<string, number>(); // buyerId|sku -> tick
export const QUARANTINE_AFTER = 3; // violations before a seller stops receiving RFQs

export function isProcuring(buyerId: string, sku: SkuId) {
  const k = `${buyerId}|${sku}`;
  return inflight.has(k) || (cooldownUntil.get(k) ?? 0) > world.tick;
}

function stage(d: Deal, s: Deal["stage"], note?: string) {
  d.stage = s;
  if (note) d.note = note;
  world.touch(d);
}

function rules(company: string, deal: Deal, title: string, checks: RuleCheck[]) {
  const bad = blocking(checks).length > 0;
  world.emitEvent({ kind: "rule", title, company, dealId: deal.id, severity: bad ? "danger" : "success", data: { checks } });
  return !bad;
}

/** Coerce uint/int fields to bigint per the EIP-712 type definitions (gateway returns them as strings). */
function coerce(types: Eip712Payload["types"], type: string, value: any): any {
  if (type.endsWith("[]")) return (value as any[]).map((v) => coerce(types, type.slice(0, -2), v));
  if (types[type]) {
    const out: Record<string, unknown> = {};
    for (const f of types[type]) out[f.name] = coerce(types, f.type, value?.[f.name]);
    return out;
  }
  if (/^u?int\d*$/.test(type)) return BigInt(value);
  return value;
}

export async function signEip712(payer: ReturnType<typeof privateKeyToAccount>, p: Eip712Payload) {
  const { EIP712Domain, ...types } = p.types as any;
  const domain = { ...p.domain } as any;
  if (domain.chainId !== undefined) domain.chainId = Number(domain.chainId);
  return payer.signTypedData({ domain, types, primaryType: p.primaryType as any, message: coerce(types, p.primaryType, p.message) });
}

function payerFor(buyer: Company) {
  if (config.hspMode === "live" && config.treasuryKey) return privateKeyToAccount(config.treasuryKey);
  return accountFor(buyer.id);
}

export function urgencyOf(c: Company, sku: SkuId): Urgency {
  const burn = (c.demand?.[sku] ?? 0) + (c.recipe ? (c.recipe.inputs[sku] ?? 0) * c.recipe.ratePerTick : 0);
  if (!burn) return "normal";
  const cover = (c.inventory[sku] ?? 0) / burn;
  return cover < 4 ? "critical" : cover < 9 ? "elevated" : "normal";
}

export async function procure(buyer: Company, sku: SkuId, qtyOverride?: number) {
  const k = `${buyer.id}|${sku}`;
  if (inflight.has(k)) return;
  inflight.add(k);
  const me = `${buyer.id}.buyer`;
  const urgency = urgencyOf(buyer, sku);
  const qty = qtyOverride ?? buyer.policy.reorderQty[sku] ?? 50;
  const deal: Deal = {
    id: rid("rfq"), buyer: buyer.id, sku, qty, urgency, stage: "rfq", quotes: [], rounds: [],
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  world.deals.set(deal.id, deal);
  world.emitEvent({ kind: "deal", title: `Reorder triggered: ${qty} ${sku} (${urgency})`, company: me, dealId: deal.id, severity: urgency === "critical" ? "warn" : "info" });

  const tell = async (to: string, body: ConcordBody) => send(await seal(me, to, deal.id, body));

  try {
    // 1 — RFQ fan-out over A2A to every registered seller of this SKU.
    const all = world.sellersOf(sku, buyer.id);
    const sellers = all.filter((s) => s.stats.violations < QUARANTINE_AFTER);
    for (const q of all.filter((s) => !sellers.includes(s)))
      world.emitEvent({ kind: "rule", title: `${q.name} quarantined — ${q.stats.violations} violations on record`, company: me, counterparty: `${q.id}.seller`, dealId: deal.id, severity: "warn" });
    if (!sellers.length) return stage(deal, "failed", "no suppliers in good standing");
    const replies = await Promise.allSettled(
      sellers.map((s) => tell(`${s.id}.seller`, { type: "RFQ", sku, qty, urgency, neededWithinTicks: urgency === "critical" ? 3 : 8 })),
    );

    // 2 — Receiver-side verification of each quote (protects against sellers that bypass guardrails).
    const valid: { seller: Company; env: Envelope; price: number; lead: number; qty: number }[] = [];
    for (let i = 0; i < sellers.length; i++) {
      const r = replies[i];
      if (r.status !== "fulfilled" || r.value.body.type !== "QUOTE") continue;
      const q = r.value.body;
      const checks = verifyIncomingQuote(sku, q.unitPrice, urgency);
      const violations = blocking(checks).map((c) => c.rule);
      deal.quotes.push({ seller: sellers[i].id, unitPrice: q.unitPrice, leadTicks: q.leadTicks, accepted: false, violations });
      rules(me, deal, `Quote from ${sellers[i].name} verified`, checks);
      if (violations.length) {
        sellers[i].stats.violations++;
        world.emitEvent({ kind: "rule", title: `Violation by ${sellers[i].name}: ${violations.join(", ")}`, company: me, counterparty: `${sellers[i].id}.seller`, dealId: deal.id, severity: "danger", data: { checks } });
        void ledger.reportViolation(sellers[i].id, deal.id, violations.join(","));
        void tell(`${sellers[i].id}.seller`, { type: "REJECT", reason: `rule violation: ${violations.join(", ")}` }).catch(() => {});
        continue;
      }
      valid.push({ seller: sellers[i], env: r.value, price: q.unitPrice, lead: q.leadTicks, qty: q.qty });
    }
    world.touch(deal);
    if (!valid.length) return stage(deal, "failed", "no compliant quotes");

    // 3 — Pick best: price, lead time and reputation.
    const score = (v: (typeof valid)[number]) =>
      v.price * (1 + 0.015 * v.lead) * (1 + 0.05 * v.seller.stats.violations) * (v.qty < qty ? 1.04 : 1);
    valid.sort((a, b) => score(a) - score(b));
    const pick = valid[0];
    deal.seller = pick.seller.id;
    deal.qty = pick.qty;
    deal.quotes.find((q) => q.seller === pick.seller.id)!.accepted = true;
    for (const v of valid.slice(1)) void tell(`${v.seller.id}.seller`, { type: "REJECT", reason: "another supplier selected" }).catch(() => {});
    stage(deal, "negotiating");
    const sellerAgent = `${pick.seller.id}.seller`;

    // 4 — Negotiate (max 4 rounds). LLM proposes, rules clamp.
    let offered = pick.price;
    let agreed: number | undefined;
    deal.rounds.push({ by: sellerAgent, unitPrice: offered, rationale: (pick.env.body as any).rationale });
    for (let round = 1; round <= 4 && agreed === undefined; round++) {
      const move = await buyerRespond(buyer, sku, deal.qty, offered, round, urgency);
      if (move.action === "reject") {
        await tell(sellerAgent, { type: "REJECT", reason: move.rationale });
        return stage(deal, "rejected", move.rationale);
      }
      if (move.action === "accept") { agreed = offered; break; }
      let counter = move.unitPrice;
      const cchecks = checkCounter(buyer, sku, counter);
      if (blocking(cchecks).length) {
        const { lo } = world.band(sku);
        counter = r2(Math.min(buyer.policy.maxUnitPrice[sku] ?? Infinity, Math.max(lo, counter)));
        rules(me, deal, `Guardrail corrected counter ${move.unitPrice} → ${counter}`, checkCounter(buyer, sku, counter));
      }
      deal.rounds.push({ by: me, unitPrice: counter, rationale: `[${move.source}] ${move.rationale}` });
      world.touch(deal);
      const reply = await tell(sellerAgent, { type: "COUNTER", unitPrice: counter, round, rationale: `[${move.source}] ${move.rationale}` });
      if (reply.body.type === "ACCEPT") { agreed = counter; deal.rounds.push({ by: sellerAgent, unitPrice: counter, rationale: reply.body.rationale }); }
      else if (reply.body.type === "COUNTER") { offered = reply.body.unitPrice; deal.rounds.push({ by: sellerAgent, unitPrice: offered, rationale: reply.body.rationale }); }
      else return stage(deal, "rejected", (reply.body as any).reason ?? "seller walked away");
      world.touch(deal);
    }
    if (agreed === undefined) {
      await tell(sellerAgent, { type: "REJECT", reason: "no agreement within 4 rounds" });
      return stage(deal, "rejected", "no agreement within 4 rounds");
    }

    // 5 — Closing rules: mutual surplus, budget, human approval threshold.
    const ms = checkMutualSurplus(buyer, pick.seller, sku, deal.qty, agreed);
    Object.assign(deal, { unitPrice: agreed, refPriceAtDeal: world.refPrice(sku), valueUsd: ms.value, buyerSurplus: ms.buyerSurplus, sellerSurplus: ms.sellerSurplus });
    stage(deal, "agreed");
    if (!rules(me, deal, "Deal closing checks", ms.checks)) {
      await tell(sellerAgent, { type: "REJECT", reason: "closing rules failed" });
      return stage(deal, "failed", "closing rules failed");
    }
    if (escalations(ms.checks).length) {
      stage(deal, "awaiting-approval");
      const ok = await requestApproval(buyer.id, deal, "deal", { seller: pick.seller.name, sku, qty: deal.qty, unitPrice: agreed, valueUsd: ms.value });
      if (!ok) {
        await tell(sellerAgent, { type: "REJECT", reason: "declined by buyer's human approver" });
        return stage(deal, "rejected", "declined by human approver");
      }
    }

    // 6 — Accept → receiving agent issues payment conditions (HSP Cart Mandate).
    const cond = await tell(sellerAgent, { type: "ACCEPT", unitPrice: agreed, qty: deal.qty, rationale: "Terms accepted; send payment conditions." });
    if (cond.body.type !== "PAYMENT_CONDITIONS") return stage(deal, "failed", `seller did not issue mandate (${cond.body.type})`);
    const pc = cond.body;
    stage(deal, "mandate");
    const expectedUsd = Math.max(0.01, r2(ms.value * config.hspAmountScale));
    const mchecks = verifyMandate({
      expectedPayee: pick.seller.wallet, // registry payee (also anchored on HSK via ConcordLedger.registerCompany)
      payTo: mandatePayTo(pc.cartMandate) || pc.payTo,
      expectedUsd,
      mandateUsd: mandateTotalUsd(pc.cartMandate),
      network: mandateNetwork(pc.cartMandate),
      allowedNetworks: await allowedNetworks(),
    });
    if (!rules(me, deal, "Payment conditions verified against deal + registry", mchecks)) {
      pick.seller.stats.violations++;
      void ledger.reportViolation(pick.seller.id, deal.id, blocking(mchecks).map((c) => c.rule).join(","));
      await tell(sellerAgent, { type: "REJECT", reason: "payment mandate does not match agreed terms" });
      return stage(deal, "failed", "mandate tampering blocked");
    }

    // 7 — Payment Mandate: prepare → sign EIP-712 → finalize → submit, all through HSP.
    const token = await settlementToken();
    const payer = payerFor(buyer);
    deal.hsp = { mode: hsp.mode, flowId: pc.flowId, paymentRequestId: pc.paymentRequestId, paymentUrl: pc.paymentUrl, statusHistory: [], payer: payer.address, payTo: pc.payTo, network: token.network, token: token.coin };
    stage(deal, "signing");
    let prep = await hsp.prepare({ flowId: pc.flowId, payer: payer.address as Address, protocol: token.protocol });
    deal.hsp.cartHash = prep.cart_hash;
    deal.hsp.tokenTotalRaw = prep.token_total_raw;
    const lq = verifyLockedQuote(prep.token_total_raw, token.decimals, expectedUsd);
    if (!rules(me, deal, "Locked HSP quote verified", [lq])) return stage(deal, "failed", "locked quote mismatch");

    const gate = async (stageName: "sign" | "submit") => {
      if (config.hspMode !== "live" || !config.hspRequireConfirm) return true;
      stage(deal, "awaiting-approval");
      const ok = await requestApproval(buyer.id, deal, stageName, {
        recipient: prep.pay_to ?? pc.payTo, payer: payer.address, token_total_raw: prep.token_total_raw, network: token.network, coin: token.coin,
      });
      stage(deal, "signing");
      return ok;
    };
    if (!(await gate("sign"))) return stage(deal, "rejected", "signature declined by human");
    if (prep.quote_expires_at && Date.parse(prep.quote_expires_at) < Date.now() + 5000) {
      prep = await hsp.prepare({ flowId: pc.flowId, payer: payer.address as Address, protocol: token.protocol });
      deal.hsp.tokenTotalRaw = prep.token_total_raw;
    }
    const signature = await signEip712(payer, prep.eip712);
    world.emitEvent({ kind: "payment", title: `Payment Mandate signed (${prep.eip712.primaryType})`, company: me, dealId: deal.id, severity: "info", data: { payer: payer.address, tokenTotalRaw: prep.token_total_raw, signature: `${signature.slice(0, 18)}…` } });
    const { paymentMandateJson } = await hsp.finalize({ signature, prep });
    if (!(await gate("submit"))) return stage(deal, "rejected", "submission declined by human");
    const sub = await hsp.submit({ paymentMandateJson });
    deal.hsp.status = sub.status;
    deal.hsp.statusHistory.push({ status: sub.status, ts: Date.now() });
    stage(deal, "submitted");
    world.emitEvent({ kind: "payment", title: `Submitted to HSP gateway: ${sub.status}`, company: me, dealId: deal.id, severity: "info", data: { mode: hsp.mode } });

    // 8 — Poll settlement (15 s per HSP guide in live mode). Never infer success.
    stage(deal, "settling");
    const started = Date.now();
    const pollMs = hsp.mode === "live" ? 15_000 : 700;
    let last = sub.status;
    for (;;) {
      await sleep(pollMs);
      let q;
      try { q = await hsp.query({ flowId: pc.flowId, paymentRequestId: pc.paymentRequestId, expectedMerchantName: config.merchantName }); }
      catch (e) { world.emitEvent({ kind: "payment", title: "Query failed — retaining ids", company: me, dealId: deal.id, severity: "warn", data: { error: String(e) } }); continue; }
      if (q.status !== last) {
        last = q.status;
        deal.hsp.status = q.status;
        deal.hsp.statusHistory.push({ status: q.status, ts: Date.now() });
        deal.hsp.txHash = q.txHash;
        deal.hsp.attributionVerified = q.attributionVerified;
        world.emitEvent({ kind: "payment", title: q.status, company: me, dealId: deal.id, severity: q.status === "payment-failed" ? "danger" : "info", data: { txHash: q.txHash, mode: hsp.mode } });
        world.touch(deal);
      }
      if (q.status === "payment-failed") return stage(deal, "failed", q.statusReason ?? "payment failed");
      if (q.status === "payment-safe" || q.status === "payment-finalized") break;
      if (TERMINAL.has(q.status)) break;
      if (Date.now() - started > 10 * 60_000) { deal.note = "Pending confirmation"; world.touch(deal); }
    }
    stage(deal, "settled");
    buyer.cash = r2(buyer.cash - ms.value);
    buyer.pnl.spend = r2(buyer.pnl.spend + ms.value);
    world.recordSettledPrice(sku, agreed);
    deal.ledgerTx = undefined;
    void ledger.recordSettlement({
      dealId: deal.id, buyer: buyer.id, seller: pick.seller.id, sku, qty: deal.qty, unitPrice: agreed,
      refPrice: world.refPrice(sku), cartHash: deal.hsp.cartHash ?? "", paymentRequestId: pc.paymentRequestId, hspTx: deal.hsp.txHash,
    }).then((e) => { deal.ledgerTx = (e as any)?.tx; world.touch(deal); });

    // 9 — Proof of payment → seller verifies independently with HSP → ships.
    const dl = await tell(sellerAgent, { type: "PAYMENT_PROOF", flowId: pc.flowId, paymentRequestId: pc.paymentRequestId, status: last, txHash: deal.hsp.txHash });
    if (dl.body.type !== "DELIVERY") return stage(deal, "failed", `seller refused delivery: ${(dl.body as any).reason}`);
    buyer.incoming[sku] = (buyer.incoming[sku] ?? 0) + deal.qty;
    deal.deliverAtTick = world.tick + dl.body.etaTicks;
    stage(deal, "delivering");
  } catch (e) {
    world.emitEvent({ kind: "system", title: `Procurement error: ${(e as Error).message}`, company: me, dealId: deal.id, severity: "danger" });
    stage(deal, "failed", (e as Error).message);
  } finally {
    inflight.delete(k);
    if (deal.stage === "failed" || deal.stage === "rejected") cooldownUntil.set(k, world.tick + 4);
  }
}

export async function buyerHandle(env: Envelope): Promise<ConcordBody> {
  if (env.body.type === "REJECT") return { type: "REJECT", reason: "acknowledged" };
  return { type: "ERROR", reason: "procurement agent accepts notifications only" };
}

export type { Hex };
