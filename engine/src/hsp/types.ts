import type { Address } from "viem";

export interface ChainToken {
  network: string;
  chainId: number;
  coin: string;
  address: Address;
  decimals: number;
  protocol: "eip3009" | "permit2";
}

export interface Eip712Payload {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface PrepareResult {
  eip712: Eip712Payload;
  cart_hash: string;
  token_total_raw: string;
  quote_expires_at?: string;
  pay_to?: string;
  payer?: string;
  payment_request_id?: string;
  payment_payload: unknown;
  payment_mandate_contents: unknown;
  gas_fee_advanced?: boolean;
}

export interface QueryResult {
  status: string;
  txHash?: string;
  attributionVerified?: boolean;
  statusReason?: string;
  raw: unknown;
}

export interface HspClient {
  mode: "sim" | "live";
  getChainConfig(): Promise<ChainToken[]>;
  createOrder(i: { merchantName: string; payTo: Address; cartMandate: unknown }): Promise<{ flowId: string; paymentRequestId: string; paymentUrl?: string }>;
  prepare(i: { flowId: string; payer: Address; protocol: string }): Promise<PrepareResult>;
  finalize(i: { signature: string; prep: PrepareResult }): Promise<{ paymentMandateJson: unknown }>;
  submit(i: { paymentMandateJson: unknown }): Promise<{ status: string; raw: unknown }>;
  query(i: { flowId?: string; paymentRequestId?: string; expectedMerchantName: string }): Promise<QueryResult>;
}

export const TERMINAL = new Set(["payment-safe", "payment-finalized", "payment-failed"]);

/** AP2-style Cart Mandate in the exact shape HSP expects (merchant_authorization is added by HSP). */
export function buildCartMandate(a: {
  id: string;
  paymentRequestId: string;
  merchantName: string;
  token: ChainToken;
  payTo: Address;
  label: string;
  amountUsd: number;
  expiresInSec?: number;
}) {
  const value = a.amountUsd.toFixed(2);
  return {
    contents: {
      id: a.id,
      user_cart_confirmation_required: true,
      payment_request: {
        method_data: [
          {
            supported_methods: "https://www.x402.org/",
            data: {
              x402Version: 2,
              network: a.token.network,
              chain_id: a.token.chainId,
              contract_address: a.token.address,
              pay_to: a.payTo,
              coin: a.token.coin,
            },
          },
        ],
        details: {
          id: a.paymentRequestId,
          display_items: [{ label: a.label, amount: { currency: "USD", value } }],
          total: { label: "Total", amount: { currency: "USD", value } },
        },
      },
      cart_expiry: new Date(Date.now() + (a.expiresInSec ?? 7200) * 1000).toISOString().replace(/\.\d+Z$/, "Z"),
      merchant_name: a.merchantName,
    },
  };
}

export function mandateTotalUsd(cart: any): number {
  return Number(cart?.contents?.payment_request?.details?.total?.amount?.value ?? NaN);
}
export function mandatePayTo(cart: any): string {
  return cart?.contents?.payment_request?.method_data?.[0]?.data?.pay_to ?? "";
}
export function mandateNetwork(cart: any): string {
  return cart?.contents?.payment_request?.method_data?.[0]?.data?.network ?? "";
}
