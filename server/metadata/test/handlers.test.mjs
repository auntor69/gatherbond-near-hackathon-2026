import test from "node:test";
import assert from "node:assert/strict";

import { hashMetadata } from "../canonical.mjs";
import { createMetadataHandlers } from "../handlers.mjs";
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

async function setup({ authorized = true } = {}) {
  const { store, adapter } = openSqliteMetadataStore();
  const chain = new Map();
  const handlers = createMetadataHandlers({
    store,
    authorize: async ({ actor }) => authorized && actor === "organizer.testnet",
    getOnChainEvent: async (eventKey) => chain.get(JSON.stringify(eventKey)) ?? null,
  });
  async function anchor(eventKey = key(), metadata = doc()) {
    const hashed = await hashMetadata(metadata);
    chain.set(JSON.stringify(eventKey), { metadata_hash: hashed.array, metadata_sha256: hashed.hex });
    return hashed;
  }
  return { store, adapter, chain, handlers, anchor };
}

test("PUT stores metadata whose hash matches the chain, then is idempotent", async () => {
  const { handlers, anchor } = await setup();
  await anchor();

  const first = await handlers.put({
    actor: "organizer.testnet",
    key: key(),
    metadata: doc(),
    create_tx_hash: TX_HASH,
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.outcome, "inserted");
  assert.equal(first.body.metadata_hash.length, 32);

  const retry = await handlers.put({
    actor: "organizer.testnet",
    key: key(),
    metadata: doc(),
    create_tx_hash: TX_HASH,
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.outcome, "unchanged");
});

test("PUT rejects unauthenticated and unauthorized callers", async () => {
  const { handlers, anchor } = await setup();
  await anchor();

  assert.equal(
    (await handlers.put({ key: key(), metadata: doc(), create_tx_hash: TX_HASH })).status,
    401,
  );
  assert.equal(
    (
      await handlers.put({
        actor: "stranger.testnet",
        key: key(),
        metadata: doc(),
        create_tx_hash: TX_HASH,
      })
    ).status,
    403,
  );
});

test("PUT refuses metadata that does not match the on-chain hash", async () => {
  const { handlers, store, anchor } = await setup();
  await anchor();

  const result = await handlers.put({
    actor: "organizer.testnet",
    key: key(),
    metadata: doc({ title: "Altered after anchoring" }),
    create_tx_hash: TX_HASH,
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "metadata_hash_mismatch");
  assert.equal(await store.count(), 0, "nothing may be stored on mismatch");
});

test("PUT fails closed when the event is missing or the chain is unavailable", async () => {
  const { handlers } = await setup();
  const missing = await handlers.put({
    actor: "organizer.testnet",
    key: key(),
    metadata: doc(),
    create_tx_hash: TX_HASH,
  });
  assert.equal(missing.status, 404);

  const { store } = openSqliteMetadataStore();
  const failing = createMetadataHandlers({
    store,
    authorize: async () => true,
    getOnChainEvent: async () => {
      throw new Error("rpc down");
    },
  });
  assert.equal(
    (
      await failing.put({
        actor: "organizer.testnet",
        key: key(),
        metadata: doc(),
        create_tx_hash: TX_HASH,
      })
    ).status,
    503,
  );
});

test("PUT rejects financial fields through the metadata validator", async () => {
  const { handlers, anchor } = await setup();
  await anchor();
  const result = await handlers.put({
    actor: "organizer.testnet",
    key: key(),
    metadata: { ...doc(), deposit: "1000000000000000000000000" },
    create_tx_hash: TX_HASH,
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "invalid_metadata");
});

test("GET returns verified metadata and detects tampering", async () => {
  const { handlers, adapter, anchor } = await setup();
  await anchor();
  await handlers.put({
    actor: "organizer.testnet",
    key: key(),
    metadata: doc(),
    create_tx_hash: TX_HASH,
  });

  const good = await handlers.get({ key: key() });
  assert.equal(good.status, 200);
  assert.equal(good.body.verified, true);
  assert.equal(good.body.metadata.title, "Demo night");

  await adapter.run("UPDATE event_metadata SET metadata_json = ? WHERE event_id = '0'", [
    JSON.stringify(doc({ title: "Tampered" })),
  ]);
  const tampered = await handlers.get({ key: key() });
  assert.equal(tampered.status, 409);
  assert.equal(tampered.body.error, "metadata_hash_mismatch");
});

test("GET reports an on-chain hash mismatch even when the row is internally consistent", async () => {
  const { handlers, chain, anchor } = await setup();
  await anchor();
  await handlers.put({
    actor: "organizer.testnet",
    key: key(),
    metadata: doc(),
    create_tx_hash: TX_HASH,
  });

  const other = await hashMetadata(doc({ title: "Another event" }));
  chain.set(JSON.stringify(key()), { metadata_hash: other.array });
  const result = await handlers.get({ key: key() });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "metadata_hash_mismatch");
});

test("GET is 404 for unknown events and 503 when the store fails", async () => {
  const { handlers } = await setup();
  assert.equal((await handlers.get({ key: key() })).status, 404);

  const broken = createMetadataHandlers({
    store: {
      async get() {
        throw new Error("db down");
      },
      async verify() {
        return { matches: true };
      },
      async listPublished() {
        throw new Error("db down");
      },
    },
    getOnChainEvent: async () => ({ metadata_hash: [] }),
  });
  assert.equal((await broken.get({ key: key() })).status, 503);
  assert.equal((await broken.list()).status, 503);
});

test("list only returns published rows that still verify, and counts skipped ones", async () => {
  const { handlers, store, adapter, anchor } = await setup();
  await anchor(key({ event_id: "0" }), doc({ title: "Published" }));
  await anchor(key({ event_id: "1" }), doc({ title: "Tampered" }));

  for (const id of ["0", "1"]) {
    await handlers.put({
      actor: "organizer.testnet",
      key: key({ event_id: id }),
      metadata: doc({ title: id === "0" ? "Published" : "Tampered" }),
      create_tx_hash: TX_HASH,
    });
    await store.setPublicationStatus(key({ event_id: id }), "published");
  }

  await adapter.run("UPDATE event_metadata SET metadata_json = ? WHERE event_id = '1'", [
    JSON.stringify(doc({ title: "Edited in the database" })),
  ]);

  const result = await handlers.list({ limit: 10 });
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 1);
  assert.equal(result.body.items[0].metadata.title, "Published");
  assert.equal(result.body.skipped, 1);
});

test("publish, identical republish, public snapshot, unpublish and version monotonicity", async () => {
  const { handlers, anchor } = await setup();
  await anchor();
  await handlers.put({
    actor: "organizer.testnet",
    key: key(),
    metadata: doc(),
    create_tx_hash: TX_HASH,
  });

  const anonymous = await handlers.publish({ key: key() });
  assert.equal(anonymous.status, 401);
  const stranger = await handlers.publish({ actor: "stranger.testnet", key: key() });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.error, "forbidden");

  const first = await handlers.publish({ actor: "organizer.testnet", key: key() });
  assert.equal(first.status, 201);
  assert.equal(first.body.outcome, "published");
  assert.equal(first.body.version, 1);
  assert.equal(first.body.publication_status, "published");

  const identical = await handlers.publish({ actor: "organizer.testnet", key: key() });
  assert.equal(identical.status, 200);
  assert.equal(identical.body.outcome, "unchanged");
  assert.equal(identical.body.version, 1);

  const snapshot = await handlers.getPublication({ key: key() });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.verified, true);
  assert.equal(snapshot.body.version, 1);
  assert.equal(snapshot.body.metadata.title, "Demo night");

  const removed = await handlers.unpublish({ actor: "organizer.testnet", key: key() });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.outcome, "unpublished");
  assert.equal(removed.body.version, 2);
  assert.equal(removed.body.publication_status, "pending");
  assert.equal((await handlers.getPublication({ key: key() })).status, 404);
  assert.equal((await handlers.list()).body.items.length, 0);

  const republished = await handlers.publish({ actor: "organizer.testnet", key: key() });
  assert.equal(republished.status, 201);
  assert.equal(republished.body.version, 3);
  assert.equal((await handlers.getPublication({ key: key() })).body.version, 3);
  assert.equal((await handlers.list()).body.items.length, 1);
});

test("publish fails closed for a draft that was never saved and for chain failures", async () => {
  const { handlers, anchor, store } = await setup();
  assert.equal(
    (await handlers.publish({ actor: "organizer.testnet", key: key({ event_id: "9" }) })).status,
    404,
  );

  await anchor();
  await handlers.put({
    actor: "organizer.testnet",
    key: key(),
    metadata: doc(),
    create_tx_hash: TX_HASH,
  });
  const broken = createMetadataHandlers({
    store,
    authorize: async () => true,
    getOnChainEvent: async () => {
      throw new Error("rpc down");
    },
  });
  assert.equal(
    (await broken.publish({ actor: "organizer.testnet", key: key() })).status,
    503,
  );
});

test("details returns the verified publication plus public on-chain terms", async () => {
  const { handlers, chain, anchor } = await setup();
  const hashed = await anchor();
  await handlers.put({
    actor: "organizer.testnet",
    key: key(),
    metadata: doc(),
    create_tx_hash: TX_HASH,
  });
  await handlers.publish({ actor: "organizer.testnet", key: key() });

  chain.set(JSON.stringify(key()), {
    event_id: 0,
    organizer: "organizer.testnet",
    metadata_hash: hashed.array,
    deposit: "1000000000000000000000000",
    capacity: 3,
    registered: 1,
    checked_in: 0,
    start_at: "1763000000000000000",
    end_at: "1763003600000000000",
    status: "Open",
  });

  const result = await handlers.details({ key: key() });
  assert.equal(result.status, 200);
  assert.equal(result.body.verified, true);
  assert.equal(result.body.version, 1);
  assert.equal(result.body.metadata.title, "Demo night");
  assert.equal(result.body.onchain.capacity, 3);
  assert.equal(result.body.onchain.deposit, "1000000000000000000000000");
  assert.equal(result.body.onchain.status, "Open");
});

test("details refuses an unpublished event and a mismatched on-chain hash", async () => {
  const { handlers, chain, anchor } = await setup();
  assert.equal((await handlers.details({ key: key() })).status, 404);

  await anchor();
  await handlers.put({
    actor: "organizer.testnet",
    key: key(),
    metadata: doc(),
    create_tx_hash: TX_HASH,
  });
  await handlers.publish({ actor: "organizer.testnet", key: key() });

  const other = await hashMetadata(doc({ title: "Another event" }));
  chain.set(JSON.stringify(key()), { metadata_hash: other.array });
  const mismatch = await handlers.details({ key: key() });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.error, "metadata_hash_mismatch");
});
