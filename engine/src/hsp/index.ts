import { config } from "../config.js";
import { McpHsp } from "./mcp.js";
import { SimHsp } from "./sim.js";
import type { ChainToken, HspClient } from "./types.js";

export const hsp: HspClient = config.hspMode === "live" ? new McpHsp(config.hspMcpUrl) : new SimHsp();

let tokens: ChainToken[] | undefined;
/** Network/token/protocol always come from get_chain_config — never from memory. */
export async function settlementToken(): Promise<ChainToken> {
  tokens ??= await hsp.getChainConfig();
  const t =
    tokens.find((x) => x.network === config.hspNetwork && x.coin === config.hspCoin) ??
    tokens.find((x) => x.coin === config.hspCoin) ??
    tokens[0];
  if (!t) throw new Error("get_chain_config returned no tokens");
  return t;
}
export async function allowedNetworks() {
  tokens ??= await hsp.getChainConfig();
  return [...new Set(tokens.map((t) => t.network))];
}
