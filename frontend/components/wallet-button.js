"use client";

import { Wallet } from "./icons";
import { useWallet } from "./wallet-provider";
import { shortAccount } from "../lib/events";

export default function WalletButton() {
  const { phase, accountId, busy, connect, disconnect } = useWallet();

  if (phase === "loading") {
    return (
      <span className="wallet-connect wallet-connect--idle" aria-live="polite">
        <Wallet size={14} />
        Checking wallet
      </span>
    );
  }

  if (phase === "signedIn" && accountId) {
    return (
      <span className="wallet-connected">
        <span className="wallet-connected-account" title={accountId}>
          <Wallet size={14} />
          {shortAccount(accountId)}
        </span>
        <button
          type="button"
          className="wallet-signout"
          onClick={disconnect}
          disabled={busy !== null}
        >
          {busy === "disconnect" ? "Signing out…" : "Sign out"}
        </button>
      </span>
    );
  }

  const unavailable = phase === "unavailable";
  return (
    <button
      type="button"
      className="wallet-connect"
      onClick={connect}
      disabled={unavailable || busy !== null}
      title={
        unavailable
          ? "Wallet sessions are not configured on this deployment"
          : "Connect a NEAR Testnet wallet and sign a NEP-413 message"
      }
    >
      <Wallet size={14} />
      {busy === "connect"
        ? "Waiting for wallet…"
        : unavailable
          ? "Wallet auth unavailable"
          : phase === "error"
            ? "Retry wallet"
            : "Connect wallet"}
    </button>
  );
}
