import { createPublicClient, createWalletClient, defineChain, http, keccak256, toHex, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";
import { world } from "../sim/world.js";

// Anchors registry entries, settlements and rule violations into ConcordLedger on HSK Chain.
// Without CONCORD_LEDGER_ADDRESS + OPERATOR_PRIVATE_KEY the entries stay local and are shown as "not anchored".

export const LEDGER_ABI = parseAbi([
  "function registerCompany(bytes32 id, string name, address payee, uint8 role)",
  "function recordSettlement(bytes32 dealId, bytes32 buyer, bytes32 seller, bytes32 sku, uint64 qty, uint64 unitPriceMicros, uint64 refPriceMicros, bytes32 cartHash, string paymentRequestId, string hspTx)",
  "function reportViolation(bytes32 company, bytes32 dealId, string rule)",
  "function payeeOf(bytes32 id) view returns (address)",
]);

const enabled = Boolean(config.ledgerAddress && config.operatorKey);
const chain = defineChain({
  id: config.chainId,
  name: config.chainId === 177 ? "HashKey Chain" : "HashKey Chain Testnet",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: [config.chainRpc] } },
});
const pub = enabled ? createPublicClient({ chain, transport: http() }) : undefined;
const wallet = enabled
  ? createWalletClient({ chain, transport: http(), account: privateKeyToAccount(config.operatorKey!) })
  : undefined;

export const id32 = (s: string) => keccak256(toHex(s));
const micros = (usd: number) => BigInt(Math.round(usd * 1e6));

// Serialize writes so nonces never collide.
let queue: Promise<unknown> = Promise.resolve();
function enqueue(kind: string, data: Record<string, unknown>, fn: string, args: readonly unknown[]) {
  const entry = { kind, ts: Date.now(), anchored: false, tx: undefined as string | undefined, data };
  world.ledger.push(entry);
  if (!enabled) return Promise.resolve(entry);
  const p = queue.then(async () => {
    try {
      const hash = await wallet!.writeContract({ address: config.ledgerAddress!, abi: LEDGER_ABI, functionName: fn as any, args: args as any });
      entry.tx = hash;
      await pub!.waitForTransactionReceipt({ hash, timeout: 60_000 });
      entry.anchored = true;
      world.emitEvent({ kind: "ledger", title: `${kind} anchored on HSK`, severity: "success", data: { tx: hash, ...data } });
    } catch (e) {
      world.emitEvent({ kind: "ledger", title: `${kind} anchoring failed`, severity: "warn", data: { error: String(e).slice(0, 300) } });
    }
    return entry;
  });
  queue = p.catch(() => {});
  return p;
}

// Each anchored settlement costs ~250k gas; cap them so a long demo can't drain the operator wallet.
const MAX_SETTLEMENTS = Number(process.env.LEDGER_MAX_SETTLEMENTS ?? 20);
let anchoredSettlements = 0;

export const ledger = {
  enabled,
  registerCompany(id: string, name: string, payee: Address, role: number) {
    return enqueue("registry", { id, name, payee }, "registerCompany", [id32(id), name, payee, role]);
  },
  recordSettlement(d: { dealId: string; buyer: string; seller: string; sku: string; qty: number; unitPrice: number; refPrice: number; cartHash: string; paymentRequestId: string; hspTx?: string }) {
    if (enabled && ++anchoredSettlements > MAX_SETTLEMENTS) {
      world.ledger.push({ kind: "settlement", ts: Date.now(), anchored: false, data: { ...d, skipped: "LEDGER_MAX_SETTLEMENTS reached" } });
      return Promise.resolve(undefined);
    }
    return enqueue("settlement", d, "recordSettlement", [
      id32(d.dealId), id32(d.buyer), id32(d.seller), id32(d.sku), BigInt(d.qty), micros(d.unitPrice), micros(d.refPrice),
      ("0x" + d.cartHash.replace(/^0x/, "").padStart(64, "0").slice(0, 64)) as `0x${string}`, d.paymentRequestId, d.hspTx ?? "",
    ]);
  },
  reportViolation(company: string, dealId: string, rule: string) {
    return enqueue("violation", { company, dealId, rule }, "reportViolation", [id32(company), id32(dealId), rule]);
  },
};
