import { NextResponse } from "next/server";

const ONECLICK_BASE = process.env.ONECLICK_BASE_URL || "https://1click.chaindefuser.com";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const depositAddress = searchParams.get("depositAddress");

  if (!depositAddress) {
    return NextResponse.json({ error: "Missing depositAddress parameter" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${ONECLICK_BASE}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `1Click status returned HTTP ${res.status}` }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      originAsset,
      destinationAsset,
      amount,
      slippageTolerance = 50,
      refundTo = "idealz.near",
      recipient = "idealz.near",
      dry = false,
    } = body;

    if (!originAsset || !destinationAsset || !amount) {
      return NextResponse.json(
        { error: "originAsset, destinationAsset, and amount are required" },
        { status: 400 }
      );
    }

    const payload = {
      dry: Boolean(dry),
      swapType: "EXACT_INPUT",
      slippageTolerance: Number(slippageTolerance),
      originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset,
      amount: String(amount),
      refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${ONECLICK_BASE}/v0/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        return NextResponse.json({ error: `1Click API error ${res.status}: ${errText}` }, { status: res.status });
      }

      const data = await res.json();
      return NextResponse.json(data);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
