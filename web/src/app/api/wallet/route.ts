import { NextResponse } from "next/server";
import { createHash, generateKeyPairSync } from "crypto";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function toBase58(bytes: Uint8Array): string {
  let num = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let encoded = "";
  while (num > 0n) {
    const rem = Number(num % 58n);
    num = num / 58n;
    encoded = BASE58_ALPHABET[rem] + encoded;
  }
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    encoded = "1" + encoded;
  }
  return encoded || "1";
}

function isValidNearAccountId(id: string): boolean {
  if (!id || id.length < 2 || id.length > 64) return false;
  if (/^[0-9a-f]{64}$/.test(id)) return true; // implicit account
  return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id);
}

function deterministicMockAddr(prefix: string, seed: string, len: number): string {
  const h = createHash("sha256").update(seed).digest("hex");
  return prefix + h.slice(0, len);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = (searchParams.get("accountId") || "").trim().toLowerCase();
  const network = searchParams.get("network") === "mainnet" ? "mainnet" : "testnet";

  if (!isValidNearAccountId(accountId)) {
    return NextResponse.json(
      { error: "Invalid NEAR account ID format (use name.near, name.testnet, or 64-char hex)." },
      { status: 400 }
    );
  }

  const rpcUrl = network === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org";
  const mpcContract = network === "mainnet" ? "v1.signer" : "v1.signer-prod.testnet";
  const vaultContract = network === "mainnet" ? "mamorux-vault.near" : "mamorux-vault.testnet";

  let existsOnChain = false;
  let balanceNear = "0.0000";
  let storageUsage = 0;
  let rpcReachable = false;
  let rpcNote = "";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "mamorux-wallet",
        method: "query",
        params: {
          request_type: "view_account",
          finality: "final",
          account_id: accountId,
        },
      }),
    });
    clearTimeout(timer);
    const data = await res.json();
    rpcReachable = true;

    if (data.result && data.result.amount) {
      existsOnChain = true;
      const yocto = BigInt(data.result.amount);
      const nearWhole = yocto / 10n ** 24n;
      const nearFrac = ((yocto % 10n ** 24n) / 10n ** 20n).toString().padStart(4, "0");
      balanceNear = `${nearWhole}.${nearFrac}`;
      storageUsage = Number(data.result.storage_usage || 0);
    } else if (data.error) {
      rpcNote = "Valid NEAR address format. Account is not yet funded on-chain (implicit accounts activate on first transfer).";
    }
  } catch {
    rpcReachable = false;
    rpcNote = "Live NEAR RPC unreachable from this environment; showing deterministic address & derivation paths.";
  }

  return NextResponse.json({
    accountId,
    network,
    rpcUrl,
    rpcReachable,
    existsOnChain,
    balanceNear,
    storageUsage,
    rpcNote,
    mpcContract,
    vaultContract,
    derivedAccounts: {
      ethereum: {
        path: `mamorux/${accountId}/ethereum`,
        domainId: 0,
        address: deterministicMockAddr("0x", `${vaultContract}:mamorux/${accountId}/ethereum`, 40),
      },
      solana: {
        path: `mamorux/${accountId}/solana`,
        domainId: 1,
        address: toBase58(createHash("sha256").update(`${vaultContract}:mamorux/${accountId}/solana`).digest()),
      },
      bitcoin: {
        path: `mamorux/${accountId}/bitcoin`,
        domainId: 0,
        address: (network === "mainnet" ? "bc1q" : "tb1q") + createHash("sha256").update(`${vaultContract}:mamorux/${accountId}/bitcoin`).digest("hex").slice(0, 38),
      },
    },
  });
}

export async function POST() {
  // Generate a real Ed25519 keypair and derive the 64-char hex NEAR Implicit Account ID
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });

  // Last 32 bytes of SPKI DER are the raw Ed25519 public key
  const rawPub = new Uint8Array(spki.subarray(spki.length - 32));
  // Last 32 bytes of PKCS8 DER are the raw Ed25519 private seed
  const rawSeed = new Uint8Array(pkcs8.subarray(pkcs8.length - 32));
  const fullSecret = new Uint8Array(64);
  fullSecret.set(rawSeed, 0);
  fullSecret.set(rawPub, 32);

  const implicitAccountId = Buffer.from(rawPub).toString("hex");
  const nearPublicKey = `ed25519:${toBase58(rawPub)}`;
  const nearPrivateKey = `ed25519:${toBase58(fullSecret)}`;

  return NextResponse.json({
    accountId: implicitAccountId,
    publicKey: nearPublicKey,
    privateKey: nearPrivateKey,
    note: "This is a real NEAR Implicit Account Address (64-char hex). You can submit it on nearhackathon.com/#apply and import the private key into MyNearWallet or Meteor Wallet.",
  });
}
