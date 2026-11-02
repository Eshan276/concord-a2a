import { world } from "./world.js";
import type { Deal } from "../protocol/types.js";
import { rid } from "../util.js";

/** Human-in-the-loop gate. Resolves when someone clicks approve/decline in the control room (10 min timeout → decline). */
export function requestApproval(company: string, deal: Deal, stage: "deal" | "sign" | "submit", summary: Record<string, unknown>) {
  return new Promise<boolean>((resolve) => {
    const id = rid("apv");
    const done = (ok: boolean) => {
      if (!world.approvals.has(id)) return;
      world.approvals.delete(id);
      clearTimeout(timer);
      world.emitEvent({ kind: "approval", title: `${stage} ${ok ? "approved" : "declined"} by human`, company: `${company}.buyer`, dealId: deal.id, severity: ok ? "success" : "warn" });
      world.emit("approvals");
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 10 * 60_000);
    world.approvals.set(id, { id, dealId: deal.id, company, stage, summary, createdAt: Date.now(), resolve: done });
    world.emitEvent({ kind: "approval", title: `Human approval required (${stage})`, company: `${company}.buyer`, dealId: deal.id, severity: "warn", data: summary });
    world.emit("approvals");
  });
}
