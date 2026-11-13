import { SwarmOrchestrator } from "./orchestrator.js";
import { loadConfig } from "./config.js";
import { ChainSignatures } from "./chainsig.js";
import type { UserIntent } from "./types.js";

async function main() {
  const config = loadConfig();
  const orchestrator = new SwarmOrchestrator(config);
  const chainSig = new ChainSignatures(config.nodeUrl, config.mpcContract, config.networkId);

  console.log("===============================================================");
  console.log("  MamoruX — Confidential AI Dark-Pool & Firewall on NEAR       ");
  console.log("===============================================================");
  console.log(`Network:          ${config.networkId} (${config.nodeUrl})`);
  console.log(`MPC Signer:       ${config.mpcContract}`);
  console.log(`NEAR AI Model:    ${config.nearAiApiKey ? config.nearAiModel : "Deterministic Heuristic"}`);
  console.log("---------------------------------------------------------------\n");

  // Sample dual-intent batch demonstrating peer netting + cross-chain execution
  const sampleIntents: UserIntent[] = [
    {
      id: "intent-alpha",
      owner: "treasury-alpha.testnet",
      sell: { chain: "ethereum", symbol: "ETH" },
      buy: { chain: "solana", symbol: "SOL" },
      amount: "2.5",
      maxSlippageBps: 40,
      note: "Treasury diversification into SOL ecosystem",
    },
    {
      id: "intent-beta",
      owner: "fund-beta.testnet",
      sell: { chain: "solana", symbol: "SOL" },
      buy: { chain: "ethereum", symbol: "ETH" },
      amount: "25.0",
      maxSlippageBps: 30,
      note: "Profit taking into native ETH",
    },
  ];

  console.log(`[1] Processing batch of ${sampleIntents.length} private user intents...`);
  for (const i of sampleIntents) {
    console.log(`    - ${i.owner}: Sell ${i.amount} ${i.sell.symbol} (${i.sell.chain}) for ${i.buy.symbol} (${i.buy.chain})`);
  }

  console.log("\n[2] Executing Swarm Orchestration (Strategist, Sentinel, Matcher)...");
  const result = await orchestrator.run(sampleIntents);

  console.log("\n--- AGENT SWARM EVALUATION ---");
  console.log(`- Strategist: [${result.reports.strategist.verdict}] Risk Score: ${result.reports.strategist.riskScore}`);
  for (const f of result.reports.strategist.findings) console.log(`    * ${f}`);

  console.log(`- Sentinel:   [${result.reports.sentinel.verdict}] Risk Score: ${result.reports.sentinel.riskScore}`);
  for (const f of result.reports.sentinel.findings) console.log(`    * ${f}`);

  console.log(`- Matcher:    [${result.reports.matcher.verdict}] Risk Score: ${result.reports.matcher.riskScore}`);
  for (const f of result.reports.matcher.findings) console.log(`    * ${f}`);

  console.log("\n--- COMPILED TRADE LEGS ---");
  for (const [idx, leg] of result.plan.legs.entries()) {
    console.log(`  Leg #${idx}: [${leg.venue.toUpperCase()}] ${leg.amount} ${leg.sell.symbol} ($${leg.notionalUsd}) -> ${leg.buy.symbol}`);
    console.log(`         Rationale: ${leg.rationale}`);
  }

  console.log("\n--- CRYPTOGRAPHIC PROOFS ---");
  console.log(`Plan Hash Commitment: 0x${result.planHash}`);
  console.log(`Firewall Verdict:     ${result.approved ? "APPROVED (CLEARANCE GRANTED)" : "REJECTED (FIREWALL BLOCKED)"}`);

  if (result.approved) {
    console.log("\n[3] Resolving MPC Chain Signatures derived addresses...");
    try {
      const ethAddr = await chainSig.addressFor("mamorux-vault.testnet", "treasury-alpha.testnet", "ethereum");
      console.log(`    Derived Ethereum Address: ${ethAddr.address} (path: ${ethAddr.path})`);
      const solAddr = await chainSig.addressFor("mamorux-vault.testnet", "fund-beta.testnet", "solana");
      console.log(`    Derived Solana Address:   ${solAddr.address} (path: ${solAddr.path})`);
    } catch {
      console.log("    (MPC query simulated for local offline demo)");
    }
  }

  console.log("\n===============================================================");
  console.log("  Execution Complete. Ready for On-Chain Settlement.           ");
  console.log("===============================================================");
}

main().catch(console.error);
