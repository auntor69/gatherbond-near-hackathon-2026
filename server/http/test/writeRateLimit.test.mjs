import test from "node:test";
import assert from "node:assert/strict";

import { createMetadataRoutes } from "../routes.mjs";

const TX = "1111111111111111111111111111111111111111";

function request(actor) {
  return new Request("http://localhost/api/events/0/metadata", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(actor ? { "x-actor": actor } : {}),
    },
    body: JSON.stringify({
      metadata: {
        schema_version: 1,
        network_id: "testnet",
        contract_id: "contract.testnet",
        organizer_account_id: "organizer.testnet",
        title: "Demo",
        description: "",
        category: "community",
        venue: "",
        created_at: "2026-11-07T12:00:00Z",
      },
      create_tx_hash: TX,
    }),
  });
}

function setup({ actor = "organizer.testnet", limit }) {
  let calls = 0;
  let limitedActor = null;
  const handlers = {
    async put() {
      calls += 1;
      return { status: 200, body: { ok: true } };
    },
  };
  const routes = createMetadataRoutes({
    handlers,
    getActor: async (incoming) => incoming.headers.get("x-actor"),
    rateLimitWrite: async (accountId) => {
      limitedActor = accountId;
      return limit;
    },
    networkId: "testnet",
    contractId: "contract.testnet",
  });
  return {
    routes,
    stats: () => ({ calls, limitedActor }),
  };
}

const context = { params: Promise.resolve({ id: "0" }) };

test("a throttled write returns 429 before the handler or store is touched", async () => {
  const { routes, stats } = setup({
    limit: { allowed: false, retryAfterSeconds: 9 },
  });

  const response = await routes.put(request("organizer.testnet"), context);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "9");
  assert.deepEqual(await response.json(), {
    error: "rate_limited",
    retry_after_seconds: 9,
  });
  assert.deepEqual(stats(), { calls: 0, limitedActor: "organizer.testnet" });
});

test("an allowed write reaches the handler and is counted against the actor", async () => {
  const { routes, stats } = setup({ limit: { allowed: true, remaining: 4 } });
  const response = await routes.put(request("organizer.testnet"), context);
  assert.equal(response.status, 200);
  assert.deepEqual(stats(), { calls: 1, limitedActor: "organizer.testnet" });
});

test("an unauthenticated write stays 401 and does not consume a limit", async () => {
  let limited = 0;
  const routes = createMetadataRoutes({
    handlers: {
      async put({ actor }) {
        return actor
          ? { status: 200, body: { ok: true } }
          : { status: 401, body: { error: "unauthorized" } };
      },
    },
    getActor: async () => null,
    rateLimitWrite: async () => {
      limited += 1;
      return { allowed: true };
    },
    networkId: "testnet",
    contractId: "contract.testnet",
  });

  const response = await routes.put(request(null), context);
  assert.equal(response.status, 401);
  assert.equal(limited, 0);
});

test("publish uses the same per-actor limit before the publication handler", async () => {
  let calls = 0;
  const routes = createMetadataRoutes({
    handlers: {
      async publish() {
        calls += 1;
        return { status: 201, body: { version: 1 } };
      },
    },
    getActor: async (incoming) => incoming.headers.get("x-actor"),
    rateLimitWrite: async () => ({ allowed: false, retryAfterSeconds: 7 }),
    networkId: "testnet",
    contractId: "contract.testnet",
  });
  const response = await routes.publish(
    new Request("http://localhost/api/events/0/publication", {
      method: "POST",
      headers: { "x-actor": "organizer.testnet" },
    }),
    context,
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "7");
  assert.equal(calls, 0);
});
