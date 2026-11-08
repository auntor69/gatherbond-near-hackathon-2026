import { readFileSync } from "node:fs";

export const MIGRATION_SQL = readFileSync(
  new URL("../../database/migrations/0001_event_metadata.sql", import.meta.url),
  "utf8",
);
