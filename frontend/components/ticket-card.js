"use client";

import { useState } from "react";

import TicketQR, { downloadTicketImage } from "./ticket-qr";
import { Check, Copy, Download, Ticket } from "./icons";
import { formatNearAmount } from "../lib/contract";

export default function TicketCard({ ticket, compact = false, checkedIn = false, inactive = false }) {
  const [copyLabel, setCopyLabel] = useState("Copy ticket code");
  const [downloadLabel, setDownloadLabel] = useState("Download ticket");

  async function copy() {
    try {
      await navigator.clipboard.writeText(ticket.code);
      setCopyLabel("Copied");
      window.setTimeout(() => setCopyLabel("Copy ticket code"), 1800);
    } catch {
      setCopyLabel("Copy failed");
    }
  }

  async function download() {
    setDownloadLabel("Preparing…");
    try {
      await downloadTicketImage(ticket);
      setDownloadLabel("Downloaded");
      window.setTimeout(() => setDownloadLabel("Download ticket"), 1800);
    } catch {
      setDownloadLabel("Download failed");
      window.setTimeout(() => setDownloadLabel("Download ticket"), 2200);
    }
  }

  return (
    <article className={`ticket-card${compact ? " ticket-card--compact" : ""}`}>
      <div className="ticket-card-top">
        <span>
          <Ticket size={15} />
          GatherBond ticket
        </span>
        <span className="ticket-card-state">
          {checkedIn || ticket.checkedIn ? "Checked in" : inactive ? "Closed" : "Reserved"}
        </span>
      </div>
      <div className="ticket-card-body">
        <div>
          <p className="ticket-card-kicker">Event #{ticket.eventId}</p>
          <h3>{ticket.title || `Event ${ticket.eventId}`}</h3>
          <p className="ticket-card-meta">
            {ticket.attendee} · {formatNearAmount(ticket.deposit)}
          </p>
        </div>
        <div className="ticket-card-stub">
          <span>ONE</span>
          <strong>ADMIT</strong>
        </div>
      </div>
      {inactive ? (
        <div className="ticket-card-qr ticket-card-qr--closed">
          <Ticket size={30} />
          <div>
            <span>Door closed</span>
            <p>
              This event is no longer checking tickets in. Your reservation remains on chain;
              use the claim action when settlement is available.
            </p>
          </div>
        </div>
      ) : (
        <div className="ticket-card-qr">
          <TicketQR code={ticket.code} size={compact ? 150 : 188} />
          <div>
            <span>Scan at the door</span>
            <p>
              The organizer scans this QR in Gate Mode. The scan is only the input; the actual
              attendance proof is the onchain check-in transaction.
            </p>
          </div>
        </div>
      )}
      <div className="ticket-code-block">
        <span>One-time ticket code / manual fallback</span>
        <code>{ticket.code}</code>
      </div>
      <div className="ticket-card-actions">
        <button type="button" className="button button-dark button-small" onClick={copy}>
          {copyLabel === "Copied" ? <Check size={14} /> : <Copy size={14} />}
          {copyLabel}
        </button>
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={download}
          disabled={downloadLabel === "Preparing…"}
        >
          <Download size={14} />
          {downloadLabel}
        </button>
        <span className="ticket-card-note">
          Keep the QR or download. If this browser is lost, the same wallet can restore a new
          ticket from My commitments; the old code then stops working.
        </span>
      </div>
    </article>
  );
}
