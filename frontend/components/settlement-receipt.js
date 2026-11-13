"use client";

import { useState } from "react";

import { formatNearAmount } from "../lib/contract";
import { toBigInt } from "../lib/flakeFund";
import { Check, Copy, ShieldCheck, Spark } from "./icons";

const CLAIM_COPY = {
  Claimed: { label: "Settled on chain", tone: "settled" },
  Pending: { label: "Transfer in flight", tone: "pending" },
  Unclaimed: { label: "Claim available", tone: "available" },
};

export default function SettlementReceipt({
  event,
  reservation,
  eventId,
  title,
}) {
  const [shareLabel, setShareLabel] = useState("Share receipt");

  if (!event || !reservation) {
    return null;
  }

  const finalized = event.status === "Finalized";
  const cancelled = event.status === "Cancelled";
  const belowFloor =
    finalized && Number(event.checked_in) * 5 < Number(event.registered);
  const failed = event.status === "Failed" || belowFloor;
  if (!finalized && !cancelled && !failed) {
    return null;
  }
  if (finalized && !failed && !reservation.checked_in) {
    return null;
  }

  const deposit = toBigInt(reservation.deposit);
  const reward =
    finalized && !failed && reservation.checked_in
      ? toBigInt(event.reward_per_attendee)
      : 0n;
  const total = deposit + reward;
  const claim = CLAIM_COPY[reservation.claim] ?? {
    label: String(reservation.claim ?? "Settlement"),
    tone: "pending",
  };

  async function shareReceipt() {
    const recapUrl = `${window.location.origin}/events/${encodeURIComponent(eventId)}/recap`;
    const refundText =
      reservation.claim === "Claimed"
        ? `My deposit for ${title} was refunded on GatherBond.`
        : reservation.claim === "Pending"
          ? `My refund for ${title} is on the way on GatherBond.`
          : `I can claim a full refund for ${title} on GatherBond.`;
    const text =
      cancelled || failed
        ? refundText
        : reservation.claim === "Claimed"
          ? `I showed up to ${title}. I got my deposit back plus ${formatNearAmount(reward)} from the no-show pool.`
          : reservation.claim === "Pending"
            ? `I showed up to ${title}. My deposit and ${formatNearAmount(reward)} share are on the way.`
            : `I showed up to ${title}. I can claim my deposit back plus ${formatNearAmount(reward)} from the no-show pool.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${title} — GatherBond receipt`, text, url: recapUrl });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${recapUrl}`);
      setShareLabel("Receipt copied");
      window.setTimeout(() => setShareLabel("Share receipt"), 1800);
    } catch (error) {
      if (error?.name !== "AbortError") {
        setShareLabel("Copy failed");
        window.setTimeout(() => setShareLabel("Share receipt"), 1800);
      }
    }
  }

  return (
    <article className="settlement-receipt">
      <div className="settlement-receipt-head">
        <div>
          <p className="eyebrow">{cancelled || failed ? "Refund receipt" : "Show-up receipt"}</p>
          <h3>{cancelled ? "The room was cancelled." : failed ? "Full refund available." : "You showed up."}</h3>
        </div>
        <span className={`receipt-status receipt-status--${claim.tone}`}>
          {reservation.claim === "Claimed" ? <Check size={13} /> : <Spark size={13} />}
          {claim.label}
        </span>
      </div>

      <div className="settlement-receipt-amount">
        <span>{cancelled || failed ? "Deposit refund" : "Total returned"}</span>
        <strong>{formatNearAmount(total)}</strong>
      </div>

      <div className="settlement-receipt-grid">
        <div>
          <span>Deposit</span>
          <strong>{formatNearAmount(deposit)}</strong>
        </div>
        <div>
          <span>{cancelled || failed ? "Pool" : "No-show share"}</span>
          <strong>{formatNearAmount(reward)}</strong>
        </div>
        <div>
          <span>Claim</span>
          <strong>{claim.label}</strong>
        </div>
      </div>

      <p className="settlement-receipt-note">
        <ShieldCheck size={14} />
        {cancelled
          ? "Full deposit refund under the cancellation rule. No no-show pool is distributed."
          : failed
            ? "Turnout stayed below 20%, so every reservation gets its full deposit back. No pool is distributed."
            : "The share is fixed when the event settles. The contract pays each attendee by pull claim, so one failed transfer cannot block the room."}
      </p>

      <div className="action-row action-row--tight">
        <button type="button" className="button button-dark button-small" onClick={shareReceipt}>
          {shareLabel === "Receipt copied" ? <Check size={14} /> : <Copy size={14} />}
          {shareLabel}
        </button>
      </div>
    </article>
  );
}
