import test from "node:test";
import assert from "node:assert/strict";

import {
  clientKey,
  createRateLimiter,
  createRateLimiters,
  rateLimitedResponse,
  readRateLimitConfig,
} from "../rateLimit.mjs";

test("a fixed window allows up to the limit, then 429s and resets", () => {
  let now = 1_000;
  const limiter = createRateLimiter({ limit: 2, windowMs: 5_000, now: () => now });

  assert.equal(limiter.hit("a").allowed, true);
  assert.equal(limiter.hit("a").allowed, true);
  const denied = limiter.hit("a");
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 5);

  assert.equal(limiter.hit("b").allowed, true, "keys are independent");

  now = 6_000;
  assert.equal(limiter.hit("a").allowed, true);
});

test("new keys fail closed instead of evicting active buckets at the key cap", () => {
  const limiter = createRateLimiter({ limit: 5, windowMs: 10_000, maxKeys: 2 });
  limiter.hit("a");
  limiter.hit("b");
  const denied = limiter.hit("c");
  assert.equal(denied.allowed, false);
  assert.equal(limiter.hit("a").allowed, true);
});

test("config is explicit and safe by default", () => {
  const defaults = readRateLimitConfig({});
  assert.equal(defaults.disabled, false);
  assert.deepEqual(defaults.login, { limit: 10, windowMs: 60_000 });
  assert.deepEqual(defaults.loginAccount, { limit: 10, windowMs: 60_000 });
  assert.deepEqual(defaults.write, { limit: 30, windowMs: 60_000 });

  const tuned = readRateLimitConfig({
    GATHERBOND_LOGIN_RATE_LIMIT: "3",
    GATHERBOND_LOGIN_ACCOUNT_RATE_LIMIT: "4",
    GATHERBOND_LOGIN_RATE_WINDOW_SECONDS: "7",
    GATHERBOND_WRITE_RATE_LIMIT: "9",
    GATHERBOND_WRITE_RATE_WINDOW_SECONDS: "11",
  });
  assert.deepEqual(tuned.login, { limit: 3, windowMs: 7_000 });
  assert.deepEqual(tuned.loginAccount, { limit: 4, windowMs: 7_000 });
  assert.deepEqual(tuned.write, { limit: 9, windowMs: 11_000 });

  const invalid = readRateLimitConfig({
    GATHERBOND_LOGIN_RATE_LIMIT: "nope",
    GATHERBOND_LOGIN_ACCOUNT_RATE_LIMIT: "0",
    GATHERBOND_WRITE_RATE_LIMIT: "-2",
    GATHERBOND_LOGIN_RATE_WINDOW_SECONDS: "0",
  });
  assert.deepEqual(invalid.login, { limit: 10, windowMs: 60_000 });
  assert.deepEqual(invalid.loginAccount, { limit: 10, windowMs: 60_000 });
  assert.deepEqual(invalid.write, { limit: 30, windowMs: 60_000 });

  assert.equal(readRateLimitConfig({ GATHERBOND_RATE_LIMIT_DISABLED: "0" }).disabled, false);
  assert.equal(readRateLimitConfig({ GATHERBOND_RATE_LIMIT_DISABLED: "1" }).disabled, true);
});

test("disabled limiters allow everything explicitly", () => {
  const limits = createRateLimiters(readRateLimitConfig({ GATHERBOND_RATE_LIMIT_DISABLED: "1" }));
  assert.equal(limits.disabled, true);
  assert.equal(limits.login.checkClient("x").allowed, true);
  assert.equal(limits.login.checkAccount("a").allowed, true);
  assert.equal(limits.write("a").allowed, true);
});

test("client identity prefers the first forwarded hop", () => {
  const forwarded = new Request("http://localhost/api/auth/session", {
    headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
  });
  assert.equal(clientKey(forwarded), "203.0.113.5");

  const realIp = new Request("http://localhost/api/auth/session", {
    headers: { "x-real-ip": "198.51.100.9" },
  });
  assert.equal(clientKey(realIp), "198.51.100.9");

  assert.equal(clientKey(new Request("http://localhost/api/auth/session")), "unknown");
});

test("the 429 response carries a retry indicator", async () => {
  const response = rateLimitedResponse({ retryAfterSeconds: 42 });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "rate_limited",
    retry_after_seconds: 42,
  });
});
