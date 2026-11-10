import { formatNearAmount } from "../lib/contract";
import {
  flakeFundSummary,
  formatShowUpRate,
} from "../lib/flakeFund";
import { Check, ShieldCheck, Spark, Ticket } from "./icons";

function Stat({ label, value, detail }) {
  return (
    <div className="flake-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export default function FlakeFund({ event, variant = "detail" }) {
  const summary = flakeFundSummary({
    deposit: event.deposit,
    registered: event.registered,
    checkedIn: event.checkedIn,
    status: event.status,
  });
  const recap = variant === "recap";
  const depositLabel = formatNearAmount(summary.deposit);

  if (summary.state === "empty") {
    return (
      <section className={`flake-fund${recap ? " flake-fund--recap" : ""}`} id="flake-fund">
        <div className="flake-fund-head">
          <div>
            <p className="eyebrow">The Flake Fund</p>
            <h2>No pool yet.</h2>
          </div>
          <span className="flake-fund-badge">
            <Ticket size={13} />
            Waiting for a seat
          </span>
        </div>
        <p className="flake-fund-empty">
          The pool starts when the first person reserves. The deposit is {depositLabel}; it is
          returned when the attendee shows up.
        </p>
      </section>
    );
  }

  if (summary.state === "waiting") {
    return (
      <section className={`flake-fund${recap ? " flake-fund--recap" : ""}`} id="flake-fund">
        <div className="flake-fund-head">
          <div>
            <p className="eyebrow">The Flake Fund</p>
            <h2>One more seat makes a room.</h2>
          </div>
          <span className="flake-fund-badge">
            <Ticket size={13} />
            {summary.registered} reserved
          </span>
        </div>
        <p className="flake-fund-empty">
          A no-show pool needs at least two reservations. The current deposit is {depositLabel}.
          The contract will use the real check-in count at finalization.
        </p>
      </section>
    );
  }

  if (summary.state === "cancelled") {
    return (
      <section className={`flake-fund${recap ? " flake-fund--recap" : ""}`} id="flake-fund">
        <div className="flake-fund-head">
          <div>
            <p className="eyebrow">The Flake Fund</p>
            <h2>The room was cancelled.</h2>
          </div>
          <span className="flake-fund-badge flake-fund-badge--cancelled">
            <ShieldCheck size={13} />
            Full refunds
          </span>
        </div>
        <p className="flake-fund-copy">
          Every registered attendee can claim their full deposit back. No no-show pool is
          distributed and the organizer cannot withdraw attendee escrow.
        </p>
        <div className="flake-fund-grid">
          <Stat label="Registered" value={summary.registered} />
          <Stat label="Refund per attendee" value={depositLabel} />
          <Stat label="No-show pool" value={formatNearAmount(0n)} detail="Not distributed" />
        </div>
      </section>
    );
  }

  if (summary.state === "finalized") {
    return (
      <section className={`flake-fund${recap ? " flake-fund--recap" : ""}`} id="flake-fund">
        <div className="flake-fund-head">
          <div>
            <p className="eyebrow">The Flake Fund</p>
            <h2>The flakes funded the room.</h2>
          </div>
          <span className="flake-fund-badge flake-fund-badge--actual">
            <Check size={13} />
            Actual settlement
          </span>
        </div>

        <div className="flake-fund-hero">
          <div>
            <span>Extra returned per attendee</span>
            <strong>{formatNearAmount(summary.rewardPerAttendee)}</strong>
          </div>
          <p>
            {summary.checkedIn} of {summary.registered} showed up. The {summary.flakes}{" "}
            no-show{summary.flakes === 1 ? "" : "s"} funded a{" "}
            {formatNearAmount(summary.pool)} pool.
          </p>
        </div>

        <div className="flake-fund-grid">
          <Stat label="Show-up rate" value={formatShowUpRate(summary.showUpRate)} />
          <Stat label="No-shows" value={summary.flakes} />
          <Stat label="Pool" value={formatNearAmount(summary.pool)} />
          <Stat label="Deposits refunded" value={formatNearAmount(summary.totalRefund)} />
          <Stat label="Total back to the room" value={formatNearAmount(summary.totalReturned)} />
          <Stat
            label="Treasury remainder"
            value={formatNearAmount(summary.remainder)}
            detail="Integer rounding only"
          />
        </div>

        <p className="flake-fund-note">
          <ShieldCheck size={15} />
          This is the contract snapshot. Checked-in attendees get their deposit plus the fixed
          per-attendee reward. The organizer gets no cut of the pool.
        </p>
      </section>
    );
  }

  return (
    <section className={`flake-fund${recap ? " flake-fund--recap" : ""}`} id="flake-fund">
      <div className="flake-fund-head">
        <div>
          <p className="eyebrow">The Flake Fund</p>
          <h2>If the flakes fund the room.</h2>
        </div>
        <span className="flake-fund-badge">
          <Spark size={13} />
          Projected · 20% no-shows
        </span>
      </div>

      <div className="flake-fund-hero">
        <div>
          <span>Projected pool</span>
          <strong>{formatNearAmount(summary.projectedPool)}</strong>
        </div>
        <p>
          If {summary.projectedFlakes} of {summary.registered} people flake, the{" "}
          {summary.projections.attendees} who show split the pool. Each attendee gets about{" "}
          {formatNearAmount(summary.projectedReward)} extra.
        </p>
      </div>

      <div className="flake-fund-grid">
        <Stat label="Reserved" value={summary.registered} />
        <Stat label="Checked in so far" value={summary.checkedIn} />
        <Stat label="Deposit" value={depositLabel} />
        <Stat
          label="If one flakes"
          value={formatNearAmount(summary.oneFlakeReward)}
          detail="Extra per other attendee"
        />
      </div>

      <p className="flake-fund-note">
        <ShieldCheck size={15} />
        Illustration only. The contract uses the real check-in count at finalization. No-shows
        fund the attendees; the organizer and GatherBond take no cut.
      </p>
    </section>
  );
}
