import test from "node:test";
import assert from "node:assert/strict";

import { MetadataConflictError, hashMetadata } from "../canonical.mjs";
import { libsqlAdapter } from "../libsql.mjs";
import { createMetadataStore } from "../store.mjs";
import { openSqliteMetadataStore } from "../sqlite.mjs";

const TX_HASH = "1111111111111111111111111111111111111111";

function doc(overrides = {}) {
  return {
    schema_version: 1,
    network_id: "testnet",
    contract_id: "contract.testnet",
    organizer_account_id: "organizer.testnet",
    title: "Demo night",
    description: "Commit to gather.",
    category: "community",
    venue: "Online",
    image_url: "",
    tags: ["demo"],
    created_at: "2026-11-07T12:00:00Z",
    ...overrides,
  };
}

function key(overrides = {}) {
  return { network_id: "testnet", contract_id: "contract.testnet", event_id: "0", ...overrides };
}

test("save and get round-trip the canonical document", async () => {
  const { store } = openSqliteMetadataStore();
  const { outcome, record } = await store.save({
    key: key(),
    metadata: doc(),
    organizer_account_id: "organizer.testnet",
    create_tx_hash: TX_HASH,
  });
  assert.equal(outcome, "inserted");
  assert.equal(record.metadata_sha256, (await hashMetadata(doc())).hex);
  assert.deepEqual(JSON.parse(record.metadata_json), doc());
  assert.equal(record.publication_status, "pending");

  const fetched = await store.get(key());
  assert.deepEqual(fetched, record);
  assert.equal(await store.count(), 1);
});

test("save is idempotent for the same key and hash", async () => {
  const { store, adapter } = openSqliteMetadataStore();
  const input = {
    key: key(),
    metadata: doc(),
    organizer_account_id: "organizer.testnet",
    create_tx_hash: TX_HASH,
  };
  await store.save(input);
  const second = await store.save(input);
  assert.equal(second.outcome, "unchanged");
  const rows = await adapter.all("SELECT COUNT(*) AS total FROM event_metadata", []);
  assert.equal(Number(rows[0].total), 1);
});

test("a different hash for the same event is a conflict", async () => {
  const { store } = openSqliteMetadataStore();
  await store.save({
    key: key(),
    metadata: doc(),
    organizer_account_id: "organizer.testnet",
    create_tx_hash: TX_HASH,
  });
  await assert.rejects(
    store.save({
      key: key(),
      metadata: doc({ title: "Different title" }),
      organizer_account_id: "organizer.testnet",
      create_tx_hash: TX_HASH,
    }),
    MetadataConflictError,
  );
});

test("event ids above 2^53 are preserved as text", async () => {
  const { store } = openSqliteMetadataStore();
  const big = { ...key(), event_id: "18446744073709551615" };
  await store.save({
    key: big,
    metadata: doc(),
    organizer_account_id: "organizer.testnet",
    create_tx_hash: TX_HASH,
  });
  const fetched = await store.get(big);
  assert.equal(fetched.key.event_id, "18446744073709551615");
});

test("identity mismatches are rejected", async () => {
  const { store } = openSqliteMetadataStore();
  await assert.rejects(
    store.save({
      key: key(),
      metadata: doc({ contract_id: "other.testnet" }),
      organizer_account_id: "organizer.testnet",
      create_tx_hash: TX_HASH,
    }),
  );
  await assert.rejects(
    store.save({
      key: key(),
      metadata: doc(),
      organizer_account_id: "someone-else.testnet",
      create_tx_hash: TX_HASH,
    }),
  );
});

test("published listing filters, paginates and only exposes published rows", async () => {
  const { store } = openSqliteMetadataStore();
  for (let id = 0; id < 3; id += 1) {
    await store.save({
      key: key({ event_id: String(id) }),
      metadata: doc({ title: `Event ${id}`, category: id === 2 ? "professional" : "community" }),
      organizer_account_id: "organizer.testnet",
      create_tx_hash: TX_HASH,
    });
  }
  assert.equal((await store.listPublished()).length, 0);

  await store.setPublicationStatus(key({ event_id: "0" }), "published");
  await store.setPublicationStatus(key({ event_id: "1" }), "published");
  await store.setPublicationStatus(key({ event_id: "2" }), "published");

  const firstPage = await store.listPublished({ limit: 2, offset: 0 });
  assert.equal(firstPage.length, 2);
  const secondPage = await store.listPublished({ limit: 2, offset: 2 });
  assert.equal(secondPage.length, 1);
  assert.equal((await store.listPublished({ category: "professional" })).length, 1);

  const capped = await store.listPublished({ limit: 500 });
  assert.equal(capped.length, 3);
});

test("verify detects a tampered stored document", async () => {
  const { store, adapter } = openSqliteMetadataStore();
  await store.save({
    key: key(),
    metadata: doc(),
    organizer_account_id: "organizer.testnet",
    create_tx_hash: TX_HASH,
  });
  const good = await store.verify(await store.get(key()));
  assert.equal(good.matches, true);

  await adapter.run("UPDATE event_metadata SET metadata_json = ? WHERE event_id = '0'", [
    JSON.stringify(doc({ title: "Tampered" })),
  ]);
  const tampered = await store.verify(await store.get(key()));
  assert.equal(tampered.matches, false);
});

test("publish is versioned, idempotent while public, and permanent across legacy tombstones", async () => {
  const { store, adapter } = openSqliteMetadataStore();
  await store.save({
    key: key(),
    metadata: doc(),
    organizer_account_id: "organizer.testnet",
    create_tx_hash: TX_HASH,
  });

  const first = await store.publish({ key: key(), published_by: "organizer.testnet" });
  assert.equal(first.outcome, "published");
  assert.equal(first.publication.version, 1);
  assert.equal(first.publication.published_by, "organizer.testnet");
  assert.equal((await store.getPublication(key())).version, 1);

  const identical = await store.publish({ key: key(), published_by: "organizer.testnet" });
  assert.equal(identical.outcome, "unchanged");
  assert.equal(identical.publication.version, 1);

  // Simulate a tombstone written by the old product. Reads must ignore it and keep
  // serving the last publish; no new code can append one.
  await adapter.run(
    `INSERT INTO event_publications (
      network_id, contract_id, event_id, version, action,
      metadata_json, metadata_sha256, create_tx_hash, published_by, published_at
    ) VALUES (?, ?, ?, ?, 'unpublish', NULL, NULL, NULL, ?, ?)`,
    ["testnet", "contract.testnet", "0", 2, "organizer.testnet", new Date().toISOString()],
  );
  assert.equal((await store.getPublication(key())).version, 1);
  assert.equal((await store.listPublished()).length, 1);

  const republished = await store.publish({ key: key(), published_by: "organizer.testnet" });
  assert.equal(republished.outcome, "published");
  assert.equal(republished.publication.version, 3);
  assert.equal((await store.getPublication(key())).version, 3);

  const history = await adapter.all(
    "SELECT version, action FROM event_publications ORDER BY version",
    [],
  );
  assert.deepEqual(
    history.map((row) => [Number(row.version), row.action]),
    [
      [1, "publish"],
      [2, "unpublish"],
      [3, "publish"],
    ],
  );
});

test("public listing excludes drafts and superseded versions", async () => {
  const { store, adapter } = openSqliteMetadataStore();
  for (const id of ["0", "1"]) {
    await store.save({
      key: key({ event_id: id }),
      metadata: doc({ title: `Event ${id}` }),
      organizer_account_id: "organizer.testnet",
      create_tx_hash: TX_HASH,
    });
  }

  await store.publish({ key: key({ event_id: "0" }), published_by: "organizer.testnet" });
  let listed = await store.listPublished();
  assert.deepEqual(listed.map((record) => record.key.event_id), ["0"]);
  assert.equal(listed[0].publication_status, "published");
  assert.equal(listed[0].publication_version, 1);

  await store.publish({ key: key({ event_id: "1" }), published_by: "organizer.testnet" });
  listed = await store.listPublished();
  assert.deepEqual(listed.map((record) => record.key.event_id).sort(), ["0", "1"]);

  // A legacy tombstone does not hide event 0 after the fact.
  await adapter.run(
    `INSERT INTO event_publications (
      network_id, contract_id, event_id, version, action,
      metadata_json, metadata_sha256, create_tx_hash, published_by, published_at
    ) VALUES (?, ?, ?, ?, 'unpublish', NULL, NULL, NULL, ?, ?)`,
    ["testnet", "contract.testnet", "0", 2, "organizer.testnet", new Date().toISOString()],
  );
  listed = await store.listPublished();
  assert.deepEqual(listed.map((record) => record.key.event_id).sort(), ["0", "1"]);
  assert.equal(
    listed.find((record) => record.key.event_id === "0").publication_version,
    1,
    "the latest publish remains public after a legacy tombstone",
  );
  assert.equal((await store.getPublication(key({ event_id: "0" }))).version, 1);

  await store.publish({ key: key({ event_id: "0" }), published_by: "organizer.testnet" });
  listed = await store.listPublished();
  const event0 = listed.find((record) => record.key.event_id === "0");
  assert.equal(event0.publication_version, 3, "the next publish appends version 3");
  assert.equal((await store.getPublication(key({ event_id: "0" }))).version, 3);

  const older = await store.getPublication(key({ event_id: "1" }));
  assert.equal(older.version, 1, "event 1 still serves its current version");
  assert.equal((await store.listPublished()).length, 2);
});

test("a failed publication insert leaves no public state behind", async () => {
  const base = openSqliteMetadataStore();
  await base.store.save({
    key: key(),
    metadata: doc(),
    organizer_account_id: "organizer.testnet",
    create_tx_hash: TX_HASH,
  });

  const failing = createMetadataStore({
    ...base.adapter,
    async run(sql, params) {
      if (sql.includes("INSERT INTO event_publications")) {
        throw new Error("simulated publication write failure");
      }
      return base.adapter.run(sql, params);
    },
  });

  await assert.rejects(
    failing.publish({ key: key(), published_by: "organizer.testnet" }),
    /simulated publication write failure/,
  );
  assert.equal(await base.store.getPublication(key()), null);
  assert.equal((await base.store.listPublished()).length, 0);
});

test("libsql adapter maps an @libsql/client-shaped object", async () => {
  const calls = [];
  const client = {
    async execute({ sql, args }) {
      calls.push({ sql, args });
      if (sql.startsWith("SELECT")) {
        return { rows: [{ total: 1 }] };
      }
      return { rowsAffected: 2 };
    },
    async executeMultiple(sql) {
      calls.push({ sql, args: [] });
    },
  };
  const adapter = libsqlAdapter(client);
  assert.deepEqual(await adapter.get("SELECT 1", []), { total: 1 });
  assert.deepEqual(await adapter.run("UPDATE x", [1]), { changes: 2 });
  await adapter.exec("CREATE TABLE x (a)");
  assert.deepEqual(calls[0], { sql: "SELECT 1", args: [] });
  assert.deepEqual(calls[1], { sql: "UPDATE x", args: [1] });
});
