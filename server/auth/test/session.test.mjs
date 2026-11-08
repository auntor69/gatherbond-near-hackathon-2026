import test from "node:test";
import assert from "node:assert/strict";

import {
  clearedSessionCookie,
  isSessionSecretConfigured,
  issueSessionToken,
  parseCookies,
  readSessionCookie,
  sessionCookie,
  verifySessionToken,
} from "../session.mjs";

const SECRET = "test-session-secret-that-is-at-least-32-chars";
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

test("session tokens round-trip the account and expiry", () => {
  const token = issueSessionToken({
    secret: SECRET,
    accountId: "organizer.testnet",
    ttlSeconds: 600,
    now: NOW,
  });
  const result = verifySessionToken({ token, secret: SECRET, now: NOW });
  assert.equal(result.valid, true);
  assert.equal(result.accountId, "organizer.testnet");
  assert.equal(result.expiresAt, Math.floor(NOW / 1000) + 600);
});

test("expired, tampered and foreign-secret tokens are rejected", () => {
  const token = issueSessionToken({
    secret: SECRET,
    accountId: "organizer.testnet",
    ttlSeconds: 60,
    now: NOW,
  });

  const expired = verifySessionToken({
    token,
    secret: SECRET,
    now: NOW + 61_000,
  });
  assert.equal(expired.valid, false);
  assert.equal(expired.reason, "expired");

  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.equal(verifySessionToken({ token: tampered, secret: SECRET, now: NOW }).reason, "invalid");

  const foreign = verifySessionToken({ token, secret: `${SECRET}-other`, now: NOW });
  assert.equal(foreign.valid, false);
  assert.equal(foreign.reason, "invalid");

  assert.equal(verifySessionToken({ token, secret: "", now: NOW }).reason, "not_configured");
  assert.equal(verifySessionToken({ token: "", secret: SECRET, now: NOW }).reason, "missing");
});

test("secrets shorter than 32 characters are not configured", () => {
  assert.equal(isSessionSecretConfigured("short"), false);
  assert.equal(isSessionSecretConfigured(SECRET), true);
  assert.throws(() => issueSessionToken({ secret: "short", accountId: "a.testnet" }), /32/);
});

test("cookies are HttpOnly, SameSite=Lax and parse without leaking other values", () => {
  const cookie = sessionCookie("v1.abc.def", { maxAgeSeconds: 120, secure: true });
  assert.match(cookie, /^gatherbond_session=v1\.abc\.def;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=120/);
  assert.match(cookie, /Secure/);

  assert.equal(clearedSessionCookie().includes("Max-Age=0"), true);

  const parsed = parseCookies("a=1; gatherbond_session=v1.abc.def; theme=dark");
  assert.equal(parsed.gatherbond_session, "v1.abc.def");
  assert.equal(parsed.a, "1");
});

test("readSessionCookie uses only the verified cookie", () => {
  const token = issueSessionToken({
    secret: SECRET,
    accountId: "organizer.testnet",
    ttlSeconds: 600,
    now: NOW,
  });
  const request = new Request("http://localhost/api/events", {
    headers: { cookie: `theme=dark; gatherbond_session=${token}` },
  });
  const result = readSessionCookie(request, { secret: SECRET, now: NOW });
  assert.equal(result.accountId, "organizer.testnet");

  const forged = new Request("http://localhost/api/events", {
    headers: { cookie: "gatherbond_session=v1.forged.token" },
  });
  assert.equal(readSessionCookie(forged, { secret: SECRET, now: NOW }).accountId, null);
});
