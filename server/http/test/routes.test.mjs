import test from "node:test";
import assert from "node:assert/strict";

import { hashMetadata } from "../../metadata/canonical.mjs";
import { createMetadataHandlers } from "../../metadata/handlers.mjs";
import { openSqliteMetadataStore } from "../../metadata/sqlite.mjs";
import { createMetadataRoutes } from "../routes.mjs";

const TX = "1111111111111111111111111111111111111111";

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

function body(metadata = doc()) {
  return { metadata, create_tx_hash: TX };
}

function request(method, path, { actor, payload } = {}) {
  const headers = {};
  if (actor) {
    headers["x-actor"] = actor;
  }
  if (payload !== undefined) {
    headers["content-type"] = "application/json";
  }
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body:
      payload === undefined
        ? undefined
        : typeof payload === "string"
          ? payload
          : JSON.stringify(payload),
  });
}

const context = (id) => ({ params: Promise.resolve({ id }) });

function putRequest(id, payload, actor = "organizer.testnet") {
  return request("PUT", `/api/events/${id}/metadata`, { actor, payload });
}

async function setup({ chainUp = true, store: storeOverride } = {}) {
  const { store, adapter } = openSqliteMetadataStore();
  const chain = new Map();
  const handlers = createMetadataHandlers({
    store: storeOverride ?? store,
    authorize: async ({ actor, metadata }) => actor === metadata.organizer_account_id,
    getOnChainEvent: async (key) => {
      if (!chainUp) {
        throw new Error("rpc down");
      }
      return chain.get(key.event_id) ?? null;
    },
  });
  const routes = createMetadataRoutes({
    handlers,
    networkId: "testnet",
    contractId: "contract.testnet",
    getActor: (incoming) => incoming.headers.get("x-actor"),
  });

  async function anchor(eventId, metadata = doc()) {
    const hashed = await hashMetadata(metadata);
    chain.set(String(eventId), { metadata_hash: hashed.array });
    return hashed;
  }

  return { store, adapter, chain, routes, anchor };
}

test("PUT is reachable over HTTP and idempotent", async () => {
  const { routes, anchor } = await setup();
  await anchor("0");

  const first = await routes.put(
    putRequest("0", body()),
    context("0"),
  );
  assert.equal(first.status, 201);
  assert.equal(first.headers.get("content-type"), "application/json; charset=utf-8");
  const created = await first.json();
  assert.equal(created.outcome, "inserted");
  assert.deepEqual(created.event, {
    network_id: "testnet",
    contract_id: "contract.testnet",
    event_id: "0",
  });
  assert.equal(created.metadata_hash.length, 32);

  const retry = await routes.put(putRequest("0", body()), context("0"));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).outcome, "unchanged");
});

test("PUT fails closed with 401 and 403", async () => {
  const { routes, anchor } = await setup();
  await anchor("0");

  const anonymous = await routes.put(
    request("PUT", "/api/events/0/metadata", { payload: body() }),
    context("0"),
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, "unauthorized");

  const stranger = await routes.put(
    putRequest("0", body(), "stranger.testnet"),
    context("0"),
  );
  assert.equal(stranger.status, 403);
  assert.equal((await stranger.json()).error, "forbidden");
});

test("PUT returns 404 when the event is not on chain", async () => {
  const { routes } = await setup();
  const response = await routes.put(putRequest("9", body()), context("9"));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "event_not_found_on_chain");
});

test("PUT detects a hash mismatch before storing anything", async () => {
  const { routes, anchor, store } = await setup();
  await anchor("0", doc({ title: "Original" }));

  const response = await routes.put(
    putRequest("0", body(doc({ title: "Changed after anchoring" }))),
    context("0"),
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "metadata_hash_mismatch");
  assert.equal(await store.count(), 0);
});

test("PUT fails closed with 503 when the chain or the store is unavailable", async () => {
  const chainDown = await setup({ chainUp: false });
  const chainResponse = await chainDown.routes.put(putRequest("0", body()), context("0"));
  assert.equal(chainResponse.status, 503);
  assert.equal((await chainResponse.json()).error, "chain_unavailable");

  const failingStore = {
    async save() {
      throw new Error("database down");
    },
    async get() {
      throw new Error("database down");
    },
    async verify() {
      throw new Error("database down");
    },
    async listPublished() {
      throw new Error("database down");
    },
    async setPublicationStatus() {
      throw new Error("database down");
    },
    async count() {
      throw new Error("database down");
    },
  };
  const storeDown = await setup({ store: failingStore });
  await storeDown.anchor("0");
  const storeResponse = await storeDown.routes.put(putRequest("0", body()), context("0"));
  assert.equal(storeResponse.status, 503);
  assert.equal((await storeResponse.json()).error, "metadata_store_unavailable");
});

test("GET returns verified metadata, rejects tampering and 404s unknown events", async () => {
  const { routes, anchor, adapter } = await setup();
  await anchor("0");
  await routes.put(putRequest("0", body()), context("0"));

  const ok = await routes.get(request("GET", "/api/events/0/metadata"), context("0"));
  assert.equal(ok.status, 200);
  const verified = await ok.json();
  assert.equal(verified.verified, true);
  assert.equal(verified.metadata.title, "Demo night");
  assert.equal(verified.metadata_sha256.length, 64);

  await adapter.run("UPDATE event_metadata SET metadata_json = ? WHERE event_id = '0'", [
    JSON.stringify(doc({ title: "Tampered in the database" })),
  ]);
  const tampered = await routes.get(request("GET", "/api/events/0/metadata"), context("0"));
  assert.equal(tampered.status, 409);
  assert.equal((await tampered.json()).error, "metadata_hash_mismatch");

  const missing = await routes.get(request("GET", "/api/events/9/metadata"), context("9"));
  assert.equal(missing.status, 404);
});

test("GET rejects an on-chain hash mismatch for an internally consistent row", async () => {
  const { routes, anchor, chain } = await setup();
  await anchor("0");
  await routes.put(putRequest("0", body()), context("0"));

  const other = await hashMetadata(doc({ title: "Another event" }));
  chain.set("0", { metadata_hash: other.array });

  const response = await routes.get(request("GET", "/api/events/0/metadata"), context("0"));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "metadata_hash_mismatch");
});

test("list exposes only published rows that still verify", async () => {
  const { routes, anchor, store, adapter } = await setup();
  await anchor("0", doc({ title: "Published" }));
  await anchor("1", doc({ title: "Tampered" }));

  for (const id of ["0", "1"]) {
    const metadata = doc({ title: id === "0" ? "Published" : "Tampered" });
    await routes.put(putRequest(id, body(metadata)), context(id));
    await store.setPublicationStatus(
      { network_id: "testnet", contract_id: "contract.testnet", event_id: id },
      "published",
    );
  }
  await adapter.run("UPDATE event_metadata SET metadata_json = ? WHERE event_id = '1'", [
    JSON.stringify(doc({ title: "Edited in the database" })),
  ]);

  const response = await routes.list(request("GET", "/api/events?limit=10"));
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].metadata.title, "Published");
  assert.equal(page.skipped, 1);
});

test("malformed requests are rejected with 400", async () => {
  const { routes } = await setup();

  const badJson = await routes.put(
    request("PUT", "/api/events/0/metadata", { actor: "organizer.testnet", payload: "{not json" }),
    context("0"),
  );
  assert.equal(badJson.status, 400);
  assert.equal((await badJson.json()).error, "invalid_json");

  const noId = await routes.get(request("GET", "/api/events"), { params: Promise.resolve({}) });
  assert.equal(noId.status, 400);
  assert.equal((await noId.json()).error, "invalid_key");
});
