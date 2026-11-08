// Framework-level HTTP routes for event metadata.
//
// Next.js route handlers are thin wrappers around these functions. They speak the Web
// Request/Response API, so the same code is testable with plain `Request` objects and
// carries no framework dependency.

import { rateLimitedResponse } from "./rateLimit.mjs";

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

async function readEventId(context) {
  const params = await context?.params;
  const id = params?.id;
  if (Array.isArray(id)) {
    return id[0] ?? null;
  }
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function createMetadataRoutes({
  handlers,
  getActor = async () => null,
  rateLimitWrite,
  networkId,
  contractId,
} = {}) {
  if (!handlers) {
    throw new Error("createMetadataRoutes requires handlers");
  }
  if (!networkId || !contractId) {
    throw new Error("createMetadataRoutes requires networkId and contractId");
  }

  const keyFor = (eventId) => ({
    network_id: networkId,
    contract_id: contractId,
    event_id: eventId,
  });

  /** Resolve the session/dev actor and charge the shared per-actor write limit. */
  const authenticatedWrite = async (request) => {
    let actor = null;
    try {
      actor = await getActor(request);
    } catch {
      actor = null;
    }

    if (actor && typeof rateLimitWrite === "function") {
      let limit;
      try {
        limit = await rateLimitWrite(actor);
      } catch {
        return { actor, response: jsonResponse(503, { error: "rate_limit_unavailable" }) };
      }
      if (limit && limit.allowed === false) {
        return { actor, response: rateLimitedResponse(limit) };
      }
    }
    return { actor, response: null };
  };

  return {
    /** GET /api/events?limit&offset&category */
    async list(request) {
      try {
        const url = new URL(request.url);
        const result = await handlers.list({
          limit: url.searchParams.get("limit") ?? undefined,
          offset: url.searchParams.get("offset") ?? undefined,
          category: url.searchParams.get("category") ?? undefined,
        });
        return jsonResponse(result.status, result.body);
      } catch {
        return jsonResponse(500, { error: "internal_error" });
      }
    },

    /** GET /api/events/:id/metadata */
    async get(request, context) {
      const eventId = await readEventId(context);
      if (!eventId) {
        return jsonResponse(400, { error: "invalid_key", detail: "missing event id" });
      }
      try {
        const result = await handlers.get({ key: keyFor(eventId) });
        return jsonResponse(result.status, result.body);
      } catch {
        return jsonResponse(500, { error: "internal_error" });
      }
    },

    /** PUT /api/events/:id/metadata — body { metadata, create_tx_hash } */
    async put(request, context) {
      const eventId = await readEventId(context);
      if (!eventId) {
        return jsonResponse(400, { error: "invalid_key", detail: "missing event id" });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse(400, { error: "invalid_json" });
      }
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse(400, { error: "invalid_body" });
      }

      // Authenticated writes are limited per account. The limiter runs before the
      // handler, so a throttled attempt does not touch the chain or the metadata store.
      const { actor, response: limited } = await authenticatedWrite(request);
      if (limited) {
        return limited;
      }

      try {
        const result = await handlers.put({
          actor,
          key: keyFor(eventId),
          metadata: body.metadata,
          create_tx_hash: body.create_tx_hash,
        });
        return jsonResponse(result.status, result.body);
      } catch {
        return jsonResponse(500, { error: "internal_error" });
      }
    },

    /** POST /api/events/:id/publication — publish the organizer's current draft. */
    async publish(request, context) {
      const eventId = await readEventId(context);
      if (!eventId) {
        return jsonResponse(400, { error: "invalid_key", detail: "missing event id" });
      }

      const { actor, response: limited } = await authenticatedWrite(request);
      if (limited) {
        return limited;
      }

      try {
        const result = await handlers.publish({ actor, key: keyFor(eventId) });
        return jsonResponse(result.status, result.body);
      } catch {
        return jsonResponse(500, { error: "internal_error" });
      }
    },

    /** DELETE /api/events/:id/publication — remove the current version from public view. */
    async unpublish(request, context) {
      const eventId = await readEventId(context);
      if (!eventId) {
        return jsonResponse(400, { error: "invalid_key", detail: "missing event id" });
      }

      const { actor, response: limited } = await authenticatedWrite(request);
      if (limited) {
        return limited;
      }

      try {
        const result = await handlers.unpublish({ actor, key: keyFor(eventId) });
        return jsonResponse(result.status, result.body);
      } catch {
        return jsonResponse(500, { error: "internal_error" });
      }
    },

    /** GET /api/events/:id/publication — the public current snapshot only. */
    async getPublication(request, context) {
      const eventId = await readEventId(context);
      if (!eventId) {
        return jsonResponse(400, { error: "invalid_key", detail: "missing event id" });
      }
      try {
        const result = await handlers.getPublication({ key: keyFor(eventId) });
        return jsonResponse(result.status, result.body);
      } catch {
        return jsonResponse(500, { error: "internal_error" });
      }
    },
  };
}
