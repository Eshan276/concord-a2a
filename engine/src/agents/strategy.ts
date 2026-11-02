import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "../config.js";
import { world } from "../sim/world.js";
import type { Company, SkuId, Urgency } from "../protocol/types.js";
import { r2 } from "../util.js";

// The LLM proposes negotiation moves; the rule engine (rules/engine.ts) decides whether they may be sent.
// Without ANTHROPIC_API_KEY — or for the deliberately malicious "rogue" actor — a deterministic
// heuristic is used, so the demo always runs.

export interface Move {
  action: "accept" | "counter" | "reject";
  unitPrice: number;
  rationale: string;
  source: "llm" | "heuristic";
}

const anthropic = config.anthropicKey ? new Anthropic({ apiKey: config.anthropicKey }) : undefined;
const MoveSchema = z.object({
  action: z.enum(["accept", "counter", "reject"]),
  unitPrice: z.number(),
  rationale: z.string(),
});

let inflight = 0;
async function llm(system: string, prompt: string): Promise<Omit<Move, "source"> | undefined> {
  if (!anthropic || inflight >= 4) return undefined;
  inflight++;
  try {
    const msg = await anthropic.messages.parse(
      {
        model: config.model,
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { format: zodOutputFormat(MoveSchema) },
      },
      { timeout: 20_000 },
    );
    return msg.parsed_output ?? undefined;
  } catch (e) {
    world.emitEvent({ kind: "llm", title: "LLM unavailable — heuristic fallback", severity: "warn", data: { error: String(e).slice(0, 200) } });
    return undefined;
  } finally {
    inflight--;
  }
}

const SYSTEM_SELLER = `You are the autonomous Sales Agent of a company on Concord, a B2B trade network.
Goal: maximise your company's profit over many repeated trades, while dealing fairly.
Hard rules enforced by code (moves that break them are blocked and reported on-chain, hurting your reputation):
- Price must stay within the fair band around the on-chain reference price.
- If the buyer is near stock-out ("critical"), you may not charge more than reference +3%.
- Never sell below your unit cost.
Prefer repeat business over squeezing one deal. Keep rationale to one or two crisp sentences, written for an auditor.`;

const SYSTEM_BUYER = `You are the autonomous Procurement Agent of a company on Concord, a B2B trade network.
Goal: secure supply reliably at a good price, while dealing fairly.
Hard rules enforced by code: you may not counter below the fair band floor (no predatory lowballing), and never above your walk-away price.
Healthy suppliers keep your supply chain alive — do not try to push them below a fair margin. Accept when the price is fair and close to reference.
Keep rationale to one or two crisp sentences, written for an auditor.`;

function ctx(sku: SkuId) {
  const { ref, lo, hi } = world.band(sku);
  return { ref: r2(ref), bandLo: r2(lo), bandHi: r2(hi) };
}

/** Seller: opening quote. */
export async function sellerOpen(seller: Company, sku: SkuId, qty: number, urgency: Urgency): Promise<Move> {
  const { ref, bandHi } = ctx(sku);
  const cost = seller.policy.unitCost[sku] ?? ref * 0.8;
  const target = cost * (1 + seller.policy.targetMargin);
  if (seller.policy.strategy === "rogue") {
    // Attack 1: gouge a buyer in distress. Attack 2: bait with a cheap quote, then swap pay_to in the mandate.
    if (urgency === "critical")
      return { action: "counter", unitPrice: r2(ref * 1.55), rationale: "Buyer is about to stock out — price at 1.55× reference, take it or leave it.", source: "heuristic" };
    return { action: "counter", unitPrice: r2(ref * 0.9), rationale: "Lowest price on the network, guaranteed.", source: "heuristic" };
  }
  const out = await llm(
    SYSTEM_SELLER,
    JSON.stringify({ task: "Open with a quote (action must be 'counter').", sku, qty, buyerUrgency: urgency, yourUnitCost: r2(cost), yourTargetMargin: seller.policy.targetMargin, referencePrice: ref, fairBand: ctx(sku), stockOnHand: world.available(seller, sku) }),
  );
  if (out) return { ...out, action: "counter", source: "llm" };
  const markup = seller.policy.strategy === "aggressive" ? 0.1 : 0.04;
  const p = Math.min(Math.max(target, ref * (1 + markup)), bandHi, urgency === "critical" ? ref * 1.03 : Infinity);
  return { action: "counter", unitPrice: r2(p), rationale: `Cost-plus ${(seller.policy.targetMargin * 100).toFixed(0)}% anchored near reference ${ref}.`, source: "heuristic" };
}

/** Seller: respond to buyer counter. */
export async function sellerRespond(seller: Company, sku: SkuId, qty: number, myLast: number, theirs: number, round: number): Promise<Move> {
  const cost = seller.policy.unitCost[sku] ?? 0;
  if (seller.policy.strategy === "rogue")
    return { action: "accept", unitPrice: theirs, rationale: "Deal. Sending payment details now.", source: "heuristic" };
  const minAcceptable = cost * (1 + seller.policy.targetMargin * 0.45);
  const out = await llm(
    SYSTEM_SELLER,
    JSON.stringify({ task: "Buyer countered. Accept, counter, or reject.", sku, qty, round, yourLastPrice: myLast, buyerCounter: theirs, yourUnitCost: r2(cost), fairBand: ctx(sku) }),
  );
  if (out) return { ...out, unitPrice: out.action === "accept" ? theirs : out.unitPrice, source: "llm" };
  if (theirs >= minAcceptable) return { action: "accept", unitPrice: theirs, rationale: `Counter keeps ${(((theirs - cost) / cost) * 100).toFixed(1)}% margin — accept to win repeat volume.`, source: "heuristic" };
  if (round >= 3) return { action: "reject", unitPrice: myLast, rationale: "Counter is below our minimum fair margin after 3 rounds.", source: "heuristic" };
  return { action: "counter", unitPrice: r2((myLast + Math.max(theirs, minAcceptable)) / 2), rationale: "Meeting halfway while protecting a minimum margin.", source: "heuristic" };
}

/** Buyer: respond to a quote or a seller counter. */
export async function buyerRespond(buyer: Company, sku: SkuId, qty: number, offered: number, round: number, urgency: Urgency): Promise<Move> {
  const { ref, bandLo } = ctx(sku);
  const walk = buyer.policy.maxUnitPrice[sku] ?? ref * 1.2;
  const out = await llm(
    SYSTEM_BUYER,
    JSON.stringify({ task: "Supplier offered a price. Accept, counter, or reject.", sku, qty, round, offeredUnitPrice: offered, yourWalkAwayPrice: walk, yourUrgency: urgency, referencePrice: ref, fairBand: ctx(sku) }),
  );
  if (out) return { ...out, unitPrice: out.action === "accept" ? offered : out.unitPrice, source: "llm" };
  if (offered > walk) return { action: "reject", unitPrice: offered, rationale: `Above walk-away ${walk}.`, source: "heuristic" };
  const target = ref * (urgency === "critical" ? 1.0 : 0.98);
  if (offered <= target * 1.01 || round >= 3 || (urgency === "critical" && round >= 1))
    return { action: "accept", unitPrice: offered, rationale: `${offered} is within 1% of fair reference ${ref}; securing supply.`, source: "heuristic" };
  const counter = r2(Math.max(bandLo, (offered + ref * (0.94 + Math.random() * 0.04)) / 2));
  return { action: "counter", unitPrice: counter, rationale: `Countering toward reference ${ref}; fair, not predatory.`, source: "heuristic" };
}
