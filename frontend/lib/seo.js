import { eventWhenLabel } from "./events.js";
import { absoluteUrl, eventPath, recapPath, siteUrl } from "./site.js";

const DESCRIPTION_LIMIT = 160;

/** Collapse whitespace and cut on a word boundary so metadata stays readable. */
export function metaDescription(value, fallback = "") {
  const text = String(value ?? fallback)
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "";
  }
  if (text.length <= DESCRIPTION_LIMIT) {
    return text;
  }
  const clipped = text.slice(0, DESCRIPTION_LIMIT - 1);
  const boundary = clipped.lastIndexOf(" ");
  return `${(boundary > 80 ? clipped.slice(0, boundary) : clipped).trimEnd()}…`;
}

export function eventSeoDescription(event) {
  const detail =
    String(event?.description ?? "").trim() ||
    `${event?.category || "Community"} gathering at ${event?.venue || "a real venue"}.`;
  return metaDescription(
    `${detail} ${eventWhenLabel(event)}. Reserve with a refundable NEAR Testnet bond on GatherBond.`,
  );
}

function isoDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function organizationJsonLd() {
  const base = siteUrl();
  return {
    "@type": "Organization",
    "@id": `${base}/#organization`,
    name: "GatherBond",
    url: base,
    logo: {
      "@type": "ImageObject",
      url: `${base}/icon.svg`,
    },
    sameAs: [
      "https://github.com/auntor69/gatherbond-near-hackathon-2026",
      "https://x.com/GatherBondApp",
    ],
  };
}

export function websiteJsonLd() {
  const base = siteUrl();
  return {
    "@type": "WebSite",
    "@id": `${base}/#website`,
    name: "GatherBond",
    alternateName: "GatherBond — Make plans. Keep them.",
    url: base,
    description:
      "Refundable commitments for real-world gatherings on NEAR Testnet. Show up, get your bond back, and share the no-show pool.",
    inLanguage: "en",
    publisher: { "@id": `${base}/#organization` },
  };
}

export function eventJsonLd(event) {
  if (!event?.id || !event?.title) {
    return null;
  }
  const url = absoluteUrl(eventPath(event.id));
  const startDate = isoDate(event.startAt);
  const endDate = isoDate(event.endAt);
  // Structured data should use the same canonical card a crawler or social client
  // receives for this event, not an organizer image or the generic site card.
  const image = absoluteUrl(
    `/events/${encodeURIComponent(String(event.id))}/opengraph-image`,
  );
  const cancelled = event.status === "Cancelled" || event.status === "Failed";
  const description =
    String(event.description ?? "").trim() ||
    `${event.title} at ${event.venue || "a real venue"} — a refundable GatherBond commitment on NEAR Testnet.`;

  const data = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description,
    url,
    mainEntityOfPage: url,
    image: [image],
    eventStatus: cancelled
      ? "https://schema.org/EventCancelled"
      : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    inLanguage: "en",
    location: {
      "@type": "Place",
      name: event.venue || "Venue to be announced",
      address: event.venue || "Venue to be announced",
    },
    organizer: {
      "@type": "Organization",
      name: event.organizer || "GatherBond organizer",
    },
    identifier: {
      "@type": "PropertyValue",
      propertyID: "NEAR event",
      value: `${event.contractId || "cynopom.testnet"}:${event.id}`,
    },
  };

  if (startDate) {
    data.startDate = startDate;
  }
  if (endDate) {
    data.endDate = endDate;
  }
  if (Array.isArray(event.tags) && event.tags.length > 0) {
    data.keywords = event.tags.join(", ");
  }
  if (event.registrationDeadline) {
    data.validThrough = isoDate(event.registrationDeadline) ?? undefined;
  }

  return data;
}

export function itemListJsonLd(events = []) {
  const items = events
    .filter((event) => event?.id && event?.title)
    .slice(0, 50)
    .map((event, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: event.title,
      url: absoluteUrl(eventPath(event.id)),
    }));
  if (items.length === 0) {
    return null;
  }
  return {
    "@type": "ItemList",
    name: "Published GatherBond rooms",
    itemListElement: items,
  };
}

export function homeGraph(events = []) {
  const graph = [organizationJsonLd(), websiteJsonLd()];
  const list = itemListJsonLd(events);
  if (list) {
    graph.push(list);
  }
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

export function breadcrumbJsonLd(event) {
  const items = [
    {
      "@type": "ListItem",
      position: 1,
      name: "GatherBond",
      item: absoluteUrl("/"),
    },
  ];
  if (event?.id && event?.title) {
    items.push({
      "@type": "ListItem",
      position: 2,
      name: event.title,
      item: absoluteUrl(eventPath(event.id)),
    });
  }
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}

export function recapGraph(event) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: `${event.title} — Room proof`,
        description: `Public attendance and settlement proof for ${event.title} on GatherBond.`,
        url: absoluteUrl(recapPath(event.id)),
        isPartOf: { "@id": `${siteUrl()}/#website` },
        about: eventJsonLd(event),
        inLanguage: "en",
      },
      breadcrumbJsonLd(event),
    ],
  };
}

/** Serialize JSON-LD without allowing a `</script>` sequence to terminate the tag. */
export function jsonLdString(value) {
  return JSON.stringify(value ?? {})
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
