import "dotenv/config";

const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 8787),
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${num(process.env.PORT, 8787)}`,

  // Team name used as HSP merchant_name — must be identical everywhere for prize attribution.
  merchantName: process.env.HSP_MERCHANT_NAME ?? "Concord",

  // HSP gateway mode: "sim" runs a local, clearly-labelled simulator of the HSP flow
  // (real EIP-712 signing + verification, no chain). "live" talks to the HSP MCP server.
  hspMode: (process.env.HSP_MODE ?? "sim") as "sim" | "live",
  hspMcpUrl: process.env.HSP_MCP_URL ?? "https://mcp-qa.hashkeymerchant.com/",
  // Deal value (USD) × scale = amount actually settled through HSP (keeps testnet spend tiny).
  hspAmountScale: num(process.env.HSP_AMOUNT_SCALE, 0.001),
  // In live mode, require a human click in the dashboard before signing and before submitting.
  hspRequireConfirm: (process.env.HSP_REQUIRE_CONFIRM ?? "true") === "true",
  // Preferred network/token from get_chain_config (live mode).
  hspNetwork: process.env.HSP_NETWORK ?? "hashkey-testnet",
  hspCoin: process.env.HSP_COIN ?? "USDC",
  // Optional funded payer key used by buyer agents that have no key of their own (live mode).
  treasuryKey: process.env.PAYER_PRIVATE_KEY as `0x${string}` | undefined,

  // LLM negotiation (falls back to deterministic heuristic strategy without a key).
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.CONCORD_MODEL ?? "claude-sonnet-5-5",

  // HSK Chain ledger anchoring (optional).
  chainRpc: process.env.HSK_RPC_URL ?? "https://mainnet.hsk.xyz",
  chainId: num(process.env.HSK_CHAIN_ID, 177),
  explorer: process.env.HSK_EXPLORER ?? "https://hashkey.blockscout.com",
  ledgerAddress: process.env.CONCORD_LEDGER_ADDRESS as `0x${string}` | undefined,
  operatorKey: process.env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined,

  tickMs: num(process.env.TICK_MS, 2500),
  fairBand: num(process.env.FAIR_BAND, 0.15),
  distressBand: num(process.env.DISTRESS_BAND, 0.03),
};
