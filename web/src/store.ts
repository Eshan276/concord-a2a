import { useEffect, useReducer, useState } from "react";
import type { Approval, Company, Deal, Snapshot, Sku, WorldEvent } from "./types";
import { api, getToken } from "./auth";

export interface State extends Snapshot {
  connected: boolean;
  dealMap: Record<string, Deal>;
  refSeries: Record<string, { tick: number; ref: number; lo: number; hi: number; trade?: number }[]>;
  pulses: Pulse[];
}
export interface Pulse { id: number; from: string; to: string; kind: "msg" | "money" | "goods" | "violation"; born: number }

type Action =
  | { t: "snapshot"; s: Snapshot }
  | { t: "event"; e: WorldEvent }
  | { t: "deal"; d: Deal }
  | { t: "tick"; tick: number; companies: Company[]; skus: Sku[]; running: boolean; speed: number }
  | { t: "approvals"; a: Approval[] }
  | { t: "conn"; ok: boolean }
  | { t: "gc" };

let pulseId = 0;
const company = (agent?: string) => agent?.split(".")[0] ?? "";

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case "snapshot": {
      const dealMap: Record<string, Deal> = {};
      for (const d of a.s.deals) dealMap[d.id] = d;
      const refSeries: State["refSeries"] = {};
      for (const k of a.s.skus) refSeries[k.id] = (a.s.priceHistory[k.id] ?? []).map((p) => ({ tick: p.tick, ref: p.price, lo: p.price * (1 - a.s.config.fairBand), hi: p.price * (1 + a.s.config.fairBand) }));
      return { ...s, ...a.s, dealMap, refSeries, connected: true };
    }
    case "event": {
      const events = [...s.events.slice(-599), a.e];
      let pulses = s.pulses;
      const from = company(a.e.company), to = company(a.e.counterparty);
      if (a.e.kind === "a2a" && from && to) pulses = [...pulses, { id: ++pulseId, from, to, kind: "msg", born: Date.now() }];
      if (a.e.kind === "rule" && a.e.severity === "danger" && from && to) pulses = [...pulses, { id: ++pulseId, from: to, to: from, kind: "violation", born: Date.now() }];
      return { ...s, events, pulses };
    }
    case "deal": {
      const prev = s.dealMap[a.d.id];
      let pulses = s.pulses;
      let refSeries = s.refSeries;
      if (a.d.seller && prev?.stage !== a.d.stage) {
        if (a.d.stage === "submitted") pulses = [...pulses, { id: ++pulseId, from: a.d.buyer, to: a.d.seller, kind: "money", born: Date.now() }];
        if (a.d.stage === "delivered") pulses = [...pulses, { id: ++pulseId, from: a.d.seller, to: a.d.buyer, kind: "goods", born: Date.now() }];
        if (a.d.stage === "settled" && a.d.unitPrice) {
          const ser = [...(refSeries[a.d.sku] ?? [])];
          const last = ser[ser.length - 1];
          if (last) ser[ser.length - 1] = { ...last, trade: a.d.unitPrice };
          refSeries = { ...refSeries, [a.d.sku]: ser };
        }
      }
      return { ...s, dealMap: { ...s.dealMap, [a.d.id]: a.d }, pulses, refSeries };
    }
    case "tick": {
      const refSeries = { ...s.refSeries };
      for (const k of a.skus) refSeries[k.id] = [...(refSeries[k.id] ?? []).slice(-239), { tick: a.tick, ref: k.band.ref, lo: k.band.lo, hi: k.band.hi }];
      return { ...s, tick: a.tick, companies: a.companies, skus: a.skus, running: a.running, speed: a.speed, refSeries };
    }
    case "approvals":
      return { ...s, approvals: a.a };
    case "conn":
      return { ...s, connected: a.ok };
    case "gc": {
      const now = Date.now();
      const pulses = s.pulses.filter((p) => now - p.born < 1600);
      return pulses.length === s.pulses.length ? s : { ...s, pulses };
    }
  }
}

const empty: State = {
  tick: 0, running: false, speed: 1,
  config: { hspMode: "sim", merchantName: "", amountScale: 0.001, fairBand: 0.15, llm: false, model: "", ledger: null, chainId: 177, explorer: "" },
  skus: [], companies: [], deals: [], events: [], approvals: [], priceHistory: {}, ledger: [],
  connected: false, dealMap: {}, refSeries: {}, pulses: [],
};

export function useConcord(enabled = true) {
  const [state, dispatch] = useReducer(reducer, empty);
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(`/api/events?token=${encodeURIComponent(getToken("admin"))}`);
    es.addEventListener("snapshot", (m) => dispatch({ t: "snapshot", s: JSON.parse((m as MessageEvent).data) }));
    es.addEventListener("event", (m) => dispatch({ t: "event", e: JSON.parse((m as MessageEvent).data) }));
    es.addEventListener("deal", (m) => dispatch({ t: "deal", d: JSON.parse((m as MessageEvent).data) }));
    es.addEventListener("tick", (m) => dispatch({ t: "tick", ...JSON.parse((m as MessageEvent).data) }));
    es.addEventListener("approvals", (m) => dispatch({ t: "approvals", a: JSON.parse((m as MessageEvent).data) }));
    es.onerror = () => dispatch({ t: "conn", ok: false });
    es.onopen = () => dispatch({ t: "conn", ok: true });
    const gc = setInterval(() => dispatch({ t: "gc" }), 400);
    return () => { es.close(); clearInterval(gc); };
  }, [enabled]);
  return state;
}

/** Tenant-scoped workspace state: polls /api/me, which the server filters to this company only. */
export function useCompanyState(token: string) {
  const [state, setState] = useState<(State & { me: string }) | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const pull = async () => {
      try {
        const r = await api("/api/me", "company");
        if (!r.ok) { setError(r.status === 401 ? "unauthorized" : `HTTP ${r.status}`); return; }
        const snap = await r.json();
        if (!alive) return;
        const dealMap: Record<string, Deal> = {};
        for (const d of snap.deals) dealMap[d.id] = d;
        const refSeries: State["refSeries"] = {};
        for (const k of snap.skus) refSeries[k.id] = (snap.priceHistory[k.id] ?? []).map((p: { tick: number; price: number }) => ({ tick: p.tick, ref: p.price, lo: p.price * (1 - snap.config.fairBand), hi: p.price * (1 + snap.config.fairBand) }));
        setState({ ...snap, dealMap, refSeries, pulses: [], connected: true });
        setError("");
      } catch {
        setError("offline");
      }
    };
    void pull();
    const t = setInterval(pull, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [token]);
  return { state, error };
}

export async function control(body: Record<string, unknown>) {
  await api("/api/control", "admin", { method: "POST", body: JSON.stringify(body) });
}
export async function approve(id: string, ok: boolean) {
  await api(`/api/approvals/${id}`, "admin", { method: "POST", body: JSON.stringify({ approve: ok }) });
}
export async function approveAsCompany(id: string, ok: boolean) {
  await api(`/api/me/approvals/${id}`, "company", { method: "POST", body: JSON.stringify({ approve: ok }) });
}
