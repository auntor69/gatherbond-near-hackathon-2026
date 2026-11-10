"use client";

import { useState } from "react";

import { Check, Copy, Ticket } from "./icons";
import { formatNearAmount } from "../lib/contract";

export default function TicketCard({ ticket, compact = false }) {
  const [label, setLabel] = useState("Copy ticket code");

  async function copy() {
    try {
      await navigator.clipboard.writeText(ticket.code);
      setLabel("Copied");
      window.setTimeout(() => setLabel("Copy ticket code"), 1800);
    } catch {
      setLabel("Copy failed");
    }
  }

  return (
    <article className={`ticket-card${compact ? " ticket-card--compact" : ""}`}>
      <div className="ticket-card-top">
        <span>
          <Ticket size={15} />
          GatherBond ticket
        </span>
        <span className="ticket-card-state">{ticket.checkedIn ? "Checked in" : "Reserved"}</span>
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
      <div className="ticket-code-block">
        <span>One-time ticket code</span>
        <code>{ticket.code}</code>
      </div>
      <div className="ticket-card-actions">
        <button type="button" className="button button-dark button-small" onClick={copy}>
          {label === "Copied" ? <Check size={14} /> : <Copy size={14} />}
          {label}
        </button>
        <span className="ticket-card-note">
          Keep this code. The contract only stores its commitment; the organizer needs the code
          to check you in.
        </span>
      </div>
    </article>
  );
}
