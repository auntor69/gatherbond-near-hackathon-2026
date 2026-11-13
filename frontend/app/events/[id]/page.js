import { notFound } from "next/navigation";

import EventDetail from "../../../components/event-detail";
import JsonLd from "../../../components/json-ld";
import { eventJsonLd, eventSeoDescription } from "../../../lib/seo.js";
import { loadPublishedEvent } from "../../../lib/serverEvents.mjs";
import { absoluteUrl, eventPath } from "../../../lib/site.js";

export const runtime = "nodejs";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const result = await loadPublishedEvent(id);
  if (!result.event) {
    return {
      title: "Event unavailable",
      description: "This room has no verified public publication on GatherBond.",
      alternates: { canonical: eventPath(id) },
      robots: { index: false, follow: false },
    };
  }

  const event = result.event;
  const description = eventSeoDescription(event);
  const image = `/events/${encodeURIComponent(event.id)}/opengraph-image`;

  return {
    title: event.title,
    description,
    keywords: [
      event.title,
      event.category,
      event.venue,
      "NEAR Testnet",
      ...(event.tags ?? []),
    ].filter(Boolean),
    authors: [{ name: event.organizer }],
    alternates: { canonical: eventPath(event.id) },
    openGraph: {
      type: "article",
      locale: "en_US",
      url: eventPath(event.id),
      siteName: "GatherBond",
      title: `${event.title} · GatherBond`,
      description,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: `${event.title} — verified GatherBond room`,
        },
      ],
      ...(event.publishedAt ? { publishedTime: event.publishedAt } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: `${event.title} · GatherBond`,
      description,
      images: [image],
    },
    robots: { index: true, follow: true },
  };
}

export default async function EventPage({ params }) {
  const { id } = await params;
  const result = await loadPublishedEvent(id);

  if (result.status === "invalid" || result.status === "not_found") {
    notFound();
  }

  return (
    <>
      {result.event ? <JsonLd data={eventJsonLd(result.event)} /> : null}
      <EventDetail
        key={result.event?.id ?? id}
        id={id}
        initialEvent={result.event}
        initialStatus={result.status}
        initialError={result.error}
      />
    </>
  );
}
