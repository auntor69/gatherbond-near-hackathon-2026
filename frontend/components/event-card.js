import Link from "next/link";

import { ArrowUpRight, MapPin } from "./icons";
import EventArt from "./event-art";
import { eventEnded } from "../lib/eventState";
import { eventWhenLabel, formatNear, statusLabel } from "../lib/events";

export default function EventCard({ event }) {
  const ended = eventEnded(event);
  const displayStatus =
    ended && event.status === "Open" ? "Ended" : statusLabel(event.status);
  return (
    <article className="event-card">
      <Link
        href={`/events/${encodeURIComponent(event.id)}`}
        className="event-card-link"
        aria-label={`View ${event.title}`}
      >
        <EventArt event={event} className="card-art" />
        <div className="card-body">
          <div className="card-topline">
            <span className="card-category">{event.category}</span>
            <span className="card-network" title="Contract status">{displayStatus}</span>
          </div>

          <h3 className="card-title">{event.title}</h3>

          <p className="card-venue">
            <MapPin size={15} />
            <span>{event.venue}</span>
          </p>

          <div className="card-when">
            <span>{eventWhenLabel(event)}</span>
            {formatNear(event.deposit) ? <span>{formatNear(event.deposit)}</span> : null}
          </div>

          <div className="card-footer">
            <span className="card-organizer">by {event.organizer}</span>
            <span className="card-arrow" aria-hidden="true">
              <ArrowUpRight size={17} />
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
