"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import TicketCard from "./ticket-card";
import TicketRecovery from "./ticket-recovery";
import { ArrowRight, Check, Spark, Ticket, Wallet } from "./icons";
import { useWallet } from "./wallet-provider";
import { sendContractCall } from "../lib/nearWallet";
import {
  contractError,
  encodeTicket,
  formatNearAmount,
  loadTicket,
  newTicketSecret,
  saveTicket,
} from "../lib/contract";
import { ticketCommitmentHex } from "../lib/ticketCommitment.mjs";

function Notice({ notice }) {
  if (!notice) return null;
  return (
    <div className={`studio-notice studio-notice--${notice.tone}`} role="status">
      <span className="studio-notice-mark">{notice.tone === "success" ? <Check size={14} /> : "!"}</span>
      <p>{notice.text}</p>
    </div>
  );
}

export default function ReservePanel({ event, onReserved }) {
  const wallet = useWallet();
  const [config, setConfig] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [reservation, setReservation] = useState(null);
  const [reservationLoading, setReservationLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const contractId = event.contractId ?? config?.contract_id ?? null;
  const networkId = event.network ?? config?.network_id ?? "testnet";

  useEffect(() => {
    let active = true;
    fetch("/api/config", { cache: "no-store" })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (active && response.ok) setConfig(body);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!wallet.accountId || !contractId) {
      setReservation(null);
      setReservationLoading(false);
      return;
    }
    let active = true;
    setReservationLoading(true);
    fetch("/api/me/commitments", { cache: "no-store" })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (!active) return;
        if (!response.ok) {
          setReservation(null);
          return;
        }
        const item = (Array.isArray(body.items) ? body.items : []).find(
          (entry) => String(entry.reservation?.event_id) === String(event.id),
        );
        setReservation(item?.reservation ?? null);
      })
      .catch(() => {
        if (active) setReservation(null);
      })
      .finally(() => {
        if (active) setReservationLoading(false);
      });
    return () => {
      active = false;
    };
  }, [wallet.accountId, contractId, event.id]);

  useEffect(() => {
    if (!wallet.accountId || !contractId) return;
    setTicket(
      loadTicket({
        networkId,
        contractId,
        eventId: event.id,
        attendee: wallet.accountId,
      }),
    );
  }, [wallet.accountId, contractId, networkId, event.id]);

  const registrationClosed =
    event.registrationDeadline && Date.now() >= Date.parse(event.registrationDeadline);
  const checkinClosed = event.checkinClose && Date.now() > Date.parse(event.checkinClose);
  const full = event.capacity !== null && event.registered >= event.capacity;
  const open = !event.status || event.status === "Open";
  const canRecover = open && !reservation?.checked_in && !checkinClosed;
  const recoveryNote = reservation?.checked_in
    ? "This wallet is already checked in. No ticket is needed; claim the settlement after the event ends."
    : !open
      ? "This event is closed. Ticket recovery is no longer available."
      : checkinClosed
        ? "The onchain check-in window has closed. This reservation can no longer be checked in."
        : "The reservation is onchain and belongs to this wallet. Restore a new secret; the old QR/code stops working immediately.";
  const canReserve =
    open &&
    !registrationClosed &&
    !full &&
    !reservation &&
    !reservationLoading &&
    wallet.phase === "signedIn" &&
    Boolean(contractId) &&
    Boolean(event.deposit);

  const finalized = event.status === "Finalized";
  const belowFloor =
    finalized && Number(event.checkedIn) * 5 < Number(event.registered);
  const refundsEveryone = event.status === "Cancelled" || event.status === "Failed" || belowFloor;
  const canClaim =
    reservation &&
    reservation.claim === "Unclaimed" &&
    (refundsEveryone || (finalized && reservation.checked_in)) &&
    wallet.phase === "signedIn" &&
    Boolean(contractId);

  async function claimSettlement() {
    setNotice(null);
    setBusy(true);
    try {
      await sendContractCall({
        contractId,
        methodName: "claim_settlement",
        args: { event_id: event.id },
        deposit: "0",
        gas: "150000000000000",
        expectedAccount: wallet.accountId,
      });
      setReservation((current) => (current ? { ...current, claim: "Pending" } : current));
      setNotice({
        tone: "success",
        text: refundsEveryone
          ? "Refund submitted. The transfer callback marks this reservation claimed."
          : "Claim submitted. The transfer callback marks this reservation claimed.",
      });
    } catch (error) {
      setNotice({ tone: "error", text: contractError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function reserve() {
    setNotice(null);
    if (wallet.phase !== "signedIn" || !wallet.accountId) {
      setNotice({ tone: "error", text: "Connect a NEAR Testnet wallet first." });
      return;
    }
    if (!contractId || !event.deposit) {
      setNotice({ tone: "error", text: "The contract terms are not available, so no deposit can be sent." });
      return;
    }

    setBusy(true);
    try {
      const secret = newTicketSecret();
      const commitment = await ticketCommitmentHex({
        networkId,
        contractId,
        eventId: event.id,
        attendee: wallet.accountId,
        secret,
      });
      const commitmentArray = Array.from({ length: 32 }, (_, index) =>
        Number.parseInt(commitment.slice(index * 2, index * 2 + 2), 16),
      );
      const call = await sendContractCall({
        contractId,
        methodName: "register",
        args: {
          event_id: event.id,
          ticket_commitment: commitmentArray,
        },
        deposit: String(event.deposit),
        gas: "100000000000000",
        expectedAccount: wallet.accountId,
      });

      const next = {
        v: 1,
        networkId,
        contractId,
        eventId: String(event.id),
        attendee: wallet.accountId,
        secret,
        code: "",
        title: event.title,
        deposit: String(event.deposit),
        txHash: call.hash,
        createdAt: new Date().toISOString(),
      };
      // Store the secret exactly once, after the reservation is confirmed.
      next.code = encodeTicket(next);
      saveTicket(next);
      setTicket(next);
      setReservation({ event_id: String(event.id), checked_in: false });
      setNotice({
        tone: "success",
        text: `Reserved with ${formatNearAmount(event.deposit)}. Your one-time ticket is below.`,
      });
      onReserved?.();
    } catch (error) {
      setNotice({ tone: "error", text: contractError(error) });
    } finally {
      setBusy(false);
    }
  }

  if (ticket) {
    return (
      <section className="reserve-panel" id="reserve">
        <div className="reserve-head">
          <div>
            <p className="eyebrow">Your reservation</p>
            <h2>You are in the room.</h2>
          </div>
          <span className="status-badge status-badge--live">
            <Check size={13} />
            On chain
          </span>
        </div>
        <TicketCard ticket={ticket} compact checkedIn={Boolean(reservation?.checked_in)} />
        {canClaim ? (
          <button
            type="button"
            className="button button-lime button-full"
            onClick={claimSettlement}
            disabled={busy}
          >
            {busy ? "Submitting claim…" : refundsEveryone ? "Claim full refund" : "Claim settlement"}
          </button>
        ) : null}
        <Notice notice={notice} />
        <p className="reserve-footnote">
          The QR/code is stored in this browser. It is not in the URL and the contract never stores
          the secret itself. If this browser is lost, use My commitments to restore the ticket with
          the same wallet.
        </p>
      </section>
    );
  }

  if (reservation) {
    return (
      <section className="reserve-panel" id="reserve">
        <div className="reserve-head">
          <div>
            <p className="eyebrow">Your reservation is onchain</p>
            <h2>{reservation.checked_in ? "Already checked in." : "The ticket needs a restore."}</h2>
          </div>
          <span className="status-badge status-badge--live">
            <Check size={13} />
            {reservation.checked_in ? "Checked in" : "Reserved"}
          </span>
        </div>
        <TicketRecovery
          config={config}
          eventId={event.id}
          accountId={wallet.accountId}
          title={event.title}
          deposit={reservation.deposit}
          canRecover={canRecover}
          note={recoveryNote}
          onRecovered={(next) => setTicket(next)}
        />
        <p className="reserve-footnote">
          Recovery is a real <code>rotate_ticket_commitment</code> transaction signed by this
          wallet. It changes only the ticket secret; the deposit and reservation stay onchain.
        </p>
        {canClaim ? (
          <button
            type="button"
            className="button button-lime button-full"
            onClick={claimSettlement}
            disabled={busy}
          >
            {busy ? "Submitting claim…" : refundsEveryone ? "Claim full refund" : "Claim settlement"}
          </button>
        ) : null}
        <Notice notice={notice} />
        <Link href="/commitments" className="text-link">
          Open my commitments
          <ArrowRight size={14} />
        </Link>
      </section>
    );
  }

  return (
    <section className="reserve-panel" id="reserve">
      <div className="reserve-head">
        <div>
          <p className="eyebrow">The commitment</p>
          <h2>Reserve your seat.</h2>
        </div>
        <Ticket size={22} />
      </div>

      <p className="reserve-copy">
        The contract will hold exactly <strong>{formatNearAmount(event.deposit)}</strong> until
        the event settles. Show up and check in to claim it back plus your share of the no-show
        pool.
      </p>

      {!open ? (
        <p className="reserve-closed">Registration is closed because the event is {String(event.status).toLowerCase()}.</p>
      ) : registrationClosed ? (
        <p className="reserve-closed">The registration deadline has passed.</p>
      ) : full ? (
        <p className="reserve-closed">This room is full.</p>
      ) : reservationLoading ? (
        <button type="button" className="button button-lime button-full" disabled>
          <Ticket size={16} />
          Checking your reservation…
        </button>
      ) : wallet.phase !== "signedIn" ? (
        <button
          type="button"
          className="button button-lime button-full"
          onClick={wallet.connect}
          disabled={wallet.busy !== null || wallet.phase === "loading" || wallet.phase === "unavailable"}
        >
          <Wallet size={16} />
          {wallet.busy === "connect" ? "Waiting for wallet…" : "Connect wallet to reserve"}
        </button>
      ) : (
        <button
          type="button"
          className="button button-lime button-full"
          onClick={reserve}
          disabled={busy || !canReserve}
        >
          <Spark size={16} />
          {busy ? "Waiting for wallet…" : `Reserve for ${formatNearAmount(event.deposit)}`}
        </button>
      )}

      <Notice notice={notice} />

      <p className="reserve-footnote">
        No card. No platform balance. The wallet signs one <code>register</code> transaction with
        the exact deposit. The organizer checks the one-time ticket in after registration closes.
      </p>
      <Link href="/commitments" className="text-link">
        Open my commitments
        <ArrowRight size={14} />
      </Link>
    </section>
  );
}
