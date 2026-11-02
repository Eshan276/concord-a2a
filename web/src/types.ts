export type Urgency = "normal" | "elevated" | "critical";
export interface RuleCheck { rule: string; pass: boolean; detail: string; severity?: "info" | "block" | "escalate" }
export interface Company {
  id: string; name: string; sector: string; role: "buyer" | "seller" | "both"; tier: number; wallet: string;
  sells: string[]; buys: string[]; inventory: Record<string, number>; reserved: Record<string, number>; incoming: Record<string, number>;
  demand?: Record<string, number>;
  policy: { reorderPoint: Record<string, number>; reorderQty: Record<string, number>; maxUnitPrice: Record<string, number>; unitCost: Record<string, number>; targetMargin: number; autoApproveUsd: number; strategy: string; guardrails: boolean };
  cash: number; pnl: { revenue: number; cogs: number; spend: number; lostSales: number }; stats: { trades: number; violations: number; onTime: number };
}
export interface Sku { id: string; name: string; unit: string; refPrice: number; ref: number; band: { ref: number; lo: number; hi: number } }
export interface Deal {
  id: string; buyer: string; seller?: string; sku: string; qty: number; urgency: Urgency; stage: string;
  quotes: { seller: string; unitPrice: number; leadTicks: number; accepted: boolean; violations: string[] }[];
  rounds: { by: string; unitPrice: number; rationale: string }[];
  unitPrice?: number; refPriceAtDeal?: number; valueUsd?: number; buyerSurplus?: number; sellerSurplus?: number;
  hsp?: { mode: "sim" | "live"; flowId?: string; paymentRequestId?: string; cartHash?: string; tokenTotalRaw?: string; status?: string; statusHistory: { status: string; ts: number }[]; txHash?: string; attributionVerified?: boolean; payer?: string; payTo?: string; network?: string; token?: string };
  ledgerTx?: string; createdAt: number; updatedAt: number; note?: string;
}
export interface WorldEvent { seq: number; ts: number; tick: number; kind: string; title: string; company?: string; counterparty?: string; dealId?: string; severity?: "info" | "success" | "warn" | "danger"; data?: any }
export interface Approval { id: string; dealId: string; company: string; stage: "deal" | "sign" | "submit"; summary: Record<string, unknown>; createdAt: number }
export interface Snapshot {
  tick: number; running: boolean; speed: number;
  config: { hspMode: "sim" | "live"; merchantName: string; amountScale: number; fairBand: number; llm: boolean; model: string; ledger: string | null; chainId: number; explorer: string };
  skus: Sku[]; companies: Company[]; deals: Deal[]; events: WorldEvent[]; approvals: Approval[];
  priceHistory: Record<string, { tick: number; price: number }[]>;
  ledger: { kind: string; ts: number; tx?: string; anchored: boolean; data: any }[];
}
