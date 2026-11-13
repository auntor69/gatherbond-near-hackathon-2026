"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import EventArt from "./event-art";
import EventCard from "./event-card";
import { ArrowRight, ArrowUpRight, Check, Search } from "./icons";
import { eventLifecycle, eventStartsAt } from "../lib/eventState";
import { eventWhenLabel, formatNear, mapListing } from "../lib/events";

function listingOrder(left, right) {
  const leftLifecycle = eventLifecycle(left);
  const rightLifecycle = eventLifecycle(right);
  const rank = (lifecycle) => {
    if (lifecycle.closed) return 3;
    if (lifecycle.started) return 2;
    return 1;
  };
  const rankDiff = rank(leftLifecycle) - rank(rightLifecycle);
  if (rankDiff !== 0) return rankDiff;
  const leftStart = eventStartsAt(left) ?? 0;
  const rightStart = eventStartsAt(right) ?? 0;
  return leftLifecycle.closed ? rightStart - leftStart : leftStart - rightStart;
}

function FeatureEvent({ event }) {
  const lifecycle = eventLifecycle(event);
  const closed = lifecycle.closed;
  return (
    <Link href={`/events/${encodeURIComponent(event.id)}`} className="feature-card">
      <div className="feature-art">
        <EventArt event={event} className="feature-art-inner" />
        <span className="feature-stamp">
          {closed ? (
            <>Latest<br />room</>
          ) : lifecycle.started ? (
            <>Happening<br />now</>
          ) : (
            <>Next<br />up</>
          )}
        </span>
      </div>
      <div className="feature-body">
        <div className="feature-topline">
          <span className="feature-label">
            Featured room{closed ? ` · ${lifecycle.displayStatus}` : ""}
          </span>
        </div>
        <h3 className="feature-title">{event.title}</h3>
        <p className="feature-description">{event.description}</p>
        <div className="feature-meta">
          <span>{eventWhenLabel(event)}</span>
          <span>{event.venue}</span>
          {formatNear(event.deposit) ? <span>{formatNear(event.deposit)}</span> : null}
        </div>
        <span className="feature-cta">
          Open the event
          <ArrowUpRight size={17} />
        </span>
      </div>
    </Link>
  );
}

function SkeletonGrid() {
  return (
    <div className="event-grid" aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <div className="skeleton-card" key={item}>
          <div className="skeleton skeleton-art" />
          <div className="skeleton-body">
            <div className="skeleton skeleton-line skeleton-line--short" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line skeleton-line--medium" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Discover({ initial = null }) {
  const [liveEvents, setLiveEvents] = useState(() => initial?.events ?? []);
  const [source, setSource] = useState(() => {
    if (!initial) return "loading";
    return initial.events.length > 0 || initial.skipped > 0 ? "live" : "empty";
  });
  const [skipped, setSkipped] = useState(initial?.skipped ?? 0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  useEffect(() => {
    // The server already rendered the verified shelf. Keep that content in the HTML
    // instead of replacing it with a client-only loading state.
    if (initial) return undefined;
    let active = true;

    async function load() {
      try {
        const response = await fetch("/api/events?limit=24", { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!active) {
          return;
        }
        const skippedRows = Number(body.skipped) || 0;
        if (
          response.ok &&
          Array.isArray(body.items) &&
          (body.items.length > 0 || skippedRows > 0)
        ) {
          setLiveEvents(body.items.map(mapListing).filter((event) => event.id));
          setSkipped(skippedRows);
          setSource("live");
        } else {
          setSource(body.error ? "unavailable" : "empty");
        }
      } catch {
        if (active) {
          setSource("unavailable");
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [initial]);

  const events = useMemo(() => [...liveEvents].sort(listingOrder), [liveEvents]);
  const loading = source === "loading";

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(events.map((event) => event.category).filter(Boolean)))],
    [events],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      const categoryMatch = category === "All" || event.category === category;
      if (!categoryMatch) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return [event.title, event.category, event.venue, event.organizer, ...(event.tags ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [events, category, query]);

  const showFeatured = !query.trim() && category === "All" && filtered.length > 0;
  const gridEvents = showFeatured ? filtered.slice(1) : filtered;

  function clearFilters() {
    setQuery("");
    setCategory("All");
  }

  return (
    <section className="section discover-section" id="discover">
      <div className="shell">
        <div className="section-head discover-head">
          <div>
            <p className="eyebrow">02 / The shelf</p>
            <h2 className="section-title">
              Rooms worth
              <br />
              <em>showing up for.</em>
            </h2>
          </div>
          <p className="section-copy">
            Find a room with a real commitment attached. Every listing is checked against the
            event contract before it is shown.
          </p>
        </div>

        <div className="discover-toolbar">
          <label className="search-field">
            <Search size={18} />
            <span className="sr-only">Search events</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search rooms, cities, people"
            />
          </label>

          <div className="filter-row" aria-label="Filter by category">
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                className="filter-chip"
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="discover-status">
          <span className="result-count" aria-live="polite">
            {loading
              ? "Checking the shelf…"
              : `${filtered.length} ${filtered.length === 1 ? "room" : "rooms"}`}
          </span>
          {source === "live" ? (
            <span className="live-note">
              <Check size={14} />
              Contract-checked
            </span>
          ) : null}
        </div>

        {source === "unavailable" ? (
          <div className="data-note" role="alert">
            Discovery is temporarily offline. No sample or cached events are substituted.
          </div>
        ) : null}

        {source === "live" && skipped > 0 ? (
          <p className="data-note">
            {skipped} published {skipped === 1 ? "row was" : "rows were"} hidden because they
            could not be verified against the contract.
          </p>
        ) : null}

        {loading ? <SkeletonGrid /> : null}

        {!loading && filtered.length === 0 && source === "empty" ? (
          <div className="empty-state">
            <span className="empty-state-mark">+</span>
            <h3>No rooms are published yet.</h3>
            <p>Connect an organizer wallet and create the first real event on the contract.</p>
            <Link href="/studio#create" className="button button-dark">
              Create the first event <ArrowRight size={15} />
            </Link>
          </div>
        ) : null}

        {!loading && filtered.length === 0 && source === "live" && events.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-mark">∅</span>
            <h3>No verified rooms are available.</h3>
            <p>
              Every published row was hidden because it could not be verified against the
              contract. Nothing unverified is being shown.
            </p>
          </div>
        ) : null}

        {!loading && filtered.length === 0 && source === "live" && events.length > 0 ? (
          <div className="empty-state">
            <span className="empty-state-mark">∅</span>
            <h3>Nothing matches those filters.</h3>
            <p>Try another word, or clear the filters to see every published room.</p>
            <button type="button" className="button button-dark" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : null}

        {!loading && showFeatured ? <FeatureEvent event={filtered[0]} /> : null}

        {!loading && gridEvents.length > 0 ? (
          <div className="event-grid">
            {gridEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        ) : null}

        {!loading && showFeatured && gridEvents.length === 0 ? (
          <p className="shelf-tail">
            One room is enough for now.{" "}
            <Link href="/studio" className="text-link">
              Add another <ArrowRight size={14} />
            </Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}
