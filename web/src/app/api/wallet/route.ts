import { NextResponse } from "next/server";
import { generateKeyPairSync } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { base58, bech32 } from "@scure/base";

function isValidNearAccountId(id: string): boolean {
  if (!id || id.length < 2 || id.length > 64) return false;
  if (/^[0-9a-f]{64}$/.test(id)) return true;
  return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id);
}

function parseNearSecp256k1(pk: string): Uint8Array {
  const [curve, data] = pk.split(":");
  if (curve !== "secp256k1" || !data) throw new Error(`Expected secp256k1 key, got ${pk}`);
  const raw = base58.decode(data);
  if (raw.length !== 64) throw new Error("secp256k1 key must be 64 bytes");
  return new Uint8Array([4, ...raw]);
}

function ethAddressFromUncompressed(uncompressed: Uint8Array): string {
  const hash = keccak_256(uncompressed.slice(1));
  return "0x" + Buffer.from(hash.slice(-20)).toString("hex");
}

function btcP2wpkhFromUncompressed(uncompressed: Uint8Array, network: "testnet" | "mainnet"): string {
  const compressed = secp256k1.ProjectivePoint.fromHex(uncompressed).toRawBytes(true);
  const h160 = ripemd160(sha256(compressed));
  return bech32.encode(network === "mainnet" ? "bc" : "tb", [0, ...bech32.toWords(h160)]);
}

function solanaAddressFromNearKey(pk: string): string {
  const [curve, data] = pk.split(":");
  if (curve !== "ed25519" || !data || base58.decode(data).length !== 32) {
    throw new Error(`Expected ed25519 key, got ${pk}`);
  }
  return data;
}

async function getEthBalance(address: string): Promise<string> {
  try {
    const res = await fetch("https://ethereum-rpc.publicnode.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBalance", params: [address, "latest"], id: 1 }),
      signal: AbortSignal.timeout(4500),
    });
    const data = await res.json();
    if (data.result) {
      const wei = BigInt(data.result);
      const ethWhole = wei / BigInt(10 ** 18);
      const ethFrac = ((wei % BigInt(10 ** 18)) / BigInt(10 ** 14)).toString().padStart(4, "0");
      return `${ethWhole}.${ethFrac}`;
    }
  } catch {}
  return "0.0000";
}

async function getSolBalance(address: string): Promise<string> {
  try {
    const res = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }),
      signal: AbortSignal.timeout(4500),
    });
    const data = await res.json();
    if (data.result && typeof data.result.value === "number") {
      return (data.result.value / 1e9).toFixed(4);
    }
  } catch {}
  return "0.0000";
}

async function getBtcBalance(address: string): Promise<string> {
  try {
    const res = await fetch(`https://mempool.space/api/address/${encodeURIComponent(address)}`, {
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const data = await res.json();
      const sats = (data.chain_stats?.funded_txo_sum || 0) - (data.chain_stats?.spent_txo_sum || 0);
      return (Math.max(0, sats) / 1e8).toFixed(6);
    }
  } catch {}
  return "0.000000";
}

async function rpcCall(rpcUrl: string, params: Record<string, unknown>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: "mamorux", method: "query", params }),
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function mpcDerivedPublicKey(
  rpcUrl: string,
  mpcContract: string,
  predecessor: string,
  path: string,
  domainId: 0 | 1
): Promise<string> {
  const data = await rpcCall(rpcUrl, {
    request_type: "call_function",
    finality: "final",
    account_id: mpcContract,
    method_name: "derived_public_key",
    args_base64: Buffer.from(JSON.stringify({ path, predecessor, domain_id: domainId })).toString("base64"),
  });
  if (data.error || data.result?.error) {
    throw new Error(data.result?.error || JSON.stringify(data.error));
  }
  return JSON.parse(Buffer.from(data.result.result).toString("utf8")) as string;
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
    const accData = await rpcCall(rpcUrl, {
      request_type: "view_account",
      finality: "final",
      account_id: accountId,
    });
    rpcReachable = true;

    if (accData.result && accData.result.amount) {
      existsOnChain = true;
      const yocto = BigInt(accData.result.amount);
      const nearWhole = yocto / BigInt(10 ** 24);
      const nearFrac = ((yocto % BigInt(10 ** 24)) / BigInt(10 ** 20)).toString().padStart(4, "0");
      balanceNear = `${nearWhole}.${nearFrac}`;
      storageUsage = Number(accData.result.storage_usage || 0);
    } else {
      rpcNote = "Valid NEAR address format, but not yet funded on-chain (implicit accounts activate on first transfer).";
    }
  } catch (e) {
    rpcReachable = false;
    rpcNote = `NEAR RPC unreachable (${(e as Error).message}).`;
  }

  // Real MPC Chain Signatures derivation via v1.signer
  const ethPath = `mamorux/${accountId}/ethereum`;
  const solPath = `mamorux/${accountId}/solana`;
  const btcPath = `mamorux/${accountId}/bitcoin`;

  let mpcDerived = false;
  let mpcError: string | null = null;
  let derivedAccounts: {
    ethereum: { path: string; publicKey?: string; address: string; balance: string; symbol: string };
    solana: { path: string; publicKey?: string; address: string; balance: string; symbol: string };
    bitcoin: { path: string; publicKey?: string; address: string; balance: string; symbol: string };
  } | null = null;

  if (rpcReachable) {
    try {
      const [ethPk, solPk, btcPk] = await Promise.all([
        mpcDerivedPublicKey(rpcUrl, mpcContract, vaultContract, ethPath, 0),
        mpcDerivedPublicKey(rpcUrl, mpcContract, vaultContract, solPath, 1),
        mpcDerivedPublicKey(rpcUrl, mpcContract, vaultContract, btcPath, 0),
      ]);

      const ethAddr = ethAddressFromUncompressed(parseNearSecp256k1(ethPk));
      const solAddr = solanaAddressFromNearKey(solPk);
      const btcAddr = btcP2wpkhFromUncompressed(parseNearSecp256k1(btcPk), network);

      const [ethBal, solBal, btcBal] = await Promise.all([
        getEthBalance(ethAddr),
        getSolBalance(solAddr),
        getBtcBalance(btcAddr),
      ]);

      derivedAccounts = {
        ethereum: {
          path: ethPath,
          publicKey: ethPk,
          address: ethAddr,
          balance: ethBal,
          symbol: "ETH",
        },
        solana: {
          path: solPath,
          publicKey: solPk,
          address: solAddr,
          balance: solBal,
          symbol: "SOL",
        },
        bitcoin: {
          path: btcPath,
          publicKey: btcPk,
          address: btcAddr,
          balance: btcBal,
          symbol: "BTC",
        },
      };
      mpcDerived = true;
    } catch (e) {
      mpcError = `MPC derivation failed: ${(e as Error).message}`;
    }
  } else {
    mpcError = "Cannot derive live MPC addresses while NEAR RPC is unreachable.";
  }

  const portfolio = {
    near: { balance: balanceNear, symbol: "NEAR", network },
    ethereum: derivedAccounts ? { balance: derivedAccounts.ethereum.balance, symbol: "ETH", address: derivedAccounts.ethereum.address } : null,
    solana: derivedAccounts ? { balance: derivedAccounts.solana.balance, symbol: "SOL", address: derivedAccounts.solana.address } : null,
    bitcoin: derivedAccounts ? { balance: derivedAccounts.bitcoin.balance, symbol: "BTC", address: derivedAccounts.bitcoin.address } : null,
  };

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
    mpcDerived,
    mpcError,
    derivedAccounts,
    portfolio,
  });
}

export async function POST() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });

  const rawPub = new Uint8Array(spki.subarray(spki.length - 32));
  const rawSeed = new Uint8Array(pkcs8.subarray(pkcs8.length - 32));
  const fullSecret = new Uint8Array(64);
  fullSecret.set(rawSeed, 0);
  fullSecret.set(rawPub, 32);

  const implicitAccountId = Buffer.from(rawPub).toString("hex");
  const nearPublicKey = `ed25519:${base58.encode(rawPub)}`;
  const nearPrivateKey = `ed25519:${base58.encode(fullSecret)}`;

  return NextResponse.json({
    accountId: implicitAccountId,
    publicKey: nearPublicKey,
    privateKey: nearPrivateKey,
    note: "Cryptographically valid Ed25519 NEAR Implicit Account Address (64-char hex). Save the private key securely and import it into Meteor Wallet or MyNearWallet.",
  });
}
