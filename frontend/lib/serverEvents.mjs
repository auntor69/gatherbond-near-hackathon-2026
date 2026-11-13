// Server-only data loaders for crawlable pages, the sitemap and social cards. They call
// the same framework-agnostic route layer as the public API, so the same hash and RPC
// verification rules apply. A failure returns an explicit status and never a demo event.

import { cache } from "react";

import { getMetadataRoutes } from "../../server/http/nextRuntime.mjs";
import { mapDetail, mapListing } from "./events.js";

const INTERNAL_ORIGIN = "https://gatherbond.invalid";
const MAX_LIST_PAGE = 50;
const MAX_SITEMAP_PAGES = 20;

function normalizeEventId(value) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? text : null;
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

export const loadPublishedEvent = cache(async (rawId) => {
  const id = normalizeEventId(rawId);
  if (!id) {
    return { status: "invalid", event: null, error: "invalid_key" };
  }

  try {
    const routes = await getMetadataRoutes();
    const response = await routes.details(
      new Request(`${INTERNAL_ORIGIN}/api/events/${id}`),
      { params: { id } },
    );
    const body = await readJson(response);

    if (response.status === 200 && body.verified) {
      return { status: "ready", event: mapDetail(body), error: null };
    }
    if (response.status === 404) {
      return { status: "not_found", event: null, error: body.error ?? "not_published" };
    }
    if (response.status === 409) {
      return {
        status: "conflict",
        event: null,
        error: body.error ?? "metadata_hash_mismatch",
      };
    }
    return {
      status: "unavailable",
      event: null,
      error: body.error ?? "event_unavailable",
      httpStatus: response.status,
    };
  } catch {
    return { status: "unavailable", event: null, error: "network_error" };
  }
});

export const loadPublishedListings = cache(async (limit = 24, offset = 0) => {
  const pageLimit = Math.min(Math.max(Number(limit) || 24, 1), MAX_LIST_PAGE);
  const pageOffset = Math.max(Number(offset) || 0, 0);

  try {
    const routes = await getMetadataRoutes();
    const response = await routes.list(
      new Request(
        `${INTERNAL_ORIGIN}/api/events?limit=${pageLimit}&offset=${pageOffset}`,
      ),
    );
    const body = await readJson(response);
    if (!response.ok || !Array.isArray(body.items)) {
      return null;
    }

    const events = body.items.map(mapListing).filter((event) => event.id);
    const skipped = Number(body.skipped) || 0;
    const nextOffset = Number(body.next_offset);
    return {
      events,
      skipped,
      rowsReturned: body.items.length + skipped,
      nextOffset: Number.isFinite(nextOffset)
        ? nextOffset
        : pageOffset + body.items.length + skipped,
    };
  } catch {
    return null;
  }
});

/** The sitemap only ever contains verified publications, never drafts or guesses. */
export const loadAllPublishedListings = cache(async () => {
  const events = [];
  let skipped = 0;
  let offset = 0;

  for (let page = 0; page < MAX_SITEMAP_PAGES; page += 1) {
    const result = await loadPublishedListings(MAX_LIST_PAGE, offset);
    if (!result) {
      return page === 0 ? null : { events, skipped };
    }
    events.push(...result.events);
    skipped += result.skipped;
    if (result.rowsReturned < MAX_LIST_PAGE || result.nextOffset <= offset) {
      break;
    }
    offset = result.nextOffset;
  }

  return { events, skipped };
});
