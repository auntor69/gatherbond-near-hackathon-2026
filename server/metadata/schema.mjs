import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Lazy on purpose: page and metadata-route modules import the runtime during a Next
// build, where no database is opened. Reading the file at module evaluation made build
// collection depend on the bundler's fs shim. It is only needed when a store is opened.
export function migrationSql() {
  return readFileSync(
    fileURLToPath(
      new URL("../../database/migrations/0001_event_metadata.sql", import.meta.url),
    ),
    "utf8",
  );
}
