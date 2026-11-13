import type { Cross, PlannedLeg, Prices, UserIntent } from "./types.js";

/**
 * Private netting engine: the dark-pool core of MamoruX.
 *
 * Opposite intents (A sells X for Y, B sells Y for X) are crossed internally at the oracle mid
 * price. Crossed volume never touches a public order book or mempool as a swap, so there is
 * nothing to front-run. Each side settles as a plain transfer between vault-controlled
 * Chain Signatures addresses. Only the residual is routed through NEAR Intents.
 */
export interface Residual {
  intent: UserIntent;
  amount: number; // remaining sell units
  notionalUsd: number;
}

export interface NettingResult {
  crosses: Cross[];
  residuals: Residual[];
  /** Fraction of total notional matched internally (0..1). */
  internalizationRate: number;
  totalNotionalUsd: number;
}

const key = (a: { chain: string; symbol: string }) => `${a.chain}:${a.symbol.toUpperCase()}`;

export function priceOf(prices: Prices, symbol: string): number {
  const p = prices[symbol.toUpperCase()];
  if (!p || !(p > 0)) throw new Error(`No price for ${symbol}`);
  return p;
}

const round = (n: number, d = 8) => Math.round(n * 10 ** d) / 10 ** d;

export function netIntents(intents: UserIntent[], prices: Prices): NettingResult {
  // Deterministic order: time priority = input order, tie-broken by id.
  const book = intents.map((intent) => {
    const amount = Number(intent.amount);
    return { intent, amount, usd: amount * priceOf(prices, intent.sell.symbol) };
  });
  const total = book.reduce((s, b) => s + b.usd, 0);
  const crosses: Cross[] = [];

  for (let i = 0; i < book.length; i++) {
    const a = book[i];
    for (let j = i + 1; j < book.length && a.usd > 1e-9; j++) {
      const b = book[j];
      if (b.usd <= 1e-9) continue;
      if (a.intent.owner === b.intent.owner) continue; // no self-crossing (wash trades)
      if (key(a.intent.sell) !== key(b.intent.buy) || key(a.intent.buy) !== key(b.intent.sell)) continue;
      const usd = Math.min(a.usd, b.usd);
      const pa = priceOf(prices, a.intent.sell.symbol);
      const pb = priceOf(prices, b.intent.sell.symbol);
      crosses.push({
        a: a.intent.id,
        b: b.intent.id,
        pair: `${a.intent.sell.symbol.toUpperCase()}/${b.intent.sell.symbol.toUpperCase()}`,
        amountA: round(usd / pa),
        amountB: round(usd / pb),
        notionalUsd: round(usd, 2),
      });
      a.usd -= usd;
      b.usd -= usd;
      a.amount = Math.max(0, a.amount - usd / pa);
      b.amount = Math.max(0, b.amount - usd / pb);
    }
  }

  const residuals = book
    .filter((b) => b.usd > 0.01)
    .map((b) => ({ intent: b.intent, amount: round(b.amount), notionalUsd: round(b.usd, 2) }));
  const matched = crosses.reduce((s, c) => s + c.notionalUsd * 2, 0);
  return {
    crosses,
    residuals,
    internalizationRate: total > 0 ? Math.min(1, matched / total) : 0,
    totalNotionalUsd: round(total, 2),
  };
}

/** Turn netting output into executable legs. Residuals are chunked to shrink their public footprint. */
export function buildLegs(net: NettingResult, intents: UserIntent[], chunkUsd: number): PlannedLeg[] {
  const byId = new Map(intents.map((i) => [i.id, i]));
  const legs: PlannedLeg[] = [];

  for (const c of net.crosses) {
    const a = byId.get(c.a)!;
    const b = byId.get(c.b)!;
    legs.push({
      intentId: a.id,
      chain: a.sell.chain,
      kind: "Native",
      sell: a.sell,
      buy: a.buy,
      amount: c.amountA,
      notionalUsd: c.notionalUsd,
      venue: "internal-cross",
      rationale: `Internal cross with ${b.id}: transfer ${c.amountA} ${a.sell.symbol} to counterparty's vault address`,
    });
    legs.push({
      intentId: b.id,
      chain: b.sell.chain,
      kind: "Native",
      sell: b.sell,
      buy: b.buy,
      amount: c.amountB,
      notionalUsd: c.notionalUsd,
      venue: "internal-cross",
      rationale: `Internal cross with ${a.id}: transfer ${c.amountB} ${b.sell.symbol} to counterparty's vault address`,
    });
  }

  for (const r of net.residuals) {
    const chunks = Math.max(1, Math.ceil(r.notionalUsd / Math.max(1, chunkUsd)));
    for (let k = 0; k < chunks; k++) {
      legs.push({
        intentId: r.intent.id,
        chain: r.intent.sell.chain,
        kind: "Intent",
        sell: r.intent.sell,
        buy: r.intent.buy,
        amount: round(r.amount / chunks),
        notionalUsd: round(r.notionalUsd / chunks, 2),
        venue: "near-intents",
        rationale: `Residual ${k + 1}/${chunks} routed to NEAR Intents solvers (1Click)`,
      });
    }
  }
  return legs;
}

/**
 * Matcher self-audit: every intent's legs must add up to exactly what the user asked for, and crosses
 * must be fair at the oracle price. Returns a list of violations (empty = sound).
 */
export function auditConservation(intents: UserIntent[], legs: PlannedLeg[], prices: Prices, tolBps = 5): string[] {
  const issues: string[] = [];
  for (const i of intents) {
    const want = Number(i.amount);
    const got = legs.filter((l) => l.intentId === i.id).reduce((s, l) => s + l.amount, 0);
    if (Math.abs(got - want) > (want * tolBps) / 10_000 + 1e-8) {
      issues.push(`${i.id}: legs sum ${got} != requested ${want}`);
    }
  }
  const crossLegs = legs.filter((l) => l.venue === "internal-cross");
  for (let k = 0; k + 1 < crossLegs.length; k += 2) {
    const [x, y] = [crossLegs[k], crossLegs[k + 1]];
    const vx = x.amount * priceOf(prices, x.sell.symbol);
    const vy = y.amount * priceOf(prices, y.sell.symbol);
    if (Math.abs(vx - vy) > (Math.max(vx, vy) * tolBps) / 10_000 + 0.01) {
      issues.push(`unfair cross ${x.intentId}<->${y.intentId}: $${vx.toFixed(2)} vs $${vy.toFixed(2)}`);
    }
  }
  return issues;
}
