"use client";

import { useState } from "react";

export default function EventArt({ event, className = "" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const title =
    typeof event?.title === "string" && event.title.trim() ? event.title.trim() : "GatherBond";
  const mark = title.charAt(0).toUpperCase();
  const accent = event?.accent ?? "lime";
  const number = String(event?.id ?? "").padStart(3, "0").slice(-3);
  const image =
    !imageFailed && typeof event?.imageUrl === "string" ? event.imageUrl.trim() : "";

  return (
    <div className={`event-art ${className}`.trim()} data-accent={accent} aria-hidden="true">
      {image ? (
        <img
          className="event-art-image"
          src={image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : (
        <>
          <span className="event-art-grid" />
          <span className="event-art-ring event-art-ring--one" />
          <span className="event-art-ring event-art-ring--two" />
          <span className="event-art-mark">{mark}</span>
        </>
      )}
      <span
        className="event-art-label"
        style={
          image
            ? {
                background: "rgba(19, 18, 15, 0.78)",
                borderColor: "rgba(255, 255, 255, 0.38)",
                color: "#fff",
              }
            : undefined
        }
      >
        {event?.category ?? "Event"} / {image ? "Poster" : "On-chain"}
      </span>
      <span
        className="event-art-number"
        style={image ? { color: "#fff", textShadow: "0 1px 3px rgba(0, 0, 0, 0.7)" } : undefined}
      >
        GB—{number}
      </span>
    </div>
  );
}
