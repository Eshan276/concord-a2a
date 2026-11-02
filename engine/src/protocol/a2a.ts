import type { Request, Response, Router } from "express";
import express from "express";
import { verifyMessage, type Address, type Hex } from "viem";
import { accountFor } from "../wallet.js";
import { config } from "../config.js";
import { hashObj, rid } from "../util.js";
import { world } from "../sim/world.js";
import type { ConcordBody, Envelope } from "./types.js";

// Concord speaks A2A (JSON-RPC 2.0 over HTTP, "message/send"). Each Concord message is a signed
// envelope carried in a DataPart. Every company exposes two agents with discoverable Agent Cards:
//   GET  /agents/:company.:side/.well-known/agent-card.json
//   POST /agents/:company.:side/a2a

export const CONCORD_EXT = "https://concord.trade/ext/trade/v1";

export function agentCard(companyId: string, side: "buyer" | "seller") {
  const c = world.companies.get(companyId)!;
  const id = `${companyId}.${side}`;
  return {
    protocolVersion: "0.3.0",
    name: `${c.name} — ${side === "seller" ? "Sales" : "Procurement"} Agent`,
    description: side === "seller"
      ? `Quotes, negotiates and invoices ${c.sells.join(", ")} under Concord fair-dealing rules; settles via HSP.`
      : `Sources ${c.buys.join(", ")} from Concord suppliers; verifies mandates and pays via HSP.`,
    url: `${config.publicUrl}/agents/${id}/a2a`,
    preferredTransport: "JSONRPC",
    version: "0.1.0",
    provider: { organization: c.name, url: config.publicUrl },
    capabilities: { streaming: false, pushNotifications: false, extensions: [{ uri: CONCORD_EXT, required: true }] },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: side === "seller"
      ? c.sells.map((s) => ({ id: `quote:${s}`, name: `Supply ${s}`, description: `RFQ → QUOTE → negotiate → HSP cart mandate for ${s}`, tags: ["rfq", "hsp", s] }))
      : [{ id: "procure", name: "Procurement", description: "Receives delivery notices and payment requests", tags: ["procurement"] }],
    "x-concord": { company: companyId, payee: c.wallet, sells: c.sells, buys: c.buys },
  };
}

export async function seal(from: string, to: string, rfqId: string, body: ConcordBody): Promise<Envelope> {
  const companyId = from.split(".")[0];
  const base = { id: rid("msg"), rfqId, from, to, ts: Date.now(), body };
  const hash = hashObj(base);
  const sig = await accountFor(companyId).signMessage({ message: hash });
  return { ...base, hash, sig };
}

export async function verifyEnvelope(env: Envelope): Promise<boolean> {
  const { hash, sig, ...base } = env;
  if (hashObj(base) !== hash) return false;
  const company = world.companies.get(env.from.split(".")[0]);
  if (!company) return false;
  return verifyMessage({ address: company.wallet as Address, message: hash, signature: sig as Hex });
}

/** Send an envelope to another agent over real HTTP A2A and return its signed reply envelope. */
export async function send(env: Envelope): Promise<Envelope> {
  world.emitEvent({
    kind: "a2a", title: env.body.type, company: env.from, counterparty: env.to, dealId: env.rfqId,
    data: { body: env.body, hash: env.hash },
  });
  const res = await fetch(`http://127.0.0.1:${config.port}/agents/${env.to}/a2a`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: env.id,
      method: "message/send",
      params: {
        message: {
          kind: "message", role: "agent", messageId: env.id, contextId: env.rfqId,
          parts: [{ kind: "data", data: env }], extensions: [CONCORD_EXT],
        },
      },
    }),
  });
  const json: any = await res.json();
  if (json.error) throw new Error(`A2A ${env.to}: ${json.error.message}`);
  const reply: Envelope = json.result?.parts?.[0]?.data;
  if (!reply || !(await verifyEnvelope(reply))) throw new Error(`A2A ${env.to}: unsigned or tampered reply`);
  world.emitEvent({
    kind: "a2a", title: reply.body.type, company: reply.from, counterparty: reply.to, dealId: reply.rfqId,
    data: { body: reply.body, hash: reply.hash },
  });
  return reply;
}

export type Handler = (env: Envelope) => Promise<ConcordBody>;

export function a2aRouter(handlers: { seller: Handler; buyer: Handler }): Router {
  const r = express.Router();
  r.get("/agents/:agent/.well-known/agent-card.json", (req: Request, res: Response) => {
    const [cid, side] = String(req.params.agent).split(".");
    if (!world.companies.has(cid) || (side !== "buyer" && side !== "seller")) return res.status(404).end();
    res.json(agentCard(cid, side));
  });
  r.post("/agents/:agent/a2a", async (req: Request, res: Response) => {
    const { id, method, params } = req.body ?? {};
    const fail = (code: number, message: string) => res.json({ jsonrpc: "2.0", id, error: { code, message } });
    if (method !== "message/send") return fail(-32601, "method not found");
    const agent = String(req.params.agent);
    const [cid, side] = agent.split(".");
    if (!world.companies.has(cid)) return fail(-32001, "unknown agent");
    const env: Envelope = params?.message?.parts?.find((p: any) => p.kind === "data")?.data;
    if (!env || env.to !== agent) return fail(-32602, "invalid Concord envelope");
    if (!(await verifyEnvelope(env))) return fail(-32003, "envelope signature invalid");
    try {
      const body = await (side === "seller" ? handlers.seller : handlers.buyer)(env);
      const reply = await seal(agent, env.from, env.rfqId, body);
      res.json({
        jsonrpc: "2.0", id,
        result: { kind: "message", role: "agent", messageId: reply.id, contextId: env.rfqId, parts: [{ kind: "data", data: reply }] },
      });
    } catch (e) {
      fail(-32000, String((e as Error).message ?? e));
    }
  });
  return r;
}
