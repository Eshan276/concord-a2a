import { mkdirSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Address } from "viem";
import type { ChainToken, HspClient, PrepareResult, QueryResult } from "./types.js";

// Live client for the HSP Agentic Payment MCP server (https://mcp-qa.hashkeymerchant.com/).
// The guide says to use the live input schemas, so tool schemas are read at connect time and
// logical argument names are mapped onto whatever the server actually declares.

type Schema = { properties?: Record<string, { type?: string | string[] }>; required?: string[] };
const REQUIRED_TOOLS = [
  "get_chain_config", "create_order", "get_order", "prepare_payment",
  "finalize_payment", "estimate_fee", "submit_payment", "query_payment",
];

export class McpHsp implements HspClient {
  mode = "live" as const;
  private client?: Client;
  private schemas = new Map<string, Schema>();
  private toolNames = new Map<string, string>(); // logical -> actual (clients may prefix)

  constructor(private url: string) {}

  async connect() {
    if (this.client) return;
    const client = new Client({ name: "concord-engine", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(this.url)));
    const { tools } = await client.listTools();
    for (const t of tools) {
      const logical = REQUIRED_TOOLS.find((n) => t.name === n || t.name.endsWith(n));
      if (logical) {
        this.toolNames.set(logical, t.name);
        this.schemas.set(logical, t.inputSchema as Schema);
      }
    }
    mkdirSync(".data", { recursive: true });
    writeFileSync(".data/hsp-tools.json", JSON.stringify(tools, null, 2));
    const missing = REQUIRED_TOOLS.filter((n) => !this.toolNames.has(n));
    if (missing.length) throw new Error(`HSP MCP missing tools: ${missing.join(", ")} — refusing to pay`);
    this.client = client;
  }

  /** Map logical args to the live schema: pick the first candidate key the schema declares and coerce object/string. */
  private adapt(tool: string, args: Record<string, { candidates: string[]; value: unknown }>) {
    const props = this.schemas.get(tool)?.properties ?? {};
    const out: Record<string, unknown> = {};
    for (const [logical, { candidates, value }] of Object.entries(args)) {
      if (value === undefined) continue;
      const key = candidates.find((c) => c in props) ?? (Object.keys(props).length ? undefined : candidates[0]);
      if (!key) continue;
      const t = props[key]?.type;
      const types = Array.isArray(t) ? t : t ? [t] : [];
      let v = value;
      if (types.includes("string") && !types.includes("object") && typeof v === "object") v = JSON.stringify(v);
      if (types.includes("object") && !types.includes("string") && typeof v === "string") {
        try { v = JSON.parse(v); } catch { /* keep string */ }
      }
      out[key] = v;
      void logical;
    }
    return out;
  }

  private async call(tool: string, args: Record<string, unknown>): Promise<any> {
    await this.connect();
    const res: any = await this.client!.callTool({ name: this.toolNames.get(tool)!, arguments: args });
    let payload: any = res.structuredContent;
    if (payload === undefined) {
      const text = (res.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
      try { payload = JSON.parse(text); } catch { payload = { text }; }
    }
    if (res.isError) throw new Error(`HSP ${tool} error: ${JSON.stringify(payload).slice(0, 400)}`);
    if (payload && typeof payload === "object" && "code" in payload && payload.code !== 0 && payload.code !== undefined)
      throw new Error(`HSP ${tool} code ${payload.code}: ${payload.msg ?? ""}`);
    return payload?.data ?? payload;
  }

  async getChainConfig(): Promise<ChainToken[]> {
    const raw = await this.call("get_chain_config", {});
    const out: ChainToken[] = [];
    const visit = (node: any, ctx: { network?: string; chainId?: number }) => {
      if (Array.isArray(node)) return node.forEach((n) => visit(n, ctx));
      if (!node || typeof node !== "object") return;
      const next = {
        network: node.network ?? node.name ?? ctx.network,
        chainId: Number(node.chain_id ?? node.chainId ?? ctx.chainId),
      };
      if (node.address && node.decimals !== undefined) {
        out.push({
          network: next.network!,
          chainId: next.chainId!,
          coin: node.symbol ?? node.coin ?? node.token,
          address: node.address,
          decimals: Number(node.decimals),
          protocol: (node.payment_protocol ?? node.protocol ?? "eip3009").toLowerCase(),
        });
      }
      for (const v of Object.values(node)) if (typeof v === "object") visit(v, next);
    };
    visit(raw, {});
    return out;
  }

  async createOrder(i: { merchantName: string; payTo: Address; cartMandate: unknown }) {
    const r = await this.call("create_order", this.adapt("create_order", {
      merchant_name: { candidates: ["merchant_name", "merchantName"], value: i.merchantName },
      pay_to: { candidates: ["pay_to", "payTo"], value: i.payTo },
      cart_mandate: { candidates: ["cart_mandate", "cartMandate"], value: i.cartMandate },
    }));
    return { flowId: r.flow_id, paymentRequestId: r.payment_request_id, paymentUrl: r.payment_url };
  }

  async prepare(i: { flowId: string; payer: Address; protocol: string }): Promise<PrepareResult> {
    return this.call("prepare_payment", this.adapt("prepare_payment", {
      flow_id: { candidates: ["flow_id", "flowId"], value: i.flowId },
      payer: { candidates: ["payer", "payer_address", "from", "payerAddress"], value: i.payer },
      protocol: { candidates: ["protocol", "payment_protocol"], value: i.protocol },
    }));
  }

  async finalize(i: { signature: string; prep: PrepareResult }) {
    const r = await this.call("finalize_payment", this.adapt("finalize_payment", {
      signature: { candidates: ["signature"], value: i.signature },
      payment_payload: { candidates: ["payment_payload"], value: i.prep.payment_payload },
      payment_mandate_contents: { candidates: ["payment_mandate_contents"], value: i.prep.payment_mandate_contents },
      cart_hash: { candidates: ["cart_hash"], value: i.prep.cart_hash },
    }));
    return { paymentMandateJson: r.payment_mandate_json ?? r };
  }

  async submit(i: { paymentMandateJson: unknown }) {
    const r = await this.call("submit_payment", this.adapt("submit_payment", {
      payment_mandate_json: { candidates: ["payment_mandate_json", "paymentMandateJson"], value: i.paymentMandateJson },
    }));
    return { status: r.status ?? r.payment?.status ?? "payment-submitted", raw: r };
  }

  async query(i: { flowId?: string; paymentRequestId?: string; expectedMerchantName: string }): Promise<QueryResult> {
    const r = await this.call("query_payment", this.adapt("query_payment", {
      flow_id: { candidates: ["flow_id", "flowId"], value: i.flowId },
      payment_request_id: { candidates: ["payment_request_id", "paymentRequestId"], value: i.flowId ? undefined : i.paymentRequestId },
      expected_merchant_name: { candidates: ["expected_merchant_name", "merchant_name"], value: i.expectedMerchantName },
    }));
    const p = r.payment ?? r;
    return {
      status: p.status,
      txHash: p.tx_signature || undefined,
      attributionVerified: r.attribution_verified ?? p.attribution_verified,
      statusReason: p.status_reason,
      raw: r,
    };
  }
}
