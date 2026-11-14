import test from "node:test";
import assert from "node:assert/strict";

import { createRateLimiter } from "../../http/rateLimit.mjs";
import { adminUnlock } from "../http.mjs";

const SECRET = "s".repeat(64);
const ACCOUNT = "admin.testnet";
const KEY = "admin-key-0123456789";

function context({ secure = false, limit = 5 } = {}) {
  return {
    getSessionActor: async () => ACCOUNT,
    admin: {
      accounts: [ACCOUNT],
      secret: SECRET,
      key: KEY,
      keyStatus: "configured",
      secure,
      ttlSeconds: 600,
      unlockLimiter: createRateLimiter({ limit, windowMs: 60_000 }),
    },
  };
}

function request(key, ip = "203.0.113.1") {
  return new Request("https://gatherbond.test/api/admin/unlock", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ key }),
  });
}

test("unlock attempts are limited per account, not by a spoofable IP", async () => {
  const ctx = context({ limit: 1 });
  const first = await adminUnlock(ctx, request("wrong", "198.51.100.1"));
  assert.equal(first.status, 401);

  const second = await adminUnlock(ctx, request("wrong", "198.51.100.2"));
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error, "rate_limited");
});

test("the unlock cookie is Secure only when the admin context is secure", async () => {
  const insecure = await adminUnlock(context(), request(KEY));
  assert.equal(insecure.status, 200);
  assert.doesNotMatch(insecure.headers.get("set-cookie"), /; Secure/);

  const secure = await adminUnlock(context({ secure: true }), request(KEY));
  assert.equal(secure.status, 200);
  assert.match(secure.headers.get("set-cookie"), /; Secure/);
});