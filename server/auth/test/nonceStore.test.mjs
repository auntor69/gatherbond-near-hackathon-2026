import test from "node:test";
import assert from "node:assert/strict";

import { createSqliteDatabase } from "../../metadata/sqlite.mjs";
import { createSqliteNonceStore } from "../nonceStore.mjs";

test("concurrent claims for one nonce have exactly one winner", async () => {
  const db = createSqliteDatabase();
  const store = createSqliteNonceStore(db);

  const results = await Promise.all(
    Array.from({ length: 24 }, () => store.claim("alice.testnet", "same-nonce")),
  );
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await store.claim("alice.testnet", "same-nonce"), false);
});

test("different nonces for one account all claim successfully", async () => {
  const store = createSqliteNonceStore(createSqliteDatabase());
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      store.claim("alice.testnet", `nonce-${index}`),
    ),
  );
  assert.deepEqual(results, Array(8).fill(true));
});

test("nonces are scoped to the account", async () => {
  const store = createSqliteNonceStore(createSqliteDatabase());
  assert.equal(await store.claim("alice.testnet", "shared"), true);
  assert.equal(await store.claim("bob.testnet", "shared"), true);
  assert.equal(await store.claim("alice.testnet", "shared"), false);
});

test("a nonce stays used when the store is reopened on the same database", async () => {
  const db = createSqliteDatabase();
  const first = createSqliteNonceStore(db);
  assert.equal(await first.claim("alice.testnet", "persisted"), true);
  const reopened = createSqliteNonceStore(db);
  assert.equal(await reopened.claim("alice.testnet", "persisted"), false);
});
