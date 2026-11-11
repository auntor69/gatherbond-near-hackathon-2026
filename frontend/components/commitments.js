"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import SettlementReceipt from "./settlement-receipt";
import TicketCard from "./ticket-card";
import { ArrowRight, Check, ShieldCheck, Ticket, Wallet } from "./icons";
import { useWallet } from "./wallet-provider";
import { sendContractCall } from "../lib/nearWallet";
import {
  contractError,
  formatNearAmount,
  loadTicket,
} from "../lib/contract";

function json(response) {
  return response.json().catch(() => ({}));
}

function nanosDate(value) {
  try {
    return new Date(Number(BigInt(String(value)) / 1_000_000n)).toISOString();
  } catch {
    return null;
  }
}

const CLAIM_LABEL = {
  Unclaimed: "Unclaimed",
  Pending: "Claim pending",
  Claimed: "Claimed",
};

function statusCopy(item) {
  const reservation = item.reservation;
  const event = item.onchain;
  if (!event) return "Contract state unavailable";
  if (reservation.claim === "Claimed") return "Settlement claimed";
  if (reservation.claim === "Pending") return "Transfer in flight";
  if (event.status === "Finalized") {
    return reservation.checked_in ? "Checked in · claim available" : "No-show · no refund";
  }
  if (event.status === "Cancelled") return "Cancelled · refund available";
  if (reservation.checked_in) return "Checked in";
  return "Reserved";
}

export default function Commitments() {
  const wallet = useWallet();
  const [config, setConfig] = useState(null);
  const [items, setItems] = useState([]);
  const [state, setState] = useState("signedOut");
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let active = true;
    fetch("/api/config", { cache: "no-store" })
      .then(json)
      .then((body) => active && body.contract_id && setConfig(body))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (wallet.phase !== "signedIn") {
      setState("signedOut");
      setItems([]);
      return;
    }
    setState("loading");
    try {
      const response = await fetch("/api/me/commitments", { cache: "no-store" });
      const body = await json(response);
      if (!response.ok) {
        setState(body.error === "contract_not_configured" ? "unavailable" : "error");
        setItems([]);
        return;
      }
      const next = await Promise.all(
        (Array.isArray(body.items) ? body.items : []).map(async (item) => {
          const eventId = String(item.reservation?.event_id ?? "");
          let title = `Event ${eventId}`;
          try {
            const detail = await fetch(`/api/events/${encodeURIComponent(eventId)}`, {
              cache: "no-store",
            });
            const detailBody = await json(detail);
            if (detail.ok && detailBody.metadata?.title) title = detailBody.metadata.title;
          } catch {
            // The contract reservation is still shown without a public metadata title.
          }
          const ticket =
            config?.contract_id && wallet.accountId
              ? loadTicket({
                  networkId: config.network_id,
                  contractId: config.contract_id,
                  eventId,
                  attendee: wallet.accountId,
                })
              : null;
          return { ...item, eventId, title, ticket };
        }),
      );
      setItems(next);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [wallet.phase, wallet.accountId, config]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action, item) {
    setNotice(null);
    if (wallet.phase !== "signedIn") {
      setNotice({ tone: "error", text: "Connect your wallet first." });
      return;
    }
    setBusy(`${action}-${item.eventId}`);
    try {
      const contractId = config?.contract_id;
      if (!contractId) throw new Error("The contract is not configured on this deployment.");
      await sendContractCall({
        contractId,
        methodName: action === "claim" ? "claim_settlement" : "finalize_event",
        args: { event_id: item.eventId },
        deposit: "0",
        gas: action === "claim" ? "150000000000000" : "100000000000000",
        expectedAccount: wallet.accountId,
      });
      setNotice({
        tone: "success",
        text:
          action === "claim"
            ? `Claim submitted for event ${item.eventId}. The transfer callback marks it claimed.`
            : `Event ${item.eventId} finalized.`,
      });
      window.setTimeout(load, 4500);
    } catch (error) {
      setNotice({ tone: "error", text: contractError(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="page page--commitments">
      <section className="commitments-hero">
        <div className="shell commitments-hero-grid">
          <div>
            <p className="eyebrow">My commitments / attendee side</p>
            <h1>
              Plans are easy.
              <br />
              <em>Showing up is the point.</em>
            </h1>
            <p className="commitments-lede">
              These rows come from <code>get_reservations_for_account</code> on the configured
              NEAR Testnet contract. Nothing is invented locally: if the contract has no
              reservation for this account, this page is empty.
            </p>
            <div className="hero-actions">
              <Link href="/#discover" className="button button-dark">
                Find a room
                <ArrowRight size={16} />
              </Link>
              {wallet.phase !== "signedIn" ? (
                <button
                  type="button"
                  className="button button-lime"
                  onClick={wallet.connect}
                  disabled={wallet.busy !== null || wallet.phase === "loading" || wallet.phase === "unavailable"}
                >
                  <Wallet size={16} />
                  {wallet.busy === "connect" ? "Waiting for wallet…" : "Connect wallet"}
                </button>
              ) : null}
            </div>
          </div>

          <aside className="commitment-summary">
            <div>
              <Ticket size={22} />
              <span>On-chain reservations</span>
              <strong>{state === "ready" ? items.length : "—"}</strong>
            </div>
            <p>
              Ticket secrets stay in this browser. The contract stores only the commitment, so a
              lost browser cannot be reconstructed from the chain.
            </p>
          </aside>
        </div>
      </section>

      <section className="section commitments-body">
        <div className="shell">
          {notice ? (
            <div className={`studio-notice studio-notice--${notice.tone}`} role="status">
              <span className="studio-notice-mark">{notice.tone === "success" ? <Check size={14} /> : "!"}</span>
              <p>{notice.text}</p>
            </div>
          ) : null}

          {state === "signedOut" ? (
            <div className="empty-panel">
              <span className="empty-panel-icon">
                <Wallet size={28} />
              </span>
              <p className="eyebrow">Wallet required</p>
              <h2>Connect to read your commitments.</h2>
              <p>
                Reservations are read for the account proved by your NEP-413 session. No account
                id is accepted from the URL or a form.
              </p>
            </div>
          ) : null}

          {state === "loading" ? (
            <div className="empty-panel">
              <span className="loading-mark">GB</span>
              <h2>Reading the contract.</h2>
              <p>Fetching reservations for your signed-in account from NEAR Testnet.</p>
            </div>
          ) : null}

          {state === "unavailable" ? (
            <div className="empty-panel">
              <span className="empty-panel-icon">!</span>
              <h2>The contract is not configured.</h2>
              <p>
                Set <code>CONTRACT_NAME</code> on the server to the deployed GatherBond contract.
                The page will not substitute local or sample rows.
              </p>
            </div>
          ) : null}

          {state === "error" ? (
            <div className="empty-panel">
              <span className="empty-panel-icon">!</span>
              <h2>The contract read failed.</h2>
              <p>NEAR RPC did not return your reservations. Nothing was changed.</p>
              <button type="button" className="button button-dark" onClick={load}>
                Retry read
              </button>
            </div>
          ) : null}

          {state === "ready" && items.length === 0 ? (
            <div className="empty-panel">
              <span className="empty-panel-icon">
                <Ticket size={28} />
              </span>
              <p className="eyebrow">The honest empty state</p>
              <h2>No commitments yet.</h2>
              <p>
                Reserve a seat on an event page. The exact deposit is sent to the contract, and the
                reservation appears here after the transaction is confirmed.
              </p>
              <Link href="/#discover" className="button button-dark">
                Browse the shelf
                <ArrowRight size={16} />
              </Link>
            </div>
          ) : null}

          {state === "ready" && items.length > 0 ? (
            <div className="commitments-list">
              {items.map((item) => {
                const event = item.onchain;
                const reservation = item.reservation;
                const ended = event?.end_at && Date.now() >= Date.parse(nanosDate(event.end_at));
                const canClaim =
                  event &&
                  reservation.claim === "Unclaimed" &&
                  (event.status === "Cancelled" ||
                    (event.status === "Finalized" && reservation.checked_in));
                return (
                  <article className="commitment-card" key={item.eventId}>
                    <div className="commitment-card-head">
                      <div>
                        <p className="eyebrow">Reservation / event {item.eventId}</p>
                        <h2>{item.title}</h2>
                      </div>
                      <span className="status-badge">{statusCopy(item)}</span>
                    </div>

                    <div className="commitment-facts">
                      <div>
                        <span>Deposit</span>
                        <strong>{formatNearAmount(reservation.deposit)}</strong>
                      </div>
                      <div>
                        <span>Claim</span>
                        <strong>
                          {event?.status === "Finalized" && !reservation.checked_in
                            ? "No refund"
                            : CLAIM_LABEL[reservation.claim] ?? reservation.claim ?? "—"}
                        </strong>
                      </div>
                      <div>
                        <span>Checked in</span>
                        <strong>{reservation.checked_in ? "Yes" : "No"}</strong>
                      </div>
                      <div>
                        <span>Event status</span>
                        <strong>{event?.status ?? "Unavailable"}</strong>
                      </div>
                    </div>

                    {item.ticket ? <TicketCard ticket={item.ticket} compact /> : (
                      <p className="commitment-warning">
                        The ticket secret is not in this browser. The reservation is still on chain,
                        but check-in needs the original ticket code.
                      </p>
                    )}

                    <SettlementReceipt
                      event={event}
                      reservation={reservation}
                      eventId={item.eventId}
                      title={item.title}
                    />

                    <div className="action-row">
                      {canClaim ? (
                        <button
                          type="button"
                          className="button button-dark button-small"
                          onClick={() => run("claim", item)}
                          disabled={busy !== null}
                        >
                          <ShieldCheck size={14} />
                          {busy === `claim-${item.eventId}` ? "Submitting claim…" : "Claim settlement"}
                        </button>
                      ) : null}
                      {event?.status === "Open" && ended ? (
                        <button
                          type="button"
                          className="button button-ghost button-small"
                          onClick={() => run("finalize", item)}
                          disabled={busy !== null}
                        >
                          {busy === `finalize-${item.eventId}` ? "Finalizing…" : "Finalize event"}
                        </button>
                      ) : null}
                      <Link href={`/events/${item.eventId}`} className="text-link">
                        Open event <ArrowRight size={14} />
                      </Link>
                      {event && event.status !== "Open" ? (
                        <Link href={`/events/${item.eventId}/recap`} className="text-link">
                          Open recap <ArrowRight size={14} />
                        </Link>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}

          <aside className="commitments-aside">
            <div className="commitments-aside-head">
              <ShieldCheck size={20} />
              <h3>No invented balances</h3>
            </div>
            <p>
              This page reads the contract for the signed-in account. A failed RPC call is shown as
              a failure, never replaced with a plausible row.
            </p>
            <div className="commitments-rule" />
            <div className="commitments-aside-row">
              <Check size={15} />
              Contract state, not local storage
            </div>
            <div className="commitments-aside-row">
              <Check size={15} />
              Ticket secret never in a URL
            </div>
            <div className="commitments-aside-row">
              <Check size={15} />
              Claims are individual pull withdrawals
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
