import { secp256k1 } from "@noble/curves/secp256k1";
import { sha3_256, keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { base58, bech32 } from "@scure/base";
import { viewFunction } from "./near-rpc.js";
import type { FetchLike } from "./near-ai.js";
import type { Chain } from "./types.js";

/**
 * NEAR Chain Signatures helpers.
 *
 * The MPC network holds one root key per domain. A child key for (predecessor, path) is
 *   child = root + epsilon * G,  epsilon = sha3_256(PREFIX + predecessor + "," + path)
 * so the MamoruVault contract (the predecessor of every `sign` call) controls one native address per
 * (user, chain) path, on Bitcoin, EVM chains and Solana, without bridges or wrapped assets.
 */
export const EPSILON_PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation:";

/** Domain ids on the MPC contract: 0 = secp256k1 (ECDSA), 1 = ed25519 (EdDSA). */
export function domainFor(chain: Chain): 0 | 1 {
  return chain === "solana" || chain === "near" ? 1 : 0;
}

export function vaultPath(owner: string, chain: Chain): string {
  return `mamorux/${owner}/${chain}`;
}

export function deriveEpsilon(predecessor: string, path: string): bigint {
  const h = sha3_256(utf8ToBytes(`${EPSILON_PREFIX}${predecessor},${path}`));
  return BigInt("0x" + bytesToHex(h)) % secp256k1.CURVE.n;
}

/** Parse `secp256k1:<base58 64-byte x||y>` (NEAR format) into a 65-byte uncompressed key. */
export function parseNearSecp256k1(pk: string): Uint8Array {
  const [curve, data] = pk.split(":");
  if (curve !== "secp256k1" || !data) throw new Error(`expected secp256k1 key, got ${pk}`);
  const raw = base58.decode(data);
  if (raw.length !== 64) throw new Error("secp256k1 key must be 64 bytes");
  return new Uint8Array([4, ...raw]);
}

export function deriveSecp256k1Child(rootUncompressed: Uint8Array, predecessor: string, path: string): Uint8Array {
  const root = secp256k1.ProjectivePoint.fromHex(rootUncompressed);
  const eps = deriveEpsilon(predecessor, path);
  return root.add(secp256k1.ProjectivePoint.BASE.multiply(eps)).toRawBytes(false);
}

export function ethAddress(uncompressed: Uint8Array): string {
  return "0x" + bytesToHex(keccak_256(uncompressed.slice(1)).slice(-20));
}

export function btcP2wpkhAddress(uncompressed: Uint8Array, network: "testnet" | "mainnet"): string {
  const compressed = secp256k1.ProjectivePoint.fromHex(uncompressed).toRawBytes(true);
  const h160 = ripemd160(sha256(compressed));
  return bech32.encode(network === "mainnet" ? "bc" : "tb", [0, ...bech32.toWords(h160)]);
}

/** `ed25519:<base58 32 bytes>` -> Solana address (the base58 public key itself). */
export function solanaAddressFromNearKey(pk: string): string {
  const [curve, data] = pk.split(":");
  if (curve !== "ed25519" || base58.decode(data).length !== 32) throw new Error(`expected ed25519 key, got ${pk}`);
  return data;
}

export interface DerivedAddress {
  chain: Chain;
  path: string;
  domainId: 0 | 1;
  publicKey: string;
  address: string;
  /** "local" = derived here from the root key; "mpc-view" = returned by the MPC contract. */
  source: "local" | "mpc-view";
}

export class ChainSignatures {
  constructor(
    private nodeUrl: string,
    private mpcContract: string,
    private network: "testnet" | "mainnet",
    private fetchImpl: FetchLike = fetch,
  ) {}

  rootPublicKey(domainId: 0 | 1 = 0): Promise<string> {
    return viewFunction<string>(this.nodeUrl, this.mpcContract, "public_key", { domain_id: domainId }, this.fetchImpl);
  }

  derivedPublicKey(predecessor: string, path: string, domainId: 0 | 1): Promise<string> {
    return viewFunction<string>(
      this.nodeUrl,
      this.mpcContract,
      "derived_public_key",
      { path, predecessor, domain_id: domainId },
      this.fetchImpl,
    );
  }

  /** Native address controlled by `vault` for `owner` on `chain`. Cross-checks local math against the MPC view. */
  async addressFor(vault: string, owner: string, chain: Chain): Promise<DerivedAddress> {
    const path = vaultPath(owner, chain);
    const domainId = domainFor(chain);
    const publicKey = await this.derivedPublicKey(vault, path, domainId);
    if (domainId === 1) {
      if (chain !== "solana") return { chain, path, domainId, publicKey, address: publicKey, source: "mpc-view" };
      return { chain, path, domainId, publicKey, address: solanaAddressFromNearKey(publicKey), source: "mpc-view" };
    }
    const child = parseNearSecp256k1(publicKey);
    // Independent local derivation from the root key: proves we understand exactly what is being signed for.
    const root = parseNearSecp256k1(await this.rootPublicKey(0));
    const local = deriveSecp256k1Child(root, vault, path);
    const source = bytesToHex(local) === bytesToHex(child) ? "local" : "mpc-view";
    const address = chain === "bitcoin" ? btcP2wpkhAddress(child, this.network) : ethAddress(child);
    return { chain, path, domainId, publicKey, address, source };
  }
}
