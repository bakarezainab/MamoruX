import { z } from "zod";

/** Chains the swarm understands. Must match the vault policy allowlist (lower-case). */
export const Chain = z.enum(["ethereum", "base", "arbitrum", "bitcoin", "solana", "near"]);
export type Chain = z.infer<typeof Chain>;

/** A user's private rebalancing intent: "sell `amount` of `sell` for `buy`". */
export const UserIntent = z.object({
  id: z.string(),
  owner: z.string(), // NEAR account id
  sell: z.object({ chain: Chain, symbol: z.string() }),
  buy: z.object({ chain: Chain, symbol: z.string() }),
  /** Amount of the sell asset in whole-unit decimal string. */
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  maxSlippageBps: z.number().int().min(1).max(1000).default(50),
  /** Free-text instructions. Treated as untrusted input by the Sentinel. */
  note: z.string().max(2000).optional(),
  /** Optional recipient on the destination chain. Must be a vault-derived address unless allowlisted. */
  recipient: z.string().optional(),
});
export type UserIntent = z.infer<typeof UserIntent>;

export type LegKind = "Intent" | "Native";

export interface PlannedLeg {
  intentId: string;
  chain: Chain;
  kind: LegKind;
  sell: { chain: Chain; symbol: string };
  buy: { chain: Chain; symbol: string };
  amount: number; // sell-asset units
  notionalUsd: number;
  venue: "internal-cross" | "near-intents" | "chain-signatures";
  rationale: string;
}

export interface Plan {
  intents: UserIntent[];
  legs: PlannedLeg[];
  internalCrosses: Cross[];
  strategistNotes: string;
}

/** An internal match between two opposite intents: no public footprint, no MEV. */
export interface Cross {
  a: string; // intent id
  b: string;
  pair: string; // e.g. ETH/SOL
  amountA: number; // units of a.sell
  amountB: number; // units of b.sell
  notionalUsd: number;
}

export interface AgentReport {
  agent: "strategist" | "sentinel" | "matcher";
  model: string;
  verdict: "Approve" | "Reject";
  riskScore: number; // 0-100
  findings: string[];
  /** Raw private reasoning (kept off-chain). */
  reasoning: string;
  /** TEE proof for the inference, if NEAR AI Cloud was used. */
  tee?: TeeProof;
  mode: "near-ai-cloud" | "deterministic-fallback";
}

export interface TeeProof {
  chatId: string;
  signingAddress?: string;
  signature?: string;
  signedText?: string;
  verified: boolean;
  detail: string;
}

export type Prices = Record<string, number>; // symbol -> USD
