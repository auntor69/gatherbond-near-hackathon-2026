-- GatherBond event metadata (off-chain discovery only).
-- The NEAR contract is authoritative for money, registration, attendance and claims.
-- This table must never be used to prove payment, attendance or claim entitlement.
--
-- event_id is TEXT (decimal u64) so values above JavaScript's 2^53 survive the round trip.
-- (network_id, contract_id, event_id) is the identity; metadata_json is the canonical
-- document whose SHA-256 is metadata_sha256 and is anchored on-chain at create_event.

CREATE TABLE IF NOT EXISTS event_metadata (
  network_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 1 AND 20),
  organizer_account_id TEXT NOT NULL,

  -- Denormalized display columns for discovery/search.
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  venue TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',

  -- Canonical metadata document and its on-chain digest.
  metadata_json TEXT NOT NULL,
  metadata_sha256 TEXT NOT NULL CHECK (length(metadata_sha256) = 64),
  create_tx_hash TEXT NOT NULL,

  publication_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (publication_status IN ('pending', 'published', 'hidden')),

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  PRIMARY KEY (network_id, contract_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_metadata_published
  ON event_metadata (publication_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_metadata_category
  ON event_metadata (category, publication_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_metadata_organizer
  ON event_metadata (organizer_account_id, created_at DESC);

-- Publication is an append-only log so every publish/unpublish is one atomic INSERT.
-- The highest version is current. action='publish' carries an immutable snapshot of the
-- metadata that was public at that version; action='unpublish' is a tombstone that
-- supersedes the previous version without deleting its audit row.
--
-- Keeping this table in 0001 is deliberate: no database exists yet at the human Turso
-- gate, so the single documented migration command stays sufficient.
CREATE TABLE IF NOT EXISTS event_publications (
  network_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 1 AND 20),
  version INTEGER NOT NULL CHECK (version >= 1),
  action TEXT NOT NULL CHECK (action IN ('publish', 'unpublish')),

  metadata_json TEXT,
  metadata_sha256 TEXT CHECK (metadata_sha256 IS NULL OR length(metadata_sha256) = 64),
  create_tx_hash TEXT,
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL,

  PRIMARY KEY (network_id, contract_id, event_id, version),
  CHECK (
    (action = 'publish'
      AND metadata_json IS NOT NULL
      AND metadata_sha256 IS NOT NULL
      AND create_tx_hash IS NOT NULL)
    OR
    (action = 'unpublish'
      AND metadata_json IS NULL
      AND metadata_sha256 IS NULL
      AND create_tx_hash IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_event_publications_latest
  ON event_publications (network_id, contract_id, event_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_event_publications_published
  ON event_publications (action, metadata_sha256);
