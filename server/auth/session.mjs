// HMAC-signed session cookie.
//
// Stateless by design: the token carries the account id and expiry and is authenticated
// with GATHERBOND_SESSION_SECRET. Replay of a login signature is prevented separately by
// the single-use nonce table; this token only proves "this server issued this session".
//
// Token format: v1.<base64url(payload)>.<base64url(HMAC-SHA256(payload))>

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "gatherbond_session";
export const MIN_SECRET_LENGTH = 32;

export function isSessionSecretConfigured(secret) {
  return typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;
}

function hmac(secret, data) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function issueSessionToken({
  secret,
  accountId,
  ttlSeconds = 7200,
  now = Date.now(),
  jti = randomUUID(),
} = {}) {
  if (!isSessionSecretConfigured(secret)) {
    throw new Error(`GATHERBOND_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (typeof accountId !== "string" || accountId.length === 0) {
    throw new Error("issueSessionToken requires an account id");
  }
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + Math.max(1, Math.floor(ttlSeconds));
  const payload = { v: 1, sub: accountId, iat: issuedAt, exp: expiresAt, jti };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `v1.${encoded}.${hmac(secret, encoded)}`;
}

/** Returns { valid, accountId, expiresAt, reason }. Never throws on malformed input. */
export function verifySessionToken({ token, secret, now = Date.now() } = {}) {
  if (!isSessionSecretConfigured(secret)) {
    return { valid: false, reason: "not_configured" };
  }
  if (typeof token !== "string" || token.length === 0) {
    return { valid: false, reason: "missing" };
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return { valid: false, reason: "invalid" };
  }
  const [, encoded, signature] = parts;

  let expected;
  try {
    expected = Buffer.from(hmac(secret, encoded), "base64url");
  } catch {
    return { valid: false, reason: "invalid" };
  }
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { valid: false, reason: "invalid" };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "invalid" };
  }
  if (!payload || payload.v !== 1 || typeof payload.sub !== "string" || !Number.isFinite(payload.exp)) {
    return { valid: false, reason: "invalid" };
  }
  if (Math.floor(now / 1000) >= payload.exp) {
    return { valid: false, reason: "expired", accountId: payload.sub, expiresAt: payload.exp };
  }
  return { valid: true, accountId: payload.sub, expiresAt: payload.exp, session: payload };
}

export function parseCookies(header) {
  const cookies = {};
  if (typeof header !== "string") {
    return cookies;
  }
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) {
      cookies[name] = value;
    }
  }
  return cookies;
}

/** Read and verify the session cookie from a Web Request. */
export function readSessionCookie(request, { secret, now = Date.now() } = {}) {
  const token = parseCookies(request?.headers?.get?.("cookie"))[SESSION_COOKIE];
  if (!token) {
    return { valid: false, accountId: null, reason: "missing" };
  }
  const result = verifySessionToken({ token, secret, now });
  // Keep the expiry reason for the whoami response, but never hand out an account id
  // for an invalid or expired token: callers use this value as the write actor.
  return { ...result, accountId: result.valid ? result.accountId : null };
}

export function sessionCookie(token, { maxAgeSeconds = 7200, secure = false } = {}) {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function clearedSessionCookie({ secure = false } = {}) {
  return sessionCookie("", { maxAgeSeconds: 0, secure });
}
