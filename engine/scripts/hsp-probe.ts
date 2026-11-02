// Connectivity check for HSP Agentic Payment MCP (run after HSP confirms your IP allowlist).
//   npx tsx scripts/hsp-probe.ts
// Lists tools, saves live input schemas to .data/hsp-tools.json and prints get_chain_config.
import { McpHsp } from "../src/hsp/mcp.js";
import { config } from "../src/config.js";

const health = await fetch(new URL("/health", config.hspMcpUrl)).then((r) => r.text()).catch((e) => String(e));
console.log("health:", health.slice(0, 200));
const c = new McpHsp(config.hspMcpUrl);
try {
  await c.connect();
  console.log("all 8 tools present; schemas written to .data/hsp-tools.json");
  console.log(JSON.stringify(await c.getChainConfig(), null, 2));
} catch (e) {
  console.error("HSP MCP unreachable:", (e as Error).message);
  console.error("If you see a Cloudflare block, your egress IP is not on the HSP QA allowlist yet.");
  process.exit(1);
}
process.exit(0);
