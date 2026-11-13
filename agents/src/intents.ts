import type { FetchLike } from "./near-ai.js";
import type { Chain } from "./types.js";

/**
 * NEAR Intents 1Click API client (https://1click.chaindefuser.com).
 *
 * 1Click turns a cross-chain swap into a single deposit: request a quote, send funds to the returned
 * `depositAddress` (from a Chain-Signatures-derived address, in our case), and solvers on the
 * `intents.near` verifier settle the swap to the recipient on the destination chain.
 */
export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt?: string;
  contractAddress?: string;
}

export interface QuoteParams {
  originAsset: string;
  destinationAsset: string;
  /** Smallest units of the origin asset. */
  amount: string;
  recipient: string;
  refundTo: string;
  slippageBps: number;
  dry: boolean;
  deadlineMs?: number;
}

export interface QuoteResponse {
  quote: {
    depositAddress?: string;
    amountIn: string;
    amountInFormatted?: string;
    amountOut: string;
    amountOutFormatted?: string;
    amountOutUsd?: string;
    minAmountOut?: string;
    timeEstimate?: number;
    deadline?: string;
  };
  signature?: string;
  timestamp?: string;
}

export type SwapStatus =
  | "KNOWN_DEPOSIT_TX"
  | "PENDING_DEPOSIT"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

/** Our chain names -> 1Click `blockchain` identifiers. */
export const ONECLICK_CHAIN: Record<Chain, string> = {
  ethereum: "eth",
  base: "base",
  arbitrum: "arb",
  bitcoin: "btc",
  solana: "sol",
  near: "near",
};

export class OneClick {
  private tokensCache?: { at: number; tokens: OneClickToken[] };

  constructor(
    private baseUrl = "https://1click.chaindefuser.com",
    private jwt?: string,
    private fetchImpl: FetchLike = fetch,
  ) {}

  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", ...(this.jwt ? { Authorization: `Bearer ${this.jwt}` } : {}) };
  }

  async tokens(): Promise<OneClickToken[]> {
    if (this.tokensCache && Date.now() - this.tokensCache.at < 60_000) return this.tokensCache.tokens;
    const res = await this.fetchImpl(`${this.baseUrl}/v0/tokens`, { headers: this.headers() });
    if (!res.ok) throw new Error(`1Click tokens ${res.status}`);
    const tokens = (await res.json()) as OneClickToken[];
    this.tokensCache = { at: Date.now(), tokens };
    return tokens;
  }

  async findToken(chain: Chain, symbol: string): Promise<OneClickToken | undefined> {
    const bc = ONECLICK_CHAIN[chain];
    const s = symbol.toUpperCase();
    const all = await this.tokens();
    return all.find((t) => t.blockchain === bc && t.symbol.toUpperCase() === s);
  }

  /** Live USD prices for symbols, taken from the 1Click token list. */
  async prices(symbols: string[]): Promise<Record<string, number>> {
    const all = await this.tokens();
    const out: Record<string, number> = {};
    for (const s of symbols) {
      const t = all.find((x) => x.symbol.toUpperCase() === s.toUpperCase() && x.price > 0);
      if (t) out[s.toUpperCase()] = t.price;
    }
    return out;
  }

  async quote(p: QuoteParams): Promise<QuoteResponse> {
    const body = {
      dry: p.dry,
      swapType: "EXACT_INPUT",
      slippageTolerance: p.slippageBps,
      originAsset: p.originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: p.destinationAsset,
      amount: p.amount,
      refundTo: p.refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: p.recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + (p.deadlineMs ?? 30 * 60_000)).toISOString(),
    };
    const res = await this.fetchImpl(`${this.baseUrl}/v0/quote`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`1Click quote ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as QuoteResponse;
  }

  async status(depositAddress: string): Promise<{ status: SwapStatus; [k: string]: unknown }> {
    const res = await this.fetchImpl(`${this.baseUrl}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`1Click status ${res.status}`);
    return (await res.json()) as { status: SwapStatus };
  }

  /** Optional: tell 1Click about the deposit tx to speed up processing. */
  async submitDeposit(txHash: string, depositAddress: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}/v0/deposit/submit`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ txHash, depositAddress }),
    });
    if (!res.ok) throw new Error(`1Click deposit/submit ${res.status}`);
    return res.json();
  }
}

/** Decimal string -> smallest-unit integer string without floating point loss. */
export function toBaseUnits(amount: string, decimals: number): string {
  const [i, f = ""] = amount.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(i || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0")).toString();
}
