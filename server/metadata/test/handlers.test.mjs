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
  assert.ok(result.body.items[0].onchain, "listed rows carry their contract terms");
  assert.equal(result.body.skipped, 1);
});

test("list hides rows missing from the contract and fails closed when RPC is down", async () => {
  const { handlers, chain, store, anchor } = await setup();
  await anchor(key({ event_id: "0" }), doc({ title: "On chain" }));
  await anchor(key({ event_id: "1" }), doc({ title: "Missing" }));
  for (const id of ["0", "1"]) {
    await handlers.put({
      actor: "organizer.testnet",
      key: key({ event_id: id }),
      metadata: doc({ title: id === "0" ? "On chain" : "Missing" }),
      create_tx_hash: TX_HASH,
    });
    await store.setPublicationStatus(key({ event_id: id }), "published");
  }
  chain.delete(JSON.stringify(key({ event_id: "1" })));

  const listed = await handlers.list({ limit: 10 });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.items.length, 1);
  assert.equal(listed.body.items[0].event.event_id, "0");
  assert.equal(listed.body.skipped, 1);

  const { store: brokenStore } = openSqliteMetadataStore();
  await brokenStore.save({
    key: key(),
    metadata: doc(),
    organizer_account_id: "organizer.testnet",
    create_tx_hash: TX_HASH,
  });
  await brokenStore.publish({ key: key(), published_by: "organizer.testnet" });
  const broken = createMetadataHandlers({
    store: brokenStore,
    getOnChainEvent: async () => {
      throw new Error("rpc down");
    },
  });
  assert.equal((await broken.list()).status, 503);
  assert.equal((await broken.list()).body.error, "chain_unavailable");
});

test("publish, identical republish and permanent public snapshot", async () => {
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

  // There is no handler-level unpublish path: the snapshot above remains public.
  assert.equal(typeof handlers.unpublish, "undefined");
  assert.equal((await handlers.getPublication({ key: key() })).status, 200);
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

test("concurrent identical PUTs store once and answer 201 plus 200", async () => {
  const { handlers, store, anchor } = await setup();
  await anchor();
  const input = {
    actor: "organizer.testnet",
    key: key(),
    metadata: doc(),
    create_tx_hash: TX_HASH,
  };

  const results = await Promise.all([
    handlers.put(input),
    handlers.put(input),
    handlers.put(input),
    handlers.put(input),
  ]);
  assert.deepEqual(
    results.map((result) => result.status).sort((left, right) => left - right),
    [200, 200, 200, 201],
  );
  assert.equal(await store.count(), 1);
});

test("concurrent publish requests allocate one version and never fail a retry", async () => {
  const { handlers, anchor } = await setup();
  await anchor();
  await handlers.put({
    actor: "organizer.testnet",
    key: key(),
    metadata: doc(),
    create_tx_hash: TX_HASH,
  });

  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      handlers.publish({ actor: "organizer.testnet", key: key() }),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.status).sort((left, right) => left - right),
    [200, 200, 200, 200, 200, 201],
  );
  assert.ok(results.every((result) => result.body.version === 1));
});

test("list skips a published row when the contract now points at different metadata", async () => {
  const { handlers, chain, anchor } = await setup();
  await anchor();
  await handlers.put({
    actor: "organizer.testnet",
    key: key(),
    metadata: doc(),
    create_tx_hash: TX_HASH,
  });
  await handlers.publish({ actor: "organizer.testnet", key: key() });

  const other = await hashMetadata(doc({ title: "Different on-chain event" }));
  chain.set(JSON.stringify(key()), { metadata_hash: other.array });
  const listed = await handlers.list({ limit: 10 });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.items.length, 0);
  assert.equal(listed.body.skipped, 1);
});

test("details refreshes on-chain status without changing the anchored snapshot", async () => {
  const { handlers, chain, anchor } = await setup();
  const hashed = await anchor();
  chain.set(JSON.stringify(key()), {
    event_id: 0,
    organizer: "organizer.testnet",
    metadata_hash: hashed.array,
    start_at: "1763000000000000000",
    end_at: "1763003600000000000",
    status: "Open",
  });
  await handlers.put({
    actor: "organizer.testnet",
    key: key(),
    metadata: doc(),
    create_tx_hash: TX_HASH,
  });
  await handlers.publish({ actor: "organizer.testnet", key: key() });

  const before = await handlers.details({ key: key() });
  assert.equal(before.status, 200);
  assert.equal(before.body.onchain.status, "Open");
  assert.equal(before.body.metadata_sha256, hashed.hex);

  chain.set(JSON.stringify(key()), {
    ...chain.get(JSON.stringify(key())),
    status: "Finalized",
    checked_in: 6,
  });
  const after = await handlers.details({ key: key() });
  assert.equal(after.status, 200);
  assert.equal(after.body.onchain.status, "Finalized");
  assert.equal(after.body.onchain.checked_in, 6);
  assert.equal(after.body.metadata_sha256, before.body.metadata_sha256);
  assert.equal(after.body.version, before.body.version);
});
