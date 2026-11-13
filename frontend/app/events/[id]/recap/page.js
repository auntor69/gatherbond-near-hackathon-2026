import { notFound } from "next/navigation";

import EventRecap from "../../../../components/event-recap";
import JsonLd from "../../../../components/json-ld";
import { eventLifecycle } from "../../../../lib/eventState.js";
import { metaDescription, recapGraph } from "../../../../lib/seo.js";
import { loadPublishedEvent } from "../../../../lib/serverEvents.mjs";
import { eventPath, recapPath } from "../../../../lib/site.js";

export const runtime = "nodejs";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const result = await loadPublishedEvent(id);
  if (!result.event) {
    return {
      title: "Room proof unavailable",
      description: "This room has no verified public proof on GatherBond.",
      alternates: { canonical: recapPath(id) },
      robots: { index: false, follow: false },
    };
  }

  const event = result.event;
  const closed = eventLifecycle(event).closed;
  const description = metaDescription(
    `${event.title}: ${event.checkedIn ?? 0} of ${event.registered ?? 0} reserved seats checked in at ${event.venue}. Public attendance and settlement proof from the NEAR contract.`,
  );
  const image = `/events/${encodeURIComponent(event.id)}/opengraph-image`;

  return {
    title: `${event.title} — Room proof`,
    description,
    keywords: [event.title, event.category, event.venue, "NEAR proof", "room proof"].filter(
      Boolean,
    ),
    alternates: { canonical: recapPath(event.id) },
    openGraph: {
      type: "article",
      locale: "en_US",
      url: recapPath(event.id),
      siteName: "GatherBond",
      title: `${event.title} — Room proof · GatherBond`,
      description,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: `${event.title} — GatherBond room proof`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${event.title} — Room proof · GatherBond`,
      description,
      images: [image],
    },
    robots: closed ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export default async function EventRecapPage({ params }) {
  const { id } = await params;
  const result = await loadPublishedEvent(id);

  if (result.status === "invalid" || result.status === "not_found") {
    notFound();
  }

  return (
    <>
      {result.event ? <JsonLd data={recapGraph(result.event)} /> : null}
      <EventRecap
        key={result.event?.id ?? id}
        id={id}
        initialEvent={result.event}
        initialStatus={result.status}
        initialError={result.error}
      />
    </>
  );
}
