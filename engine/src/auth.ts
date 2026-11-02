import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { NextFunction, Request, Response } from "express";

// Tenancy: each company gets its own API token at onboarding and can only read/act on its own data.
// The network operator (control room) uses a separate admin token.
const FILE = ".data/tokens.json";
mkdirSync(".data", { recursive: true });
const store: { admin: string; companies: Record<string, string> } = existsSync(FILE)
  ? JSON.parse(readFileSync(FILE, "utf8"))
  : { admin: process.env.ADMIN_TOKEN ?? `adm_${randomBytes(16).toString("hex")}`, companies: {} };
const save = () => writeFileSync(FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
save();

export const adminToken = store.admin;

export function tokenFor(companyId: string) {
  store.companies[companyId] ??= `cmp_${randomBytes(18).toString("hex")}`;
  save();
  return store.companies[companyId];
}

const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function bearer(req: Request) {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  return typeof req.query.token === "string" ? req.query.token : "";
}

export function companyOf(token: string): string | undefined {
  if (!token) return undefined;
  return Object.entries(store.companies).find(([, t]) => eq(t, token))?.[0];
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const t = bearer(req);
  if (t && eq(t, store.admin)) return next();
  res.status(401).json({ error: "operator token required" });
}

export function requireCompany(req: Request, res: Response, next: NextFunction) {
  const cid = companyOf(bearer(req));
  if (!cid) return res.status(401).json({ error: "company token required" });
  res.locals.companyId = cid;
  next();
}
