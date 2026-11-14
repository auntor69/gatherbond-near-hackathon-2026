-- GatherBond moderation registry (server-only).
--
-- The escrow contract is append-only: there is no delete_event method and no admin
-- override. This table therefore records a public-listing takedown, not a chain edit.
-- A hidden event remains visible in the contract and keeps its funds, but every public
-- GatherBond surface omits it. Restoring removes the row and appends an audit entry.
--
-- This table is deliberately separate from event_publications. Publication history is
-- immutable; moderation is a reversible presentation decision with its own audit trail.

CREATE TABLE IF NOT EXISTS event_moderation (
  network_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 1 AND 20),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  actor TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  PRIMARY KEY (network_id, contract_id, event_id)
);

CREATE TABLE IF NOT EXISTS event_moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 1 AND 20),
  action TEXT NOT NULL CHECK (action IN ('hide', 'restore')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_moderation_log_recent
  ON event_moderation_log (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_event_moderation_updated
  ON event_moderation (updated_at DESC);
