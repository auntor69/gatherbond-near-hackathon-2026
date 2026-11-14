import test from "node:test";
import assert from "node:assert/strict";

import { MetadataHiddenError, hashMetadata } from "../canonical.mjs";
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

async function publishedEvent() {
  const opened = openSqliteMetadataStore();
  await opened.store.save({
    key: key(),
    metadata: doc(),
    organizer_account_id: "organizer.testnet",
    create_tx_hash: TX_HASH,
  });
  await opened.store.publish({ key: key(), published_by: "organizer.testnet" });
  return opened;
}

test("hiding removes an event from discovery while preserving publication history", async () => {
  const { store, adapter } = await publishedEvent();
  assert.equal((await store.listPublished()).length, 1);
  assert.equal((await store.isHidden(key())), false);

  const hidden = await store.hide({
    key: key(),
    reason: "Duplicate demo event",
    actor: "admin.testnet",
  });
  assert.equal(hidden.hidden, true);
  assert.equal(await store.isHidden(key()), true);
  assert.equal((await store.listPublished()).length, 0);
  assert.equal(await store.getModeration(key()).then((row) => row.reason), "Duplicate demo event");
  assert.equal(await store.getPublication(key()).then((row) => row.version), 1);

  const audit = await store.listModerationLog();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "hide");
  assert.equal(audit[0].key.event_id, "0");
  assert.equal(audit[0].actor, "admin.testnet");

  const rows = await adapter.all("SELECT COUNT(*) AS total FROM event_publications", []);
  assert.equal(Number(rows[0].total), 1, "moderation must not delete publication history");
});

test("a hidden event cannot be republished until it is restored", async () => {
  const { store } = await publishedEvent();
  await store.hide({
    key: key(),
    reason: "Known scam event",
    actor: "admin.testnet",
  });

  await assert.rejects(
    store.publish({ key: key(), published_by: "organizer.testnet" }),
    MetadataHiddenError,
  );
  assert.equal((await store.listPublished()).length, 0);

  const restored = await store.restore({
    key: key(),
    reason: "False positive, reviewed",
    actor: "admin.testnet",
  });
  assert.equal(restored.restored, true);
  assert.equal(await store.isHidden(key()), false);
  assert.equal((await store.listPublished()).length, 1);

  const audit = await store.listModerationLog();
  assert.deepEqual(
    audit.map((entry) => entry.action),
    ["restore", "hide"],
  );
});

test("moderation requires a real reason and a valid actor", async () => {
  const { store } = await publishedEvent();
  await assert.rejects(
    store.hide({ key: key(), reason: "x", actor: "admin.testnet" }),
    /reason/,
  );
  await assert.rejects(
    store.hide({ key: key(), reason: "Duplicate demo", actor: "not an account" }),
    /actor/,
  );
  assert.equal(await store.isHidden(key()), false);
});

test("hidden metadata still hashes consistently for the admin view", async () => {
  const { store } = await publishedEvent();
  const record = await store.get(key());
  const verified = await store.verify(record);
  assert.equal(verified.matches, true);
  assert.equal(verified.actual, (await hashMetadata(doc())).hex);
});

test("the moderation audit can be scoped to the active contract", async () => {
  const { store } = openSqliteMetadataStore();
  await store.hide({
    key: key(),
    reason: "Duplicate demo event",
    actor: "admin.testnet",
  });
  await store.hide({
    key: key({ contract_id: "other.testnet" }),
    reason: "Other contract event",
    actor: "admin.testnet",
  });

  const scoped = await store.listModerationLog({
    networkId: "testnet",
    contractId: "contract.testnet",
  });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].key.contract_id, "contract.testnet");
  assert.equal((await store.listModerationLog()).length, 2);
});
