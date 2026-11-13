"use client";

import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  Lock,
  Cpu,
  ArrowRightLeft,
  Layers,
  CheckCircle2,
  Key,
  RefreshCw,
  Terminal,
  EyeOff,
  Award,
  ChevronRight,
  Database,
  Fingerprint,
  Wallet,
  Copy,
  Check,
  Sparkles,
  X,
  ShieldAlert,
  ExternalLink,
  Plus,
  Trash2,
} from "lucide-react";

type TabId = "overview" | "app" | "how-it-works" | "models" | "submit";

interface QueuedIntent {
  id: string;
  owner: string;
  sell: { chain: string; symbol: string };
  buy: { chain: string; symbol: string };
  amount: string;
  maxSlippageBps: number;
}

interface SwarmResponse {
  approved: boolean;
  planHash: string;
  prices: Record<string, number>;
  priceFeedLive: boolean;
  totalNotionalUsd: number;
  internalizationRate: number;
  crosses: Array<{ a: string; b: string; pair: string; amountA: number; amountB: number; notionalUsd: number }>;
  legs: Array<{
    intentId: string;
    chain: string;
    kind: string;
    sell: { chain: string; symbol: string };
    buy: { chain: string; symbol: string };
    amount: number;
    notionalUsd: number;
    venue: string;
    rationale: string;
    liveQuote?: {
      amountOutFormatted?: string;
      amountOutUsd?: string;
      timeEstimateSec?: number;
      source: string;
      error?: string;
    };
  }>;
  reports: {
    strategist: { verdict: string; riskScore: number; findings: string[]; model: string; mode: string };
    sentinel: { verdict: string; riskScore: number; findings: string[]; model: string; mode: string };
    matcher: { verdict: string; riskScore: number; findings: string[]; model: string; mode: string };
  };
  rejectionReason: string | null;
}

interface WalletInfo {
  accountId: string;
  network: "mainnet" | "testnet";
  rpcReachable: boolean;
  existsOnChain: boolean;
  balanceNear: string;
  rpcNote?: string;
  mpcContract: string;
  vaultContract: string;
  mpcDerived: boolean;
  mpcError?: string | null;
  derivedAccounts: {
    ethereum: { path: string; address: string };
    solana: { path: string; address: string };
    bitcoin: { path: string; address: string };
  } | null;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  // Wallet State (no hardcoded fake account)
  const [walletOpen, setWalletOpen] = useState(false);
  const [network, setNetwork] = useState<"mainnet" | "testnet">("mainnet");
  const [walletInput, setWalletInput] = useState("");
  const [activeAccount, setActiveAccount] = useState("");
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [generatedWallet, setGeneratedWallet] = useState<{
    accountId: string;
    publicKey: string;
    privateKey: string;
    note: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Dark-Pool Intent State
  const [sellAsset, setSellAsset] = useState("ETH");
  const [sellChain, setSellChain] = useState("ethereum");
  const [amount, setAmount] = useState("1.0");
  const [buyAsset, setBuyAsset] = useState("SOL");
  const [buyChain, setBuyChain] = useState("solana");
  const [intentNote, setIntentNote] = useState("Quarterly treasury rebalance");
  const [slippageBps, setSlippageBps] = useState("40");
  const [pool, setPool] = useState<QueuedIntent[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [swarmError, setSwarmError] = useState<string | null>(null);
  const [swarmResult, setSwarmResult] = useState<SwarmResponse | null>(null);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const loadPool = async () => {
    try {
      const res = await fetch("/api/swarm");
      const data = await res.json();
      if (Array.isArray(data.pool)) setPool(data.pool);
    } catch {
      // ignore initial pool fetch error
    }
  };

  useEffect(() => {
    loadPool();
  }, []);

  const inspectWallet = async (accId = walletInput, net = network) => {
    const clean = accId.trim().toLowerCase();
    if (!clean) {
      setWalletError("Enter a NEAR wallet address or generate one below.");
      return;
    }
    setWalletLoading(true);
    setWalletError(null);
    try {
      const res = await fetch(`/api/wallet?accountId=${encodeURIComponent(clean)}&network=${net}`);
      const data = await res.json();
      if (!res.ok) {
        setWalletError(data.error || "Failed to verify NEAR account");
      } else {
        setWalletInfo(data);
        setActiveAccount(data.accountId);
      }
    } catch {
      setWalletError("Network error while checking NEAR wallet");
    } finally {
      setWalletLoading(false);
    }
  };

  const handleGenerateWallet = async () => {
    setWalletLoading(true);
    setWalletError(null);
    try {
      const res = await fetch("/api/wallet", { method: "POST" });
      const data = await res.json();
      setGeneratedWallet(data);
      setWalletInput(data.accountId);
      await inspectWallet(data.accountId, network);
    } catch {
      setWalletError("Failed to generate NEAR keypair");
    } finally {
      setWalletLoading(false);
    }
  };

  const submitSwarmAction = async (action: "execute" | "add_to_pool" | "clear_pool") => {
    setSwarmError(null);
    if (action !== "clear_pool" && !activeAccount) {
      setWalletOpen(true);
      setSwarmError("Connect or generate a NEAR wallet address first.");
      return;
    }
    setIsProcessing(true);
    try {
      const res = await fetch("/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          owner: activeAccount,
          sellAsset,
          sellChain,
          buyAsset,
          buyChain,
          amount,
          maxSlippageBps: Number(slippageBps),
          note: intentNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSwarmError(data.error || "Swarm execution failed");
      } else if (action === "add_to_pool" || action === "clear_pool") {
        setPool(data.pool || []);
      } else {
        setSwarmResult(data);
      }
    } catch {
      setSwarmError("Failed to reach MamoruX API");
    } finally {
      setIsProcessing(false);
    }
  };

  const shortAddr = (addr: string) =>
    addr.length > 20 ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : addr;

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white near-grid-bg flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-[#262626] bg-[#0A0A0A]/85 backdrop-blur-xl sticky top-0 z-40 px-4 md:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3 cursor-pointer group" onClick={() => setActiveTab("overview")}>
            <div className="w-10 h-10 rounded-xl bg-[#00EC97] flex items-center justify-center shadow-lg shadow-[#00EC97]/20 group-hover:scale-105 transition-transform">
              <Lock className="w-5 h-5 text-black stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-black text-lg tracking-tight text-white">
                  Mamoru<span className="text-[#00EC97]">X</span>
                </span>
                <span className="hidden sm:inline-block text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-[#00EC97]/10 text-[#00EC97] border border-[#00EC97]/30">
                  NEAR Protocol
                </span>
              </div>
              <p className="text-[11px] text-neutral-400">Private AI Dark-Pool &amp; Policy Firewall</p>
            </div>
          </div>

          <nav className="hidden lg:flex items-center space-x-1 bg-[#141414] border border-[#262626] p-1 rounded-xl">
            {[
              { id: "overview", label: "Overview" },
              { id: "app", label: "Live Dark-Pool" },
              { id: "how-it-works", label: "How It Works" },
              { id: "models", label: "AI & Security" },
              { id: "submit", label: "Use Cases & Submit" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabId)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === tab.id
                    ? "bg-[#00EC97] text-black shadow-sm"
                    : "text-neutral-400 hover:text-white hover:bg-[#1F1F1F]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center space-x-2.5">
            <button
              onClick={() => setWalletOpen(true)}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl border text-xs font-mono transition-all ${
                activeAccount
                  ? "bg-[#171717] border-[#00EC97]/50 text-white"
                  : "bg-[#00EC97]/10 border-[#00EC97] text-[#00EC97] font-bold"
              }`}
            >
              <Wallet className="w-3.5 h-3.5 text-[#00EC97]" />
              <span>{activeAccount ? shortAddr(activeAccount) : "Connect / Get NEAR Wallet"}</span>
            </button>

            <button
              onClick={() => setActiveTab("app")}
              className="hidden sm:flex items-center space-x-1.5 bg-[#00EC97] hover:bg-[#17D9D4] text-black px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-lg shadow-[#00EC97]/15"
            >
              <span>Launch App</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex lg:hidden items-center space-x-1 overflow-x-auto pt-3 pb-1">
          {[
            { id: "overview", label: "Overview" },
            { id: "app", label: "Live Dark-Pool" },
            { id: "how-it-works", label: "How It Works" },
            { id: "models", label: "AI & Security" },
            { id: "submit", label: "Use Cases & Submit" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabId)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                activeTab === tab.id ? "bg-[#00EC97] text-black" : "bg-[#171717] text-neutral-400"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1">
        {/* ================= OVERVIEW TAB ================= */}
        {activeTab === "overview" && (
          <section className="max-w-7xl mx-auto px-6 pt-14 pb-24 space-y-20 animate-fadeInUp">
            <div className="relative text-center space-y-7 max-w-4xl mx-auto">
              <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-96 h-48 bg-[#00EC97]/10 blur-[100px] rounded-full pointer-events-none" />

              <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-[#171717] border border-[#00EC97]/30 text-xs text-[#00EC97] font-mono">
                <Sparkles className="w-3.5 h-3.5" />
                <span>NEAR Protocol Hackathon 2026 • 5 Target Tracks</span>
              </div>

              <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-white leading-[1.08]">
                Trade Across Chains in the{" "}
                <span className="bg-gradient-to-r from-[#00EC97] via-[#17D9D4] to-[#00EC97] animate-gradient bg-clip-text text-transparent">
                  Dark.
                </span>
                <br />
                Verified by{" "}
                <span className="text-white underline decoration-[#00EC97] decoration-4 underline-offset-8">
                  Confidential AI.
                </span>
              </h1>

              <p className="text-base sm:text-lg text-neutral-400 max-w-2xl mx-auto leading-relaxed">
                <strong>MamoruX</strong> (<em>mamoru</em> = to protect) is an institutional cross-chain dark pool and AI security firewall.
                Three specialized agents audit, net, and settle orders across Bitcoin, Ethereum, and Solana via{" "}
                <strong>NEAR Intents (1Click)</strong>, <strong>Chain Signatures</strong>, and <strong>NEAR AI Cloud TEEs</strong>.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
                <button
                  onClick={() => setActiveTab("app")}
                  className="px-7 py-3.5 rounded-xl bg-[#00EC97] hover:bg-[#17D9D4] text-black font-bold text-sm transition-all shadow-xl shadow-[#00EC97]/20 flex items-center space-x-2"
                >
                  <span>Open Live Dark-Pool</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setWalletOpen(true)}
                  className="px-6 py-3.5 rounded-xl bg-[#171717] hover:bg-[#222222] text-white border border-[#2E2E2E] hover:border-[#00EC97]/40 font-semibold text-sm transition-all flex items-center space-x-2"
                >
                  <Wallet className="w-4 h-4 text-[#00EC97]" />
                  <span>Connect or Generate NEAR Wallet</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="near-card p-6 rounded-2xl space-y-3">
                <div className="w-10 h-10 rounded-xl bg-[#00EC97]/10 border border-[#00EC97]/30 flex items-center justify-center text-[#00EC97]">
                  <EyeOff className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-white">NEAR AI Cloud (TEEs)</h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Confidential inference inside Intel TDX / NVIDIA enclaves. Only <code className="text-[#00EC97]">plan_hash</code> and hardware signatures touch the chain.
                </p>
              </div>

              <div className="near-card p-6 rounded-2xl space-y-3">
                <div className="w-10 h-10 rounded-xl bg-[#17D9D4]/10 border border-[#17D9D4]/30 flex items-center justify-center text-[#17D9D4]">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-white">MamoruVault (Rust SDK)</h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  On-chain policy firewall enforcing risk ceilings (&le; 60), quorum, chain allowlists, and an emergency Sentinel <code className="text-[#17D9D4]">pause()</code>.
                </p>
              </div>

              <div className="near-card p-6 rounded-2xl space-y-3">
                <div className="w-10 h-10 rounded-xl bg-[#00EC97]/10 border border-[#00EC97]/30 flex items-center justify-center text-[#00EC97]">
                  <ArrowRightLeft className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-white">NEAR Intents (1Click)</h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Peer-to-peer internal crosses settle privately; residual unmatched flow queries live 1Click solvers for optimal cross-chain quotes.
                </p>
              </div>

              <div className="near-card p-6 rounded-2xl space-y-3">
                <div className="w-10 h-10 rounded-xl bg-[#17D9D4]/10 border border-[#17D9D4]/30 flex items-center justify-center text-[#17D9D4]">
                  <Key className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-white">Chain Signatures MPC</h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Single NEAR vault derives and signs native Bitcoin, Ethereum, and Solana transactions via <code className="text-[#17D9D4]">v1.signer</code> without bridges.
                </p>
              </div>
            </div>

            <div className="near-card p-8 rounded-3xl space-y-6">
              <div className="flex items-center space-x-3">
                <Award className="w-6 h-6 text-[#00EC97]" />
                <h2 className="text-lg font-bold text-white tracking-wide">5 Targeted Hackathon Tracks</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
                {[
                  { name: "01. Unstoppable DeFi", desc: "MEV-free dark-pool swaps settled via NEAR Intents & Chain Signatures." },
                  { name: "02. Privacy & Private AI", desc: "Sealed trade intents inside Intel TDX enclaves; zero public alpha leakage." },
                  { name: "03. AI Swarms", desc: "Strategist, Sentinel & Matcher agents reaching cryptographic quorum." },
                  { name: "04. AI Security & Defense", desc: "Prompt-injection firewall, risk caps & Sentinel circuit breaker." },
                  { name: "05. Agent Economy", desc: "Autonomous agents deriving keys and clearing multi-chain value." },
                ].map((t, i) => (
                  <div key={i} className="p-4 rounded-xl bg-[#111111] border border-[#262626] space-y-2">
                    <span className="text-[#00EC97] font-mono font-bold block">{t.name}</span>
                    <p className="text-neutral-400 leading-relaxed">{t.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ================= LIVE DARK-POOL APP TAB ================= */}
        {activeTab === "app" && (
          <section className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 animate-fadeInUp">
            {/* Left Column: Real Intent Composer + Dark-Pool Queue */}
            <div className="lg:col-span-5 space-y-6">
              <div className="near-card p-6 rounded-2xl space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center space-x-2">
                    <Lock className="w-4 h-4 text-[#00EC97]" />
                    <span>Sealed Intent Composer</span>
                  </h2>
                  <span className="text-[11px] font-mono text-[#00EC97] bg-[#00EC97]/10 px-2.5 py-0.5 rounded-full border border-[#00EC97]/30">
                    {activeAccount ? shortAddr(activeAccount) : "No Wallet"}
                  </span>
                </div>

                {!activeAccount && (
                  <button
                    onClick={() => setWalletOpen(true)}
                    className="w-full p-3 rounded-xl bg-[#00EC97]/10 border border-[#00EC97]/40 text-[#00EC97] text-xs font-mono text-left flex items-center justify-between"
                  >
                    <span>Click here to connect or generate your NEAR wallet first</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}

                <div className="p-3.5 rounded-xl bg-[#111111] border border-[#262626] space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-mono text-neutral-400 uppercase">Sell Amount &amp; Chain</label>
                    <select
                      value={`${sellAsset}:${sellChain}`}
                      onChange={(e) => {
                        const [sym, ch] = e.target.value.split(":");
                        setSellAsset(sym);
                        setSellChain(ch);
                      }}
                      className="bg-[#1C1C1C] text-xs font-mono text-[#00EC97] border border-[#2E2E2E] rounded-lg px-2 py-1 outline-none"
                    >
                      <option value="ETH:ethereum">ETH (Ethereum)</option>
                      <option value="SOL:solana">SOL (Solana)</option>
                      <option value="BTC:bitcoin">BTC (Bitcoin)</option>
                      <option value="NEAR:near">NEAR (NEAR)</option>
                      <option value="USDC:base">USDC (Base)</option>
                    </select>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="bg-transparent font-mono text-2xl font-bold text-white outline-none w-full"
                    placeholder="0.0"
                  />
                </div>

                <div className="flex justify-center -my-3 relative z-10">
                  <div className="w-8 h-8 rounded-full bg-[#1C1C1C] border border-[#2E2E2E] flex items-center justify-center text-[#00EC97]">
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[#111111] border border-[#262626] flex items-center justify-between">
                  <div>
                    <label className="text-[11px] font-mono text-neutral-400 uppercase block">Target Asset</label>
                    <span className="text-xs font-mono text-neutral-300">Live 1Click / P2P Mid</span>
                  </div>
                  <select
                    value={`${buyAsset}:${buyChain}`}
                    onChange={(e) => {
                      const [sym, ch] = e.target.value.split(":");
                      setBuyAsset(sym);
                      setBuyChain(ch);
                    }}
                    className="bg-[#1C1C1C] text-xs font-mono text-[#17D9D4] border border-[#2E2E2E] rounded-lg px-2.5 py-1.5 outline-none"
                  >
                    <option value="SOL:solana">SOL (Solana)</option>
                    <option value="ETH:ethereum">ETH (Ethereum)</option>
                    <option value="BTC:bitcoin">BTC (Bitcoin)</option>
                    <option value="NEAR:near">NEAR (NEAR)</option>
                    <option value="USDC:base">USDC (Base)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-neutral-400">Intent Note (Audited by Sentinel)</span>
                    <span className="text-neutral-500">Policy Max: 300 bps</span>
                  </div>
                  <textarea
                    rows={2}
                    value={intentNote}
                    onChange={(e) => setIntentNote(e.target.value)}
                    className="w-full bg-[#111111] border border-[#262626] focus:border-[#00EC97] rounded-xl p-3 text-xs text-neutral-200 outline-none transition resize-none font-mono"
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-[#111111] border border-[#262626] text-xs">
                  <span className="text-neutral-400">Max Slippage Tolerance</span>
                  <div className="flex items-center space-x-1.5 font-mono">
                    <input
                      type="number"
                      value={slippageBps}
                      onChange={(e) => setSlippageBps(e.target.value)}
                      className="w-14 bg-[#1C1C1C] text-center text-[#00EC97] rounded px-1.5 py-1 outline-none border border-[#2E2E2E]"
                    />
                    <span className="text-neutral-500">bps</span>
                  </div>
                </div>

                {swarmError && <p className="text-xs font-mono text-red-400">{swarmError}</p>}

                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => submitSwarmAction("add_to_pool")}
                    disabled={isProcessing}
                    className="col-span-1 py-3 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#2E2E2E] text-xs font-bold text-white transition flex items-center justify-center space-x-1"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#00EC97]" />
                    <span>Queue</span>
                  </button>
                  <button
                    onClick={() => submitSwarmAction("execute")}
                    disabled={isProcessing}
                    className="col-span-2 py-3 rounded-xl bg-[#00EC97] hover:bg-[#17D9D4] font-bold text-black text-xs tracking-wide transition flex items-center justify-center space-x-2 shadow-lg shadow-[#00EC97]/15 disabled:opacity-60"
                  >
                    {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    <span>{isProcessing ? "Running Swarm..." : "Execute Swarm"}</span>
                  </button>
                </div>
              </div>

              {/* Real Dark-Pool Orderbook */}
              <div className="near-card p-5 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    Live Dark-Pool Queue ({pool.length})
                  </h3>
                  {pool.length > 0 && (
                    <button
                      onClick={() => submitSwarmAction("clear_pool")}
                      className="text-[11px] font-mono text-red-400 hover:underline flex items-center space-x-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>
                {pool.length === 0 ? (
                  <p className="text-xs text-neutral-500 font-mono">
                    Pool is empty. Queue an intent from one wallet, switch wallets, and execute an opposite intent to demo P2P netting.
                  </p>
                ) : (
                  <div className="space-y-2 text-xs font-mono">
                    {pool.map((p) => (
                      <div key={p.id} className="p-2.5 rounded-xl bg-[#111111] border border-[#262626] flex justify-between">
                        <span className="text-neutral-300 truncate max-w-[140px]">{shortAddr(p.owner)}</span>
                        <span className="text-[#00EC97]">
                          {p.amount} {p.sell.symbol} &rarr; {p.buy.symbol}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Live MPC Chain Signatures Addresses */}
              <div className="near-card p-5 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center space-x-2">
                    <Key className="w-3.5 h-3.5 text-[#00EC97]" />
                    <span>Live MPC Derived Addresses</span>
                  </h3>
                  <button onClick={() => setWalletOpen(true)} className="text-[11px] font-mono text-[#00EC97] hover:underline">
                    {activeAccount ? "Change Wallet" : "Connect"}
                  </button>
                </div>

                {!walletInfo ? (
                  <p className="text-xs font-mono text-neutral-500">Connect a NEAR wallet to query live v1.signer MPC keys.</p>
                ) : walletInfo.derivedAccounts ? (
                  <div className="space-y-2 text-xs font-mono">
                    {(["ethereum", "solana", "bitcoin"] as const).map((ch) => (
                      <div
                        key={ch}
                        className="p-2.5 rounded-xl bg-[#111111] border border-[#262626] flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] text-neutral-500 uppercase">
                            {ch} • {walletInfo.derivedAccounts![ch].path}
                          </div>
                          <div className="text-neutral-200 truncate">{walletInfo.derivedAccounts![ch].address}</div>
                        </div>
                        <button
                          onClick={() => copyText(walletInfo.derivedAccounts![ch].address, ch)}
                          className="p-1.5 rounded-lg hover:bg-[#222222] text-neutral-400 hover:text-[#00EC97] shrink-0"
                        >
                          {copiedKey === ch ? <Check className="w-3.5 h-3.5 text-[#00EC97]" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs font-mono text-amber-400">
                    {walletInfo.mpcError || "MPC RPC query unavailable in this environment."}
                  </p>
                )}
              </div>
            </div>

            {/* Right Column: Swarm Execution Output */}
            <div className="lg:col-span-7 space-y-6">
              {!swarmResult ? (
                <div className="near-card p-10 rounded-3xl text-center space-y-3">
                  <Terminal className="w-8 h-8 text-[#00EC97] mx-auto" />
                  <h3 className="text-base font-bold text-white">Ready to Execute</h3>
                  <p className="text-xs text-neutral-400 max-w-md mx-auto">
                    Connect or generate your NEAR wallet, configure your cross-chain intent on the left, and click{" "}
                    <strong>Execute Swarm</strong> to run live 1Click pricing, Sentinel firewall checks, and dark-pool matching.
                  </p>
                </div>
              ) : (
                <>
                  <div
                    className={`p-4 rounded-2xl border flex items-center justify-between ${
                      swarmResult.approved
                        ? "bg-[#00EC97]/10 border-[#00EC97]/40 text-[#00EC97]"
                        : "bg-red-500/10 border-red-500/40 text-red-400"
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      {swarmResult.approved ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <ShieldAlert className="w-5 h-5 shrink-0" />}
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider">
                          {swarmResult.approved
                            ? "FIREWALL CLEARANCE GRANTED — READY FOR SETTLEMENT"
                            : "SENTINEL FIREWALL VETO — EXECUTION BLOCKED"}
                        </div>
                        <div className="text-[11px] font-mono opacity-90 mt-0.5">
                          {swarmResult.rejectionReason || `Plan Commitment: ${swarmResult.planHash.slice(0, 26)}...`}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="near-card p-4 rounded-xl">
                      <div className="text-[11px] font-mono text-neutral-400">Internal Netting</div>
                      <div className="text-xl font-black text-white mt-1">
                        {(swarmResult.internalizationRate * 100).toFixed(1)}%
                      </div>
                      <div className="text-[11px] font-mono text-[#00EC97]">{swarmResult.crosses.length} P2P Cross(es)</div>
                    </div>

                    <div className="near-card p-4 rounded-xl">
                      <div className="text-[11px] font-mono text-neutral-400">Sentinel Risk Score</div>
                      <div
                        className={`text-xl font-black mt-1 ${
                          swarmResult.reports.sentinel.riskScore <= 60 ? "text-[#00EC97]" : "text-red-400"
                        }`}
                      >
                        {swarmResult.reports.sentinel.riskScore} / 100
                      </div>
                      <div className="text-[11px] font-mono text-neutral-400">Policy Max: 60</div>
                    </div>

                    <div className="near-card p-4 rounded-xl">
                      <div className="text-[11px] font-mono text-neutral-400">Total Notional</div>
                      <div className="text-xl font-black text-white mt-1">
                        ${swarmResult.totalNotionalUsd.toLocaleString()}
                      </div>
                      <div className="text-[11px] font-mono text-[#17D9D4]">
                        {swarmResult.priceFeedLive ? "Live 1Click Prices" : "Oracle Offline"}
                      </div>
                    </div>
                  </div>

                  <div className="near-card rounded-2xl overflow-hidden">
                    <div className="border-b border-[#262626] px-5 py-3.5 flex items-center justify-between bg-[#111111]">
                      <div className="flex items-center space-x-2">
                        <Terminal className="w-4 h-4 text-[#00EC97]" />
                        <span className="text-xs font-bold uppercase tracking-wider">Multi-Agent Consensus Log</span>
                      </div>
                      <span className="text-[11px] font-mono text-neutral-400">Owner: {shortAddr(activeAccount)}</span>
                    </div>

                    <div className="p-5 space-y-3">
                      {[swarmResult.reports.strategist, swarmResult.reports.sentinel, swarmResult.reports.matcher].map(
                        (rep, idx) => (
                          <div key={idx} className="p-4 rounded-xl bg-[#111111] border border-[#262626] space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-white">
                                {rep.model} <span className="text-[10px] font-mono text-neutral-500">({rep.mode})</span>
                              </span>
                              <span
                                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                                  rep.verdict === "Approve"
                                    ? "bg-[#00EC97]/10 text-[#00EC97] border-[#00EC97]/30"
                                    : "bg-red-500/10 text-red-400 border-red-500/30"
                                }`}
                              >
                                {rep.verdict.toUpperCase()} • RISK {rep.riskScore}
                              </span>
                            </div>
                            <ul className="space-y-1 text-xs font-mono text-neutral-300">
                              {rep.findings.map((f, j) => (
                                <li key={j}>&gt; {f}</li>
                              ))}
                            </ul>
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  <div className="near-card rounded-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center space-x-2">
                        <Layers className="w-4 h-4 text-[#00EC97]" />
                        <span>Compiled Execution Legs ({swarmResult.legs.length})</span>
                      </h3>
                      <button
                        onClick={() => copyText(swarmResult.planHash, "planHash")}
                        className="text-[11px] font-mono text-[#00EC97] flex items-center space-x-1 hover:underline"
                      >
                        <span>{copiedKey === "planHash" ? "Copied Hash!" : "Copy plan_hash"}</span>
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="space-y-2.5 font-mono text-xs">
                      {swarmResult.legs.map((leg, i) => (
                        <div
                          key={i}
                          className="p-3.5 rounded-xl bg-[#111111] border border-[#262626] flex items-center justify-between gap-4"
                        >
                          <div>
                            <div className="flex items-center space-x-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                  leg.venue === "internal-cross"
                                    ? "bg-[#00EC97]/10 text-[#00EC97] border-[#00EC97]/30"
                                    : "bg-[#17D9D4]/10 text-[#17D9D4] border-[#17D9D4]/30"
                                }`}
                              >
                                {leg.venue.toUpperCase()}
                              </span>
                              <span className="font-bold text-white">
                                {leg.amount} {leg.sell.symbol} &rarr; {leg.buy.symbol} (${leg.notionalUsd.toLocaleString()})
                              </span>
                            </div>
                            <p className="text-[11px] text-neutral-400 mt-1">{leg.rationale}</p>
                            {leg.liveQuote && (
                              <p className="text-[11px] text-[#00EC97] mt-1">
                                {leg.liveQuote.source === "1click-live"
                                  ? `Live 1Click Quote: ~${leg.liveQuote.amountOutFormatted} ${leg.buy.symbol} ($${leg.liveQuote.amountOutUsd}, ~${leg.liveQuote.timeEstimateSec}s)`
                                  : `1Click Quote: ${leg.liveQuote.error}`}
                              </p>
                            )}
                          </div>
                          <span className="text-[11px] text-neutral-300 shrink-0">
                            {swarmResult.approved ? "✓ Ready" : "✕ Blocked"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {/* ================= HOW IT WORKS TAB ================= */}
        {activeTab === "how-it-works" && (
          <section className="max-w-7xl mx-auto px-6 py-14 space-y-12 animate-fadeInUp">
            <div className="space-y-3 max-w-2xl">
              <h2 className="text-3xl font-black text-white">How MamoruX Works</h2>
              <p className="text-sm text-neutral-400">
                From sealed private intent to trustless multi-chain settlement in 4 verifiable steps.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
              {[
                { step: "01", title: "Seal Intent Off-Chain", desc: "Users submit rebalancing intents to NEAR AI Cloud TEEs. Plaintext strategy never touches public mempools." },
                { step: "02", title: "3-Agent TEE Swarm", desc: "Strategist chunks orders, Sentinel audits for prompt injections/exploits, Matcher nets opposite dark-pool flow." },
                { step: "03", title: "MamoruVault Firewall", desc: "Rust contract verifies plan_hash, risk score <= 60, quorum >= 2, and mandatory Sentinel approval." },
                { step: "04", title: "Intents + Chain Signatures", desc: "Crosses settle between vault accounts; residuals route to 1Click solvers; native legs sign via v1.signer." },
              ].map((s) => (
                <div key={s.step} className="near-card p-6 rounded-2xl space-y-3">
                  <div className="text-xs font-mono font-bold text-[#00EC97]">STEP {s.step}</div>
                  <h3 className="text-base font-bold text-white">{s.title}</h3>
                  <p className="text-xs text-neutral-400 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ================= AI & SECURITY TAB ================= */}
        {activeTab === "models" && (
          <section className="max-w-7xl mx-auto px-6 py-14 space-y-10 animate-fadeInUp">
            <div className="space-y-3 max-w-2xl">
              <h2 className="text-3xl font-black text-white">Verifiable AI Models &amp; On-Chain Policy</h2>
              <p className="text-sm text-neutral-400">
                Hardware-attested TEE inference paired with deterministic Rust smart contract invariants.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="near-card p-6 rounded-2xl space-y-3">
                <Cpu className="w-6 h-6 text-[#00EC97]" />
                <h3 className="font-bold text-white">Strategist (DeepSeek-V3.1)</h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Deconstructs portfolio rebalances into optimal chunk sizes via <code>cloud-api.near.ai/v1</code> inside Intel TDX enclaves.
                </p>
              </div>
              <div className="near-card p-6 rounded-2xl space-y-3">
                <ShieldCheck className="w-6 h-6 text-[#17D9D4]" />
                <h3 className="font-bold text-white">Sentinel Firewall</h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Scans intent notes for prompt injection, rejects slippage &gt; 300 bps, and can trigger <code>pause()</code> in 1 block.
                </p>
              </div>
              <div className="near-card p-6 rounded-2xl space-y-3">
                <Database className="w-6 h-6 text-[#00EC97]" />
                <h3 className="font-bold text-white">Matcher Conservation</h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Mathematically audits that input intent notional strictly equals output legs within 5 bps tolerance.
                </p>
              </div>
            </div>

            <div className="near-card p-7 rounded-3xl space-y-4">
              <div className="flex items-center space-x-2 text-[#00EC97]">
                <Fingerprint className="w-5 h-5" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Enforced Contract Invariants (22 Cargo Tests)</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                <div className="p-4 rounded-xl bg-[#111111] border border-[#262626]">
                  <div className="text-[#00EC97] font-bold">max_risk_score &lt;= 60</div>
                  <div className="text-neutral-400 font-sans mt-1">Any attestation above 60 automatically marks the plan Rejected.</div>
                </div>
                <div className="p-4 rounded-xl bg-[#111111] border border-[#262626]">
                  <div className="text-[#00EC97] font-bold">require_sentinel = true</div>
                  <div className="text-neutral-400 font-sans mt-1">Matcher + Strategist cannot bypass Sentinel security sign-off.</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ================= USE CASES & SUBMIT TAB ================= */}
        {activeTab === "submit" && (
          <section className="max-w-7xl mx-auto px-6 py-14 space-y-12 animate-fadeInUp">
            <div className="space-y-3 max-w-2xl">
              <h2 className="text-3xl font-black text-white">Use Cases &amp; Hackathon Submission</h2>
              <p className="text-sm text-neutral-400">
                Submit MamoruX on{" "}
                <a
                  href="https://nearhackathon.com/#apply"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#00EC97] hover:underline inline-flex items-center space-x-1"
                >
                  <span>nearhackathon.com/#apply</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                .
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { tag: "01 / DAO TREASURIES", title: "MEV-Free Rebalancing", desc: "DAOs diversify governance tokens into stablecoins or L1s without getting sandwiched by public mempool bots." },
                { tag: "02 / HEDGE FUNDS", title: "Confidential Alpha", desc: "Trading desks rotate across BTC, ETH, and SOL without revealing strategy intent to copy-traders." },
                { tag: "03 / AI AGENTS", title: "Autonomous Clearing", desc: "AI agents settle cross-chain services through a single NEAR vault with deterministic security guardrails." },
              ].map((u, i) => (
                <div key={i} className="near-card p-6 rounded-2xl space-y-2.5">
                  <div className="text-xs font-mono font-bold text-[#00EC97]">{u.tag}</div>
                  <h3 className="text-base font-bold text-white">{u.title}</h3>
                  <p className="text-xs text-neutral-400 leading-relaxed">{u.desc}</p>
                </div>
              ))}
            </div>

            <div className="near-card p-8 rounded-3xl space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-white">Submission Checklist (nearhackathon.com/#apply)</h3>
                  <p className="text-xs text-neutral-400 mt-1">
                    Prizes are paid in NEAR directly to the NEAR Wallet Address you paste into the form.
                  </p>
                </div>
                <button
                  onClick={() => setWalletOpen(true)}
                  className="px-4 py-2 rounded-xl bg-[#00EC97] text-black text-xs font-bold hover:bg-[#17D9D4] transition"
                >
                  Get / Verify NEAR Wallet Address
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                <div className="p-4 rounded-xl bg-[#111111] border border-[#262626] flex items-center justify-between">
                  <div>
                    <div className="text-neutral-500">Project Name</div>
                    <div className="text-white font-bold mt-0.5">MamoruX</div>
                  </div>
                  <button onClick={() => copyText("MamoruX", "sub-name")} className="text-[#00EC97]">
                    {copiedKey === "sub-name" ? "Copied!" : "Copy"}
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-[#111111] border border-[#262626] flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-neutral-500">Your NEAR Wallet Address</div>
                    <div className="text-[#00EC97] font-bold mt-0.5 truncate">
                      {activeAccount || "Not connected yet — click button above"}
                    </div>
                  </div>
                  {activeAccount && (
                    <button onClick={() => copyText(activeAccount, "sub-wallet")} className="text-[#00EC97] shrink-0">
                      {copiedKey === "sub-wallet" ? "Copied!" : "Copy"}
                    </button>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-[#111111] border border-[#262626] flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-neutral-500">Repository Link</div>
                    <div className="text-white mt-0.5 truncate">https://github.com/bakarezainab/MamoruX</div>
                  </div>
                  <button
                    onClick={() => copyText("https://github.com/bakarezainab/MamoruX", "sub-repo")}
                    className="text-[#00EC97] shrink-0"
                  >
                    {copiedKey === "sub-repo" ? "Copied!" : "Copy"}
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-[#111111] border border-[#262626]">
                  <div className="text-neutral-500">Selected Tracks (5)</div>
                  <div className="text-white mt-0.5">
                    Unstoppable DeFi, Privacy &amp; Private AI, AI Swarms, AI Security &amp; Defense, Agent Economy
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ================= NEAR WALLET MODAL ================= */}
      {walletOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="near-card w-full max-w-lg rounded-3xl p-6 space-y-5 border border-[#00EC97]/40 animate-fadeInUp">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#00EC97] flex items-center justify-center text-black">
                  <Wallet className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">NEAR Wallet Inspector &amp; Generator</h3>
                  <p className="text-[11px] text-neutral-400">Verify your NEAR address or create a new one</p>
                </div>
              </div>
              <button onClick={() => setWalletOpen(false)} className="text-neutral-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center space-x-2 text-xs font-mono">
              {(["mainnet", "testnet"] as const).map((net) => (
                <button
                  key={net}
                  onClick={() => {
                    setNetwork(net);
                    if (walletInput.trim()) inspectWallet(walletInput, net);
                  }}
                  className={`flex-1 py-2 rounded-xl border transition ${
                    network === net
                      ? "bg-[#00EC97]/15 border-[#00EC97] text-[#00EC97] font-bold"
                      : "bg-[#111111] border-[#262626] text-neutral-400"
                  }`}
                >
                  NEAR {net.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono text-neutral-400">
                Paste your NEAR Wallet Address (.near, .testnet, or 64-char hex)
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  placeholder="yourname.near"
                  className="flex-1 bg-[#111111] border border-[#262626] focus:border-[#00EC97] rounded-xl px-3.5 py-2.5 text-xs font-mono text-white outline-none"
                />
                <button
                  onClick={() => inspectWallet(walletInput, network)}
                  disabled={walletLoading}
                  className="px-4 py-2.5 rounded-xl bg-[#00EC97] text-black font-bold text-xs hover:bg-[#17D9D4] transition disabled:opacity-50"
                >
                  {walletLoading ? "..." : "Verify"}
                </button>
              </div>
              {walletError && <p className="text-xs text-red-400 font-mono">{walletError}</p>}
            </div>

            {walletInfo && (
              <div className="p-4 rounded-2xl bg-[#111111] border border-[#262626] space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Active Address:</span>
                  <button
                    onClick={() => copyText(walletInfo.accountId, "modal-addr")}
                    className="text-[#00EC97] flex items-center space-x-1"
                  >
                    <span className="truncate max-w-[200px]">{walletInfo.accountId}</span>
                    {copiedKey === "modal-addr" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Balance ({walletInfo.network}):</span>
                  <span className="text-white font-bold">{walletInfo.balanceNear} NEAR</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">On-Chain Status:</span>
                  <span className={walletInfo.existsOnChain ? "text-[#00EC97]" : "text-amber-400"}>
                    {walletInfo.existsOnChain ? "Active On-Chain" : "Unfunded / Implicit"}
                  </span>
                </div>
                {walletInfo.rpcNote && <p className="text-[11px] text-neutral-400 pt-1 font-sans">{walletInfo.rpcNote}</p>}
              </div>
            )}

            <div className="border-t border-[#262626] pt-4 space-y-3">
              <button
                onClick={handleGenerateWallet}
                disabled={walletLoading}
                className="w-full py-2.5 rounded-xl bg-[#1C1C1C] hover:bg-[#262626] border border-[#2E2E2E] hover:border-[#00EC97]/50 text-xs font-bold text-white transition flex items-center justify-center space-x-2"
              >
                <Key className="w-3.5 h-3.5 text-[#00EC97]" />
                <span>Generate New NEAR Wallet Address (Ed25519)</span>
              </button>

              {generatedWallet && (
                <div className="p-3.5 rounded-xl bg-[#00EC97]/10 border border-[#00EC97]/30 space-y-2 text-[11px] font-mono">
                  <div className="text-[#00EC97] font-bold">New NEAR Wallet Address Generated!</div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-neutral-300 truncate">Address: {generatedWallet.accountId}</span>
                    <button onClick={() => copyText(generatedWallet.accountId, "gen-id")} className="text-[#00EC97] shrink-0">
                      {copiedKey === "gen-id" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-neutral-400 truncate">Private Key: {generatedWallet.privateKey}</span>
                    <button onClick={() => copyText(generatedWallet.privateKey, "gen-pk")} className="text-[#00EC97] shrink-0">
                      {copiedKey === "gen-pk" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="text-neutral-300 font-sans">{generatedWallet.note}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-[#262626] py-7 px-6 text-center text-xs text-neutral-500 font-mono">
        <p>MamoruX • Confidential AI Dark-Pool &amp; Policy Firewall • Built on NEAR Protocol (near-sdk v5)</p>
      </footer>
    </div>
  );
}
