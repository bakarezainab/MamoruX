import { NextResponse } from "next/server";

const NEAR_AI_BASE = process.env.NEAR_AI_BASE_URL || "https://cloud-api.near.ai/v1";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const attestationModel = searchParams.get("attestationModel");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    if (attestationModel) {
      const res = await fetch(
        `${NEAR_AI_BASE}/attestation/report?model=${encodeURIComponent(attestationModel)}`,
        { signal: controller.signal, cache: "no-store" }
      );
      const data = await res.json();
      return NextResponse.json({
        model: attestationModel,
        status: res.status,
        attestation: data,
      });
    }

    const res = await fetch(`${NEAR_AI_BASE}/models`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          live: false,
          serverKeyConfigured: Boolean(process.env.NEAR_AI_API_KEY),
          models: [],
          error: `NEAR AI Cloud returned HTTP ${res.status}`,
        },
        { status: 502 }
      );
    }

    const json = await res.json();
    const models = Array.isArray(json.data)
      ? json.data.map((m: { id: string; name?: string; owned_by?: string }) => ({
          id: m.id,
          name: m.name || m.id,
          owned_by: m.owned_by || "near-ai",
        }))
      : [];

    return NextResponse.json({
      live: true,
      baseUrl: NEAR_AI_BASE,
      defaultModel: process.env.NEAR_AI_MODEL || "deepseek/deepseek-v3.2",
      serverKeyConfigured: Boolean(process.env.NEAR_AI_API_KEY),
      modelCount: models.length,
      models,
    });
  } catch (e) {
    return NextResponse.json(
      {
        live: false,
        serverKeyConfigured: Boolean(process.env.NEAR_AI_API_KEY),
        models: [],
        error: (e as Error).message,
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
