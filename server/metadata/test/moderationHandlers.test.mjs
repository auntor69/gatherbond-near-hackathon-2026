import test from "node:test";
import assert from "node:assert/strict";

import { createMetadataHandlers } from "../handlers.mjs";
import { hashMetadata } from "../canonical.mjs";
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

function key() {
  return { network_id: "testnet", contract_id: "contract.testnet", event_id: "0" };
}

test("a hidden event disappears from every public metadata surface", async () => {
  const { store } = openSqliteMetadataStore();
  const hashed = await hashMetadata(doc());
  const onchain = {
    event_id: 0,
    organizer: "organizer.testnet",
    metadata_hash: hashed.array,
    deposit: "1000000000000000000000000",
    capacity: 20,
    registered: 0,
    checked_in: 0,
    start_at: "1763000000000000000",
    end_at: "1763003600000000000",
    registration_deadline: "1762990000000000000",
    checkin_open: "1763000000000000000",
    checkin_close: "1763003600000000000",
    status: "Open",
    refund_pool: "0",
    reward_pool: "0",
    reward_per_attendee: "0",
    locked: false,
  };
  const handlers = createMetadataHandlers({
    store,
    authorize: async ({ actor }) => actor === "organizer.testnet",
    getOnChainEvent: async () => onchain,
  });

  assert.equal(
    (
      await handlers.put({
        actor: "organizer.testnet",
        key: key(),
        metadata: doc(),
        create_tx_hash: TX_HASH,
      })
    ).status,
    201,
  );
  assert.equal(
    (await handlers.publish({ actor: "organizer.testnet", key: key() })).status,
    201,
  );
  assert.equal((await handlers.list()).body.items.length, 1);
  assert.equal((await handlers.details({ key: key() })).status, 200);

  await store.hide({
    key: key(),
    reason: "Known scam event",
    actor: "admin.testnet",
  });

  assert.equal((await handlers.list()).body.items.length, 0);
  assert.equal((await handlers.get({ key: key() })).status, 404);
  assert.equal((await handlers.getPublication({ key: key() })).status, 404);
  assert.equal((await handlers.details({ key: key() })).status, 404);
  assert.equal(
    (await handlers.publish({ actor: "organizer.testnet", key: key() })).status,
    403,
  );
  assert.equal(
    (
      await handlers.put({
        actor: "organizer.testnet",
        key: key(),
        metadata: doc({ title: "Changed after takedown" }),
        create_tx_hash: TX_HASH,
      })
    ).status,
    403,
  );
});
