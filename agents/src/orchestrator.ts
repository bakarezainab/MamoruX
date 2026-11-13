import { StrategistAgent } from "./strategist.js";
import { SentinelAgent } from "./sentinel.js";
import { MatcherAgent } from "./matcher-agent.js";
import { NearAiClient, sha256Hex } from "./near-ai.js";
import { OneClick } from "./intents.js";
import { ChainSignatures, vaultPath } from "./chainsig.js";
import type { Config } from "./config.js";
import type { AgentReport, Plan, Prices, UserIntent } from "./types.js";

export interface SwarmExecutionResult {
  plan: Plan;
  planHash: string;
  reports: {
    strategist: AgentReport;
    sentinel: AgentReport;
    matcher: AgentReport;
  };
  approved: boolean;
  onChainPlanId?: number;
  contractStatus?: string;
  rejectionReason?: string;
}

export class SwarmOrchestrator {
  private strategist: StrategistAgent;
  private sentinel: SentinelAgent;
  private matcher: MatcherAgent;
  private oneClick: OneClick;
  private chainSig: ChainSignatures;

  constructor(private config: Config) {
    const nearAi = config.nearAiApiKey
      ? new NearAiClient(config.nearAiApiKey, config.nearAiBaseUrl, config.nearAiModel)
      : undefined;

    this.strategist = new StrategistAgent(nearAi);
    this.sentinel = new SentinelAgent(nearAi);
    this.matcher = new MatcherAgent();
    this.oneClick = new OneClick(config.oneClickBaseUrl, config.oneClickJwt);
    this.chainSig = new ChainSignatures(config.nodeUrl, config.mpcContract, config.networkId);
  }

  async fetchMarketPrices(symbols: string[]): Promise<Prices> {
    try {
      const prices = await this.oneClick.prices(symbols);
      if (Object.keys(prices).length > 0) return prices;
    } catch {
      // fallback if API is unreachable
    }

    // Default reference prices for typical assets
    return {
      ETH: 2800,
      SOL: 180,
      NEAR: 5.5,
      BTC: 89000,
      USDC: 1.0,
      USDT: 1.0,
    };
  }

  async run(intents: UserIntent[]): Promise<SwarmExecutionResult> {
    const symbols = Array.from(new Set(intents.flatMap((i) => [i.sell.symbol, i.buy.symbol])));
    const prices = await this.fetchMarketPrices(symbols);

    // 1. Strategist plans the trade deconstruction and netting
    const { plan, report: strategistReport } = await this.strategist.plan(intents, prices);

    // 2. Sentinel audits the plan inside TEE against adversarial criteria
    const sentinelReport = await this.sentinel.audit(plan, prices);

    // 3. Matcher mathematically checks balance conservation
    const matcherReport = await this.matcher.auditAndAttest(plan, prices);

    // 4. Compute deterministic cryptographic plan commitment hash
    const planHash = sha256Hex(JSON.stringify(plan));

    // Consensus evaluation
    const approved =
      strategistReport.verdict === "Approve" &&
      sentinelReport.verdict === "Approve" &&
      matcherReport.verdict === "Approve" &&
      sentinelReport.riskScore <= 60;

    let rejectionReason = undefined;
    if (!approved) {
      if (sentinelReport.verdict === "Reject") {
        rejectionReason = `Sentinel Veto: ${sentinelReport.findings.join("; ")}`;
      } else if (matcherReport.verdict === "Reject") {
        rejectionReason = `Matcher Veto: ${matcherReport.findings.join("; ")}`;
      } else {
        rejectionReason = "Consensus quorum failure";
      }
    }

    return {
      plan,
      planHash,
      reports: {
        strategist: strategistReport,
        sentinel: sentinelReport,
        matcher: matcherReport,
      },
      approved,
      rejectionReason,
    };
  }
}
