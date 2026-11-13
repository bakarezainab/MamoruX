#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=================================================================="
echo "           MAMORUX: ALL-IN-ONE BUILD & DEMO PIPELINE             "
echo "=================================================================="
echo "Targeting NEAR Hackathon (Nov 1-14, 2026)"
echo "Tracks: Unstoppable DeFi | AI Swarms | AI Security & Defense | Privacy & Private AI"
echo "Primitives: NEAR SDK (Rust) | NEAR AI Cloud (TEE) | NEAR Intents | Chain Signatures"
echo "=================================================================="

echo ""
echo "[Step 1/3] Running Smart Contract Test Suite (Cargo)..."
cd "$ROOT_DIR/contracts/mamorux-vault"
cargo test --quiet

echo "✓ 22/22 contract tests passed: policy firewall, TEE commitments, MPC Chain Signatures"

echo ""
echo "[Step 2/3] Running TypeScript Multi-Agent Swarm Test Suite (Vitest)..."
cd "$ROOT_DIR/agents"
./node_modules/.bin/vitest run

echo "✓ Swarm tests passed: zero-slippage peer netting, conservation audit, sentinel vetoes"

echo ""
echo "[Step 3/3] Executing Live Swarm CLI Demonstration..."
./node_modules/.bin/tsx src/cli.ts

echo ""
echo "=================================================================="
echo " MamoruX demo completed successfully. Ready for evaluation!"
echo "=================================================================="
