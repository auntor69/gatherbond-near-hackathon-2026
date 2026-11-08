// GatherBond event-metadata repository over a minimal async SQL port.
//
// The port is { all(sql, params), get(sql, params), run(sql, params), exec(sql) } so the
// same code runs on local SQLite (server/metadata/sqlite.mjs) and Turso/libSQL
// (server/metadata/libsql.mjs). The database is never authoritative for money,
// registration, attendance or claims; it only stores descriptive metadata.
//
// Publication is append-only: every publish/unpublish appends one row to
// event_publications. A row with action='publish' carries the immutable snapshot; a row
// with action='unpublish' is a tombstone. The latest row decides whether the event is
// public, so a transition is one atomic INSERT and can never leave a half-applied state.

import {
  MetadataConflictError,
  MetadataValidationError,
  canonicalJson,
  canonicalMetadata,
  hashMetadata,
  normalizeEventKey,
} from "./canonical.mjs";

const PUBLICATION_STATUSES = new Set(["pending", "published", "hidden"]);
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,88}$/;
const MAX_PAGE = 50;

function rowToRecord(row) {
  if (!row) {
    return null;
  }
  const hasPublication =
    row.publication_version !== undefined && row.publication_version !== null;
  let publicationStatus = row.publication_status;
  if (hasPublication) {
    publicationStatus = row.publication_action === "publish" ? "published" : "pending";
  }
  return {
    key: {
      network_id: row.network_id,
      contract_id: row.contract_id,
      event_id: row.event_id,
    },
    organizer_account_id: row.organizer_account_id,
    metadata_json: row.metadata_json,
    metadata_sha256: row.metadata_sha256,
    create_tx_hash: row.create_tx_hash,
    publication_status: publicationStatus,
    publication_version: hasPublication ? Number(row.publication_version) : 0,
    published_at:
      hasPublication && row.publication_action === "publish"
        ? row.publication_published_at
        : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicationRowToRecord(row) {
  if (!row) {
    return null;
  }
  return {
    key: {
      network_id: row.network_id,
      contract_id: row.contract_id,
      event_id: row.event_id,
    },
    version: Number(row.version),
    action: row.action,
    metadata_json: row.metadata_json,
    metadata_sha256: row.metadata_sha256,
    create_tx_hash: row.create_tx_hash,
    published_by: row.published_by,
    published_at: row.published_at,
  };
}

function requireTxHash(value) {
  if (typeof value !== "string" || !TX_HASH.test(value)) {
    throw new MetadataValidationError("create_tx_hash", "must be a base58 transaction hash");
  }
  return value;
}

function isVersionConflict(error) {
  return /unique|primary key|SQLITE_CONSTRAINT/i.test(
    `${error?.code ?? ""} ${error?.message ?? ""}`,
  );
}

export function createMetadataStore(db) {
  if (!db || typeof db.all !== "function" || typeof db.get !== "function" || typeof db.run !== "function") {
    throw new Error("createMetadataStore requires an async SQL adapter");
  }

  async function latestPublicationRow(normalized) {
    return db.get(
      `SELECT * FROM event_publications
        WHERE network_id = ? AND contract_id = ? AND event_id = ?
          AND version = (
            SELECT MAX(version) FROM event_publications
             WHERE network_id = ? AND contract_id = ? AND event_id = ?
          )
        LIMIT 1`,
      [
        normalized.network_id,
        normalized.contract_id,
        normalized.event_id,
        normalized.network_id,
        normalized.contract_id,
        normalized.event_id,
      ],
    );
  }

  async function get(key) {
    const normalized = normalizeEventKey(key);
    const row = await db.get(
      `SELECT m.*,
              p.version AS publication_version,
              p.action AS publication_action,
              p.published_at AS publication_published_at
         FROM event_metadata m
         LEFT JOIN event_publications p
           ON p.network_id = m.network_id
          AND p.contract_id = m.contract_id
          AND p.event_id = m.event_id
          AND p.version = (
            SELECT MAX(version) FROM event_publications
             WHERE network_id = m.network_id
               AND contract_id = m.contract_id
               AND event_id = m.event_id
          )
        WHERE m.network_id = ? AND m.contract_id = ? AND m.event_id = ?`,
      [normalized.network_id, normalized.contract_id, normalized.event_id],
    );
    return rowToRecord(row);
  }

  async function publish({ key, published_by } = {}) {
    const normalized = normalizeEventKey(key);
    const record = await get(normalized);
    if (!record) {
      return { outcome: "not_found", publication: null };
    }
    const actor = published_by ?? record.organizer_account_id;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const latest = await latestPublicationRow(normalized);
      if (
        latest?.action === "publish" &&
        latest.metadata_sha256 === record.metadata_sha256 &&
        latest.metadata_json === record.metadata_json
      ) {
        return { outcome: "unchanged", publication: publicationRowToRecord(latest) };
      }

      const version = Number(latest?.version ?? 0) + 1;
      const publishedAt = new Date().toISOString();
      try {
        await db.run(
          `INSERT INTO event_publications (
            network_id, contract_id, event_id, version, action,
            metadata_json, metadata_sha256, create_tx_hash, published_by, published_at
          ) VALUES (?, ?, ?, ?, 'publish', ?, ?, ?, ?, ?)`,
          [
            normalized.network_id,
            normalized.contract_id,
            normalized.event_id,
            version,
            record.metadata_json,
            record.metadata_sha256,
            record.create_tx_hash,
            actor,
            publishedAt,
          ],
        );
      } catch (error) {
        // Two concurrent publishers may compute the same next version. The primary key
        // makes exactly one INSERT win; re-read and either report the now-identical
        // publication or try the next version once. Nothing partial is ever written.
        if (attempt === 0 && isVersionConflict(error)) {
          continue;
        }
        throw error;
      }

      return {
        outcome: "published",
        publication: {
          key: normalized,
          version,
          action: "publish",
          metadata_json: record.metadata_json,
          metadata_sha256: record.metadata_sha256,
          create_tx_hash: record.create_tx_hash,
          published_by: actor,
          published_at: publishedAt,
        },
      };
    }

    throw new MetadataConflictError("could not allocate the next publication version");
  }

  async function unpublish({ key, unpublished_by } = {}) {
    const normalized = normalizeEventKey(key);
    const record = await get(normalized);
    if (!record) {
      return { outcome: "not_found", publication: null };
    }
    const actor = unpublished_by ?? record.organizer_account_id;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const latest = await latestPublicationRow(normalized);
      if (!latest) {
        // Nothing has ever been public; there is no version to supersede.
        return { outcome: "unchanged", publication: null };
      }
      if (latest.action === "unpublish") {
        return { outcome: "unchanged", publication: publicationRowToRecord(latest) };
      }

      const version = Number(latest.version) + 1;
      const unpublishedAt = new Date().toISOString();
      try {
        await db.run(
          `INSERT INTO event_publications (
            network_id, contract_id, event_id, version, action,
            metadata_json, metadata_sha256, create_tx_hash, published_by, published_at
          ) VALUES (?, ?, ?, ?, 'unpublish', NULL, NULL, NULL, ?, ?)`,
          [
            normalized.network_id,
            normalized.contract_id,
            normalized.event_id,
            version,
            actor,
            unpublishedAt,
          ],
        );
      } catch (error) {
        if (attempt === 0 && isVersionConflict(error)) {
          continue;
        }
        throw error;
      }

      return {
        outcome: "unpublished",
        publication: {
          key: normalized,
          version,
          action: "unpublish",
          metadata_json: null,
          metadata_sha256: null,
          create_tx_hash: null,
          published_by: actor,
          published_at: unpublishedAt,
        },
      };
    }

    throw new MetadataConflictError("could not allocate the next publication version");
  }

  return {
    /** Idempotent insert: same key and hash is a no-op; a different hash is a conflict. */
    async save({
      key,
      metadata,
      organizer_account_id,
      create_tx_hash,
      publication_status = "pending",
      subtle,
    }) {
      const normalized = normalizeEventKey(key);
      const document = canonicalMetadata(metadata);

      if (document.network_id !== normalized.network_id) {
        throw new MetadataValidationError("network_id", "does not match the event key");
      }
      if (document.contract_id !== normalized.contract_id) {
        throw new MetadataValidationError("contract_id", "does not match the event key");
      }
      if (document.organizer_account_id !== organizer_account_id) {
        throw new MetadataValidationError(
          "organizer_account_id",
          "does not match the metadata document",
        );
      }
      if (!PUBLICATION_STATUSES.has(publication_status)) {
        throw new MetadataValidationError("publication_status", "is not a known status");
      }
      const txHash = requireTxHash(create_tx_hash);

      const hashed = await hashMetadata(document, subtle);
      const existing = await db.get(
        `SELECT metadata_sha256 FROM event_metadata
          WHERE network_id = ? AND contract_id = ? AND event_id = ?`,
        [normalized.network_id, normalized.contract_id, normalized.event_id],
      );

      if (existing) {
        if (existing.metadata_sha256 !== hashed.hex) {
          throw new MetadataConflictError(
            "an event with this identity is already anchored with a different metadata hash",
          );
        }
        return { outcome: "unchanged", record: await get(normalized) };
      }

      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO event_metadata (
          network_id, contract_id, event_id, organizer_account_id,
          title, description, category, venue, image_url, tags_json,
          metadata_json, metadata_sha256, create_tx_hash, publication_status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          normalized.network_id,
          normalized.contract_id,
          normalized.event_id,
          document.organizer_account_id,
          document.title,
          document.description,
          document.category,
          document.venue,
          document.image_url,
          JSON.stringify(document.tags),
          canonicalJson(document),
          hashed.hex,
          txHash,
          publication_status,
          document.created_at,
          now,
        ],
      );

      return { outcome: "inserted", record: await get(normalized) };
    },

    get,

    /** Re-hash the stored document and compare it with the stored digest. */
    async verify(record, subtle) {
      try {
        const parsed = JSON.parse(record.metadata_json);
        const hashed = await hashMetadata(parsed, subtle);
        return {
          matches: hashed.hex === record.metadata_sha256,
          canonical: hashed.canonical,
          actual: hashed.hex,
          stored: record.metadata_sha256,
        };
      } catch (error) {
        return { matches: false, error: error.message, stored: record.metadata_sha256 };
      }
    },

    /**
     * Latest publication only, and only when it is a publish (not a tombstone).
     * Older publish rows are retained for audit but are never returned here.
     */
    async getPublication(key) {
      const normalized = normalizeEventKey(key);
      const row = await latestPublicationRow(normalized);
      if (!row || row.action !== "publish") {
        return null;
      }
      return publicationRowToRecord(row);
    },

    publish,
    unpublish,

    /**
     * Public listing: the latest version must be a publish, and its snapshot digest must
     * still equal the current draft digest. Returning the current draft (rather than the
     * snapshot bytes) preserves the existing tamper check: a row whose bytes were edited
     * in place is returned, fails verification in the handler, and is counted as skipped.
     */
    async listPublished({ limit = 20, offset = 0, category } = {}) {
      const pageSize = Math.min(Math.max(Number(limit) || 20, 1), MAX_PAGE);
      const pageOffset = Math.max(Number(offset) || 0, 0);

      const rows = category
        ? await db.all(
            `SELECT m.*,
                    p.version AS publication_version,
                    p.action AS publication_action,
                    p.published_at AS publication_published_at
               FROM event_metadata m
               JOIN event_publications p
                 ON p.network_id = m.network_id
                AND p.contract_id = m.contract_id
                AND p.event_id = m.event_id
                AND p.version = (
                  SELECT MAX(version) FROM event_publications
                   WHERE network_id = m.network_id
                     AND contract_id = m.contract_id
                     AND event_id = m.event_id
                )
              WHERE p.action = 'publish'
                AND p.metadata_sha256 = m.metadata_sha256
                AND m.category = ?
              ORDER BY m.created_at DESC, m.event_id DESC
              LIMIT ? OFFSET ?`,
            [category, pageSize, pageOffset],
          )
        : await db.all(
            `SELECT m.*,
                    p.version AS publication_version,
                    p.action AS publication_action,
                    p.published_at AS publication_published_at
               FROM event_metadata m
               JOIN event_publications p
                 ON p.network_id = m.network_id
                AND p.contract_id = m.contract_id
                AND p.event_id = m.event_id
                AND p.version = (
                  SELECT MAX(version) FROM event_publications
                   WHERE network_id = m.network_id
                     AND contract_id = m.contract_id
                     AND event_id = m.event_id
                )
              WHERE p.action = 'publish'
                AND p.metadata_sha256 = m.metadata_sha256
              ORDER BY m.created_at DESC, m.event_id DESC
              LIMIT ? OFFSET ?`,
            [pageSize, pageOffset],
          );

      return rows.map(rowToRecord);
    },

    /**
     * Compatibility for the existing test/store callers: publishing and unpublishing now
     * always go through the versioned append-only log. A raw status toggle cannot bypass it.
     */
    async setPublicationStatus(key, status) {
      if (!PUBLICATION_STATUSES.has(status)) {
        throw new MetadataValidationError("publication_status", "is not a known status");
      }
      const result =
        status === "published"
          ? await publish({ key })
          : await unpublish({ key });
      return result.outcome !== "not_found";
    },

    async count() {
      const row = await db.get("SELECT COUNT(*) AS total FROM event_metadata", []);
      return Number(row?.total ?? 0);
    },
  };
}
