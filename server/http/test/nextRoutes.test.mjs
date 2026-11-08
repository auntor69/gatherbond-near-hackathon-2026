import test from "node:test";
import assert from "node:assert/strict";

import { resetMetadataRoutesForTests } from "../nextRuntime.mjs";

const CLEARED = [
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "METADATA_SQLITE_PATH",
  "GATHERBOND_ALLOW_DEV_ACTOR",
  "GATHERBOND_SESSION_SECRET",
  "GATHERBOND_AUTH_RECIPIENT",
  "GATHERBOND_SESSION_TTL_SECONDS",
  "GATHERBOND_SECURE_COOKIES",
  "CONTRACT_NAME",
  "NEXT_PUBLIC_CONTRACT_NAME",
  "NEAR_RPC_URL",
  "NEAR_NETWORK_ID",
  "NEXT_PUBLIC_NEAR_NETWORK_ID",
];

function clearEnvironment() {
  for (const key of CLEARED) {
    delete process.env[key];
  }
}

function demoDocument() {
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
  };
}

test("Next app/API list route degrades to 503 without a database", async () => {
  clearEnvironment();
  resetMetadataRoutesForTests();

  const { GET } = await import("../../../frontend/app/api/events/route.js");
  const response = await GET(new Request("http://localhost/api/events"));

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).error, "metadata_store_unavailable");
});

test("Next list route serves an empty published page over local SQLite", async () => {
  clearEnvironment();
  process.env.METADATA_SQLITE_PATH = ":memory:";
  resetMetadataRoutesForTests();

  const { GET } = await import("../../../frontend/app/api/events/route.js");
  const response = await GET(new Request("http://localhost/api/events?limit=5"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [], skipped: 0, next_offset: 0 });
});

test("Next dynamic route returns 401 without an actor and 503 without a contract", async () => {
  clearEnvironment();
  process.env.METADATA_SQLITE_PATH = ":memory:";
  resetMetadataRoutesForTests();

  const { PUT } = await import("../../../frontend/app/api/events/[id]/metadata/route.js");
  const payload = JSON.stringify({
    metadata: demoDocument(),
    create_tx_hash: "1111111111111111111111111111111111111111",
  });
  const context = { params: Promise.resolve({ id: "0" }) };

  const anonymous = await PUT(
    new Request("http://localhost/api/events/0/metadata", { method: "PUT", body: payload }),
    context,
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, "unauthorized");

  process.env.GATHERBOND_ALLOW_DEV_ACTOR = "1";
  resetMetadataRoutesForTests();
  const withActor = await PUT(
    new Request("http://localhost/api/events/0/metadata", {
      method: "PUT",
      headers: { "x-gatherbond-actor": "organizer.testnet" },
      body: payload,
    }),
    context,
  );
  assert.equal(withActor.status, 503);
  assert.equal((await withActor.json()).error, "chain_unavailable");
});

test("Next auth session route fails closed without a session secret", async () => {
  clearEnvironment();
  resetMetadataRoutesForTests();

  const { POST, GET } = await import("../../../frontend/app/api/auth/session/route.js");
  const post = await POST(
    new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  assert.equal(post.status, 503);
  assert.equal((await post.json()).error, "auth_not_configured");

  const get = await GET(new Request("http://localhost/api/auth/session"));
  assert.equal(get.status, 401);
  const getBody = await get.json();
  assert.equal(getBody.error, "unauthorized");
  assert.equal(getBody.configured, false);
  assert.equal(getBody.recipient, "gatherbond.app");
});

test("Next dynamic route rejects a malformed body before any chain lookup", async () => {
  clearEnvironment();
  process.env.METADATA_SQLITE_PATH = ":memory:";
  resetMetadataRoutesForTests();

  const { PUT } = await import("../../../frontend/app/api/events/[id]/metadata/route.js");
  const response = await PUT(
    new Request("http://localhost/api/events/0/metadata", { method: "PUT", body: "{nope" }),
    { params: Promise.resolve({ id: "0" }) },
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_json");
});
