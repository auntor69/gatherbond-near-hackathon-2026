"use client";

import { useState } from "react";

import { Check, Refresh } from "./icons";
import { contractError } from "../lib/contract";
import { recoverTicket } from "../lib/ticketRecovery";

export default function TicketRecovery({
  config,
  eventId,
  accountId,
  title,
  deposit,
  canRecover = true,
  note,
  onRecovered,
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  async function restore() {
    if (!canRecover || busy) return;
    if (
      !window.confirm(
        "Restore this ticket with the connected wallet? The old ticket QR/code will stop working immediately.",
      )
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const ticket = await recoverTicket({ config, eventId, accountId, title, deposit });
      setNotice({
        tone: "success",
        text: "New ticket issued. The previous QR/code is now invalid.",
      });
      onRecovered?.(ticket);
    } catch (error) {
      setNotice({ tone: "error", text: contractError(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ticket-recovery">
      <div className="ticket-recovery-copy">
        <strong>{canRecover ? "Ticket missing from this browser." : "No ticket to restore here."}</strong>
        <p>
          {note ||
            "The reservation is still onchain and belongs to this wallet. Restoring issues a new secret and invalidates any old QR or code."}
        </p>
      </div>
      {canRecover ? (
        <button
          type="button"
          className="button button-dark button-small"
          onClick={restore}
          disabled={busy || !config?.contract_id || !accountId}
        >
          <Refresh size={14} />
          {busy ? "Restoring ticket…" : "Restore with this wallet"}
        </button>
      ) : null}
      {notice ? (
        <p className={`ticket-recovery-notice ticket-recovery-notice--${notice.tone}`} role="status">
          {notice.tone === "success" ? <Check size={13} /> : "!"} {notice.text}
        </p>
      ) : null}
    </div>
  );
}
