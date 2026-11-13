import type { FetchLike } from "./near-ai.js";

/** Read-only NEAR JSON-RPC `call_function` helper. */
export async function viewFunction<T = unknown>(
  nodeUrl: string,
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const res = await fetchImpl(nodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "mamorux",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const json = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: unknown };
  if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error).slice(0, 300)}`);
  if (json.result?.error) throw new Error(`View error: ${json.result.error}`);
  const bytes = Buffer.from(json.result?.result ?? []);
  return JSON.parse(bytes.toString("utf8")) as T;
}
