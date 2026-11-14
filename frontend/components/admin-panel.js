"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { shortAccount } from "../lib/events";
import { useWallet } from "./wallet-provider";

function messageFor(body, fallback) {
  if (body?.error === "forbidden") {
    return "This wallet is signed in, but it is not on the admin allowlist.";
  }
  if (body?.error === "unauthorized") {
    return "Connect the allowlisted admin wallet to continue.";
  }
  if (body?.error === "admin_unlock_required") {
    return "Enter the admin passphrase to unlock this session.";
  }
  if (body?.error === "invalid_admin_key") {
    return "The admin passphrase is incorrect.";
  }
  if (body?.error === "admin_key_invalid") {
    return "The server admin key is shorter than 16 characters. Fix GATHERBOND_ADMIN_KEY.";
  }
  if (body?.error === "rate_limited") {
    return "Too many attempts. Wait a few minutes and try again.";
  }
  if (body?.error === "chain_unavailable" || body?.error === "moderation_store_unavailable") {
    return "The server could not reach the chain or database. Nothing was changed.";
  }
  return fallback;
}

function Badge({ tone = "neutral", children }) {
  return <span className={`admin-badge admin-badge--${tone}`}>{children}</span>;
}

function formatMoment(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function EventRow({ event, onChanged, onAuthExpired }) {
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const hidden = event.hidden === true;
  const title = event.title || "Untitled event";
  const stateLabel = hidden ? "Hidden" : event.listed ? "Public" : "Not listed";
  const tone = hidden ? "danger" : event.listed ? "live" : "neutral";

  async function submit(action) {
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) {
      setError("Add a short reason (at least 3 characters) for the audit log.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/events/${encodeURIComponent(event.event_id)}/moderation`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-gatherbond-admin": "1",
        },
        body: JSON.stringify({
          action,
          reason: cleanReason,
          confirm: String(event.event_id),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 || (response.status === 403 && body.error === "forbidden")) {
        onAuthExpired?.();
        return;
      }
      if (!response.ok) {
        throw new Error(messageFor(body, "The moderation action failed. Nothing was changed."));
      }
      setReason("");
      setConfirming(false);
      onChanged?.(action === "hide" ? "Event hidden from every public surface." : "Event restored to public surfaces.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The moderation action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`admin-event${hidden ? " admin-event--hidden" : ""}`}>
      <div className="admin-event-head">
        <div className="admin-event-id">
          <span className="admin-mono">EVENT {event.event_id}</span>
          <Badge tone={tone}>{stateLabel}</Badge>
          {event.publication_verified ? <Badge tone="verified">verified metadata</Badge> : null}
        </div>
        <div className="admin-event-links">
          {event.listed ? (
            <Link href={event.public_path} className="admin-link" target="_blank" rel="noreferrer">
              Open public page
            </Link>
          ) : null}
          <span className="admin-mono">{event.onchain_status ?? "Unknown"}</span>
        </div>
      </div>

      <h2>{title}</h2>
      <p className="admin-event-org">
        {event.organizer ? shortAccount(event.organizer, 12, 8) : "Unknown organizer"}
        {event.registered !== null ? ` · ${event.registered} registered · ${event.checked_in ?? 0} checked in` : ""}
      </p>

      {hidden ? (
        <div className="admin-event-moderation">
          <p>
            <strong>Hidden from the site.</strong> The on-chain event still exists. Reason:{" "}
            {event.moderation?.reason}
          </p>
          <p className="admin-mono">
            By {event.moderation?.actor} · {formatMoment(event.moderation?.updated_at)}
          </p>
        </div>
      ) : null}

      <div className="admin-event-action">
        <label className="admin-field">
          <span>{hidden ? "Reason for restoring" : "Reason for hiding"}</span>
          <input
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
              setConfirming(false);
            }}
            maxLength={500}
            placeholder={hidden ? "Reviewed — safe to restore" : "Duplicate demo event"}
            autoComplete="off"
          />
        </label>
        <div className="admin-event-buttons">
          {hidden ? (
            <button
              type="button"
              className="button button-dark button-small"
              onClick={() => submit("restore")}
              disabled={busy}
            >
              {busy ? "Restoring…" : "Restore to site"}
            </button>
          ) : confirming ? (
            <>
              <span className="admin-confirm-copy">
                This hides the event from discovery, its page, recap, API and sitemap. It does
                not delete the contract event or its funds.
              </span>
              <button
                type="button"
                className="button button-danger button-small"
                onClick={() => submit("hide")}
                disabled={busy}
              >
                {busy ? "Hiding…" : "Confirm hide"}
              </button>
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button button-danger button-small"
              onClick={() => {
                if (reason.trim().length < 3) {
                  setError("Add a short reason (at least 3 characters) first.");
                  return;
                }
                setConfirming(true);
              }}
              disabled={busy}
            >
              Hide from site
            </button>
          )}
        </div>
      </div>
      {error ? <p className="admin-error" role="alert">{error}</p> : null}
    </article>
  );
}

export default function AdminPanel() {
  const wallet = useWallet();
  const [access, setAccess] = useState({ phase: "loading", accountId: null, keyRequired: false, error: null });
  const [key, setKey] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [data, setData] = useState(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState(null);

  const loadAccess = useCallback(async () => {
    setData(null);
    setAccess((current) => ({ ...current, phase: "loading", error: null }));
    try {
      const response = await fetch("/api/admin/access", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setAccess({
          phase: "ready",
          accountId: body.account_id ?? null,
          keyRequired: body.key_required === true,
          error: null,
        });
        return;
      }
      if (body.error === "admin_unlock_required") {
        setAccess({
          phase: "locked",
          accountId: wallet.accountId ?? null,
          keyRequired: true,
          error: null,
        });
        return;
      }
      if (body.error === "forbidden") {
        setAccess({
          phase: "forbidden",
          accountId: wallet.accountId ?? null,
          keyRequired: false,
          error: messageFor(body, "Admin access denied."),
        });
        return;
      }
      if (response.status === 401) {
        setAccess({
          phase: "signedOut",
          accountId: null,
          keyRequired: body.key_required === true,
          error: null,
        });
        return;
      }
      setAccess({
        phase: "error",
        accountId: null,
        keyRequired: false,
        error: messageFor(body, "Admin status could not be loaded."),
      });
    } catch {
      setAccess({
        phase: "error",
        accountId: null,
        keyRequired: false,
        error: "The admin service could not be reached.",
      });
    }
  }, [wallet.accountId]);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/events", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        if (body.error === "admin_unlock_required") {
          setAccess((current) => ({ ...current, phase: "locked", keyRequired: true }));
          return;
        }
        setData(null);
        setKey("");
        setAccess({
          phase: "signedOut",
          accountId: null,
          keyRequired: body.key_required === true,
          error: null,
        });
        return;
      }
      if (response.status === 403) {
        setData(null);
        setAccess((current) => ({
          ...current,
          phase: "forbidden",
          error: messageFor(body, "Admin access denied."),
        }));
        return;
      }
      if (!response.ok) {
        throw new Error(messageFor(body, "Events could not be loaded."));
      }
      setData(body);
    } catch (caught) {
      setNotice({
        tone: "error",
        text: caught instanceof Error ? caught.message : "Events could not be loaded.",
      });
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    loadAccess();
  }, [loadAccess]);

  useEffect(() => {
    if (access.phase === "ready") {
      loadEvents();
    }
  }, [access.phase, loadEvents]);

  async function unlock(event) {
    event.preventDefault();
    if (unlocking) return;
    setUnlocking(true);
    setAccess((current) => ({ ...current, error: null }));
    try {
      const response = await fetch("/api/admin/unlock", {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-gatherbond-admin": "1",
        },
        body: JSON.stringify({ key }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(messageFor(body, "Unlock failed."));
      }
      setKey("");
      await loadAccess();
    } catch (caught) {
      setAccess((current) => ({
        ...current,
        error: caught instanceof Error ? caught.message : "Unlock failed.",
      }));
    } finally {
      setUnlocking(false);
    }
  }

  async function lock() {
    setNotice(null);
    try {
      const response = await fetch("/api/admin/unlock", {
        method: "DELETE",
        cache: "no-store",
        headers: { "x-gatherbond-admin": "1" },
      });
      if (!response.ok) {
        throw new Error("The server did not clear the admin session. Try again.");
      }
      setKey("");
      setData(null);
      await loadAccess();
    } catch (caught) {
      setNotice({
        tone: "error",
        text: caught instanceof Error ? caught.message : "The console could not be locked.",
      });
    }
  }

  const events = useMemo(() => {
    const items = Array.isArray(data?.items) ? data.items : [];
    const term = query.trim().toLowerCase();
    if (!term) return items;
    return items.filter((event) =>
      [event.event_id, event.title, event.organizer, event.onchain_status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [data, query]);

  const hiddenCount = data?.hidden ?? 0;
  const total = data?.total ?? 0;

  return (
    <main className="page page--admin">
      <section className="page-hero admin-hero">
        <div className="shell page-hero-grid">
          <div>
            <p className="eyebrow">Private moderation / allowlisted wallet</p>
            <h1>
              Keep the public
              <br />
              <em>room honest.</em>
            </h1>
          </div>
          <div className="page-hero-aside">
            <p>
              Hide duplicate, malicious or scam events from every public GatherBond surface.
              On-chain events cannot be deleted; this console records a reversible takedown
              without touching the contract or anyone&apos;s funds.
            </p>
          </div>
        </div>
      </section>

      <div className="shell admin-shell">
        <div className="admin-access">
          <div>
            <span className="admin-mono">ACCESS</span>
            <strong>
              {access.phase === "ready"
                ? access.accountId
                : access.phase === "loading"
                  ? "Checking session…"
                  : access.phase === "locked"
                    ? "Passphrase required"
                    : access.phase === "forbidden"
                      ? "Wallet not allowlisted"
                      : "Admin access required"}
            </strong>
          </div>
          {access.phase === "ready" && access.keyRequired ? (
            <button type="button" className="button button-ghost button-small" onClick={lock}>
              Lock console
            </button>
          ) : null}
        </div>

        {access.phase === "loading" ? (
          <div className="admin-state" role="status">Checking the private access gate…</div>
        ) : null}

        {access.phase === "signedOut" ? (
          <div className="admin-state">
            <h2>Connect the admin wallet.</h2>
            <p>
              This console is not linked in the site navigation. Access needs a verified
              wallet session for an account on the server allowlist.
            </p>
            <button
              type="button"
              className="button button-dark"
              onClick={wallet.connect}
              disabled={wallet.busy !== null || wallet.phase === "unavailable"}
            >
              {wallet.busy === "connect" ? "Waiting for wallet…" : "Connect admin wallet"}
            </button>
            {wallet.phase === "unavailable" ? (
              <p className="admin-error">Wallet sessions are not configured on this deployment.</p>
            ) : null}
          </div>
        ) : null}

        {access.phase === "forbidden" ? (
          <div className="admin-state admin-state--error">
            <h2>Access denied.</h2>
            <p>{access.error}</p>
            <p className="admin-mono">
              Signed in as {wallet.accountId ?? "unknown"}. Nothing was changed.
            </p>
            <button type="button" className="button button-ghost" onClick={wallet.disconnect}>
              Sign out
            </button>
          </div>
        ) : null}

        {access.phase === "error" ? (
          <div className="admin-state admin-state--error">
            <h2>Admin service unavailable.</h2>
            <p>{access.error}</p>
            <button type="button" className="button button-dark" onClick={loadAccess}>
              Retry
            </button>
          </div>
        ) : null}

        {access.phase === "locked" ? (
          <div className="admin-state">
            <h2>Second factor required.</h2>
            <p>
              The wallet is allowlisted. Enter the server-side admin passphrase to unlock a
              short-lived console session.
            </p>
            <form className="admin-unlock" onSubmit={unlock}>
              <label className="admin-field">
                <span>Admin passphrase</span>
                <input
                  type="password"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <button type="submit" className="button button-dark" disabled={unlocking}>
                {unlocking ? "Unlocking…" : "Unlock console"}
              </button>
            </form>
            {access.error ? <p className="admin-error" role="alert">{access.error}</p> : null}
          </div>
        ) : null}

        {access.phase === "ready" ? (
          <>
            <div className="admin-toolbar">
              <label className="admin-search">
                <span className="sr-only">Filter events</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter by ID, title or organizer"
                />
              </label>
              <div className="admin-toolbar-meta">
                <span className="admin-mono">{total} on-chain</span>
                <span className="admin-mono">{hiddenCount} hidden</span>
                <button
                  type="button"
                  className="button button-ghost button-small"
                  onClick={loadEvents}
                  disabled={loadingEvents}
                >
                  {loadingEvents ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>

            <p className="admin-note">
              <strong>Read this before removing anything.</strong> Hiding is a presentation
              decision, not a contract delete. The event, its deposits and its settlement stay
              on NEAR Testnet. Restoring makes a verified listing public again if its metadata
              still matches the contract.
            </p>

            {notice ? (
              <p className={`admin-flash admin-flash--${notice.tone}`} role="status">
                {notice.text}
              </p>
            ) : null}

            {loadingEvents && !data ? (
              <div className="admin-state" role="status">Loading on-chain events…</div>
            ) : null}

            {!loadingEvents && data && events.length === 0 ? (
              <div className="admin-state">
                <h2>No matching events.</h2>
                <p>Try clearing the filter or refresh the on-chain list.</p>
              </div>
            ) : null}

            <div className="admin-events">
              {events.map((event) => (
                <EventRow
                  key={event.event_id}
                  event={event}
                  onAuthExpired={loadAccess}
                  onChanged={(text) => {
                    loadEvents();
                    setNotice({ tone: "success", text });
                  }}
                />
              ))}
            </div>

            {Array.isArray(data?.audit) && data.audit.length > 0 ? (
              <section className="admin-audit">
                <div className="admin-section-head">
                  <div>
                    <p className="eyebrow">Audit log</p>
                    <h2>Recent moderation actions</h2>
                  </div>
                  <span className="admin-mono">{data.audit.length} shown</span>
                </div>
                <div className="admin-audit-list">
                  {data.audit.map((entry) => (
                    <div className="admin-audit-row" key={entry.id}>
                      <Badge tone={entry.action === "hide" ? "danger" : "live"}>
                        {entry.action}
                      </Badge>
                      <span className="admin-mono">event {entry.key.event_id}</span>
                      <span>{entry.reason}</span>
                      <span className="admin-mono">{entry.actor}</span>
                      <time dateTime={entry.created_at}>{formatMoment(entry.created_at)}</time>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
