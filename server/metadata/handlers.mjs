// GatherBond metadata API handlers (framework-agnostic).
//
// M4's Next.js route handlers are thin wrappers around these functions. Nothing here
// reads environment variables, so no TURSO_AUTH_TOKEN can leak into a client bundle:
// the client is constructed server-side and injected.
//
// Trust rules:
//   - the caller is authenticated before `put` (server session; never a browser field);
//   - `getOnChainEvent(key)` must read `get_event(event_id)` from the contract and return
//     `{ metadata_hash }` — the database never decides financial terms or attendance;
//   - a metadata document whose hash differs from the on-chain hash is never returned as
//     verified and is never stored.

import {
  MetadataConflictError,
  MetadataValidationError,
  hashEquals,
  hashMetadata,
  hexToBytes,
  normalizeEventKey,
} from "./canonical.mjs";

function respond(status, body) {
  return { status, body };
}

function invalidKey(error) {
  return respond(400, { error: "invalid_key", detail: error.message });
}

function storeFailure(error) {
  if (error instanceof MetadataConflictError) {
    return respond(409, { error: "metadata_conflict", detail: error.message });
  }
  if (error instanceof MetadataValidationError) {
    return respond(400, { error: "invalid_metadata", detail: error.message });
  }
  return respond(503, { error: "metadata_store_unavailable" });
}

function publicRecord(record) {
  return {
    event: record.key,
    metadata: JSON.parse(record.metadata_json),
    metadata_sha256: record.metadata_sha256,
    metadata_hash: Array.from(hexToBytes(record.metadata_sha256)),
    publication_status: record.publication_status,
    publication_version: record.publication_version ?? 0,
    published_at: record.published_at ?? null,
    create_tx_hash: record.create_tx_hash,
    created_at: record.created_at,
  };
}

function publicationRecord(publication) {
  return {
    event: publication.key,
    version: publication.version,
    publication_status: "published",
    metadata: JSON.parse(publication.metadata_json),
    metadata_sha256: publication.metadata_sha256,
    metadata_hash: Array.from(hexToBytes(publication.metadata_sha256)),
    create_tx_hash: publication.create_tx_hash,
    published_by: publication.published_by,
    published_at: publication.published_at,
  };
}

export function createMetadataHandlers({
  store,
  getOnChainEvent,
  authorize = async () => false,
} = {}) {
  if (!store) {
    throw new Error("createMetadataHandlers requires a metadata store");
  }
  if (typeof getOnChainEvent !== "function") {
    throw new Error("createMetadataHandlers requires getOnChainEvent(key)");
  }

  return {
    /**
     * PUT /api/events/:id/metadata
     * { actor, key, metadata, create_tx_hash }
     */
    async put({ actor, key, metadata, create_tx_hash }) {
      let normalized;
      try {
        normalized = normalizeEventKey(key);
      } catch (error) {
        return invalidKey(error);
      }

      if (!actor) {
        return respond(401, { error: "unauthorized" });
      }

      let hashed;
      try {
        hashed = await hashMetadata(metadata);
      } catch (error) {
        return respond(400, { error: "invalid_metadata", detail: error.message });
      }

      // The authorizer receives the validated document so it can bind the actor to
      // `organizer_account_id` instead of trusting a client-supplied account field.
      let allowed = false;
      try {
        allowed = await authorize({ actor, key: normalized, metadata: hashed.metadata });
      } catch {
        allowed = false;
      }
      if (!allowed) {
        return respond(403, { error: "forbidden" });
      }

      let onChain;
      try {
        onChain = await getOnChainEvent(normalized);
      } catch {
        return respond(503, { error: "chain_unavailable" });
      }
      if (!onChain) {
        return respond(404, { error: "event_not_found_on_chain" });
      }
      if (!hashEquals(hashed.hex, onChain.metadata_hash)) {
        return respond(409, {
          error: "metadata_hash_mismatch",
          submitted: hashed.hex,
          on_chain: onChain.metadata_hash ?? null,
        });
      }

      try {
        const { outcome, record } = await store.save({
          key: normalized,
          metadata: hashed.metadata,
          organizer_account_id: hashed.metadata.organizer_account_id,
          create_tx_hash,
        });
        return respond(outcome === "inserted" ? 201 : 200, {
          outcome,
          ...publicRecord(record),
        });
      } catch (error) {
        return storeFailure(error);
      }
    },

    /** GET /api/events/:id/metadata — verified against the stored and on-chain hash. */
    async get({ key }) {
      let normalized;
      try {
        normalized = normalizeEventKey(key);
      } catch (error) {
        return invalidKey(error);
      }

      let record;
      try {
        record = await store.get(normalized);
      } catch {
        return respond(503, { error: "metadata_store_unavailable" });
      }
      if (!record) {
        return respond(404, { error: "metadata_not_found" });
      }

      const local = await store.verify(record);
      if (!local.matches) {
        return respond(409, {
          error: "metadata_hash_mismatch",
          stored: record.metadata_sha256,
          recomputed: local.actual ?? null,
        });
      }

      let onChain;
      try {
        onChain = await getOnChainEvent(normalized);
      } catch {
        return respond(503, { error: "chain_unavailable" });
      }
      if (!onChain) {
        return respond(409, { error: "event_not_found_on_chain" });
      }
      if (!hashEquals(record.metadata_sha256, onChain.metadata_hash)) {
        return respond(409, {
          error: "metadata_hash_mismatch",
          stored: record.metadata_sha256,
          on_chain: onChain.metadata_hash ?? null,
        });
      }

      return respond(200, { verified: true, ...publicRecord(record) });
    },

    /**
     * POST /api/events/:id/publication
     * Publish the organizer's current verified draft. Repeating an unchanged publish is
     * a no-op that reports the existing version.
     */
    async publish({ actor, key }) {
      let normalized;
      try {
        normalized = normalizeEventKey(key);
      } catch (error) {
        return invalidKey(error);
      }
      if (!actor) {
        return respond(401, { error: "unauthorized" });
      }

      let record;
      try {
        record = await store.get(normalized);
      } catch {
        return respond(503, { error: "metadata_store_unavailable" });
      }
      if (!record) {
        return respond(404, { error: "metadata_not_found" });
      }

      let allowed = false;
      try {
        allowed = await authorize({
          actor,
          key: normalized,
          metadata: { organizer_account_id: record.organizer_account_id },
        });
      } catch {
        allowed = false;
      }
      if (!allowed) {
        return respond(403, { error: "forbidden" });
      }

      const local = await store.verify(record);
      if (!local.matches) {
        return respond(409, {
          error: "metadata_hash_mismatch",
          stored: record.metadata_sha256,
          recomputed: local.actual ?? null,
        });
      }

      let onChain;
      try {
        onChain = await getOnChainEvent(normalized);
      } catch {
        return respond(503, { error: "chain_unavailable" });
      }
      if (!onChain) {
        return respond(404, { error: "event_not_found_on_chain" });
      }
      if (!hashEquals(record.metadata_sha256, onChain.metadata_hash)) {
        return respond(409, {
          error: "metadata_hash_mismatch",
          stored: record.metadata_sha256,
          on_chain: onChain.metadata_hash ?? null,
        });
      }

      try {
        const { outcome, publication } = await store.publish({
          key: normalized,
          published_by: actor,
        });
        if (outcome === "not_found" || !publication) {
          return respond(404, { error: "metadata_not_found" });
        }
        return respond(outcome === "published" ? 201 : 200, {
          outcome,
          ...publicationRecord(publication),
        });
      } catch {
        return respond(503, { error: "metadata_store_unavailable" });
      }
    },

    /** GET /api/events/:id/publication — public current snapshot, never a draft. */
    async getPublication({ key }) {
      let normalized;
      try {
        normalized = normalizeEventKey(key);
      } catch (error) {
        return invalidKey(error);
      }

      let publication;
      try {
        publication = await store.getPublication(normalized);
      } catch {
        return respond(503, { error: "metadata_store_unavailable" });
      }
      if (!publication) {
        return respond(404, { error: "not_published" });
      }

      const local = await store.verify(publication);
      if (!local.matches) {
        return respond(409, {
          error: "metadata_hash_mismatch",
          stored: publication.metadata_sha256,
          recomputed: local.actual ?? null,
        });
      }

      let onChain;
      try {
        onChain = await getOnChainEvent(normalized);
      } catch {
        return respond(503, { error: "chain_unavailable" });
      }
      if (!onChain) {
        return respond(409, { error: "event_not_found_on_chain" });
      }
      if (!hashEquals(publication.metadata_sha256, onChain.metadata_hash)) {
        return respond(409, {
          error: "metadata_hash_mismatch",
          stored: publication.metadata_sha256,
          on_chain: onChain.metadata_hash ?? null,
        });
      }

      return respond(200, { verified: true, ...publicationRecord(publication) });
    },

    /**
     * GET /api/events/:id — the verified publication plus the contract's public terms.
     * The publication remains the only metadata source; `onchain` is the read-only
     * EventView used by the detail page for schedule, deposit, capacity and status.
     */
    async details({ key }) {
      let normalized;
      try {
        normalized = normalizeEventKey(key);
      } catch (error) {
        return invalidKey(error);
      }

      let publication;
      try {
        publication = await store.getPublication(normalized);
      } catch {
        return respond(503, { error: "metadata_store_unavailable" });
      }
      if (!publication) {
        return respond(404, { error: "not_published" });
      }

      const local = await store.verify(publication);
      if (!local.matches) {
        return respond(409, {
          error: "metadata_hash_mismatch",
          stored: publication.metadata_sha256,
          recomputed: local.actual ?? null,
        });
      }

      let onChain;
      try {
        onChain = await getOnChainEvent(normalized);
      } catch {
        return respond(503, { error: "chain_unavailable" });
      }
      if (!onChain) {
        return respond(409, { error: "event_not_found_on_chain" });
      }
      if (!hashEquals(publication.metadata_sha256, onChain.metadata_hash)) {
        return respond(409, {
          error: "metadata_hash_mismatch",
          stored: publication.metadata_sha256,
          on_chain: onChain.metadata_hash ?? null,
        });
      }

      return respond(200, {
        verified: true,
        ...publicationRecord(publication),
        onchain: onChain,
      });
    },

    /**
     * GET /api/events?status=published&limit&offset&category
     * Discovery only lists rows that still hash to their stored digest. On-chain
     * cross-checks happen on the detail route, where a single event is read.
     */
    async list({ limit, offset, category } = {}) {
      let rows;
      try {
        rows = await store.listPublished({ limit, offset, category });
      } catch {
        return respond(503, { error: "metadata_store_unavailable" });
      }

      const items = [];
      let skipped = 0;
      for (const record of rows) {
        const local = await store.verify(record);
        if (!local.matches) {
          skipped += 1;
          continue;
        }
        items.push(publicRecord(record));
      }

      const pageOffset = Math.max(Number(offset) || 0, 0);
      return respond(200, {
        items,
        skipped,
        next_offset: pageOffset + rows.length,
      });
    },
  };
}
