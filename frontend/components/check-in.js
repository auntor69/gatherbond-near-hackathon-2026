"use client";

import { useState } from "react";

import { Check, ShieldCheck, Ticket } from "./icons";
import { useWallet } from "./wallet-provider";
import { sendContractCall } from "../lib/nearWallet";
import { contractError, decodeTicket } from "../lib/contract";

function Notice({ notice }) {
  if (!notice) return null;
  return (
    <div className={`studio-notice studio-notice--${notice.tone}`} role="status">
      <span className="studio-notice-mark">{notice.tone === "success" ? <Check size={14} /> : "!"}</span>
      <p>{notice.text}</p>
    </div>
  );
}

export default function CheckIn() {
  const wallet = useWallet();
  const [eventId, setEventId] = useState("0");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [config, setConfig] = useState(null);

  async function configuration() {
    if (config?.contract_id) return config;
    const response = await fetch("/api/config", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.contract_id) {
      throw new Error("The contract is not configured on this deployment.");
    }
    setConfig(body);
    return body;
  }

  async function run(action) {
    setNotice(null);
    if (wallet.phase !== "signedIn") {
      setNotice({ tone: "error", text: "Connect the organizer wallet first." });
      return;
    }
    const id = eventId.trim();
    if (!/^\d+$/.test(id)) {
      setNotice({ tone: "error", text: "Enter a numeric event id." });
      return;
    }

    setBusy(action);
    try {
      const current = await configuration();
      if (action === "check_in") {
        const ticket = decodeTicket(code);
        if (ticket.eventId !== id) {
          throw new Error("That ticket belongs to a different event id.");
        }
        await sendContractCall({
          contractId: current.contract_id,
          methodName: "check_in",
          args: { event_id: id, attendee: ticket.attendee, secret: ticket.secret },
          deposit: "0",
          gas: "100000000000000",
          expectedAccount: wallet.accountId,
        });
        setNotice({ tone: "success", text: `Checked in ${ticket.attendee} for event ${id}.` });
      } else if (action === "finalize") {
        await sendContractCall({
          contractId: current.contract_id,
          methodName: "finalize_event",
          args: { event_id: id },
          deposit: "0",
          gas: "100000000000000",
          expectedAccount: wallet.accountId,
        });
        setNotice({ tone: "success", text: `Event ${id} finalized. Attendees can now claim.` });
      } else if (action === "cancel") {
        await sendContractCall({
          contractId: current.contract_id,
          methodName: "cancel_event",
          args: { event_id: id },
          deposit: "0",
          gas: "100000000000000",
          expectedAccount: wallet.accountId,
        });
        setNotice({ tone: "success", text: `Event ${id} cancelled. Every reservation is refundable.` });
      }
    } catch (error) {
      setNotice({ tone: "error", text: contractError(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel studio-panel" id="manage">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Organizer actions</p>
          <h2>Check in & settle</h2>
        </div>
        <ShieldCheck size={22} />
      </div>

      <p className="panel-intro">
        Organizer-only check-in consumes the attendee&apos;s one-time ticket. Finalization is
        permissionless after the event ends; cancellation is organizer-only before the start.
      </p>

      <div className="studio-form">
        <label className="field">
          <span>Event id</span>
          <input
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            inputMode="numeric"
            placeholder="0"
          />
        </label>

        <label className="field">
          <span>Ticket code</span>
          <textarea
            value={code}
            onChange={(event) => setCode(event.target.value)}
            rows={3}
            placeholder="Paste the GB1 ticket code from the attendee's commitments page"
          />
        </label>

        <div className="action-row">
          <button
            type="button"
            className="button button-dark"
            onClick={() => run("check_in")}
            disabled={busy !== null || !code.trim()}
          >
            <Ticket size={15} />
            {busy === "check_in" ? "Checking in…" : "Check in ticket"}
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => run("finalize")}
            disabled={busy !== null}
          >
            {busy === "finalize" ? "Finalizing…" : "Finalize event"}
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => run("cancel")}
            disabled={busy !== null}
          >
            {busy === "cancel" ? "Cancelling…" : "Cancel event"}
          </button>
        </div>
      </div>

      <Notice notice={notice} />
    </section>
  );
}
