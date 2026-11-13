/** Runtime configuration. Everything is optional: missing keys switch that edge to a labelled fallback. */
export interface Config {
  nearAiApiKey?: string;
  nearAiBaseUrl: string;
  nearAiModel: string;
  networkId: "testnet" | "mainnet";
  nodeUrl: string;
  vaultContract?: string;
  mpcContract: string;
  /** Agent account credentials, format `account.testnet:ed25519:PRIVATEKEY`. */
  strategistKey?: string;
  sentinelKey?: string;
  matcherKey?: string;
  oneClickBaseUrl: string;
  oneClickJwt?: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const networkId = env.NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
  return {
    nearAiApiKey: env.NEAR_AI_API_KEY || undefined,
    nearAiBaseUrl: env.NEAR_AI_BASE_URL || "https://cloud-api.near.ai/v1",
    nearAiModel: env.NEAR_AI_MODEL || "deepseek-ai/DeepSeek-V3.1",
    networkId,
    nodeUrl: env.NEAR_NODE_URL || (networkId === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org"),
    vaultContract: env.MAMORUX_VAULT_CONTRACT || env.AEGIS_VAULT_CONTRACT || undefined,
    mpcContract: env.MPC_CONTRACT || (networkId === "mainnet" ? "v1.signer" : "v1.signer-prod.testnet"),
    strategistKey: env.STRATEGIST_KEY || undefined,
    sentinelKey: env.SENTINEL_KEY || undefined,
    matcherKey: env.MATCHER_KEY || undefined,
    oneClickBaseUrl: env.ONECLICK_BASE_URL || "https://1click.chaindefuser.com",
    oneClickJwt: env.ONECLICK_JWT || undefined,
    port: Number(env.PORT || 8787),
  };
}

export function onChainEnabled(c: Config): boolean {
  return Boolean(c.vaultContract && c.strategistKey && c.sentinelKey && c.matcherKey);
}
