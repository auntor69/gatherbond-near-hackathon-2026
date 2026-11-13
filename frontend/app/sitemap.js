import { eventLifecycle } from "../lib/eventState.js";
import { eventJsonLd } from "../lib/seo.js";
import { loadAllPublishedListings } from "../lib/serverEvents.mjs";
import { absoluteUrl, eventPath, recapPath, siteUrl } from "../lib/site.js";

export const revalidate = 3600;

export default async function sitemap() {
  const base = siteUrl();
  const routes = [
    {
      url: `${base}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  const listings = await loadAllPublishedListings();
  if (!listings) {
    return routes;
  }

  for (const event of listings.events) {
    if (!eventJsonLd(event)) {
      continue;
    }
    routes.push({
      url: absoluteUrl(eventPath(event.id)),
      lastModified: event.publishedAt ? new Date(event.publishedAt) : undefined,
      changeFrequency: "weekly",
      priority: 0.8,
    });
    if (eventLifecycle(event).closed) {
      routes.push({
        url: absoluteUrl(recapPath(event.id)),
        lastModified: event.publishedAt ? new Date(event.publishedAt) : undefined,
        changeFrequency: "monthly",
        priority: 0.5,
      });
    }
  }

  return routes;
}
