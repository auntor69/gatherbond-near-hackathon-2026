// Cache surfaces that must change when a listing is published, hidden or restored.
// Keep this pure so the path set is unit-tested without a Next request.

export function publicationRevalidationTargets(eventId) {
  const id = String(eventId ?? "");
  if (!/^(0|[1-9]\d*)$/.test(id)) {
    return [];
  }
  return [
    { path: "/", type: "layout" },
    { path: `/events/${id}`, type: "page" },
    { path: `/events/${id}/recap`, type: "page" },
    { path: `/events/${id}/opengraph-image` },
  ];
}
