import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

import { encodeBase58 } from "../base58.mjs";
import { nep413SigningDigest } from "../nep413.mjs";
import { createAuthRoutes } from "../routes.mjs";

const RECIPIENT = "gatherbond.app";
const SECRET = "route-test-session-secret-at-least-32-chars";
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

function account() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return { raw, privateKey, publicKey: `ed25519:${encodeBase58(raw)}` };
}

function bodyFor(keys) {
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

function routes({ secret = SECRET } = {}) {
  const keys = account();
  const used = new Set();
  const handlers = createAuthRoutes({
    config: { secret, recipient: RECIPIENT, ttlSeconds: 600 },
    now: () => NOW,
    lookupAccessKey: async (accountId, publicKey) =>
      accountId === "organizer.testnet" && publicKey === keys.publicKey
        ? { permission: "FullAccess" }
        : null,
    nonceStore: {
      async claim(accountId, nonce) {
        const key = `${accountId}:${nonce}`;
        if (used.has(key)) {
          return false;
        }
        used.add(key);
        return true;
      },
    },
  });
  return { ...handlers, keys };
}

function loginRequest(payload) {
  return new Request("http://localhost/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("login sets an HttpOnly cookie that whoami accepts, and logout clears it", async () => {
  const handlers = routes();
  const payload = bodyFor(handlers.keys);
  const login = await handlers.login(loginRequest(payload));
  assert.equal(login.status, 200);
  assert.equal((await login.json()).account_id, "organizer.testnet");

  const setCookie = (login.headers.getSetCookie?.() ?? [])[0] ?? "";
  assert.match(setCookie, /gatherbond_session=/);
  assert.match(setCookie, /HttpOnly/);
  const cookie = setCookie.split(";")[0];

  const whoami = await handlers.session(
    new Request("http://localhost/api/auth/session", { headers: { cookie } }),
  );
  assert.equal(whoami.status, 200);
  const whoamiBody = await whoami.json();
  assert.equal(whoamiBody.account_id, "organizer.testnet");
  assert.equal(whoamiBody.configured, true);
  assert.equal(whoamiBody.recipient, RECIPIENT);

  const logout = await handlers.logout();
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
});

test("without a session secret login is 503 and whoami is 401", async () => {
  const handlers = routes({ secret: "" });
  const payload = bodyFor(account());
  const login = await handlers.login(loginRequest(payload));
  assert.equal(login.status, 503);
  assert.equal((await login.json()).error, "auth_not_configured");

  const whoami = await handlers.session(new Request("http://localhost/api/auth/session"));
  assert.equal(whoami.status, 401);
  const whoamiBody = await whoami.json();
  assert.equal(whoamiBody.error, "unauthorized");
  assert.equal(whoamiBody.configured, false);
  assert.equal(whoamiBody.recipient, RECIPIENT);
});

test("an expired cookie is reported as session_expired", async () => {
  const handlers = routes();
  const payload = bodyFor(handlers.keys);
  const login = await handlers.login(loginRequest(payload));
  const cookie = ((login.headers.getSetCookie?.() ?? [])[0] ?? "").split(";")[0];

  // The route's clock is fixed at NOW; mint a cookie that expired one second earlier.
  const { issueSessionToken } = await import("../session.mjs");
  const expired = issueSessionToken({
    secret: SECRET,
    accountId: "organizer.testnet",
    ttlSeconds: 1,
    now: NOW - 2_000,
  });
  const response = await handlers.session(
    new Request("http://localhost/api/auth/session", {
      headers: { cookie: `gatherbond_session=${expired}` },
    }),
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "session_expired");
  assert.ok(cookie);
});
