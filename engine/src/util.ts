import { createHash, randomBytes } from "node:crypto";

export function sortKeys(val: unknown): unknown {
  if (val === null || typeof val !== "object") return val;
  if (Array.isArray(val)) return val.map(sortKeys);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(val as object).sort()) out[k] = sortKeys((val as Record<string, unknown>)[k]);
  return out;
}

export const canonicalJson = (v: unknown) => JSON.stringify(sortKeys(v));
export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
export const hashObj = (v: unknown) => sha256(canonicalJson(v));
export const rid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const r4 = (n: number) => Math.round(n * 10000) / 10000;
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
