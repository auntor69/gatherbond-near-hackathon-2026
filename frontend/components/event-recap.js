"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import FlakeFund from "./flake-fund";
import {
  ArrowRight,
  ArrowUpRight,
  Calendar,
  Check,
  Copy,
  MapPin,
  ShieldCheck,
  Ticket,
} from "./icons";
import { formatNearAmount } from "../lib/contract";
import {
  eventWhenLabel,
  formatDate,
  mapDetail,
  shortHash,
} from "../lib/events";
import {
  flakeFundSummary,
  formatShowUpRate,
} from "../lib/flakeFund";

function StatePanel({ kicker, title, copy, children }) {
  return (
    <main className="state-page">
      <div className="state-card">
        <p className="eyebrow">{kicker}</p>
        <h1>{title}</h1>
        <p>{copy}</p>
        {children}
      </div>
    </main>
  );
}

function RecapStat({ label, value, detail }) {
  return (
    <div className="recap-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export default function EventRecap({ id }) {
  const [state, setState] = useState({ status: "loading", event: null });
  const [shareLabel, setShareLabel] = useState("Share recap");

  useEffect(() => {
    let active = true;
    setState({ status: "loading", event: null });

    async function load() {
      try {
        const response = await fetch(`/api/events/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!active) {
          return;
        }
        if (response.ok && body.verified) {
          setState({ status: "ready", event: mapDetail(body) });
          return;
        }
        if (response.status === 404) {
          setState({ status: "notfound", event: null, error: body.error });
          return;
        }
        setState({
          status: response.status === 503 ? "unavailable" : "error",
          event: null,
          error: body.error,
          httpStatus: response.status,
        });
      } catch {
        if (active) {
          setState({ status: "unavailable", event: null, error: "network_error" });
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [id]);

  const summary = useMemo(
    () =>
      state.status === "ready"
        ? flakeFundSummary({
            deposit: state.event.deposit,
            registered: state.event.registered,
            checkedIn: state.event.checkedIn,
            status: state.event.status,
          })
        : null,
    [state],
  );

  if (state.status === "loading") {
    return (
      <main className="state-page">
        <div className="state-card">
          <span className="loading-mark" aria-hidden="true">
            GB
          </span>
          <p className="eyebrow">Room proof</p>
          <h1>Reading the room.</h1>
          <p>Checking the verified publication, the contract counts and the settlement snapshot.</p>
        </div>
      </main>
    );
  }

  if (state.status === "notfound") {
    return (
      <StatePanel
        kicker="404 — no recap"
        title="This room has no public proof."
        copy="There is no verified publication at this address, or the organizer has not published it."
      >
        <Link href="/#discover" className="button button-dark">
          Back to discover
          <ArrowRight size={16} />
        </Link>
      </StatePanel>
    );
  }

  if (state.status === "error" || state.status === "unavailable") {
    return (
      <StatePanel
        kicker={state.status === "unavailable" ? "Temporarily offline" : "Proof unavailable"}
        title={state.status === "unavailable" ? "The room is resting." : "The proof did not load."}
        copy={
          state.error === "metadata_store_unavailable"
            ? "The metadata store is offline, so the public proof cannot be verified right now."
            : state.error === "chain_unavailable"
              ? "NEAR RPC is unavailable right now, so contract state cannot be read."
              : "The recap could not be loaded. Nothing has been shown as verified."
        }
      >
        <Link href={`/events/${encodeURIComponent(id)}`} className="button button-dark">
          Back to event
          <ArrowRight size={16} />
        </Link>
      </StatePanel>
    );
  }

  const event = state.event;
  const finalized = event.status === "Finalized";
  const cancelled = event.status === "Cancelled";
  const shareUrl =
    typeof window === "undefined" ? "" : window.location.href;
  const explorerBase =
    event.network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
  const contractUrl = event.contractId
    ? `${explorerBase}/address/${encodeURIComponent(event.contractId)}`
    : null;
  const txUrl = event.createTxHash
    ? `${explorerBase}/txns/${encodeURIComponent(event.createTxHash)}`
    : null;

  async function shareRecap() {
    const text = finalized
      ? event.registered === 0
        ? `${event.title} finalized with no reservations on GatherBond.`
        : event.checkedIn === 0
          ? `No one showed up to ${event.title}. The ${formatNearAmount(summary?.pool ?? 0n)} pool accrued to treasury under the contract rule.`
          : event.checkedIn === event.registered
            ? `Everyone who reserved showed up to ${event.title}. There was no flake pool; every deposit was returned in full.`
            : `${event.checkedIn} of ${event.registered} showed up to ${event.title}. The flakes funded ${formatNearAmount(summary?.pool ?? 0n)}.`
      : cancelled
        ? event.registered === 0
          ? `${event.title} on GatherBond was cancelled before anyone reserved.`
          : `${event.title} on GatherBond was cancelled. ${event.registered} reservation${event.registered === 1 ? "" : "s"} can claim a full refund.`
        : `${event.title} on GatherBond — ${event.registered} reserved, ${event.checkedIn} checked in.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${event.title} — GatherBond recap`, text, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${shareUrl}`);
      setShareLabel("Recap copied");
      window.setTimeout(() => setShareLabel("Share recap"), 1800);
    } catch (error) {
      if (error?.name !== "AbortError") {
        setShareLabel("Copy failed");
        window.setTimeout(() => setShareLabel("Share recap"), 1800);
      }
    }
  }

  const noReservations = finalized && event.registered === 0;
  const noAttendees = finalized && event.registered > 0 && event.checkedIn === 0;
  const allShowed = finalized && event.registered > 0 && event.checkedIn === event.registered;
  const cancelledEmpty = cancelled && event.registered === 0;

  const headline = cancelled
    ? "The room was cancelled."
    : noReservations
      ? "The room closed empty."
      : noAttendees
        ? "No one showed up."
        : finalized
          ? "The room showed up."
          : "The room is still open.";

  const lede = cancelled
    ? cancelledEmpty
      ? "The event was cancelled before anyone reserved. There is no deposit to refund and no pool."
      : "Every registered attendee can claim the full deposit. No no-show pool is distributed."
    : noReservations
      ? "The event finalized without reservations, so there was no pool and no settlement."
      : noAttendees
        ? "No one checked in. The contract fixed no attendee reward, and the pool remainder accrued to treasury."
        : allShowed
          ? "Everyone who reserved showed up. There was no no-show pool, so every deposit was returned in full."
          : finalized
            ? "The contract counted the room, fixed the reward and left a public receipt. The flakes funded the people who showed up."
            : "The recap becomes final when the organizer finalizes after the event ends. These are live contract counts, not a promise.";

  return (
    <main className="recap-page">
      <section className="recap-hero">
        <div className="shell">
          <Link href={`/events/${encodeURIComponent(event.id)}`} className="back-link">
            <ArrowRight size={15} />
            Back to event
          </Link>

          <div className="recap-heading">
            <div>
              <p className="eyebrow">Room proof / NEAR Testnet</p>
              <h1 className="recap-title">{headline}</h1>
              <p className="recap-lede">{lede}</p>
            </div>
            <div className="recap-actions">
              <button type="button" className="button button-dark" onClick={shareRecap}>
                <Copy size={16} />
                {shareLabel}
              </button>
              <Link
                href={`/events/${encodeURIComponent(event.id)}`}
                className="button button-ghost"
              >
                <Ticket size={16} />
                Open event
              </Link>
            </div>
          </div>

          <div className="recap-event-line">
            <span>{event.title}</span>
            <span>
              <Calendar size={14} />
              {eventWhenLabel(event)}
            </span>
            <span>
              <MapPin size={14} />
              {event.venue}
            </span>
            <span className="status-badge">{event.status}</span>
          </div>
        </div>
      </section>

      <section className="section recap-body">
        <div className="shell recap-layout">
          <article className="recap-main">
            <div className="recap-stats">
              <RecapStat label="Registered" value={event.registered ?? "—"} />
              <RecapStat
                label={finalized ? "Showed up" : cancelled ? "Checked in" : "Checked in so far"}
                value={event.checkedIn ?? "—"}
              />
              <RecapStat
                label="Flaked"
                value={finalized ? (summary?.flakes ?? "—") : "—"}
                detail={cancelled ? "No pool" : finalized ? null : "After finalization"}
              />
              <RecapStat
                label="Show-up rate"
                value={
                  finalized && summary && event.registered > 0
                    ? formatShowUpRate(summary.showUpRate)
                    : "—"
                }
                detail={cancelled ? "No settlement" : finalized ? null : "After finalization"}
              />
            </div>

            <FlakeFund event={event} variant="recap" />

            <section className="recap-story">
              <p className="eyebrow">What happened</p>
              <h2>
                {cancelled
                  ? cancelledEmpty
                    ? "No reservations. Nothing to refund."
                    : "No pool. Full refunds."
                  : noReservations
                    ? "No reservations. No settlement."
                    : noAttendees
                      ? "No one checked in."
                      : allShowed
                        ? "Everyone showed up."
                        : finalized
                          ? "The contract closed the room."
                          : "The room is still being counted."}
              </h2>
              <p>
                {cancelled
                  ? cancelledEmpty
                    ? "The organizer cancelled before anyone reserved. There is no escrow to refund, no pool and no settlement to claim."
                    : "The organizer cancelled the event. Every registered attendee is eligible for exactly their deposit back. The no-show pool is not distributed."
                  : noReservations
                    ? "The event ended without reservations. There is no pool, no attendee reward and no settlement to claim."
                    : noAttendees
                      ? `The event ended with ${summary?.flakes ?? 0} no-show${summary?.flakes === 1 ? "" : "s"}. No attendee checked in, so no attendee received a reward and the ${formatNearAmount(summary?.pool ?? 0n)} pool remainder accrued to treasury.`
                      : allShowed
                        ? `All ${event.registered} registered attendee${event.registered === 1 ? "" : "s"} checked in. No one flaked, so there was no pool and no reward; every deposit was returned in full.`
                        : finalized
                          ? `The event ended with ${summary?.flakes ?? 0} no-show${summary?.flakes === 1 ? "" : "s"}. The contract fixed the reward at ${formatNearAmount(summary?.rewardPerAttendee ?? 0n)} per checked-in attendee. Claims are individual pull withdrawals, so one failed transfer cannot block the room.`
                          : `The contract currently shows ${event.registered ?? 0} reservation${event.registered === 1 ? "" : "s"} and ${event.checkedIn ?? 0} check-in${event.checkedIn === 1 ? "" : "s"}. The organizer can check attendees in during the published window and finalize after the event ends.`}
              </p>
            </section>

            <section className="recap-integrity">
              <div className="recap-integrity-head">
                <span>
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <p className="eyebrow">Where the truth lives</p>
                  <h2>Checked, not trusted.</h2>
                </div>
              </div>
              <p>
                The title and venue come from the verified publication. Deposits, capacity,
                check-ins, no-shows and settlement come from the NEAR contract. The metadata
                hash is re-checked on every load.
              </p>
              <div className="recap-proof-grid">
                <div>
                  <span>Deposit</span>
                  <strong>{formatNearAmount(event.deposit)}</strong>
                </div>
                <div>
                  <span>Capacity</span>
                  <strong>{event.capacity ?? "—"}</strong>
                </div>
                <div>
                  <span>Contract</span>
                  <strong>
                    {contractUrl ? (
                      <a href={contractUrl} target="_blank" rel="noreferrer">
                        {shortHash(event.contractId, 10, 6)}
                        <ArrowUpRight size={12} />
                      </a>
                    ) : (
                      "—"
                    )}
                  </strong>
                </div>
                <div>
                  <span>Metadata hash</span>
                  <strong title={event.hash}>{shortHash(event.hash, 12, 8)}</strong>
                </div>
              </div>
              <div className="recap-integrity-meta">
                <span>Published {formatDate(event.publishedAt) ?? "—"}</span>
                {txUrl ? (
                  <a href={txUrl} target="_blank" rel="noreferrer">
                    Create transaction <ArrowUpRight size={13} />
                  </a>
                ) : null}
              </div>
            </section>
          </article>

          <aside className="recap-aside">
            <div className="recap-aside-card">
              <span className="recap-aside-mark">
                {cancelled ? <ShieldCheck size={20} /> : <Check size={20} />}
              </span>
              <p className="eyebrow">The promise</p>
              <h2>No cut of the flakes.</h2>
              <p>
                The organizer never touches the no-show pool. GatherBond does not take a cut of
                deposits or no-shows. The people who show up split what the people who flaked
                left behind.
              </p>
              <div className="recap-aside-rule" />
              <p className="recap-aside-small">
                This page is public aggregate proof. It does not list attendee identities.
              </p>
            </div>

            <div className="recap-aside-card recap-aside-card--dark">
              <p className="eyebrow">Run the room</p>
              <h2>Make the next yes count.</h2>
              <p>
                Create an event, set a refundable deposit and let the Flake Fund do the reminding.
              </p>
              <Link href="/studio" className="button button-lime button-full">
                Host an event
                <ArrowUpRight size={15} />
              </Link>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
