"use client";

import Link from "next/link";
import { useState } from "react";

import { ArrowUpRight, Check, Ticket, Wallet } from "./icons";
import { formatDate, shortHash } from "../lib/events";
import { useWallet } from "./wallet-provider";
import CreateEvent from "./create-event";
import CheckIn from "./check-in";

const TABS = [
  { id: "create", label: "Create" },
  { id: "gate", label: "Gate" },
  { id: "publish", label: "Publish" },
];

function Notice({ notice }) {
  if (!notice) {
    return null;
  }
  return (
    <div className={`studio-notice studio-notice--${notice.tone}`} role="status">
      <span className="studio-notice-mark">{notice.tone === "success" ? <Check size={15} /> : "!"}</span>
      <p>{notice.text}</p>
    </div>
  );
}

export default function Studio() {
  const wallet = useWallet();
  const [tab, setTab] = useState("create");
  const [eventId, setEventId] = useState("0");
  const [publication, setPublication] = useState(null);
  const [draft, setDraft] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);

  const cleanId = eventId.trim();

  function requireId() {
    if (!cleanId) {
      setNotice({ tone: "error", text: "Enter the on-chain event ID first." });
      return false;
    }
    return true;
  }

  async function loadPublication(event) {
    event?.preventDefault?.();
    if (!requireId()) {
      return;
    }
    setBusy("load");
    setNotice(null);
    setDraft(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(cleanId)}/publication`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setPublication({ state: "published", body });
        setNotice({
          tone: "success",
          text: `Loaded the public snapshot for event ${cleanId} (version ${body.version}).`,
        });
      } else if (response.status === 404) {
        setPublication({ state: "missing", status: 404 });
        setNotice({
          tone: "info",
          text: "This event has no public snapshot yet. Drafts do not appear in discovery.",
        });
      } else {
        setPublication({ state: "error", status: response.status, error: body.error });
        setNotice({
          tone: "error",
          text:
            body.error === "metadata_store_unavailable"
              ? "The metadata store is offline. Nothing was changed."
              : "The publication could not be loaded. Nothing was changed.",
        });
      }
    } catch {
      setPublication({ state: "error", error: "network_error" });
      setNotice({ tone: "error", text: "The request failed before reaching the server." });
    } finally {
      setBusy(null);
    }
  }

  async function verifyDraft() {
    if (!requireId()) {
      return;
    }
    setBusy("verify");
    setNotice(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(cleanId)}/metadata`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.verified) {
        setDraft({ state: "verified", body });
        setNotice({
          tone: "success",
          text: "The draft re-hashes correctly and matches the metadata hash in the contract.",
        });
      } else {
        setDraft({ state: "error", status: response.status, error: body.error });
        setNotice({
          tone: "error",
          text:
            body.error === "metadata_hash_mismatch"
              ? "Hash mismatch. This draft will not be shown as verified or published by the UI."
              : "No verified draft was returned for this event.",
        });
      }
    } catch {
      setDraft({ state: "error", error: "network_error" });
      setNotice({ tone: "error", text: "The verification request failed." });
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!requireId()) {
      return;
    }
    setBusy("publish");
    setNotice(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(cleanId)}/publication`, {
        method: "POST",
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setPublication({ state: "published", body });
        setNotice({
          tone: "success",
          text:
            body.outcome === "published"
              ? `Published version ${body.version}. Earlier versions stay in history.`
              : `Content is unchanged. Version ${body.version} is already public.`,
        });
      } else {
        setNotice({
          tone: "error",
          text:
            response.status === 401
              ? "Connect the organizer wallet first. Nothing was published."
              : response.status === 403
                ? "This session is not the organizer for that event."
                : "Publish failed. Nothing was changed.",
        });
      }
    } catch {
      setNotice({ tone: "error", text: "The publish request failed before reaching the server." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="page page--studio">
      <section className="page-hero">
        <div className="shell page-hero-grid">
          <div>
            <p className="eyebrow">Organizer studio / NEAR Testnet</p>
            <h1>
              The room
              <br />
              <em>behind the room.</em>
            </h1>
          </div>
          <div className="page-hero-aside">
            <p>Create the event, scan people in at the door, and publish the public page. Settlement starts automatically after the end.</p>
            <div className="page-hero-meta">
              <span>
                <Check size={15} />
                Permanent history
              </span>
              <span>
                <Ticket size={15} />
                Door-only check-in
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="shell studio-shell">
        <div className="studio-tabs" role="tablist" aria-label="Studio sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`studio-tab${tab === item.id ? " studio-tab--active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "create" ? (
          <div role="tabpanel" aria-label="Create">
            <CreateEvent
              onCreated={(id) => {
                setEventId(String(id));
              }}
            />
          </div>
        ) : null}

        {tab === "gate" ? (
          <div role="tabpanel" aria-label="Gate">
            <CheckIn defaultEventId={cleanId || "0"} />
          </div>
        ) : null}

        {tab === "publish" ? (
          <div role="tabpanel" aria-label="Publish">
            <section className="panel studio-panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Public page</p>
                  <h2>Publish an event</h2>
                </div>
                <span className="network-pill">
                  <span className="network-dot" aria-hidden="true" />
                  Testnet
                </span>
              </div>

              <p className="panel-intro">
                Publishing appends a new version. It never removes an event from the site, and
                every earlier version stays in history.
              </p>

              {wallet.phase !== "signedIn" ? (
                <div className="action-row action-row--tight">
                  <button
                    type="button"
                    className="button button-dark button-small"
                    onClick={wallet.connect}
                    disabled={
                      wallet.busy !== null ||
                      wallet.phase === "loading" ||
                      wallet.phase === "unavailable"
                    }
                  >
                    <Wallet size={14} />
                    {wallet.busy === "connect" ? "Waiting for wallet…" : "Connect organizer wallet"}
                  </button>
                </div>
              ) : null}

              <form className="studio-form" onSubmit={loadPublication}>
                <label className="field">
                  <span>On-chain event ID</span>
                  <input
                    value={eventId}
                    onChange={(event) => setEventId(event.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="0"
                    aria-describedby="event-id-help"
                  />
                </label>
                <p className="field-help" id="event-id-help">
                  The decimal ID assigned by <code>create_event</code>.
                </p>
                <div className="action-row">
                  <button type="submit" className="button button-dark" disabled={busy !== null}>
                    {busy === "load" ? "Loading…" : "Load publication"}
                    <ArrowUpRight size={16} />
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={verifyDraft}
                    disabled={busy !== null}
                  >
                    {busy === "verify" ? "Checking…" : "Verify draft"}
                  </button>
                </div>
              </form>

              <Notice notice={notice} />

              {publication?.state === "published" ? (
                <div className="result-card">
                  <div className="result-card-top">
                    <span className="status-badge status-badge--live">
                      <span className="status-dot" />
                      Published v{publication.body.version}
                    </span>
                    <Link
                      href={`/events/${encodeURIComponent(cleanId)}`}
                      className="result-link"
                    >
                      Open public page
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                  <h3>{publication.body.metadata?.title ?? `Event ${cleanId}`}</h3>
                  <p className="result-venue">{publication.body.metadata?.venue}</p>
                  <div className="result-meta">
                    <span>Published {formatDate(publication.body.published_at) ?? "—"}</span>
                    <span>By {publication.body.published_by ?? "organizer"}</span>
                  </div>
                  <div className="action-row action-row--tight">
                    <button
                      type="button"
                      className="button button-dark button-small"
                      onClick={publish}
                      disabled={busy !== null}
                    >
                      {busy === "publish" ? "Publishing…" : "Publish current draft"}
                    </button>
                  </div>
                  <details className="result-hash">
                    <summary>Advanced</summary>
                    <span>Metadata SHA-256</span>
                    <code title={publication.body.metadata_sha256}>
                      {shortHash(publication.body.metadata_sha256, 16, 8)}
                    </code>
                  </details>
                </div>
              ) : null}

              {publication?.state === "missing" ? (
                <div className="result-card result-card--muted">
                  <span className="status-badge">Not published yet</span>
                  <h3>No public snapshot.</h3>
                  <p>
                    The event exists as a draft. Publishing creates version 1 and makes it
                    discoverable. Nothing is ever unpublished automatically.
                  </p>
                  <button
                    type="button"
                    className="button button-dark button-small"
                    onClick={publish}
                    disabled={busy !== null}
                  >
                    {busy === "publish" ? "Publishing…" : "Publish current draft"}
                  </button>
                </div>
              ) : null}

              {publication?.state === "error" ? (
                <div className="result-card result-card--error">
                  <span className="status-badge">Not loaded</span>
                  <h3>No verified snapshot returned.</h3>
                  <p>
                    {publication.status
                      ? `The API answered ${publication.status}${publication.error ? ` (${publication.error})` : ""}.`
                      : "The request did not reach the API."}
                  </p>
                </div>
              ) : null}

              {draft?.state === "verified" ? (
                <div className="draft-card">
                  <div className="draft-card-head">
                    <span className="status-badge status-badge--live">
                      <Check size={13} />
                      Draft verified
                    </span>
                    <span className="mono-label">v{draft.body.publication_version ?? 0}</span>
                  </div>
                  <h3>{draft.body.metadata?.title}</h3>
                  <details className="result-hash">
                    <summary>Advanced</summary>
                    <span>Draft SHA-256</span>
                    <code title={draft.body.metadata_sha256}>
                      {shortHash(draft.body.metadata_sha256, 16, 8)}
                    </code>
                  </details>
                  <p className="draft-copy">
                    The local bytes re-hash to the stored digest and match the contract&apos;s
                    <code> metadata_hash</code>. This does not publish it.
                  </p>
                </div>
              ) : null}

              {draft?.state === "error" ? (
                <div className="draft-card draft-card--error">
                  <span className="status-badge">Draft not verified</span>
                  <p>
                    {draft.error === "metadata_hash_mismatch"
                      ? "The stored metadata no longer matches its hash. It will stay out of discovery."
                      : "No verified draft is available for this event yet."}
                  </p>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
