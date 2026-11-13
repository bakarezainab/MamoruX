import { sha256 } from "@noble/hashes/sha256";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { secp256k1 } from "@noble/curves/secp256k1";
import type { TeeProof } from "./types.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface NearAiResult {
  content: string;
  chatId: string;
  model: string;
  tee: TeeProof;
}

export type FetchLike = typeof fetch;

/**
 * Minimal NEAR AI Cloud client (OpenAI-compatible) with TEE response verification.
 *
 * NEAR AI Cloud runs models inside Intel TDX + NVIDIA confidential-computing enclaves. For each
 * completion, `/v1/signature/{chat_id}` returns `"<sha256(request)>:<sha256(response)>"` signed by
 * an enclave-held key. We recompute both hashes locally and recover the signer, so we can prove
 * which enclave produced each agent's reasoning without revealing the reasoning on-chain.
 */
export class NearAiClient {
  constructor(
    private apiKey: string,
    private baseUrl = "https://cloud-api.near.ai/v1",
    private model = "deepseek-ai/DeepSeek-V3.1",
    private fetchImpl: FetchLike = fetch,
  ) {}

  get modelId() {
    return this.model;
  }

  async chat(messages: ChatMessage[], opts: { json?: boolean; temperature?: number } = {}): Promise<NearAiResult> {
    const body = JSON.stringify({
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.2,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    });
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body,
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`NEAR AI Cloud ${res.status}: ${raw.slice(0, 300)}`);
    const json = JSON.parse(raw);
    const content: string = json.choices?.[0]?.message?.content ?? "";
    const chatId: string = json.id;
    const tee = await this.verify(chatId, body, raw).catch(
      (e): TeeProof => ({ chatId, verified: false, detail: `signature fetch failed: ${(e as Error).message}` }),
    );
    return { content, chatId, model: this.model, tee };
  }

  /** Fetch the enclave signature for a completion and verify it against our local hashes. */
  async verify(chatId: string, requestBody: string, responseBody: string): Promise<TeeProof> {
    const url = `${this.baseUrl}/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(this.model)}&signing_algo=ecdsa`;
    const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
    if (!res.ok) return { chatId, verified: false, detail: `signature endpoint ${res.status}` };
    const sig = (await res.json()) as { text: string; signature: string; signing_address: string };
    return verifyTeeSignature(chatId, requestBody, responseBody, sig);
  }

  /** Attestation report (TDX quote + NVIDIA payload) binding `signing_address` to genuine hardware. */
  async attestationReport(nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))): Promise<unknown> {
    const url = `${this.baseUrl}/attestation/report?model=${encodeURIComponent(this.model)}&signing_algo=ecdsa&nonce=${nonce}`;
    const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
    if (!res.ok) throw new Error(`attestation ${res.status}`);
    return res.json();
  }
}

export function sha256Hex(s: string | Uint8Array): string {
  return bytesToHex(sha256(typeof s === "string" ? utf8ToBytes(s) : s));
}

/** EIP-191 personal_sign recovery -> 0x address (lower-case). */
export function recoverPersonalSignAddress(text: string, signatureHex: string): string {
  const msg = utf8ToBytes(text);
  const prefixed = new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`), ...msg]);
  const digest = keccak_256(prefixed);
  const sig = hexToBytes(signatureHex.replace(/^0x/, ""));
  if (sig.length !== 65) throw new Error("signature must be 65 bytes");
  let v = sig[64];
  if (v >= 27) v -= 27;
  const pub = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(digest);
  const uncompressed = pub.toRawBytes(false).slice(1);
  return "0x" + bytesToHex(keccak_256(uncompressed).slice(-20));
}

export function verifyTeeSignature(
  chatId: string,
  requestBody: string,
  responseBody: string,
  sig: { text: string; signature: string; signing_address: string },
): TeeProof {
  const expected = `${sha256Hex(requestBody)}:${sha256Hex(responseBody)}`;
  const base = { chatId, signingAddress: sig.signing_address, signature: sig.signature, signedText: sig.text };
  if (sig.text !== expected) {
    return { ...base, verified: false, detail: "signed hashes do not match local request/response" };
  }
  try {
    const recovered = recoverPersonalSignAddress(sig.text, sig.signature);
    const ok = recovered === sig.signing_address.toLowerCase();
    return { ...base, verified: ok, detail: ok ? "enclave signature valid" : `recovered ${recovered} != signing_address` };
  } catch (e) {
    return { ...base, verified: false, detail: `bad signature: ${(e as Error).message}` };
  }
}

/** Extract the first JSON object from a model response (tolerates code fences / prose). */
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
