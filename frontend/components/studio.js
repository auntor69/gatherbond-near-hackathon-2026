"use client";

import Link from "next/link";
import { useState } from "react";

import {
  ArrowUpRight,
  Check,
  ShieldCheck,
  Spark,
  Ticket,
  Wallet,
} from "./icons";
import { formatDate, shortHash } from "../lib/events";
import { useWallet } from "./wallet-provider";
import CreateEvent from "./create-event";
import CheckIn from "./check-in";
import RoomProof from "./room-proof";

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
              ? "Connect a wallet session first using the session card. Nothing was published."
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
              ? "Connect a wallet session first using the session card. Nothing was unpublished."
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
    wallet.phase === "signedIn"
      ? "Verified wallet session"
      : wallet.phase === "signedOut"
        ? "No wallet session"
        : wallet.phase === "unavailable"
          ? "Session auth unavailable"
          : wallet.phase === "error"
            ? "Session check failed"
            : "Checking session";

  const sessionCopy =
    wallet.phase === "signedIn"
      ? "The server verified a NEP-413 signature for this account. Publishing uses that actor; the browser never handles a Turso token."
      : wallet.phase === "signedOut"
        ? "Connect a NEAR Testnet wallet. It signs a NEP-413 message; no funds move."
        : wallet.phase === "unavailable"
          ? "GATHERBOND_SESSION_SECRET is not configured, so login and authenticated writes are disabled."
          : wallet.phase === "error"
            ? "The session endpoint could not be reached. Reload or check the server."
            : "Checking the server-side session cookie.";

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
            <p>Load an event, verify the draft, publish one immutable snapshot. The public page only sees the latest verified version.</p>
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
          <CreateEvent onCreated={(id) => setEventId(String(id))} />

          <section className="panel studio-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Publication console</p>
                <h2>Load an existing event</h2>
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

          <RoomProof eventId={cleanId} />

          <CheckIn defaultEventId={cleanId} />
        </div>

        <aside className="studio-side">
          <section className="session-card">
            <div className="session-card-head">
              <span className={`session-dot session-dot--${wallet.phase}`} aria-hidden="true" />
              <span>{sessionLabel}</span>
            </div>
            <p>{sessionCopy}</p>
            {wallet.phase === "signedIn" && wallet.accountId ? (
              <code className="session-account">{wallet.accountId}</code>
            ) : null}
            <div className="session-actions">
              {wallet.phase === "signedIn" ? (
                <button
                  type="button"
                  className="button button-dark button-small"
                  onClick={wallet.disconnect}
                  disabled={wallet.busy !== null}
                >
                  {wallet.busy === "disconnect" ? "Signing out…" : "Sign out"}
                </button>
              ) : (
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
                  {wallet.busy === "connect"
                    ? "Waiting for wallet…"
                    : wallet.phase === "unavailable"
                      ? "Wallet auth unavailable"
                      : "Connect wallet"}
                </button>
              )}
            </div>
            <div className="session-rule" />
            <p className="session-footnote">
              The wallet signs a NEP-413 message. The server verifies the key against NEAR
              Testnet and sets an HttpOnly cookie. No transaction or funds move.
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
            <p>Failed auth, a mismatched hash or an offline store is shown as a failure, never replaced with fake success.</p>
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
