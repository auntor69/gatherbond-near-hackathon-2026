import test from "node:test";
import assert from "node:assert/strict";

import { hashMetadata } from "../../metadata/canonical.mjs";
import { openSqliteMetadataStore } from "../../metadata/sqlite.mjs";
import { createAdminHandlers } from "../handlers.mjs";

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

function key(eventId = "0") {
  return { network_id: "testnet", contract_id: "contract.testnet", event_id: eventId };
}

function onchain(id, metadataHash) {
  return {
    event_id: Number(id),
    organizer: "organizer.testnet",
    metadata_hash: metadataHash,
    deposit: "1000000000000000000000000",
    capacity: 20,
    registered: id === "0" ? 1 : 0,
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
}

async function setup() {
  const { store } = openSqliteMetadataStore();
  const hashed = await hashMetadata(doc());
  const events = [onchain("0", hashed.array), onchain("1", hashed.array)];
  const reader = {
    async getEventCount() {
      return "2";
    },
    async getEvents(from = 0, limit = 20) {
      return events.slice(Number(from)).slice(0, Number(limit));
    },
    async getEvent(eventId) {
      return events.find((event) => String(event.event_id) === String(eventId)) ?? null;
    },
  };

  await store.save({
    key: key("0"),
    metadata: doc(),
    organizer_account_id: "organizer.testnet",
    create_tx_hash: TX_HASH,
  });
  await store.publish({ key: key("0"), published_by: "organizer.testnet" });

  const handlers = createAdminHandlers({
    store,
    reader,
    networkId: "testnet",
    contractId: "contract.testnet",
  });
  return { handlers, store, hashed };
}

test("the admin list includes public, unlisted and hidden on-chain events", async () => {
  const { handlers, store } = await setup();
  const first = await handlers.list();
  assert.equal(first.status, 200);
  assert.equal(first.body.total, 2);
  const event0 = first.body.items.find((item) => item.event_id === "0");
  const event1 = first.body.items.find((item) => item.event_id === "1");
  assert.equal(event0.listed, true);
  assert.equal(event0.hidden, false);
  assert.equal(event1.listed, false);
  assert.equal(event1.title, null);

  await store.hide({ key: key("0"), reason: "Duplicate demo event", actor: "admin.testnet" });
  const second = await handlers.list();
  assert.equal(second.body.hidden, 1);
  assert.equal(second.body.items.find((item) => item.event_id === "0").hidden, true);
  assert.equal(second.body.items.find((item) => item.event_id === "0").listed, false);
  assert.equal(second.body.audit[0].action, "hide");
});

test("hide requires an exact event-id confirmation and a reason", async () => {
  const { handlers } = await setup();
  const noConfirm = await handlers.moderate({
    eventId: "0",
    action: "hide",
    reason: "Duplicate demo event",
    actor: "admin.testnet",
    confirm: "1",
  });
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.body.error, "confirmation_required");

  const shortReason = await handlers.moderate({
    eventId: "0",
    action: "hide",
    reason: "x",
    actor: "admin.testnet",
    confirm: "0",
  });
  assert.equal(shortReason.status, 400);
  assert.equal(shortReason.body.error, "invalid_reason");
});

test("hide and restore change only the moderation registry", async () => {
  const { handlers, store } = await setup();
  const hidden = await handlers.moderate({
    eventId: "0",
    action: "hide",
    reason: "Known scam event",
    actor: "admin.testnet",
    confirm: "0",
  });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.hidden, true);
  assert.equal(await store.getPublication(key("0")).then((row) => row.version), 1);

  const restored = await handlers.moderate({
    eventId: "0",
    action: "restore",
    reason: "Reviewed — false positive",
    actor: "admin.testnet",
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.restored, true);
  assert.equal(await store.isHidden(key("0")), false);
});

test("unknown on-chain events are rejected", async () => {
  const { handlers } = await setup();
  const result = await handlers.moderate({
    eventId: "99",
    action: "hide",
    reason: "Not a real event",
    actor: "admin.testnet",
    confirm: "99",
  });
  assert.equal(result.status, 404);
  assert.equal(result.body.error, "event_not_found_on_chain");
});
