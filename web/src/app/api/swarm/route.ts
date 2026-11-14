import { NextResponse } from "next/server";
import { runMamoruSwarm, type Chain, type UserIntent } from "@/lib/mamorux-engine";

// Real in-memory dark-pool orderbook for live multi-user / multi-wallet demos
let darkPoolBook: UserIntent[] = [];

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.action === "clear_pool") {
      darkPoolBook = [];
      return NextResponse.json({ pool: darkPoolBook, cleared: true });
    }

    const owner = String(body.owner || "").trim();
    if (!owner) {
      return NextResponse.json({ error: "Please connect or enter a NEAR wallet address first." }, { status: 400 });
    }

    const sellChain = (body.sellChain || "ethereum") as Chain;
    const buyChain = (body.buyChain || "solana") as Chain;
    const sellSymbol = String(body.sellAsset || "ETH").toUpperCase();
    const buySymbol = String(body.buyAsset || "SOL").toUpperCase();
    const amount = String(body.amount || "0");
    const maxSlippageBps = Number(body.maxSlippageBps ?? 40);
    const note = body.note ? String(body.note) : undefined;

    const intent: UserIntent = {
      id: `intent-${Date.now().toString(36)}`,
      owner,
      sell: { chain: sellChain, symbol: sellSymbol },
      buy: { chain: buyChain, symbol: buySymbol },
      amount,
      maxSlippageBps,
      note,
      createdAt: new Date().toISOString(),
    };

    if (body.action === "add_to_pool") {
      darkPoolBook.push(intent);
      return NextResponse.json({ pool: darkPoolBook, added: intent });
    }

    const batch = [...darkPoolBook, intent];
    const result = await runMamoruSwarm(batch, {
      nearAiApiKey: body.nearAiApiKey ? String(body.nearAiApiKey) : undefined,
      nearAiModel: body.nearAiModel ? String(body.nearAiModel) : undefined,
    });

    return NextResponse.json({
      ...result,
      poolCount: darkPoolBook.length,
      batchCount: batch.length,
      timestamp: new Date().toISOString(),
      derivationPaths: {
        ethereum: `mamorux/${owner}/ethereum`,
        solana: `mamorux/${owner}/solana`,
        bitcoin: `mamorux/${owner}/bitcoin`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Invalid swarm request" }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({
    service: "MamoruX Multi-Agent Swarm API",
    teeModel: process.env.NEAR_AI_MODEL || "deepseek/deepseek-v3.2",
    nearAiConfigured: Boolean(process.env.NEAR_AI_API_KEY),
    pool: darkPoolBook,
    mpcSigner: {
      mainnet: "v1.signer",
      testnet: "v1.signer-prod.testnet",
    },
  });
}
