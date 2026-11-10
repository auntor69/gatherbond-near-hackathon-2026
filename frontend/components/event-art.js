export default function EventArt({ event, className = "" }) {
  const title = typeof event?.title === "string" && event.title.trim() ? event.title.trim() : "GatherBond";
  const mark = title.charAt(0).toUpperCase();
  const accent = event?.accent ?? "lime";
  const number = String(event?.id ?? "").padStart(3, "0").slice(-3);

  return (
    <div className={`event-art ${className}`.trim()} data-accent={accent} aria-hidden="true">
      <span className="event-art-grid" />
      <span className="event-art-ring event-art-ring--one" />
      <span className="event-art-ring event-art-ring--two" />
      <span className="event-art-label">
        {event?.category ?? "Event"} / On-chain
      </span>
      <span className="event-art-mark">{mark}</span>
      <span className="event-art-number">GB—{number}</span>
    </div>
  );
}
