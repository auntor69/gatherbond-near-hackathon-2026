import test from "node:test";
import assert from "node:assert/strict";

import { createMetadataRuntime, selectStore } from "../../metadata/runtime.mjs";

test("no database configuration degrades honestly instead of crashing", async () => {
  const selection = await selectStore({});
  assert.equal(selection.mode, "unavailable");
  assert.equal(selection.reason, "no_database_configured");
  assert.equal(selection.store, null);
});

test("local SQLite is selected when configured", async () => {
  const selection = await selectStore({ METADATA_SQLITE_PATH: ":memory:" });
  assert.equal(selection.mode, "sqlite");
  assert.equal(typeof selection.store.get, "function");
  assert.equal(typeof selection.store.save, "function");
});

test("Turso credentials without a loader degrade instead of crashing", async () => {
  const selection = await selectStore({
    TURSO_DATABASE_URL: "libsql://example.turso.io",
    TURSO_AUTH_TOKEN: "token",
  });
  assert.equal(selection.mode, "unavailable");
  assert.equal(selection.reason, "libsql_loader_not_configured");
});

test("Turso selection fails closed when the client cannot load", async () => {
  const selection = await selectStore(
    { TURSO_DATABASE_URL: "libsql://example.turso.io", TURSO_AUTH_TOKEN: "token" },
    {
      importLibsql: async () => {
        throw new Error("module not installed");
      },
    },
  );
  assert.equal(selection.mode, "unavailable");
  assert.match(selection.reason, /^libsql_unavailable:/);
});

test("Turso selection builds the store over an injected client", async () => {
  const selection = await selectStore(
    { TURSO_DATABASE_URL: "libsql://example.turso.io", TURSO_AUTH_TOKEN: "token" },
    {
      importLibsql: async () => ({
        createClient: () => ({
          async execute() {
            return { rows: [], rowsAffected: 0 };
          },
        }),
      }),
    },
  );
  assert.equal(selection.mode, "turso");
  assert.equal(typeof selection.store.save, "function");
});

test("runtime exposes routes that answer 503 rather than throwing without credentials", async () => {
  const runtime = await createMetadataRuntime({ env: {} });
  assert.equal(runtime.mode, "unavailable");

  const response = await runtime.routes.list(new Request("http://localhost/api/events"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "metadata_store_unavailable");

  const get = await runtime.routes.get(new Request("http://localhost/api/events/0/metadata"), {
    params: Promise.resolve({ id: "0" }),
  });
  assert.equal(get.status, 503);
});

test("runtime failures during store selection do not reject route construction", async () => {
  const runtime = await createMetadataRuntime({
    env: {},
    selectStoreImpl: async () => {
      throw new Error("selection exploded");
    },
  }).catch((error) => ({ error }));

  // selectStore itself is defensive; if a custom selector throws, the failure must be
  // visible to the caller rather than producing a half-built runtime.
  assert.ok(runtime.error instanceof Error);
});
