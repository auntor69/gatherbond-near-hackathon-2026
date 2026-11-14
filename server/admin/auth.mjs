// Private moderation authorization.
//
// There is no public "admin" flag. Access requires all of:
//   1. a verified NEP-413 wallet session (the actor comes from the HttpOnly cookie);
//   2. that account is on the server-side GATHERBOND_ADMIN_ACCOUNTS allowlist;
//   3. if GATHERBOND_ADMIN_KEY is configured, a separate short-lived unlock cookie.
//
// The unlock cookie is HMAC-signed with the session secret and bound to the account id,
// so copying it to another wallet session does not work. The admin key is never sent to
// the browser bundle, and mutations also require a same-origin request plus a custom
// header that simple cross-site forms cannot set.

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { parseCookies } from "../auth/session.mjs";

export const ADMIN_COOKIE = "gatherbond_admin";
export const ADMIN_UNLOCK_TTL_SECONDS = 1800;
export const MIN_ADMIN_KEY_LENGTH = 16;

const ACCOUNT_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;

export function parseAdminAccounts(value) {
  const entries = String(value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => ACCOUNT_ID.test(entry));
  return [...new Set(entries)];
}

export function isAdminAccount(actor, accounts) {
  return typeof actor === "string" && Array.isArray(accounts) && accounts.includes(actor);
}

/** "not_configured", "too_short", or "configured". */
export function adminKeyStatus(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key) {
    return "not_configured";
  }
  return key.length >= MIN_ADMIN_KEY_LENGTH ? "configured" : "too_short";
}

function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest();
}

/** Constant-time comparison; both inputs are hashed first so lengths are equal. */
export function verifyAdminKey(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string" || expected.length === 0) {
    return false;
  }
  return timingSafeEqual(digest(provided), digest(expected));
}

function hmac(secret, data) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function issueAdminToken({
  secret,
  accountId,
  ttlSeconds = ADMIN_UNLOCK_TTL_SECONDS,
  now = Date.now(),
  jti = randomUUID(),
} = {}) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("admin unlock requires a configured session secret");
  }
  if (typeof accountId !== "string" || !ACCOUNT_ID.test(accountId)) {
    throw new Error("issueAdminToken requires a valid account id");
  }
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + Math.max(1, Math.floor(ttlSeconds));
  const payload = {
    v: 1,
    role: "admin",
    sub: accountId,
    iat: issuedAt,
    exp: expiresAt,
    jti,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `v1.${encoded}.${hmac(secret, encoded)}`;
}

export function verifyAdminToken({ token, secret, accountId, now = Date.now() } = {}) {
  if (typeof secret !== "string" || secret.length < 32) {
    return false;
  }
  if (typeof token !== "string" || token.length === 0) {
    return false;
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return false;
  }
  const [, encoded, signature] = parts;
  let expected;
  try {
    expected = Buffer.from(hmac(secret, encoded), "base64url");
  } catch {
    return false;
  }
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return false;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  return (
    payload &&
    payload.v === 1 &&
    payload.role === "admin" &&
    payload.sub === accountId &&
    Number.isFinite(payload.exp) &&
    Math.floor(now / 1000) < payload.exp
  );
}

export function adminCookie(token, { maxAgeSeconds = ADMIN_UNLOCK_TTL_SECONDS, secure = false } = {}) {
  const attributes = [
    `${ADMIN_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function clearedAdminCookie({ secure = false } = {}) {
  return adminCookie("", { maxAgeSeconds: 0, secure });
}

export function readAdminCookie(request) {
  return parseCookies(request?.headers?.get?.("cookie"))[ADMIN_COOKIE] ?? null;
}

/**
 * The single server-side gate used by every admin route.
 * Returns { ok: true, actor } or { ok: false, status, error }.
 */
export function readAdminAccess({
  request,
  actor,
  accounts,
  secret,
  key,
  now = Date.now(),
} = {}) {
  if (!actor) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (!isAdminAccount(actor, accounts)) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  const status = adminKeyStatus(key);
  if (status === "too_short") {
    return { ok: false, status: 503, error: "admin_key_invalid" };
  }
  if (status === "not_configured") {
    return { ok: true, actor, key_required: false };
  }

  const token = readAdminCookie(request);
  if (!verifyAdminToken({ token, secret, accountId: actor, now })) {
    return { ok: false, status: 401, error: "admin_unlock_required", key_required: true };
  }
  return { ok: true, actor, key_required: true };
}

/** Mutations must not be triggerable by a simple cross-site form. */
export function isAdminMutationRequest(request) {
  if (request?.headers?.get?.("x-gatherbond-admin") !== "1") {
    return false;
  }
  const origin = request?.headers?.get?.("origin");
  if (!origin) {
    return false;
  }
  try {
    const requestUrl = new URL(request.url);
    // Next may canonicalize request.url to localhost while the browser is on
    // 127.0.0.1. Compare against the actual Host header instead. Host is a
    // browser-forbidden header and cannot be set by cross-site JavaScript. Never trust
    // X-Forwarded-Host here: unlike Host, it is client-settable, so a forged Origin
    // could otherwise look same-origin.
    const host = (request.headers?.get?.("host") ?? requestUrl.host).trim().toLowerCase();
    const forwardedProto = request.headers?.get?.("x-forwarded-proto") ?? "";
    const protocol = (
      forwardedProto.split(",")[0].trim() || requestUrl.protocol.replace(":", "")
    ).toLowerCase();
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host.toLowerCase() === host && parsedOrigin.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}
