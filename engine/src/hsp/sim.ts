import { randomBytes } from "node:crypto";
import { verifyTypedData, type Address, type Hex } from "viem";
import type { ChainToken, HspClient, PrepareResult, QueryResult } from "./types.js";
import { mandateTotalUsd } from "./types.js";
import { hashObj, rid } from "../util.js";

// Local simulator of the HSP Agentic Payment flow. It is NOT the gateway: nothing is broadcast
// and no tx hash is ever produced. It does run the real cryptography — the payer agent signs a
// genuine EIP-712 TransferWithAuthorization and the simulator verifies it with ecrecover — so the
// agent code path is identical to live mode. The UI labels every simulated settlement.

const TOKENS: ChainToken[] = [
  { network: "hashkey-testnet", chainId: 133, coin: "USDC", address: "0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6", decimals: 6, protocol: "eip3009" },
  { network: "hashkey-testnet", chainId: 133, coin: "USDT", address: "0x372325443233fEbaC1F6998aC750276468c83CC6", decimals: 6, protocol: "permit2" },
];

interface Flow {
  flowId: string;
  paymentRequestId: string;
  merchantName: string;
  payTo: Address;
  amountUsd: number;
  token: ChainToken;
  status: string;
  payer?: Address;
  quoteExpires?: number;
  statusReason?: string;
}

const PROGRESSION = ["payment-verified", "payment-processing", "payment-included", "payment-safe", "payment-finalized"];

export class SimHsp implements HspClient {
  mode = "sim" as const;
  private flows = new Map<string, Flow>();
  private byPr = new Map<string, Flow>();

  async getChainConfig() {
    return TOKENS;
  }

  async createOrder(i: { merchantName: string; payTo: Address; cartMandate: any }) {
    const md = i.cartMandate.contents.payment_request.method_data[0].data;
    const token = TOKENS.find((t) => t.network === md.network && t.coin === md.coin);
    if (!token) throw new Error(`sim-hsp: unsupported ${md.network}/${md.coin}`);
    const prId = i.cartMandate.contents.payment_request.details.id;
    if (this.byPr.has(prId)) throw new Error("sim-hsp 10004: duplicate payment_request_id");
    const f: Flow = {
      flowId: crypto.randomUUID(),
      paymentRequestId: prId,
      merchantName: i.merchantName,
      payTo: i.payTo, // server overrides data.pay_to with the separately supplied pay_to, like HSP
      amountUsd: mandateTotalUsd(i.cartMandate),
      token,
      status: "payment-required",
    };
    this.flows.set(f.flowId, f);
    this.byPr.set(prId, f);
    return { flowId: f.flowId, paymentRequestId: prId, paymentUrl: `sim://checkout/${f.flowId}` };
  }

  async prepare(i: { flowId: string; payer: Address; protocol: string }): Promise<PrepareResult> {
    const f = this.flows.get(i.flowId);
    if (!f) throw new Error("sim-hsp 10003: flow not found");
    if (i.payer.toLowerCase() === f.payTo.toLowerCase()) throw new Error("sim-hsp: payer must differ from pay_to");
    f.payer = i.payer;
    f.quoteExpires = Date.now() + 5 * 60_000;
    const value = BigInt(Math.round(f.amountUsd * 10 ** f.token.decimals));
    const now = Math.floor(Date.now() / 1000);
    const eip712 = {
      domain: { name: "USDC", version: "2", chainId: f.token.chainId, verifyingContract: f.token.address },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: i.payer,
        to: f.payTo,
        value: value.toString(),
        validAfter: "0",
        validBefore: String(now + 300),
        nonce: ("0x" + randomBytes(32).toString("hex")) as Hex,
      },
    };
    const contents = {
      payment_mandate_id: f.paymentRequestId,
      payment_details_id: f.paymentRequestId,
      payment_details_total: { label: "Total", amount: { currency: "USD", value: f.amountUsd.toFixed(2) } },
      payment_response: { method_name: "https://www.x402.org/", details: { network: f.token.network, coin: f.token.coin } },
      merchant_agent: f.merchantName,
      timestamp: new Date().toISOString(),
    };
    return {
      eip712,
      cart_hash: hashObj({ flow: f.flowId, pr: f.paymentRequestId, amount: f.amountUsd }),
      token_total_raw: value.toString(),
      quote_expires_at: new Date(f.quoteExpires).toISOString(),
      pay_to: f.payTo,
      payer: i.payer,
      payment_request_id: f.paymentRequestId,
      payment_payload: { x402Version: 2, flow_id: f.flowId, payload: { signature: "", authorization: eip712.message } },
      payment_mandate_contents: contents,
      gas_fee_advanced: true,
    };
  }

  async finalize(i: { signature: string; prep: PrepareResult }) {
    const { eip712 } = i.prep;
    const ok = await verifyTypedData({
      address: eip712.message.from as Address,
      domain: eip712.domain as any,
      types: eip712.types as any,
      primaryType: eip712.primaryType,
      message: eip712.message as any,
      signature: i.signature as Hex,
    });
    if (!ok) throw new Error("sim-hsp: EIP-712 signature does not recover to payer");
    const payload = structuredClone(i.prep.payment_payload) as any;
    payload.payload.signature = i.signature;
    const paymentHash = hashObj(i.prep.payment_mandate_contents);
    return {
      paymentMandateJson: {
        payment_mandate_contents: i.prep.payment_mandate_contents,
        payment_payload: payload,
        cart_hash: i.prep.cart_hash,
        payment_hash: paymentHash,
        user_authorization: `sim.${paymentHash.slice(0, 32)}`,
      },
    };
  }

  async submit(i: { paymentMandateJson: any }) {
    const flowId = i.paymentMandateJson.payment_payload.flow_id;
    const f = this.flows.get(flowId);
    if (!f) throw new Error("sim-hsp 10003: flow not found");
    if (f.status !== "payment-required") throw new Error("sim-hsp 40001: mandate already consumed");
    if (!f.quoteExpires || Date.now() > f.quoteExpires) throw new Error("sim-hsp 30043: quote expired");
    f.status = "payment-submitted";
    let step = 0;
    const advance = () => {
      if (step >= PROGRESSION.length) return;
      f.status = PROGRESSION[step++];
      if (f.status === "payment-finalized") f.statusReason = "simulated finality";
      else setTimeout(advance, 700 + Math.random() * 900);
    };
    setTimeout(advance, 600);
    return { status: f.status, raw: { flow_id: flowId, sim: true } };
  }

  async query(i: { flowId?: string; paymentRequestId?: string; expectedMerchantName: string }): Promise<QueryResult> {
    const f = (i.flowId && this.flows.get(i.flowId)) || (i.paymentRequestId && this.byPr.get(i.paymentRequestId));
    if (!f) throw new Error("sim-hsp 10003: not found");
    return {
      status: f.status,
      txHash: undefined, // never fabricate a tx hash
      attributionVerified: f.merchantName === i.expectedMerchantName,
      statusReason: f.statusReason,
      raw: { ...f, sim: true, id: rid("q") },
    };
  }
}
