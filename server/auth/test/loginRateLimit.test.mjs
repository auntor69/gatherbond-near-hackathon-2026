import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

import { encodeBase58 } from "../base58.mjs";
import { nep413SigningDigest } from "../nep413.mjs";
import { createAuthRoutes } from "../routes.mjs";

const RECIPIENT = "gatherbond.app";
const SECRET = "login-rate-limit-secret-at-least-32-chars";

function account() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return { raw, privateKey, publicKey: `ed25519:${encodeBase58(raw)}` };
}

function signedBody(keys) {
  const message = "Sign in to GatherBond";
  const nonce = randomBytes(32);
  const digest = nep413SigningDigest({ message, nonce, recipient: RECIPIENT });
  return {
    account_id: "organizer.testnet",
    public_key: keys.publicKey,
    signature: sign(null, digest, keys.privateKey).toString("base64"),
    message,
    nonce: nonce.toString("base64"),
    recipient: RECIPIENT,
  };
}

function setup({ rateLimitLogin }) {
  const keys = account();
  let lookups = 0;
  let claims = 0;
  const handlers = createAuthRoutes({
    config: { secret: SECRET, recipient: RECIPIENT, ttlSeconds: 600 },
    rateLimitLogin,
    lookupAccessKey: async () => {
      lookups += 1;
      return { permission: "FullAccess" };
    },
    nonceStore: {
      async claim() {
        claims += 1;
        return true;
      },
    },
  });
  return {
    handlers,
    keys,
    stats: () => ({ lookups, claims }),
  };
}

function loginRequest(body) {
  return new Request("http://localhost/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
    body: JSON.stringify(body),
  });
}

test("a client over its login limit gets 429 before any RPC or nonce work", async () => {
  const { handlers, keys, stats } = setup({
    rateLimitLogin: {
      checkClient: () => ({ allowed: false, retryAfterSeconds: 17 }),
      checkAccount: () => assert.fail("account limiter must not run after a client denial"),
    },
  });

  const response = await handlers.login(loginRequest(signedBody(keys)));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "17");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), {
    error: "rate_limited",
    retry_after_seconds: 17,
  });
  assert.deepEqual(stats(), { lookups: 0, claims: 0 });
});

test("an account over its login limit also fails before RPC or nonce work", async () => {
  const { handlers, keys, stats } = setup({
    rateLimitLogin: {
      checkClient: () => ({ allowed: true }),
      checkAccount: () => ({ allowed: false, retryAfterSeconds: 3 }),
    },
  });

  const response = await handlers.login(loginRequest(signedBody(keys)));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(stats(), { lookups: 0, claims: 0 });
});

test("the client limiter runs even when the body is garbage", async () => {
  let checks = 0;
  const { handlers } = setup({
    rateLimitLogin: {
      checkClient: () => {
        checks += 1;
        return { allowed: true };
      },
      checkAccount: () => ({ allowed: true }),
    },
  });

  const response = await handlers.login(
    new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(checks, 1, "malformed attempts are still counted by the client limiter");
});
