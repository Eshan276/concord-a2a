import type { Address, Hex } from "viem";

export type SkuId = string;
export type Role = "buyer" | "seller" | "both";
export type Strategy = "fair" | "aggressive" | "rogue";

export interface Sku {
  id: SkuId;
  name: string;
  unit: string;
  refPrice: number; // seed reference price (USD / unit)
}

export interface Recipe {
  output: SkuId;
  inputs: Record<SkuId, number>; // units of input per unit of output
  ratePerTick: number;
}

export interface Policy {
  reorderPoint: Record<SkuId, number>;
  reorderQty: Record<SkuId, number>;
  maxUnitPrice: Record<SkuId, number>; // buyer walk-away price
  unitCost: Record<SkuId, number>; // seller cost basis (private)
  targetMargin: number; // seller desired margin over cost
  autoApproveUsd: number; // deals above this need a human
  strategy: Strategy;
  guardrails: boolean; // sender-side rule enforcement (rogue actors switch this off)
}

export interface Company {
  id: string;
  name: string;
  sector: string;
  role: Role;
  tier: number; // supply-chain depth, used for layout
  wallet: Address;
  sells: SkuId[];
  buys: SkuId[];
  inventory: Record<SkuId, number>;
  reserved: Record<SkuId, number>;
  incoming: Record<SkuId, number>;
  demand?: Record<SkuId, number>; // end-customer consumption per tick
  recipe?: Recipe;
  replenish?: Record<SkuId, number>; // raw producers: units created per tick
  policy: Policy;
  cash: number;
  pnl: { revenue: number; cogs: number; spend: number; lostSales: number };
  stats: { trades: number; violations: number; onTime: number };
  createdAt: number;
}

export type Urgency = "normal" | "elevated" | "critical";

// ---- Concord Trade Protocol message bodies (carried as A2A DataParts) ----
export type ConcordBody =
  | { type: "RFQ"; sku: SkuId; qty: number; urgency: Urgency; neededWithinTicks: number }
  | { type: "QUOTE"; sku: SkuId; qty: number; unitPrice: number; leadTicks: number; rationale: string }
  | { type: "COUNTER"; unitPrice: number; round: number; rationale: string }
  | { type: "ACCEPT"; unitPrice: number; qty: number; rationale: string }
  | { type: "REJECT"; reason: string }
  | { type: "PAYMENT_CONDITIONS"; cartMandate: unknown; flowId: string; paymentRequestId: string; paymentUrl?: string; payTo: Address; amountUsd: number; dealValueUsd: number }
  | { type: "PAYMENT_PROOF"; flowId: string; paymentRequestId: string; status: string; txHash?: string }
  | { type: "DELIVERY"; qty: number; etaTicks: number }
  | { type: "ERROR"; reason: string };

export interface Envelope {
  id: string;
  rfqId: string;
  from: string; // agent id, e.g. "roaster.seller"
  to: string;
  ts: number;
  body: ConcordBody;
  hash: string; // sha256(canonical({id,rfqId,from,to,ts,body}))
  sig: Hex; // EIP-191 signature of hash by the sending company's wallet
}

export interface RuleCheck {
  rule: string;
  pass: boolean;
  detail: string;
  severity?: "info" | "block" | "escalate";
}

export type DealStage =
  | "rfq" | "negotiating" | "agreed" | "mandate" | "awaiting-approval" | "signing"
  | "submitted" | "settling" | "settled" | "delivering" | "delivered" | "failed" | "rejected";

export interface Deal {
  id: string; // rfqId
  buyer: string;
  seller?: string;
  sku: SkuId;
  qty: number;
  urgency: Urgency;
  stage: DealStage;
  quotes: { seller: string; unitPrice: number; leadTicks: number; accepted: boolean; violations: string[] }[];
  rounds: { by: string; unitPrice: number; rationale: string }[];
  unitPrice?: number;
  refPriceAtDeal?: number;
  valueUsd?: number;
  settleUsd?: number;
  buyerSurplus?: number;
  sellerSurplus?: number;
  hsp?: {
    mode: "sim" | "live";
    flowId?: string;
    paymentRequestId?: string;
    paymentUrl?: string;
    cartHash?: string;
    tokenTotalRaw?: string;
    status?: string;
    statusHistory: { status: string; ts: number }[];
    txHash?: string;
    attributionVerified?: boolean;
    payer?: string;
    payTo?: string;
    network?: string;
    token?: string;
  };
  ledgerTx?: string;
  deliverAtTick?: number;
  createdAt: number;
  updatedAt: number;
  note?: string;
}
