"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { connectNearWallet, disconnectNearWallet } from "../lib/nearWallet";

const WalletContext = createContext(null);

const AUTH_ERROR_COPY = {
  auth_not_configured:
    "Wallet sign-in is not configured on this deployment. Set GATHERBOND_SESSION_SECRET and restart the app.",
  full_access_key_required:
    "This wallet offered a function-call key, but NEP-413 sign-in requires a full-access key.",
  unknown_public_key:
    "NEAR could not confirm that key belongs to the selected account. Try another account or wallet.",
  invalid_recipient:
    "The wallet signed a different application recipient. Check GATHERBOND_AUTH_RECIPIENT on the server and retry.",
  auth_chain_unavailable:
    "NEAR Testnet could not verify the access key right now. Nothing was changed; try again shortly.",
  nonce_already_used:
    "That signature was already used. Connect again to create a fresh one.",
  auth_store_unavailable:
    "The server could not record the one-time nonce, so no session was created.",
  invalid_signature:
    "The wallet signature did not verify. Nothing was changed.",
  session_logout_failed:
    "The server could not clear the session cookie. You are still signed in.",
  wallet_login_failed:
    "Wallet sign-in failed. Nothing was sent on-chain.",
};

function copyFor(error) {
  const code = error instanceof Error ? error.message : String(error ?? "");
  if (AUTH_ERROR_COPY[code]) {
    return AUTH_ERROR_COPY[code];
  }
  if (/reject|cancel|denied/i.test(code)) {
    return "Wallet request cancelled. Nothing was signed or changed.";
  }
  if (/failed to fetch|networkerror|network request/i.test(code)) {
    return "The wallet session service could not be reached. Nothing was changed.";
  }
  if (/failed to load|connector|manifest/i.test(code)) {
    return "The NEAR wallet connector could not load. Check your connection and try again.";
  }
  return AUTH_ERROR_COPY.wallet_login_failed;
}

async function readSession() {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  const configured = body.configured === true;
  const recipient = typeof body.recipient === "string" ? body.recipient : null;
  if (response.ok && typeof body.account_id === "string" && body.account_id.length > 0) {
    return { phase: "signedIn", accountId: body.account_id, configured, recipient };
  }
  if (response.status === 503 || !configured) {
    return { phase: "unavailable", accountId: null, configured: false, recipient };
  }
  return { phase: "signedOut", accountId: null, configured: true, recipient };
}

export function WalletProvider({ children }) {
  const [session, setSession] = useState({
    phase: "loading",
    accountId: null,
    configured: false,
    recipient: null,
  });
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let active = true;
    readSession()
      .then((next) => {
        if (active) {
          setSession(next);
        }
      })
      .catch(() => {
        if (active) {
          setSession({
            phase: "error",
            accountId: null,
            configured: false,
            recipient: null,
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const connect = useCallback(async () => {
    if (busy) {
      return;
    }
    if (!session.recipient) {
      setNotice({
        tone: "error",
        text: "Wallet sign-in is not configured. The server did not publish an auth recipient.",
      });
      return;
    }

    setBusy("connect");
    setNotice(null);
    try {
      const body = await connectNearWallet({ recipient: session.recipient });
      const response = await fetch("/api/auth/session", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "wallet_login_failed");
      }
      if (!payload.account_id) {
        throw new Error("wallet_login_failed");
      }
      setSession({
        phase: "signedIn",
        accountId: payload.account_id,
        configured: true,
        recipient: session.recipient,
      });
      setNotice({
        tone: "success",
        text: `Wallet session verified for ${payload.account_id}.`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: copyFor(error) });
    } finally {
      setBusy(null);
    }
  }, [busy, session.recipient]);

  const disconnect = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy("disconnect");
    setNotice(null);
    try {
      const response = await fetch("/api/auth/session", {
        method: "DELETE",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("session_logout_failed");
      }
      await disconnectNearWallet();
      setSession((current) => ({
        ...current,
        phase: "signedOut",
        accountId: null,
      }));
      setNotice({
        tone: "success",
        text: "Signed out of GatherBond. Your wallet remains in your browser.",
      });
    } catch (error) {
      setNotice({ tone: "error", text: copyFor(error) });
    } finally {
      setBusy(null);
    }
  }, [busy]);

  const value = useMemo(
    () => ({
      ...session,
      busy,
      notice,
      connect,
      disconnect,
      dismissNotice: () => setNotice(null),
    }),
    [session, busy, notice, connect, disconnect],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {notice ? (
        <div
          className={`wallet-notice wallet-notice--${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          <p>{notice.text}</p>
          <button type="button" onClick={value.dismissNotice} aria-label="Dismiss wallet message">
            ×
          </button>
        </div>
      ) : null}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error("useWallet must be used inside WalletProvider");
  }
  return value;
}
