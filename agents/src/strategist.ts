import type { NearAiClient } from "./near-ai.js";
import { extractJson, sha256Hex } from "./near-ai.js";
import { netIntents, buildLegs, priceOf, auditConservation } from "./matcher.js";
import type { AgentReport, Plan, Prices, UserIntent } from "./types.js";

const STRATEGIST_SYSTEM_PROMPT = `You are the Strategist Agent for MamoruX, an institutional confidential DeFi dark pool running inside a TEE on NEAR AI Cloud.
Your role:
1. Deconstruct incoming private portfolio rebalancing intents into optimal execution steps.
2. Maximize private peer-to-peer internal netting to protect orders from front-running and MEV bots.
3. Route unmatched residual volume through NEAR Intents (1Click solvers) in chunks to minimize market impact.
4. Flag native execution requirements for Chain Signatures MPC.

Respond ONLY with valid JSON with this shape:
{
  "chunkUsd": 50000,
  "notes": "Short summary of the execution thesis and trade routing choices",
  "expectedImpactBps": 4
}`;

export class StrategistAgent {
  constructor(private nearAi?: NearAiClient) {}

  async plan(intents: UserIntent[], prices: Prices): Promise<{ plan: Plan; report: AgentReport }> {
    let chunkUsd = 50_000;
    let strategistNotes = "Internal dark-pool cross with residual routed via NEAR Intents.";
    let teeProof = undefined;
    let mode: AgentReport["mode"] = "deterministic-fallback";
    let reasoning = "";

    if (this.nearAi) {
      try {
        const intentSummary = intents.map((i) => ({
          id: i.id,
          owner: i.owner,
          pair: `${i.sell.symbol}->${i.buy.symbol}`,
          amount: i.amount,
          sellChain: i.sell.chain,
          buyChain: i.buy.chain,
          maxSlip: `${i.maxSlippageBps} bps`,
          note: i.note,
        }));

        const result = await this.nearAi.chat(
          [
            { role: "system", content: STRATEGIST_SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify({ intents: intentSummary, marketPricesUsd: prices }),
            },
          ],
          { json: true, temperature: 0.1 }
        );

        const parsed = extractJson<{ chunkUsd?: number; notes?: string; expectedImpactBps?: number }>(result.content);
        if (parsed.chunkUsd && parsed.chunkUsd > 100) chunkUsd = parsed.chunkUsd;
        if (parsed.notes) strategistNotes = parsed.notes;
        teeProof = result.tee;
        reasoning = result.content;
        mode = "near-ai-cloud";
      } catch (err) {
        reasoning = `AI inference error: ${(err as Error).message}. Used deterministic routing fallback.`;
      }
    } else {
      reasoning = "Strategist running in deterministic fallback mode (no NEAR AI API key provided).";
    }

    const net = netIntents(intents, prices);
    const legs = buildLegs(net, intents, chunkUsd);
    const conservationIssues = auditConservation(intents, legs, prices);

    const findings: string[] = [
      `Total notional: $${net.totalNotionalUsd.toLocaleString()}`,
      `Internalization rate: ${(net.internalizationRate * 100).toFixed(1)}% (${net.crosses.length} peer crosses)`,
      `Residual legs generated: ${legs.filter((l) => l.kind === "Intent").length}`,
    ];
    if (conservationIssues.length > 0) {
      findings.push(`WARNING: Conservation anomalies: ${conservationIssues.join("; ")}`);
    }

    const plan: Plan = {
      intents,
      legs,
      internalCrosses: net.crosses,
      strategistNotes,
    };

    const report: AgentReport = {
      agent: "strategist",
      model: this.nearAi?.modelId ?? "deterministic-heuristic",
      verdict: conservationIssues.length === 0 ? "Approve" : "Reject",
      riskScore: conservationIssues.length === 0 ? 5 : 90,
      findings,
      reasoning: reasoning || JSON.stringify(findings),
      tee: teeProof,
      mode,
    };

    return { plan, report };
  }
}
