# MamoruX

> **Confidential AI Swarm Dark-Pool & Policy Firewall on NEAR**  
> *Built for the NEAR Hackathon (November 1–14, 2026)*

[![License: MIT](https://img.shields.io/badge/License-MIT-00EC97.svg)](LICENSE)
[![Rust Tests](https://img.shields.io/badge/Rust-22%20Passed-00EC97.svg)](#1-smart-contract-test-suite)
[![Agent Tests](https://img.shields.io/badge/Vitest-4%20Passed-00EC97.svg)](#2-typescript-agents--swarm-suite)

---

## 🎯 Targeted Hackathon Tracks (Official Alignment)
1. **Unstoppable DeFi**: *Build cross-chain exchanges, lending platforms, vaults and trading agents powered by NEAR Intents.* → MamoruX acts as an institutional cross-chain dark-pool vault settling via NEAR Intents and Chain Signatures.
2. **Privacy & Private AI**: *Build confidential applications and AI that keep sensitive data protected.* → Sealed intents execute inside NEAR AI Cloud TEE enclaves; only cryptographic commitments (`plan_hash`) and hardware attestation hashes touch the public chain.
3. **AI Swarms**: *Build systems where multiple AI agents coordinate, bid, pool resources and transact together.* → 3 specialized agents (**Strategist**, **Sentinel**, **Matcher**) reach cryptographic quorum before capital moves.
4. **AI Security & Defense**: *Make AI-controlled money safer with spending limits, wallet safeguards, reputation systems and scam detection.* → `MamoruVault` enforces risk ceilings (`<= 60`), notional caps, chain allowlists, prompt-injection scanning, and a Sentinel emergency `pause()` circuit-breaker.
5. **Agent Economy**: *Give AI agents the ability to earn, spend, negotiate and pay for services or other agents.* → Autonomous agents negotiate peer-to-peer crosses and route liquidity natively across chains.

---

## 🛠️ NEAR Toolkit & Technologies Used (Powering MamoruX)

| NEAR Tool / Primitive | How It Powers MamoruX (Exact Files) |
|---|---|
| **NEAR Intents & 1-Click Swap SDK** | Unmatched residual dark-pool order flow is chunked and routed to `1click.chaindefuser.com` (`intents.near` solvers) for zero-bridge cross-chain swaps. See [`agents/src/intents.ts`](agents/src/intents.ts). |
| **Chain Signatures & Chain Abstraction** | `MamoruVault` acts as the single multi-chain controller via `v1.signer-prod.testnet` / `v1.signer`, deriving native BTC/ETH/SOL addresses (`mamorux/{owner}/{chain}`) and signing `Secp256k1` / `Ed25519` payloads cross-contract. See [`contracts/mamorux-vault/src/lib.rs`](contracts/mamorux-vault/src/lib.rs) and [`agents/src/chainsig.ts`](agents/src/chainsig.ts). |
| **NEAR AI Cloud & TEEs** | Runs confidential inference (`deepseek-ai/DeepSeek-V3.1`) inside Intel TDX / NVIDIA enclaves via `cloud-api.near.ai/v1`, verifying `/v1/signature/{chat_id}` EIP-191 enclave proofs locally. See [`agents/src/near-ai.ts`](agents/src/near-ai.ts). |
| **Function Call Keys & Sub-Accounts** | Each autonomous agent (`strategist`, `sentinel`, `matcher`) operates with its own scoped NEAR sub-account and function-call access key registered on-chain with role-based permissions. |
| **Meta Transactions (NEP-366) Ready** | Users can submit sealed intents off-chain while relayers / agents cover NEAR gas on-chain using the user's deposited vault balance. |

---

## ⚡ Quick Start (Claude Code / Codex Evaluation)

Run the full end-to-end automated verification script:

```bash
./scripts/demo.sh
```

This single command:
1. Compiles and executes all **22 Rust smart contract unit tests** (`contracts/mamorux-vault`).
2. Runs the **TypeScript test suite** via Vitest (`agents/`).
3. Executes a live **3-agent Swarm Orchestration demo** producing cryptographic commitments and trade legs.

---

## 🖥️ Interactive Web Dashboard & NEAR Wallet Inspector

```bash
cd web
pnpm install
pnpm dev
```

Open `http://localhost:3000` to access:
- **Overview & Architecture**: Interactive breakdown of the 4 NEAR primitives and 5 tracks.
- **Live Dark-Pool**: Submit sealed intents to the `/api/swarm` endpoint, test healthy vs. adversarial attack presets, and inspect live Strategist/Sentinel/Matcher outputs.
- **NEAR Wallet Inspector & Generator (`/api/wallet`)**: Check live NEAR mainnet/testnet balances, view derived Chain Signatures addresses, or generate a fresh Ed25519 NEAR implicit wallet address.

---

## 🧪 Detailed Testing Guide

### 1. Smart Contract Test Suite
```bash
cd contracts/mamorux-vault
cargo test
```

### 2. TypeScript Agents & Swarm Suite
```bash
cd agents
pnpm test
```

### 3. Interactive Swarm Run
```bash
cd agents
npx tsx src/cli.ts
```

---

## 🔒 Security Firewall Features
- **Prompt Injection Defense**: Filters adversarial keywords (`drain`, `bypass`, `exploit`, `override`) in arbitrary natural language intent notes.
- **Slippage Ceiling**: Automatically flags and vetoes high slippage tolerance (`> 300 bps`) orders.
- **Circuit Breaker**: Any authorized Sentinel agent or vault owner can invoke `pause()` in an emergency.
- **Conservation Law Invariants**: Matcher mathematically audits that the sum of output legs strictly equals input intents.

---

## 📄 License
MIT
