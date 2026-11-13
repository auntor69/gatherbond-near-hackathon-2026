"use client";

import { useEffect, useRef, useState } from "react";

import QrGate from "./qr-gate";
import { Check, ShieldCheck, Ticket } from "./icons";
import { useWallet } from "./wallet-provider";
import { sendContractCall } from "../lib/nearWallet";
import { contractError, decodeTicket } from "../lib/contract";
import { eventCheckinState, eventLifecycle } from "../lib/eventState";
import { formatDate } from "../lib/events";
import { createSingleFlight } from "../lib/singleFlight";

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
  const [stats, setStats] = useState(null);
  const [statsKey, setStatsKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const actionGuard = useRef(createSingleFlight());

  useEffect(() => {
    const next = String(defaultEventId ?? "").trim();
    if (/^\d+$/.test(next)) setEventId(next);
  }, [defaultEventId]);

  useEffect(() => {
    const id = eventId.trim();
    if (!/^\d+$/.test(id)) {
      setStats(null);
      return undefined;
    }
    let active = true;
    fetch(`/api/events/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (active && response.ok) setStats(body.onchain ?? null);
        else if (active) setStats(null);
      })
      .catch(() => active && setStats(null));
    return () => {
      active = false;
    };
  }, [eventId, statsKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const lifecycle = stats ? eventLifecycle(stats, now) : null;
  const checkin = stats ? eventCheckinState(stats, now) : null;
  const canCheckIn = Boolean(checkin?.allowed);
  const canCancel = lifecycle?.status === "Open" && !lifecycle.started;
  const checkinWindow =
    checkin?.opensAt && checkin?.closesAt
      ? `${formatDate(new Date(checkin.opensAt))} – ${formatDate(new Date(checkin.closesAt))} (UTC)`
      : null;

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
    if (action === "check_in" && !canCheckIn) {
      setNotice({
        tone: "error",
        text:
          checkin?.reason === "not_open"
            ? "Check-in has not opened yet. The QR scanner is disabled until the published window starts."
            : checkin?.reason === "closed"
              ? "Check-in is closed for this event. No attendance can be recorded after the window."
              : "The check-in window could not be read from the contract, so check-in is disabled.",
      });
      return false;
    }
    if (
      action === "cancel" &&
      !window.confirm(
        "Cancel this event? Every reservation becomes refundable in full. This cannot be undone.",
      )
    ) {
      return false;
    }
    if (!actionGuard.current.begin()) return false;

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
        setStatsKey((key) => key + 1);
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
        setStatsKey((key) => key + 1);
        return true;
      }
      return false;
    } catch (error) {
      setNotice({ tone: "error", text: contractError(error) });
      return false;
    } finally {
      actionGuard.current.end();
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
          <h2>Check in at the door</h2>
        </div>
        <ShieldCheck size={22} />
      </div>

      <p className="panel-intro">
        Each scan consumes the one-time ticket and records real attendance on-chain. Manual
        paste is the fallback. There is no remote check-in and no finalize step.
      </p>

      {stats ? (
        <div className="form-grid form-grid--three">
          <div className="field">
            <span>Registered</span>
            <strong>{stats.registered}</strong>
          </div>
          <div className="field">
            <span>Checked in</span>
            <strong>{stats.checked_in}</strong>
          </div>
          <div className="field">
            <span>Status</span>
            <strong>{lifecycle?.displayStatus ?? stats.status}</strong>
          </div>
        </div>
      ) : null}

      {stats && lifecycle?.cancelled ? (
        <div className="studio-notice studio-notice--info" role="status">
          <span className="studio-notice-mark">!</span>
          <p>Cancelled: every reservation is refundable in full. There is no finalize step and no pool.</p>
        </div>
      ) : stats && lifecycle?.finalized ? (
        <div className="studio-notice studio-notice--success" role="status">
          <span className="studio-notice-mark"><Check size={14} /></span>
          <p>Settled: claims are individual pull withdrawals. Attendance can no longer change.</p>
        </div>
      ) : stats && lifecycle?.failedStatus ? (
        <div className="studio-notice studio-notice--info" role="status">
          <span className="studio-notice-mark">!</span>
          <p>Below the 20% floor: every reservation gets a full refund. No pool is distributed.</p>
        </div>
      ) : lifecycle?.ended ? (
        <div className="studio-notice studio-notice--success" role="status">
          <span className="studio-notice-mark"><Check size={14} /></span>
          <p>
            The event has ended. The first attendee claim settles it automatically; there is no
            finalize button.
          </p>
        </div>
      ) : lifecycle?.belowFloor ? (
        <div className="studio-notice studio-notice--info" role="status">
          <span className="studio-notice-mark">!</span>
          <p>
            Current turnout is below 20%. If the event ends here, every reservation is refunded
            in full and no pool is distributed.
          </p>
        </div>
      ) : stats && !canCheckIn ? (
        <div className="studio-notice studio-notice--info" role="status">
          <span className="studio-notice-mark">!</span>
          <p>
            {checkin?.reason === "not_open"
              ? `Check-in opens ${formatDate(new Date(checkin.opensAt))} (UTC).`
              : checkin?.reason === "closed"
                ? "The check-in window has closed. No attendance can be recorded now."
                : "The check-in window could not be read from the contract, so check-in is disabled."}
          </p>
        </div>
      ) : null}

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
              disabled={busy !== null || wallet.phase !== "signedIn" || !canCheckIn}
            >
              <Ticket size={15} />
              {wallet.phase !== "signedIn"
                ? "Connect organizer wallet to scan"
                : !canCheckIn
                  ? checkin?.reason === "not_open"
                    ? "Check-in not open yet"
                    : "Check-in closed"
                  : "Open QR scanner"}
            </button>
            <p className="gate-mode-help">
              {canCheckIn
                ? "The event id is prefilled. Each valid scan asks the organizer wallet to approve one real check-in transaction."
                : checkinWindow
                  ? `The published check-in window is ${checkinWindow}. The scanner unlocks only inside it.`
                  : "Check-in unlocks only inside the published check-in window."}
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
            disabled={busy !== null || !code.trim() || !canCheckIn}
          >
            <Ticket size={15} />
            {busy === "check_in" ? "Checking in…" : "Check in ticket"}
          </button>
          {canCancel ? (
            <button
              type="button"
              className="button button-ghost"
              onClick={() => run("cancel")}
              disabled={busy !== null}
            >
              {busy === "cancel" ? "Cancelling…" : "Cancel event"}
            </button>
          ) : null}
        </div>
      </div>

      <Notice notice={notice} />
    </section>
  );
}
