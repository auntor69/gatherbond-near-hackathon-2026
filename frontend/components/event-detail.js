"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import EventArt from "./event-art";
import {
  ArrowRight,
  ArrowUpRight,
  Calendar,
  Check,
  Copy,
  MapPin,
  ShieldCheck,
  Spark,
  Ticket,
  Wallet,
} from "./icons";
import {
  calendarFile,
  demoEventById,
  eventWhenLabel,
  formatDate,
  formatNear,
  mapDetail,
  shortHash,
  statusLabel,
} from "../lib/events";

const ERROR_COPY = {
  metadata_hash_mismatch:
    "The published metadata no longer matches the hash anchored on chain, so it is not being shown as verified.",
  event_not_found_on_chain:
    "The contract does not currently return this event. The listing may be stale or the contract configuration may have changed.",
  chain_unavailable:
    "The NEAR read-only RPC is unavailable right now. Contract terms cannot be verified.",
  metadata_store_unavailable:
    "The metadata store is offline right now. Discovery and event pages are temporarily unavailable.",
  not_published: "This event is not currently published.",
};

function StatePanel({ kicker, title, copy, children }) {
  return (
    <main className="state-page">
      <div className="state-card">
        <p className="eyebrow">{kicker}</p>
        <h1>{title}</h1>
        <p>{copy}</p>
        {children}
      </div>
    </main>
  );
}

function SampleNote() {
  return (
    <div className="detail-note detail-note--sample" role="note">
      <span className="detail-note-mark">SAMPLE</span>
      <p>
        This is sample content used to show the intended event page. It is not an on-chain
        event, has no deposit, and cannot be registered for.
      </p>
    </div>
  );
}

function VerifiedNote({ event }) {
  return (
    <div className="detail-note detail-note--verified" role="note">
      <span className="detail-note-mark">
        <ShieldCheck size={15} />
        VERIFIED
      </span>
      <p>
        The display metadata below was re-hashed and matched to the hash stored in the NEAR
        contract. Financial and timing terms are read from the contract, not from the database.
      </p>
      {event.hash ? (
        <code className="detail-note-hash" title={event.hash}>
          {shortHash(event.hash, 12, 8)}
        </code>
      ) : null}
    </div>
  );
}

export default function EventDetail({ id }) {
  const demo = demoEventById(id);
  const [state, setState] = useState(
    demo ? { status: "demo", event: demo } : { status: "loading", event: null },
  );
  const [shareLabel, setShareLabel] = useState("Share event");

  useEffect(() => {
    if (demo) {
      setState({ status: "demo", event: demo });
      return undefined;
    }

    let active = true;
    setState({ status: "loading", event: null });

    async function load() {
      try {
        const response = await fetch(`/api/events/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!active) {
          return;
        }
        if (response.ok && body.verified) {
          setState({ status: "ready", event: mapDetail(body) });
          return;
        }
        if (response.status === 404) {
          setState({ status: "notfound", event: null, error: body.error });
          return;
        }
        setState({
          status: response.status === 503 ? "unavailable" : "error",
          event: null,
          error: body.error,
          httpStatus: response.status,
        });
      } catch {
        if (active) {
          setState({ status: "unavailable", event: null, error: "network_error" });
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [demo, id]);

  if (state.status === "loading") {
    return (
      <main className="state-page">
        <div className="state-card">
          <span className="loading-mark" aria-hidden="true">
            GB
          </span>
          <p className="eyebrow">Event passport</p>
          <h1>Reading the room.</h1>
          <p>Checking the publication, its metadata hash and the contract terms.</p>
        </div>
      </main>
    );
  }

  if (state.status === "notfound") {
    return (
      <StatePanel
        kicker="404 — no publication"
        title="This room is not open."
        copy="There is no published event at this address, or the organizer has unpublished it."
      >
        <Link href="/#discover" className="button button-dark">
          Back to discover
          <ArrowRight size={16} />
        </Link>
      </StatePanel>
    );
  }

  if (state.status === "error" || state.status === "unavailable") {
    return (
      <StatePanel
        kicker={state.status === "unavailable" ? "Temporarily offline" : "Integrity check failed"}
        title={state.status === "unavailable" ? "The shelf is resting." : "This page is not verified."}
        copy={
          ERROR_COPY[state.error] ??
          "The event could not be loaded right now. Nothing has been shown as verified."
        }
      >
        <Link href="/#discover" className="button button-dark">
          Back to discover
          <ArrowRight size={16} />
        </Link>
      </StatePanel>
    );
  }

  const event = state.event;
  const shareUrl = typeof window === "undefined" ? "" : window.location.href;
  const explorerBase =
    event.network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
  const contractUrl =
    !event.demo && event.onchain && event.contractId
      ? `${explorerBase}/address/${encodeURIComponent(event.contractId)}`
      : null;
  const txUrl =
    !event.demo && event.createTxHash
      ? `${explorerBase}/txns/${encodeURIComponent(event.createTxHash)}`
      : null;

  async function shareEvent() {
    try {
      if (navigator.share) {
        await navigator.share({
          title: event.title,
          text: event.description,
          url: shareUrl,
        });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setShareLabel("Link copied");
      window.setTimeout(() => setShareLabel("Share event"), 2200);
    } catch (error) {
      if (error?.name !== "AbortError") {
        setShareLabel("Copy failed");
        window.setTimeout(() => setShareLabel("Share event"), 2200);
      }
    }
  }

  function downloadCalendar() {
    const text = calendarFile(event);
    if (!text) {
      return;
    }
    const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "gatherbond-event"}.ics`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  }

  const depositLabel = event.demo ? "Not applicable" : formatNear(event.deposit) ?? "Set on-chain";
  const capacityLabel = event.demo
    ? "Not applicable"
    : event.capacity === null || event.capacity === undefined
      ? "From contract"
      : `${event.registered ?? 0} / ${event.capacity}`;

  return (
    <main className="detail-page">
      <section className="detail-hero">
        <div className="shell">
          <Link href="/#discover" className="back-link">
            <ArrowRight size={15} />
            Back to the shelf
          </Link>

          <div className="detail-heading-grid">
            <div className="detail-heading">
              <p className="eyebrow">Event passport / {event.demo ? "Sample" : "NEAR Testnet"}</p>
              <h1 className="detail-title">{event.title}</h1>
              <p className="detail-lede">
                A {event.category.toLowerCase()} gathering at {event.venue}. One room, one
                agreement, one reason to actually turn up.
              </p>
              <div className="detail-meta">
                <span>
                  <Calendar size={16} />
                  {eventWhenLabel(event)}
                </span>
                <span>
                  <MapPin size={16} />
                  {event.venue}
                </span>
              </div>
            </div>

            <div className="detail-actions">
              {event.startAt ? (
                <button type="button" className="button button-dark" onClick={downloadCalendar}>
                  <Calendar size={16} />
                  Add to calendar
                </button>
              ) : null}
              <button type="button" className="button button-ghost" onClick={shareEvent}>
                <Copy size={16} />
                {shareLabel}
              </button>
              {event.demo ? (
                <Link href="/studio" className="button button-lime">
                  Try the studio
                  <ArrowUpRight size={16} />
                </Link>
              ) : null}
            </div>
          </div>

          <div className="detail-stage">
            <EventArt event={event} className="detail-art" />
            <div className="detail-stamp">
              <span>{event.demo ? "SAMPLE" : "PUBLICATION"}</span>
              <strong>{event.demo ? "Not on-chain" : `v${event.version}`}</strong>
            </div>
          </div>
        </div>
      </section>

      <div className="shell detail-layout">
        <article className="detail-main">
          {event.demo ? <SampleNote /> : <VerifiedNote event={event} />}

          <div className="detail-facts">
            <div className="fact">
              <span>Date</span>
              <strong>{eventWhenLabel(event)}</strong>
            </div>
            <div className="fact">
              <span>Room</span>
              <strong>{event.venue}</strong>
            </div>
            <div className="fact">
              <span>Category</span>
              <strong>{event.category}</strong>
            </div>
          </div>

          <section className="prose-block">
            <p className="eyebrow">The invitation</p>
            <h2>What you are saying yes to.</h2>
            <p>{event.description || "The organizer has not added a description yet."}</p>
            {event.tags?.length ? (
              <div className="tag-row">
                {event.tags.map((tag) => (
                  <span className="tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <section className="commitment-explainer" id="commitment">
            <div className="commitment-head">
              <p className="eyebrow">The bond</p>
              <h2>Three moments. One honest agreement.</h2>
              <p>
                GatherBond makes the cost of a no-show visible without turning the event into a
                transaction. The deposit is yours when you do the thing you said you would do.
              </p>
            </div>
            <div className="bond-steps">
              <div className="bond-step">
                <span>01</span>
                <h3>Reserve</h3>
                <p>
                  Send the exact event deposit to the contract on NEAR Testnet. No platform
                  account, no card on file.
                </p>
              </div>
              <div className="bond-step">
                <span>02</span>
                <h3>Show up</h3>
                <p>
                  The organizer checks in your one-time ticket during the published window.
                  Attendance is recorded on chain.
                </p>
              </div>
              <div className="bond-step">
                <span>03</span>
                <h3>Settle</h3>
                <p>
                  Checked-in guests claim their deposit plus a share of the no-show pool.
                  No-shows fund the room.
                </p>
              </div>
            </div>
            {event.demo ? (
              <p className="mechanic-note">
                Mechanic description only. This sample event has no deposit or settlement
                activity.
              </p>
            ) : null}
          </section>

          <section className="terms-section">
            <div className="terms-head">
              <div>
                <p className="eyebrow">On-chain terms</p>
                <h2>The rules, read from the contract.</h2>
              </div>
              {event.onchain ? (
                <span className="onchain-badge">
                  <ShieldCheck size={15} />
                  Contract state
                </span>
              ) : null}
            </div>

            {event.onchain ? (
              <div className="terms-grid">
                <div>
                  <span>Deposit</span>
                  <strong>{formatNear(event.deposit) ?? "—"}</strong>
                </div>
                <div>
                  <span>Capacity</span>
                  <strong>
                    {event.capacity ?? "—"}
                    {event.registered !== null && event.registered !== undefined
                      ? ` seats · ${event.registered} registered`
                      : ""}
                  </strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{statusLabel(event.status)}</strong>
                </div>
                <div>
                  <span>Starts</span>
                  <strong>{formatDate(event.startAt) ?? "—"}</strong>
                </div>
                <div>
                  <span>Ends</span>
                  <strong>{formatDate(event.endAt) ?? "—"}</strong>
                </div>
                <div>
                  <span>Registration closes</span>
                  <strong>{formatDate(event.registrationDeadline) ?? "—"}</strong>
                </div>
              </div>
            ) : (
              <p className="terms-empty">
                This is sample content. When an event is published on NEAR Testnet, its
                deposit, capacity and deadlines are read from the contract and shown here.
              </p>
            )}
          </section>

          <section className="integrity-panel">
            <div className="integrity-head">
              <span className="integrity-icon">
                <ShieldCheck size={20} />
              </span>
              <div>
                <p className="eyebrow">Metadata integrity</p>
                <h2>{event.demo ? "No hash for sample content." : "Checked, not trusted."}</h2>
              </div>
            </div>

            {event.demo ? (
              <p>
                Sample content has no canonical metadata hash or publication transaction. Real
                event pages show the SHA-256 that was anchored on chain.
              </p>
            ) : (
              <>
                <p>
                  The canonical metadata document was hashed before publication and checked
                  against the on-chain <code>metadata_hash</code> every time this page loads.
                </p>
                <div className="hash-block">
                  <span>Metadata SHA-256</span>
                  <code>{event.hash}</code>
                </div>
                <div className="integrity-meta">
                  <span>Version {event.version}</span>
                  <span>Published {formatDate(event.publishedAt) ?? "—"}</span>
                  <span>By {event.publishedBy ?? "organizer"}</span>
                  {txUrl ? (
                    <a href={txUrl} target="_blank" rel="noreferrer">
                      Create transaction <ArrowUpRight size={13} />
                    </a>
                  ) : null}
                </div>
              </>
            )}
          </section>
        </article>

        <aside className="passport" aria-label="Event passport">
          <div className="passport-head">
            <span>
              <Ticket size={16} />
              Event passport
            </span>
            <span className="status-badge">{event.demo ? "Sample" : statusLabel(event.status)}</span>
          </div>

          <div className="passport-body">
            <p className="passport-kicker">{event.category}</p>
            <h2>{event.title}</h2>
            <p className="passport-venue">{event.venue}</p>

            <dl className="passport-rows">
              <div>
                <dt>When</dt>
                <dd>{eventWhenLabel(event)}</dd>
              </div>
              <div>
                <dt>Deposit</dt>
                <dd>{depositLabel}</dd>
              </div>
              <div>
                <dt>Capacity</dt>
                <dd>{capacityLabel}</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>NEAR Testnet</dd>
              </div>
              <div>
                <dt>Organizer</dt>
                <dd>{event.organizer}</dd>
              </div>
              {contractUrl ? (
                <div>
                  <dt>Contract</dt>
                  <dd>
                    <a href={contractUrl} target="_blank" rel="noreferrer" className="passport-link">
                      {shortHash(event.contractId, 8, 6)}
                      <ArrowUpRight size={12} />
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>

            <div className="passport-perforation" aria-hidden="true" />

            {event.demo ? (
              <div className="passport-note">
                <Spark size={17} />
                <p>
                  Sample passport. No deposit, balance or attendance is represented here.
                </p>
              </div>
            ) : (
              <div className="passport-note">
                <Wallet size={17} />
                <p>
                  Wallet registration is the next integration step. This build never invents a
                  balance or a confirmed transaction.
                </p>
              </div>
            )}

            <div className="passport-actions">
              {event.startAt ? (
                <button type="button" className="button button-dark button-full" onClick={downloadCalendar}>
                  <Calendar size={16} />
                  Add to calendar
                </button>
              ) : null}
              <a href="#commitment" className="button button-ghost button-full">
                <Check size={16} />
                How the bond works
              </a>
              <Link href="/commitments" className="passport-subtle-link">
                Open my commitments
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
