// Local SQLite adapter (Node's built-in node:sqlite). Used for tests and local
// development; production uses the same store over Turso/libSQL.

import { DatabaseSync } from "node:sqlite";
import { createMetadataStore } from "./store.mjs";
import { migrationSql } from "./schema.mjs";

export function createSqliteDatabase(path = ":memory:") {
  return new DatabaseSync(path);
}

export function sqliteAdapter(db) {
  return {
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async get(sql, params = []) {
      return db.prepare(sql).get(...params) ?? null;
    },
    async run(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes ?? 0) };
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}

export function openSqliteMetadataStore({ path = ":memory:", db } = {}) {
  const database = db ?? createSqliteDatabase(path);
  database.exec(migrationSql());
  const adapter = sqliteAdapter(database);
  return { db: database, adapter, store: createMetadataStore(adapter) };
}
