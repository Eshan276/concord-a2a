import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";

// Each company gets its own secp256k1 key. Keys persist in .data/keys.json (gitignored)
// so payee addresses stay stable across restarts and can be registered on-chain.
const FILE = ".data/keys.json";
const keys: Record<string, Hex> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const accounts = new Map<string, PrivateKeyAccount>();

export function accountFor(companyId: string, provided?: Hex): PrivateKeyAccount {
  const cached = accounts.get(companyId);
  if (cached && !provided) return cached;
  if (provided) keys[companyId] = provided;
  if (!keys[companyId]) keys[companyId] = generatePrivateKey();
  mkdirSync(".data", { recursive: true });
  writeFileSync(FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
  const acct = privateKeyToAccount(keys[companyId]);
  accounts.set(companyId, acct);
  return acct;
}
