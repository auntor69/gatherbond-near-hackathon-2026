"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ArrowUpRight, Check, Spark } from "./icons";
import { useWallet } from "./wallet-provider";
import { hashMetadata } from "../../server/metadata/canonical.mjs";
import { sendContractCall } from "../lib/nearWallet";
import {
  contractError,
  defaultEventWindow,
  eventWindowFrom,
  parseNear,
  scheduleError,
  toNanoseconds,
} from "../lib/contract";

const INITIAL = {
  title: "",
  description: "",
  category: "Community",
  venue: "",
  image_url: "",
  tags: "",
  deposit: "1",
  capacity: "20",
  storage: "0.1",
  date: "",
  start_time: "",
  end_time: "",
};

function freshForm() {
  return { ...INITIAL, ...defaultEventWindow() };
}

function Field({ label, children, help }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {help ? <small className="field-help">{help}</small> : null}
    </label>
  );
}

function localToday() {
  const now = new Date();
  const pad = (number) => String(number).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function formatClock(value) {
  if (!/^\d{2}:\d{2}$/.test(value ?? "")) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const stamp = new Date(2000, 0, 1, hours, minutes);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(stamp);
}

function windowLength(form) {
  const schedule = eventWindowFrom(form);
  if (!schedule) return null;
  const span = Date.parse(schedule.end_at) - Date.parse(schedule.start_at);
  if (!Number.isFinite(span) || span <= 0) return null;
  const hours = Math.floor(span / 3_600_000);
  const minutes = Math.round((span % 3_600_000) / 60_000);
  return `${hours} h ${String(minutes).padStart(2, "0")} m`;
}

function ScheduleLedger({ form }) {
  return (
    <dl className="schedule-ledger">
      <div>
        <dt>Registration closes</dt>
        <dd>{formatClock(form.start_time)}</dd>
      </div>
      <div>
        <dt>Check-in opens</dt>
        <dd>{formatClock(form.start_time)}</dd>
      </div>
      <div>
        <dt>Check-in closes</dt>
        <dd>{formatClock(form.end_time)}</dd>
      </div>
    </dl>
  );
}

export default function CreateEvent({ onCreated }) {
  const wallet = useWallet();
  const [form, setForm] = useState(INITIAL);
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    setForm(freshForm());
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/config", { cache: "no-store" })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (!active) return;
        if (response.ok) setConfig(body);
        else setConfigError(body.error ?? "config_unavailable");
      })
      .catch(() => active && setConfigError("network_error"));
    return () => {
      active = false;
    };
  }, []);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setCreated(null);

    if (wallet.phase !== "signedIn" || !wallet.accountId) {
      setError("Connect and sign in with the organizer wallet first.");
      return;
    }
    if (!config?.contract_id) {
      setError("This deployment has no contract configured, so it cannot create a real event.");
      return;
    }
    const schedule = eventWindowFrom(form);
    if (!schedule) {
      setError("Choose the event date, start time and end time. Nothing was sent.");
      return;
    }
    const invalidSchedule = scheduleError(schedule);
    if (invalidSchedule) {
      setError(`${invalidSchedule} Nothing was sent.`);
      return;
    }

    setBusy(true);
    try {
      const metadata = {
        schema_version: 1,
        network_id: config.network_id,
        contract_id: config.contract_id,
        organizer_account_id: wallet.accountId,
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category.trim(),
        venue: form.venue.trim(),
        image_url: form.image_url.trim(),
        tags: form.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        created_at: new Date().toISOString(),
      };
      const hashed = await hashMetadata(metadata);

      const args = {
        deposit: parseNear(form.deposit),
        capacity: Number(form.capacity),
        start_at: toNanoseconds(schedule.start_at),
        end_at: toNanoseconds(schedule.end_at),
        registration_deadline: toNanoseconds(schedule.registration_deadline),
        checkin_open: toNanoseconds(schedule.checkin_open),
        checkin_close: toNanoseconds(schedule.checkin_close),
        metadata_hash: hashed.array,
      };

      const call = await sendContractCall({
        contractId: config.contract_id,
        methodName: "create_event",
        args,
        deposit: parseNear(form.storage),
        gas: "100000000000000",
        expectedAccount: wallet.accountId,
      });

      let eventId = call.value;
      if (eventId === null || eventId === undefined || eventId === "") {
        // Wallets are not required to expose the return value. The contract's event
        // count is monotonic, so the newest id is the one just created.
        const countResponse = await fetch("/api/contract/event-count", { cache: "no-store" });
        const countBody = await countResponse.json().catch(() => ({}));
        if (!countResponse.ok || !/^\d+$/.test(String(countBody.count))) {
          throw new Error("The event was sent, but its id could not be read. Open the studio and retry the metadata save.");
        }
        eventId = String(Number(countBody.count) - 1);
      }
      eventId = String(eventId).replace(/^"|"$/g, "");
      if (!/^\d+$/.test(eventId)) {
        throw new Error("The contract returned an invalid event id.");
      }

      const metadataResponse = await fetch(`/api/events/${encodeURIComponent(eventId)}/metadata`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metadata: hashed.metadata, create_tx_hash: call.hash }),
      });
      const metadataBody = await metadataResponse.json().catch(() => ({}));
      if (!metadataResponse.ok) {
        throw new Error(
          `Event ${eventId} is on chain, but its metadata could not be saved (${metadataBody.error ?? metadataResponse.status}). Keep this id: ${eventId}.`,
        );
      }

      const publishResponse = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/publication`,
        { method: "POST" },
      );
      const publishBody = await publishResponse.json().catch(() => ({}));
      if (!publishResponse.ok) {
        throw new Error(
          `Event ${eventId} was saved as a draft, but could not be published (${publishBody.error ?? publishResponse.status}).`,
        );
      }

      setCreated({ eventId, hash: call.hash, version: publishBody.version });
      onCreated?.(eventId);
    } catch (caught) {
      setError(contractError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel create-panel" id="create">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Organizer action</p>
          <h2>Create a real event</h2>
        </div>
        <span className="network-pill">
          <span className="network-dot" aria-hidden="true" />
          On-chain
        </span>
      </div>

      <p className="panel-intro">
        Submits <code>create_event</code>, stores the canonical metadata and publishes it. The
        storage contribution is non-refundable; attendee deposits stay in escrow.
      </p>

      {configError ? (
        <div className="studio-notice studio-notice--error" role="alert">
          <span className="studio-notice-mark">!</span>
          <p>The contract configuration could not be loaded ({configError}). Nothing was sent.</p>
        </div>
      ) : null}

      {wallet.phase !== "signedIn" ? (
        <div className="studio-notice studio-notice--info">
          <span className="studio-notice-mark">
            <Spark size={14} />
          </span>
          <p>Connect the organizer wallet above. Creating an event requires an on-chain signature.</p>
        </div>
      ) : null}

      <form className="studio-form event-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Title">
            <input
              value={form.title}
              onChange={(event) => update("title", event.target.value)}
              maxLength={140}
              required
              placeholder="Sunday Table"
            />
          </Field>
          <Field label="Category">
            <input
              value={form.category}
              onChange={(event) => update("category", event.target.value)}
              maxLength={40}
              required
            />
          </Field>
          <Field label="Venue">
            <input
              value={form.venue}
              onChange={(event) => update("venue", event.target.value)}
              maxLength={200}
              placeholder="Kreuzberg Community Kitchen · Berlin"
            />
          </Field>
          <Field label="Image URL (optional)">
            <input
              type="url"
              value={form.image_url}
              onChange={(event) => update("image_url", event.target.value)}
              placeholder="https://…"
            />
          </Field>
        </div>

        <Field label="Description">
          <textarea
            value={form.description}
            onChange={(event) => update("description", event.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="What is the room, who is it for, and what should people bring?"
          />
        </Field>

        <Field label="Tags (comma separated)">
          <input
            value={form.tags}
            onChange={(event) => update("tags", event.target.value)}
            placeholder="supper, neighbours"
          />
        </Field>

        <div className="form-grid form-grid--three">
          <Field label="Deposit (NEAR)" help="Exact amount each attendee escrows.">
            <input
              inputMode="decimal"
              value={form.deposit}
              onChange={(event) => update("deposit", event.target.value)}
              required
            />
          </Field>
          <Field label="Capacity" help="1–500 seats.">
            <input
              type="number"
              min="1"
              max="500"
              value={form.capacity}
              onChange={(event) => update("capacity", event.target.value)}
              required
            />
          </Field>
          <Field label="Storage contribution (NEAR)" help="Non-refundable; at least 0.01.">
            <input
              inputMode="decimal"
              value={form.storage}
              onChange={(event) => update("storage", event.target.value)}
              required
            />
          </Field>
        </div>

        <div className="schedule-block">
          <div className="schedule-head">
            <span>Schedule</span>
            <small>
              {windowLength(form)
                ? `${windowLength(form)} from start to end`
                : "Derived from the event times"}
            </small>
          </div>

          <div className="form-grid form-grid--three schedule-grid">
            <Field label="Date">
              <input
                type="date"
                value={form.date}
                min={localToday()}
                onChange={(event) => update("date", event.target.value)}
                required
              />
            </Field>
            <Field label="Starts">
              <input
                type="time"
                step="300"
                value={form.start_time}
                onChange={(event) => update("start_time", event.target.value)}
                required
              />
            </Field>
            <Field label="Ends">
              <input
                type="time"
                step="300"
                value={form.end_time}
                onChange={(event) => update("end_time", event.target.value)}
                required
              />
            </Field>
          </div>

          <ScheduleLedger form={form} />
          {form.start_time && form.end_time && form.end_time <= form.start_time ? (
            <p className="schedule-caption schedule-caption--warn">
              The end time must be after the start time.
            </p>
          ) : (
            <p className="schedule-caption">
              Registration closes at the start. Check-in runs from the start to the end. No
              separate windows to manage.
            </p>
          )}
        </div>

        <div className="action-row">
          <button
            type="submit"
            className="button button-dark"
            disabled={busy || wallet.phase !== "signedIn" || !config?.contract_id}
          >
            {busy ? "Waiting for wallet…" : "Create and publish"}
            <ArrowUpRight size={16} />
          </button>
          <span className="form-footnote">
            One wallet approval for create. Metadata save and publication follow automatically.
          </span>
        </div>
      </form>

      {error ? (
        <div className="studio-notice studio-notice--error" role="alert">
          <span className="studio-notice-mark">!</span>
          <p>{error}</p>
        </div>
      ) : null}

      {created ? (
        <div className="result-card">
          <div className="result-card-top">
            <span className="status-badge status-badge--live">
              <Check size={13} />
              Event {created.eventId} live
            </span>
            <Link href={`/events/${created.eventId}`} className="result-link">
              Open public page
              <ArrowUpRight size={14} />
            </Link>
          </div>
          <h3>Created, stored and published.</h3>
          <p className="result-venue">
            The contract owns the deposit, capacity and schedule. The public page shows only the
            verified snapshot.
          </p>
          <div className="result-meta">
            <span>Version {created.version ?? 1}</span>
            <span>Create tx {created.hash ?? "confirmed"}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
