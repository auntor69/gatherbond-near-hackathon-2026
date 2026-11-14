import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_COOKIE,
  adminKeyStatus,
  isAdminMutationRequest,
  issueAdminToken,
  parseAdminAccounts,
  readAdminAccess,
  verifyAdminKey,
  verifyAdminToken,
} from "../auth.mjs";

const SECRET = "a".repeat(64);
const ACCOUNT = "admin.testnet";

function request({ cookie, origin = "https://gatherbond.test", url = origin } = {}) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (origin) headers.set("origin", origin);
  return new Request(url + "/api/admin/access", { headers });
}

test("the allowlist accepts only valid account ids and removes duplicates", () => {
  assert.deepEqual(
    parseAdminAccounts("admin.testnet, second.testnet admin.testnet, BAD ID, x"),
    ["admin.testnet", "second.testnet"],
  );
  assert.deepEqual(parseAdminAccounts(""), []);
});

test("the second-factor key must be at least 16 characters", () => {
  assert.equal(adminKeyStatus(""), "not_configured");
  assert.equal(adminKeyStatus("short"), "too_short");
  assert.equal(adminKeyStatus("a".repeat(16)), "configured");
  assert.equal(verifyAdminKey("correct horse battery staple", "correct horse battery staple"), true);
  assert.equal(verifyAdminKey("wrong horse battery staple", "correct horse battery staple"), false);
});

test("admin tokens are bound to the account, role, secret and expiry", () => {
  const token = issueAdminToken({ secret: SECRET, accountId: ACCOUNT, ttlSeconds: 60 });
  assert.equal(verifyAdminToken({ token, secret: SECRET, accountId: ACCOUNT }), true);
  assert.equal(
    verifyAdminToken({ token, secret: SECRET, accountId: "other.testnet" }),
    false,
    "a token copied to another wallet session must not work",
  );
  assert.equal(
    verifyAdminToken({ token, secret: "b".repeat(64), accountId: ACCOUNT }),
    false,
    "a token signed with another secret must not work",
  );
  assert.equal(
    verifyAdminToken({
      token,
      secret: SECRET,
      accountId: ACCOUNT,
      now: Date.now() + 61_000,
    }),
    false,
    "an expired token must not work",
  );
});

test("access requires a session, allowlist membership and the configured second factor", () => {
  const base = {
    request: request(),
    accounts: [ACCOUNT],
    secret: SECRET,
    key: "",
  };

  assert.equal(readAdminAccess({ ...base, actor: null }).error, "unauthorized");
  assert.equal(readAdminAccess({ ...base, actor: "stranger.testnet" }).error, "forbidden");

  const noKey = readAdminAccess({ ...base, actor: ACCOUNT });
  assert.equal(noKey.ok, true);
  assert.equal(noKey.key_required, false);

  const keyRequired = readAdminAccess({
    ...base,
    actor: ACCOUNT,
    key: "a".repeat(16),
  });
  assert.equal(keyRequired.ok, false);
  assert.equal(keyRequired.error, "admin_unlock_required");

  const token = issueAdminToken({ secret: SECRET, accountId: ACCOUNT });
  const unlocked = readAdminAccess({
    ...base,
    request: request({ cookie: `${ADMIN_COOKIE}=${token}` }),
    actor: ACCOUNT,
    key: "a".repeat(16),
  });
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.key_required, true);

  const wrongAccount = readAdminAccess({
    ...base,
    request: request({ cookie: `${ADMIN_COOKIE}=${token}` }),
    actor: "other.testnet",
    key: "a".repeat(16),
  });
  assert.equal(wrongAccount.ok, false);
  assert.equal(wrongAccount.error, "forbidden");
});

test("a too-short configured key fails closed instead of downgrading to wallet-only access", () => {
  const result = readAdminAccess({
    request: request(),
    actor: ACCOUNT,
    accounts: [ACCOUNT],
    secret: SECRET,
    key: "short",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.error, "admin_key_invalid");
});

test("mutations require a same-origin request and the custom admin header", () => {
  const url = "https://gatherbond.test";
  const good = new Request(url + "/api/admin/events/0/moderation", {
    method: "POST",
    headers: {
      origin: url,
      "x-gatherbond-admin": "1",
    },
  });
  assert.equal(isAdminMutationRequest(good), true);

  const missingHeader = new Request(url + "/api/admin/events/0/moderation", {
    method: "POST",
    headers: { origin: url },
  });
  assert.equal(isAdminMutationRequest(missingHeader), false);

  const foreign = new Request(url + "/api/admin/events/0/moderation", {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "x-gatherbond-admin": "1",
    },
  });
  assert.equal(isAdminMutationRequest(foreign), false);

  // Next can canonicalize request.url to localhost while the browser is on 127.0.0.1.
  const local = new Request("http://localhost:3100/api/admin/events/0/moderation", {
    method: "POST",
    headers: {
      origin: "http://127.0.0.1:3100",
      host: "127.0.0.1:3100",
      "x-gatherbond-admin": "1",
    },
  });
  assert.equal(isAdminMutationRequest(local), true);

  const mismatchedHost = new Request("http://localhost:3100/api/admin/events/0/moderation", {
    method: "POST",
    headers: {
      origin: "http://evil.example",
      host: "127.0.0.1:3100",
      "x-gatherbond-admin": "1",
    },
  });
  assert.equal(isAdminMutationRequest(mismatchedHost), false);

  const spoofedForwardedHost = new Request("https://gatherbond.test/api/admin/events/0/moderation", {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      host: "gatherbond.test",
      "x-forwarded-host": "evil.example",
      "x-gatherbond-admin": "1",
    },
  });
  assert.equal(isAdminMutationRequest(spoofedForwardedHost), false);
});
