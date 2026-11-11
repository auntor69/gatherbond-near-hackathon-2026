"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatNearAmount } from "../lib/contract";
import { mapDetail } from "../lib/events";
import {
  flakeFundSummary,
  formatShowUpRate,
} from "../lib/flakeFund";
import {
  ArrowUpRight,
  Check,
  Copy,
  Refresh,
  ShieldCheck,
  Ticket,
} from "./icons";

function ProofStat({ label, value, detail }) {
  return (
    <div className="room-proof-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export default function RoomProof({ eventId }) {
  const id = String(eventId ?? "").trim();
  const validId = /^\d+$/.test(id);
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState({ status: "idle", event: null });
  const [copyLabel, setCopyLabel] = useState("Copy recap link");

  useEffect(() => {
    if (!validId) {
      setState({ status: "idle", event: null });
      return undefined;
    }

    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState({ status: "loading", event: null });
      try {
        const response = await fetch(`/api/events/${encodeURIComponent(id)}`, {
          cache: "no-store",
          signal: controller.signal,
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
          setState({ status: "missing", event: null });
          return;
        }
        setState({
          status: response.status === 503 ? "unavailable" : "error",
          event: null,
          httpStatus: response.status,
          error: body.error,
        });
      } catch (error) {
        if (active && error?.name !== "AbortError") {
          setState({ status: "error", event: null, error: "network_error" });
        }
      }
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [id, validId, refresh]);

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

  const refreshProof = useCallback(() => setRefresh((value) => value + 1), []);

  async function copyRecap() {
    try {
      const url = `${window.location.origin}/events/${encodeURIComponent(id)}/recap`;
      await navigator.clipboard.writeText(url);
      setCopyLabel("Recap link copied");
      window.setTimeout(() => setCopyLabel("Copy recap link"), 1800);
    } catch {
      setCopyLabel("Copy failed");
      window.setTimeout(() => setCopyLabel("Copy recap link"), 1800);
    }
  }

  return (
    <section className="panel studio-panel room-proof" id="room-proof">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Room proof</p>
          <h2>What the contract saw.</h2>
        </div>
        <span className="network-pill">
          <span className="network-dot" aria-hidden="true" />
          Contract state
        </span>
      </div>

      <p className="panel-intro">
        Aggregate attendance and settlement for event <code>#{id || "—"}</code>, read from the
        same public proof as the recap.
      </p>

      {!validId ? (
        <div className="room-proof-empty">
          <Ticket size={22} />
          <p>Enter a numeric on-chain event ID to load its proof.</p>
        </div>
      ) : null}

      {state.status === "loading" ? (
        <div className="room-proof-empty">
          <span className="loading-mark">GB</span>
          <p>Reading registered, checked-in and settlement state from NEAR Testnet.</p>
        </div>
      ) : null}

      {state.status === "missing" ? (
        <div className="room-proof-empty">
          <ShieldCheck size={22} />
          <p>No verified publication was returned for event #{id}. Nothing is being guessed.</p>
        </div>
      ) : null}

      {state.status === "unavailable" || state.status === "error" ? (
        <div className="room-proof-empty room-proof-empty--error">
          <span>!</span>
          <p>
            {state.error === "metadata_store_unavailable"
              ? "The metadata store is offline, so the public proof cannot be verified right now."
              : state.error === "chain_unavailable"
                ? "NEAR RPC is unavailable right now, so the contract state cannot be read."
                : "The proof could not be loaded. Nothing was changed."}
          </p>
          <button type="button" className="button button-dark button-small" onClick={refreshProof}>
            <Refresh size={14} />
            Retry read
          </button>
        </div>
      ) : null}

      {state.status === "ready" && summary ? (
        <>
          <div className="room-proof-head">
            <div>
              <span className="room-proof-kicker">Event #{state.event.id}</span>
              <h3>{state.event.title}</h3>
              <p>{state.event.venue}</p>
            </div>
            <span className={`status-badge${state.event.status === "Finalized" ? " status-badge--live" : ""}`}>
              {state.event.status}
            </span>
          </div>

          <div className="room-proof-grid">
            <ProofStat label="Registered" value={state.event.registered ?? "—"} />
            <ProofStat label="Checked in" value={state.event.checkedIn ?? "—"} />
            <ProofStat
              label="No-shows"
              value={summary.state === "finalized" ? summary.flakes : "—"}
              detail={
                summary.state === "finalized"
                  ? null
                  : summary.state === "cancelled"
                    ? "No pool"
                    : "At finalization"
              }
            />
            <ProofStat
              label="Show-up rate"
              value={
                summary.state === "finalized" && summary.registered > 0
                  ? formatShowUpRate(summary.showUpRate)
                  : "—"
              }
              detail={
                summary.state === "open"
                  ? "At finalization"
                  : summary.state === "finalized" && summary.registered === 0
                    ? "No reservations"
                    : null
              }
            />
            <ProofStat label="Deposit" value={formatNearAmount(summary.deposit)} />
            <ProofStat
              label={
                summary.state === "finalized"
                  ? "Pool"
                  : summary.state === "open"
                    ? "Projected pool"
                    : "No-show pool"
              }
              value={
                summary.state === "finalized"
                  ? formatNearAmount(summary.pool)
                  : summary.state === "open"
                    ? formatNearAmount(summary.projectedPool)
                    : formatNearAmount(0n)
              }
              detail={
                summary.state === "finalized"
                  ? "Actual settlement"
                  : summary.state === "open"
                    ? "20% no-show illustration"
                    : "Not distributed"
              }
            />
          </div>

          {summary.state === "finalized" ? (
            <p className="room-proof-note">
              <Check size={15} />
              {summary.registered === 0
                ? "Finalized: no reservations existed, so there is no pool and no settlement to distribute."
                : summary.checkedIn === 0
                  ? `Finalized: no one checked in, so no attendee received a reward. The ${formatNearAmount(summary.pool)} pool remainder accrued to treasury under the contract rule.`
                  : summary.flakes === 0
                    ? "Actual: everyone who reserved showed up. There was no flake pool; every deposit was returned in full."
                    : `Actual: ${summary.checkedIn} showed up, ${summary.flakes} flaked, and each attendee got ${formatNearAmount(summary.rewardPerAttendee)} extra. The organizer took no cut.`}
            </p>
          ) : summary.state === "cancelled" ? (
            <p className="room-proof-note">
              <ShieldCheck size={15} />
              {summary.registered === 0
                ? "Cancelled: no one had reserved, so there is nothing to refund and no pool to distribute."
                : "Cancelled: every registered attendee can claim the full deposit. No pool is distributed."}
            </p>
          ) : summary.state === "open" ? (
            <p className="room-proof-note">
              <ShieldCheck size={15} />
              Open event: the pool is a labelled projection. The contract uses the real check-in
              count at finalization.
            </p>
          ) : (
            <p className="room-proof-note">
              <ShieldCheck size={15} />
              No pool yet: the room needs at least two reservations before a no-show pool can
              exist. The contract uses the real check-in count at finalization.
            </p>
          )}

          <div className="action-row action-row--tight">
            <button type="button" className="button button-dark button-small" onClick={refreshProof}>
              <Refresh size={14} />
              Refresh proof
            </button>
            <Link
              href={`/events/${encodeURIComponent(state.event.id)}/recap`}
              className="button button-ghost button-small"
            >
              <ArrowUpRight size={14} />
              Open public recap
            </Link>
            <button type="button" className="button button-ghost button-small" onClick={copyRecap}>
              {copyLabel === "Recap link copied" ? <Check size={14} /> : <Copy size={14} />}
              {copyLabel}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
