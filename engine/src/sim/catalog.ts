import type { Company, Policy, Sku } from "../protocol/types.js";

export const SKUS: Sku[] = [
  { id: "green-beans", name: "Green Coffee Beans", unit: "kg", refPrice: 6.2 },
  { id: "kraft-bags", name: "Kraft Valve Bags", unit: "pc", refPrice: 0.35 },
  { id: "oat-milk", name: "Oat Milk", unit: "L", refPrice: 1.8 },
  { id: "roasted-coffee", name: "Roasted Coffee", unit: "kg", refPrice: 14.5 },
];

type Seed = Omit<Company, "wallet" | "reserved" | "incoming" | "pnl" | "stats" | "createdAt" | "policy"> & {
  policy: Partial<Policy>;
};

export function basePolicy(p: Partial<Policy>): Policy {
  return {
    reorderPoint: {},
    reorderQty: {},
    maxUnitPrice: {},
    unitCost: {},
    targetMargin: 0.12,
    autoApproveUsd: 2500,
    strategy: "fair",
    guardrails: true,
    ...p,
  };
}

export const SEED: Seed[] = [
  {
    id: "andes-imports", name: "Andes Green Imports", sector: "Commodity importer", role: "seller", tier: 0,
    sells: ["green-beans"], buys: [], inventory: { "green-beans": 900 }, replenish: { "green-beans": 30 }, cash: 20000,
    policy: { unitCost: { "green-beans": 5.1 }, targetMargin: 0.14 },
  },
  {
    id: "sahyadri-estates", name: "Sahyadri Estates", sector: "Coffee grower", role: "seller", tier: 0,
    sells: ["green-beans"], buys: [], inventory: { "green-beans": 600 }, replenish: { "green-beans": 22 }, cash: 15000,
    policy: { unitCost: { "green-beans": 5.4 }, targetMargin: 0.1 },
  },
  {
    id: "packright", name: "PackRight Packaging", sector: "Packaging", role: "seller", tier: 0,
    sells: ["kraft-bags"], buys: [], inventory: { "kraft-bags": 6000 }, replenish: { "kraft-bags": 250 }, cash: 8000,
    policy: { unitCost: { "kraft-bags": 0.26 }, targetMargin: 0.18 },
  },
  {
    id: "oatly-farms", name: "Western Ghats Oat Co.", sector: "Dairy alternative", role: "seller", tier: 0,
    sells: ["oat-milk"], buys: [], inventory: { "oat-milk": 1200 }, replenish: { "oat-milk": 45 }, cash: 9000,
    policy: { unitCost: { "oat-milk": 1.45 }, targetMargin: 0.15 },
  },
  {
    id: "bluepeak-roasters", name: "Bluepeak Roasters", sector: "Roastery", role: "both", tier: 1,
    sells: ["roasted-coffee"], buys: ["green-beans", "kraft-bags"],
    inventory: { "roasted-coffee": 140, "green-beans": 160, "kraft-bags": 500 },
    recipe: { output: "roasted-coffee", inputs: { "green-beans": 1.2, "kraft-bags": 1 }, ratePerTick: 9 },
    cash: 30000,
    policy: {
      reorderPoint: { "green-beans": 120, "kraft-bags": 250 },
      reorderQty: { "green-beans": 220, "kraft-bags": 800 },
      maxUnitPrice: { "green-beans": 7.4, "kraft-bags": 0.45 },
      unitCost: { "roasted-coffee": 11.2 },
      targetMargin: 0.16,
    },
  },
  {
    id: "monsoon-cafe", name: "Monsoon Café Co.", sector: "Café chain · 6 outlets", role: "buyer", tier: 2,
    sells: [], buys: ["roasted-coffee", "oat-milk"],
    inventory: { "roasted-coffee": 70, "oat-milk": 120 }, demand: { "roasted-coffee": 4, "oat-milk": 7 }, cash: 25000,
    policy: {
      reorderPoint: { "roasted-coffee": 40, "oat-milk": 60 },
      reorderQty: { "roasted-coffee": 60, "oat-milk": 140 },
      maxUnitPrice: { "roasted-coffee": 17.5, "oat-milk": 2.2 },
    },
  },
  {
    id: "bandra-brew", name: "Bandra Brew House", sector: "Specialty café", role: "buyer", tier: 2,
    sells: [], buys: ["roasted-coffee", "oat-milk"],
    inventory: { "roasted-coffee": 45, "oat-milk": 80 }, demand: { "roasted-coffee": 2.5, "oat-milk": 4 }, cash: 12000,
    policy: {
      reorderPoint: { "roasted-coffee": 25, "oat-milk": 35 },
      reorderQty: { "roasted-coffee": 40, "oat-milk": 90 },
      maxUnitPrice: { "roasted-coffee": 16.8, "oat-milk": 2.15 },
      autoApproveUsd: 500, // small café: coffee orders (~$580) escalate to the owner
    },
  },
];

export const ROGUE: Seed = {
  id: "apex-rapid", name: "Apex Rapid Supply", sector: "Opportunistic reseller", role: "seller", tier: 1,
  sells: ["roasted-coffee"], buys: [], inventory: { "roasted-coffee": 400 }, replenish: { "roasted-coffee": 6 }, cash: 5000,
  policy: { unitCost: { "roasted-coffee": 10.9 }, targetMargin: 0.4, strategy: "rogue", guardrails: false },
};
