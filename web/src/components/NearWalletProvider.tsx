"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { setupWalletSelector, type WalletSelector, type AccountState } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { actionCreators } from "@near-js/transactions";
import "@near-wallet-selector/modal-ui/styles.css";

export type NearNetwork = "mainnet" | "testnet";

interface NearWalletContextValue {
  network: NearNetwork;
  setNetwork: (net: NearNetwork) => void;
  connectedAccountId: string | null;
  walletName: string | null;
  selectorReady: boolean;
  openConnectModal: () => void;
  disconnectWallet: () => Promise<void>;
  signIntentMessage: (message: string) => Promise<{
    accountId: string;
    publicKey: string;
    signature: string;
  }>;
  sendFunctionCall: (params: {
    receiverId: string;
    methodName: string;
    args: Record<string, unknown>;
    gas?: string;
    depositYocto?: string;
  }) => Promise<{ txHash: string; explorerUrl: string }>;
}

const NearWalletContext = createContext<NearWalletContextValue | null>(null);

export function NearWalletProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetwork] = useState<NearNetwork>("mainnet");
  const [connectedAccountId, setConnectedAccountId] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [selectorReady, setSelectorReady] = useState(false);

  const selectorRef = useRef<WalletSelector | null>(null);
  const modalRef = useRef<WalletSelectorModal | null>(null);

  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | null = null;

    async function init() {
      setSelectorReady(false);
      try {
        const selector = await setupWalletSelector({
          network,
          modules: [
            setupMeteorWallet(),
            setupMyNearWallet(),
            setupHereWallet(),
          ],
        });

        const modal = setupModal(selector, {
          theme: "dark",
          description: "Connect your NEAR wallet (0 NEAR gas required for sign-in & NEP-413 signatures)",
        });

        if (!active) return;
        selectorRef.current = selector;
        modalRef.current = modal;

        const updateFromAccounts = async (accounts: AccountState[]) => {
          const acc = accounts.find((a) => a.active) || accounts[0] || null;
          setConnectedAccountId(acc ? acc.accountId : null);
          if (acc && selector.isSignedIn()) {
            try {
              const w = await selector.wallet();
              setWalletName(w.metadata.name);
            } catch {
              setWalletName("NEAR Wallet");
            }
          } else {
            setWalletName(null);
          }
        };

        await updateFromAccounts(selector.store.getState().accounts);
        subscription = selector.store.observable.subscribe((state) => {
          void updateFromAccounts(state.accounts);
        });
        setSelectorReady(true);
      } catch (err) {
        console.error("Failed to initialize NEAR Wallet Selector:", err);
        if (active) setSelectorReady(true);
      }
    }

    void init();

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [network]);

  const openConnectModal = useCallback(() => {
    modalRef.current?.show();
  }, []);

  const disconnectWallet = useCallback(async () => {
    const selector = selectorRef.current;
    if (!selector) return;
    const wallet = await selector.wallet();
    await wallet.signOut();
    setConnectedAccountId(null);
    setWalletName(null);
  }, []);

  const signIntentMessage = useCallback(async (message: string) => {
    const selector = selectorRef.current;
    if (!selector || !selector.isSignedIn()) {
      throw new Error("Connect your NEAR wallet first using Meteor, MyNearWallet, or HERE Wallet.");
    }
    const wallet = await selector.wallet();
    if (!wallet.signMessage) {
      throw new Error(`${wallet.metadata.name} does not support NEP-413 signMessage.`);
    }
    const nonceBytes = new Uint8Array(32);
    crypto.getRandomValues(nonceBytes);
    const signed = await wallet.signMessage({
      message,
      recipient: network === "mainnet" ? "mamorux.near" : "mamorux.testnet",
      nonce: nonceBytes as unknown as Buffer,
    });
    if (!signed) {
      throw new Error("Message signing was cancelled or returned no signature.");
    }
    return {
      accountId: signed.accountId,
      publicKey: signed.publicKey,
      signature: signed.signature,
    };
  }, [network]);

  const sendFunctionCall = useCallback(
    async ({
      receiverId,
      methodName,
      args,
      gas = "30000000000000",
      depositYocto = "0",
    }: {
      receiverId: string;
      methodName: string;
      args: Record<string, unknown>;
      gas?: string;
      depositYocto?: string;
    }) => {
      const selector = selectorRef.current;
      if (!selector || !selector.isSignedIn()) {
        throw new Error("Connect your NEAR wallet first to sign and send a transaction.");
      }
      const wallet = await selector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        receiverId,
        actions: [
          actionCreators.functionCall(
            methodName,
            args,
            BigInt(gas),
            BigInt(depositYocto)
          ),
        ],
      });
      const txHash =
        typeof outcome === "object" && outcome && "transaction" in outcome
          ? (outcome.transaction as { hash: string }).hash
          : "";
      const explorerBase =
        network === "mainnet" ? "https://nearblocks.io/txns/" : "https://testnet.nearblocks.io/txns/";
      return {
        txHash,
        explorerUrl: txHash ? `${explorerBase}${txHash}` : explorerBase,
      };
    },
    [network]
  );

  return (
    <NearWalletContext.Provider
      value={{
        network,
        setNetwork,
        connectedAccountId,
        walletName,
        selectorReady,
        openConnectModal,
        disconnectWallet,
        signIntentMessage,
        sendFunctionCall,
      }}
    >
      {children}
    </NearWalletContext.Provider>
  );
}

export function useNearWallet() {
  const ctx = useContext(NearWalletContext);
  if (!ctx) {
    throw new Error("useNearWallet must be used inside NearWalletProvider");
  }
  return ctx;
}
