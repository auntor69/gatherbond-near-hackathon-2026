// Turso/libSQL adapter. `client` is an @libsql/client instance created server-side:
//
//   import { createClient } from "@libsql/client";
//   const client = createClient({ url: process.env.TURSO_DATABASE_URL,
//                                 authToken: process.env.TURSO_AUTH_TOKEN });
//   const store = createMetadataStore(libsqlAdapter(client));
//
// The auth token must never be imported into a browser bundle; only server route
// handlers may construct this client.

import { createMetadataStore } from "./store.mjs";
import { migrationSql } from "./schema.mjs";

export function libsqlAdapter(client) {
  if (!client || typeof client.execute !== "function") {
    throw new Error("libsqlAdapter requires an @libsql/client instance");
  }

  async function rows(sql, params) {
    const result = await client.execute({ sql, args: params });
    return [...result.rows];
  }

  return {
    async all(sql, params = []) {
      return rows(sql, params);
    },
    async get(sql, params = []) {
      const result = await rows(sql, params);
      return result[0] ?? null;
    },
    async run(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return { changes: Number(result.rowsAffected ?? 0) };
    },
    async exec(sql) {
      if (typeof client.executeMultiple === "function") {
        await client.executeMultiple(sql);
      } else {
        await client.execute(sql);
      }
    },
  };
}

export async function migrateLibsql(client) {
  await client.executeMultiple(migrationSql());
}

export function openLibsqlMetadataStore(client) {
  return createMetadataStore(libsqlAdapter(client));
}
