import { NextResponse } from "next/server";
import { runMamoruSwarm, type Chain, type UserIntent } from "@/lib/mamorux-engine";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const owner = String(body.owner || "treasury-alpha.near").trim();
    const sellChain = (body.sellChain || "ethereum") as Chain;
    const buyChain = (body.buyChain || "solana") as Chain;
    const sellSymbol = String(body.sellAsset || "ETH").toUpperCase();
    const buySymbol = String(body.buyAsset || "SOL").toUpperCase();
    const amount = String(body.amount || "2.5");
    const maxSlippageBps = Number(body.maxSlippageBps ?? 40);
    const note = body.note ? String(body.note) : undefined;
    const includeCounterparty = body.includeCounterparty !== false;

    const primaryIntent: UserIntent = {
      id: "intent-user",
      owner,
      sell: { chain: sellChain, symbol: sellSymbol },
      buy: { chain: buyChain, symbol: buySymbol },
      amount,
      maxSlippageBps,
      note,
    };

    const intents: UserIntent[] = [primaryIntent];

    if (includeCounterparty && sellChain !== buyChain) {
      // Simulated dark-pool counterparty order for opposite side to demonstrate live P2P netting
      intents.push({
        id: "intent-counterparty",
        owner: owner.endsWith(".testnet") ? "fund-beta.testnet" : "fund-beta.near",
        sell: { chain: buyChain, symbol: buySymbol },
        buy: { chain: sellChain, symbol: sellSymbol },
        amount: buySymbol === "SOL" ? "25.0" : buySymbol === "ETH" ? "1.5" : buySymbol === "BTC" ? "0.05" : "2500",
        maxSlippageBps: 35,
        note: "Counterparty institutional dark-pool liquidity",
      });
    }

    const result = runMamoruSwarm(intents);

    return NextResponse.json({
      ...result,
      timestamp: new Date().toISOString(),
      derivationPaths: {
        ethereum: `mamorux/${owner}/ethereum`,
        solana: `mamorux/${owner}/solana`,
        bitcoin: `mamorux/${owner}/bitcoin`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Invalid swarm request" },
      { status: 400 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    service: "MamoruX Multi-Agent Swarm API",
    teeModel: process.env.NEAR_AI_MODEL || "deepseek-ai/DeepSeek-V3.1",
    nearAiConfigured: Boolean(process.env.NEAR_AI_API_KEY),
    mpcSigner: {
      mainnet: "v1.signer",
      testnet: "v1.signer-prod.testnet",
    },
  });
}
