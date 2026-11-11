"use client";

import { useEffect, useState } from "react";

import QrGate from "./qr-gate";
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

export default function CheckIn({ defaultEventId = "0" }) {
  const wallet = useWallet();
  const [eventId, setEventId] = useState(String(defaultEventId || "0"));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [config, setConfig] = useState(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [gateKey, setGateKey] = useState(0);

  useEffect(() => {
    const next = String(defaultEventId ?? "").trim();
    if (/^\d+$/.test(next)) setEventId(next);
  }, [defaultEventId]);

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

  async function run(action, rawCode = code) {
    setNotice(null);
    if (wallet.phase !== "signedIn") {
      setNotice({ tone: "error", text: "Connect the organizer wallet first." });
      return false;
    }
    const id = eventId.trim();
    if (!/^\d+$/.test(id)) {
      setNotice({ tone: "error", text: "Enter a numeric event id." });
      return false;
    }

    setBusy(action);
    try {
      const current = await configuration();
      if (action === "check_in") {
        const ticket = decodeTicket(rawCode);
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
        if (gateOpen) setGateKey((currentKey) => currentKey + 1);
        return true;
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
        return true;
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
        return true;
      }
      return false;
    } catch (error) {
      setNotice({ tone: "error", text: contractError(error) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  function scanned(raw) {
    setCode(raw);
    run("check_in", raw);
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
        Organizer-only check-in consumes the attendee&apos;s one-time ticket. Gate Mode scans the
        QR and submits one onchain transaction; manual paste remains available as a fallback.
        Finalization is permissionless after the event ends; cancellation is organizer-only before
        the start.
      </p>

      <div className="gate-mode">
        <div className="gate-mode-head">
          <div>
            <span>Gate mode</span>
            <strong>Scan → approve → onchain</strong>
          </div>
          <span className="status-badge status-badge--live">Fast path</span>
        </div>
        {gateOpen ? (
          <QrGate
            key={gateKey}
            onDecode={scanned}
            onClose={() => setGateOpen(false)}
          />
        ) : (
          <>
            <button
              type="button"
              className="button button-lime"
              onClick={() => setGateOpen(true)}
              disabled={busy !== null || wallet.phase !== "signedIn"}
            >
              <Ticket size={15} />
              {wallet.phase === "signedIn" ? "Open QR scanner" : "Connect organizer wallet to scan"}
            </button>
            <p className="gate-mode-help">
              Use a laptop webcam for the demo. The event id is prefilled from Studio; each valid
              scan asks the organizer wallet to approve one real check-in transaction.
            </p>
          </>
        )}
      </div>

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
          <span>Ticket code / manual fallback</span>
          <textarea
            value={code}
            onChange={(event) => setCode(event.target.value)}
            rows={3}
            placeholder="Scan with Gate Mode, or paste the GB1 ticket code here"
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
