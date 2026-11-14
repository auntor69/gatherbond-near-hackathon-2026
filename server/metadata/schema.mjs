import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Lazy on purpose: page and metadata-route modules import the runtime during a Next
// build, where no database is opened. Reading the files at module evaluation made build
// collection depend on the bundler's fs shim. They are only needed when a store opens.
const METADATA_MIGRATION = new URL(
  "../../database/migrations/0001_event_metadata.sql",
  import.meta.url,
);
const MODERATION_MIGRATION = new URL(
  "../../database/migrations/0002_event_moderation.sql",
  import.meta.url,
);

function readMigration(url) {
  return readFileSync(fileURLToPath(url), "utf8");
}

export function migrationSql() {
  return `${readMigration(METADATA_MIGRATION)}\n${readMigration(MODERATION_MIGRATION)}`;
}

/** The moderation migration is safe to run on cold start for existing databases. */
export function moderationSchemaSql() {
  return readMigration(MODERATION_MIGRATION);
}
