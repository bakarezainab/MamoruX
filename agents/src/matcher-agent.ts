import { sha256Hex } from "./near-ai.js";
import { auditConservation, priceOf } from "./matcher.js";
import type { AgentReport, Plan, Prices } from "./types.js";

export class MatcherAgent {
  async auditAndAttest(plan: Plan, prices: Prices): Promise<AgentReport> {
    const issues = auditConservation(plan.intents, plan.legs, prices);
    const findings: string[] = [];

    findings.push(`Internal crosses verified: ${plan.internalCrosses.length}`);
    findings.push(
      `Crossed notional value: $${plan.internalCrosses.reduce((s, c) => s + c.notionalUsd * 2, 0).toLocaleString()}`
    );

    let verdict: "Approve" | "Reject" = "Approve";
    let riskScore = 5;

    if (issues.length > 0) {
      verdict = "Reject";
      riskScore = 95;
      findings.push(...issues);
    }

    return {
      agent: "matcher",
      model: "near-mpc-intent-clearing-engine",
      verdict,
      riskScore,
      findings,
      reasoning: JSON.stringify({
        status: verdict,
        matchedPairs: plan.internalCrosses,
        conservationCheckPassed: issues.length === 0,
      }),
      mode: "deterministic-fallback",
    };
  }
}
