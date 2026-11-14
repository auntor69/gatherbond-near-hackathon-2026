// Private moderation handlers.
//
// The contract has no delete_event method. Hiding an event is therefore a public-surface
// takedown: the on-chain event and its funds remain untouched, while discovery, the event
// page, the recap, the sitemap and the public APIs omit it. Every action is audited.

import { hashEquals, normalizeEventKey } from "../metadata/canonical.mjs";

function respond(status, body) {
  return { status, body };
}

function storeFailure() {
  return respond(503, { error: "moderation_store_unavailable" });
}

function parseMetadata(record) {
  if (!record) {
    return null;
  }
  try {
    return JSON.parse(record.metadata_json);
  } catch {
    return null;
  }
}

function eventIdOf(event) {
  return String(event?.event_id ?? event?.id ?? "");
}

async function readAllEvents(reader, { max = 200 } = {}) {
  if (!reader) {
    throw new Error("contract reader is not configured");
  }
  const count = Math.max(0, Number(await reader.getEventCount()) || 0);
  const events = [];
  let from = 0;
  while (from < Math.min(count, max) && events.length < max) {
    const page = await reader.getEvents(from, 20);
    if (!Array.isArray(page) || page.length === 0) {
      break;
    }
    events.push(...page);
    const lastId = Number(eventIdOf(page[page.length - 1]));
    if (!Number.isFinite(lastId)) {
      break;
    }
    from = lastId + 1;
    if (page.length < 20) {
      break;
    }
  }
  return events;
}

export function createAdminHandlers({ store, reader, networkId, contractId } = {}) {
  if (!store) {
    throw new Error("createAdminHandlers requires a metadata store");
  }
  const keyFor = (eventId) => ({
    network_id: networkId,
    contract_id: contractId,
    event_id: String(eventId),
  });

  async function describe(event) {
    const eventId = eventIdOf(event);
    let normalized;
    try {
      normalized = normalizeEventKey(keyFor(eventId));
    } catch {
      return null;
    }

    const [record, publication, moderation] = await Promise.all([
      store.get(normalized),
      store.getPublication(normalized),
      store.getModeration(normalized),
    ]);

    const hidden = Boolean(moderation);
    const metadata = parseMetadata(record);
    let verifiedPublication = false;
    if (publication) {
      try {
        const local = await store.verify(publication);
        verifiedPublication =
          local.matches && hashEquals(publication.metadata_sha256, event?.metadata_hash);
      } catch {
        verifiedPublication = false;
      }
    }
    const listed = Boolean(publication && verifiedPublication && !hidden);

    return {
      event_id: eventId,
      title: metadata?.title ?? null,
      category: metadata?.category ?? null,
      venue: metadata?.venue ?? null,
      organizer: metadata?.organizer_account_id ?? event?.organizer ?? null,
      onchain_status: event?.status ?? null,
      registered: event?.registered ?? null,
      checked_in: event?.checked_in ?? null,
      start_at: event?.start_at ?? null,
      end_at: event?.end_at ?? null,
      metadata_sha256: record?.metadata_sha256 ?? null,
      publication_version: publication?.version ?? null,
      publication_verified: verifiedPublication,
      listed,
      hidden,
      moderation: moderation
        ? {
            reason: moderation.reason,
            actor: moderation.actor,
            updated_at: moderation.updated_at,
          }
        : null,
      public_path: `/events/${encodeURIComponent(eventId)}`,
    };
  }

  return {
    /** All on-chain events, including drafts and unverified rows. */
    async list({ limit = 200 } = {}) {
      let events;
      try {
        events = await readAllEvents(reader, { max: Math.min(Math.max(Number(limit) || 200, 1), 200) });
      } catch {
        return respond(503, { error: "chain_unavailable" });
      }

      let items;
      try {
        items = (await Promise.all(events.map(describe))).filter(Boolean);
      } catch {
        return storeFailure();
      }

      let audit = [];
      try {
        audit = await store.listModerationLog({ limit: 20, networkId, contractId });
      } catch {
        audit = [];
      }

      return respond(200, {
        network_id: networkId,
        contract_id: contractId,
        total: items.length,
        hidden: items.filter((item) => item.hidden).length,
        items: items.sort((left, right) => Number(right.event_id) - Number(left.event_id)),
        audit,
      });
    },

    async moderate({ eventId, action, reason, actor, confirm } = {}) {
      if (action !== "hide" && action !== "restore") {
        return respond(400, { error: "invalid_action" });
      }
      if (typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > 500) {
        return respond(400, { error: "invalid_reason", detail: "reason must be 3-500 characters" });
      }
      if (action === "hide" && String(confirm ?? "") !== String(eventId)) {
        return respond(400, {
          error: "confirmation_required",
          detail: "confirm must equal the event id",
        });
      }

      let key;
      try {
        key = normalizeEventKey(keyFor(eventId));
      } catch {
        return respond(400, { error: "invalid_event_id" });
      }

      let event;
      try {
        event = await reader.getEvent(key.event_id);
      } catch {
        return respond(503, { error: "chain_unavailable" });
      }
      if (!event) {
        return respond(404, { error: "event_not_found_on_chain" });
      }

      try {
        const result =
          action === "hide"
            ? await store.hide({ key, reason, actor })
            : await store.restore({ key, reason, actor });
        return respond(200, {
          event_id: key.event_id,
          action,
          ...result,
        });
      } catch {
        return storeFailure();
      }
    },
  };
}
