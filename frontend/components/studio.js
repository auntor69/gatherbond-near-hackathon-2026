"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  ArrowUpRight,
  Check,
  Copy,
  ShieldCheck,
  Spark,
  Ticket,
  Wallet,
} from "./icons";
import { formatDate, shortHash } from "../lib/events";

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
  const [session, setSession] = useState({ state: "loading" });
  const [eventId, setEventId] = useState("0");
  const [publication, setPublication] = useState(null);
  const [draft, setDraft] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!active) {
          return;
        }
        if (response.ok && body.account_id) {
          setSession({ state: "signedIn", accountId: body.account_id });
        } else if (response.status === 503) {
          setSession({ state: "unavailable" });
        } else {
          setSession({ state: "signedOut" });
        }
      })
      .catch(() => {
        if (active) {
          setSession({ state: "unavailable" });
        }
      });
    return () => {
      active = false;
    };
  }, []);

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
        setPublication({ state: "unpublished", status: 404 });
        setNotice({
          tone: "info",
          text: "This event has no current public snapshot. Drafts do not appear in discovery.",
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
              ? `Published version ${body.version}. The event is now eligible for discovery.`
              : `Content is unchanged. Version ${body.version} is already public.`,
        });
      } else {
        setNotice({
          tone: "error",
          text:
            response.status === 401
              ? "Sign in with a NEP-413 wallet session before publishing. No wallet signature was requested."
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

  async function unpublish() {
    if (!requireId()) {
      return;
    }
    setBusy("unpublish");
    setNotice(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(cleanId)}/publication`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setPublication({ state: "unpublished", body });
        setNotice({
          tone: "success",
          text: `Unpublished. Version ${body.version} is a tombstone; the public snapshot is closed.`,
        });
      } else {
        setNotice({
          tone: "error",
          text:
            response.status === 401
              ? "Sign in with a NEP-413 wallet session before unpublishing."
              : "Unpublish failed. The public snapshot was not changed.",
        });
      }
    } catch {
      setNotice({ tone: "error", text: "The unpublish request failed before reaching the server." });
    } finally {
      setBusy(null);
    }
  }

  const sessionLabel =
    session.state === "signedIn"
      ? "Signed organizer session"
      : session.state === "signedOut"
        ? "No wallet session"
        : session.state === "unavailable"
          ? "Session auth unavailable"
          : "Checking session";

  const sessionCopy =
    session.state === "signedIn"
      ? "The server has a verified, HttpOnly session cookie. Publishing uses that actor; the browser never handles a Turso token."
      : session.state === "signedOut"
        ? "Reads are public. Publishing needs a verified NEP-413 wallet session; this build does not request a wallet signature yet, so publish will answer 401."
        : session.state === "unavailable"
          ? "GATHERBOND_SESSION_SECRET is not configured on this deployment, so login and authenticated writes are disabled."
          : "Checking whether a server-side session cookie is present.";

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
            <p>
              Load an event, verify the draft against the contract, and publish one immutable
              snapshot at a time. A public page only ever sees the latest verified publication.
            </p>
            <div className="page-hero-meta">
              <span>
                <ShieldCheck size={15} />
                Hash checked
              </span>
              <span>
                <Ticket size={15} />
                Versioned
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="shell studio-grid">
        <div className="studio-main">
          <section className="panel studio-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Publication console</p>
                <h2>Load an event</h2>
              </div>
              <span className="network-pill">
                <span className="network-dot" aria-hidden="true" />
                Testnet
              </span>
            </div>

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
                The decimal ID assigned by <code>create_event</code>. The network and contract
                come from the server, never from this form.
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
                <div className="result-hash">
                  <span>Metadata SHA-256</span>
                  <code title={publication.body.metadata_sha256}>
                    {shortHash(publication.body.metadata_sha256, 16, 8)}
                  </code>
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
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={unpublish}
                    disabled={busy !== null}
                  >
                    {busy === "unpublish" ? "Unpublishing…" : "Unpublish"}
                  </button>
                </div>
              </div>
            ) : null}

            {publication?.state === "unpublished" ? (
              <div className="result-card result-card--muted">
                <span className="status-badge">No public snapshot</span>
                <h3>This room is closed to discovery.</h3>
                <p>
                  The event may have a draft, or its latest publication may be a tombstone.
                  Publishing a verified draft creates the next version.
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
                <div className="result-hash">
                  <span>Draft SHA-256</span>
                  <code title={draft.body.metadata_sha256}>
                    {shortHash(draft.body.metadata_sha256, 16, 8)}
                  </code>
                </div>
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

          <section className="panel studio-guide">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Publication rules</p>
                <h2>One snapshot. No side doors.</h2>
              </div>
              <Copy size={22} />
            </div>
            <div className="guide-grid">
              <div>
                <span className="guide-number">01</span>
                <h3>Drafts stay drafts.</h3>
                <p>
                  Discovery only selects the latest <code>publish</code> row. Drafts, tombstones
                  and superseded versions never appear on the public shelf.
                </p>
              </div>
              <div>
                <span className="guide-number">02</span>
                <h3>Unpublish is a tombstone.</h3>
                <p>
                  It closes the public snapshot without deleting the audit history. Republishing
                  later creates the next monotonic version.
                </p>
              </div>
              <div>
                <span className="guide-number">03</span>
                <h3>The contract keeps the truth.</h3>
                <p>
                  Deposit, capacity, attendance and settlement are read from NEAR. The metadata
                  row can never prove payment or presence.
                </p>
              </div>
            </div>
          </section>
        </div>

        <aside className="studio-side">
          <section className="session-card">
            <div className="session-card-head">
              <span className={`session-dot session-dot--${session.state}`} aria-hidden="true" />
              <span>{sessionLabel}</span>
            </div>
            <p>{sessionCopy}</p>
            {session.state === "signedIn" ? (
              <code className="session-account">{session.accountId}</code>
            ) : null}
            <div className="session-rule" />
            <p className="session-footnote">
              Authentication is a server-verified NEP-413 signature and an HttpOnly cookie. A
              wallet connector is not embedded in this screen.
            </p>
          </section>

          <section className="console-panel">
            <div className="console-top">
              <span>PUBLIC API</span>
              <span>NO CREDENTIALS</span>
            </div>
            <div className="console-line">
              <span className="console-prompt">$</span>
              GET /api/events/{cleanId || ":id"}/publication
            </div>
            <div className="console-result">
              <span>→</span> 200 verified snapshot · 404 closed · 409 mismatch
            </div>
            <div className="console-line">
              <span className="console-prompt">$</span>
              POST /api/events/{cleanId || ":id"}/publication
            </div>
            <div className="console-result">
              <span>→</span> organizer session · versioned publish
            </div>
            <p>
              The browser never receives <code>TURSO_AUTH_TOKEN</code> or the session secret.
            </p>
          </section>

          <section className="studio-side-note">
            <Spark size={20} />
            <h3>Not a mock console.</h3>
            <p>
              These controls call the routes in this repository. A failed auth, mismatched hash
              or offline store is shown as a failure, not replaced with fake success.
            </p>
            <Link href="/commitments" className="text-link">
              See the attendee side
              <ArrowUpRight size={14} />
            </Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
