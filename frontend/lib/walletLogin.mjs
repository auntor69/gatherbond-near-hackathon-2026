// Browser-safe helpers for the NEP-413 wallet login exchange.
//
// The wallet signs the message and 32-byte nonce below. The server verifies the
// signature, checks that the public key is a FullAccess key for the account, and only
// then issues the HttpOnly session cookie. These helpers do not hash or sign anything;
// they only make the request payload deterministic and prevent malformed values from
// reaching the server.

export const WALLET_LOGIN_MESSAGE =
  "Sign in to GatherBond. This signature proves you control this NEAR account. It does not send a transaction or move funds.";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

/** Encode the exact 32 nonce bytes as base64, the format the server verifier accepts. */
export function encodeNonce(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
    throw new TypeError("A NEP-413 nonce must be exactly 32 bytes");
  }
  if (typeof globalThis.btoa !== "function") {
    throw new Error("Base64 encoding is unavailable in this browser");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}

/** Human-readable text the wallet displays before signing. Keep it under 512 bytes. */
export function loginMessageFor(accountId) {
  const account = requireString(accountId, "accountId");
  return `${WALLET_LOGIN_MESSAGE}\n\nAccount: ${account}`;
}

/** HOT Connect may return a bare base58 key; the server expects the ed25519 prefix. */
export function normalizeEd25519PublicKey(value) {
  const key = requireString(value, "publicKey");
  if (key.startsWith("ed25519:")) {
    return key;
  }
  if (BASE58.test(key)) {
    return `ed25519:${key}`;
  }
  throw new TypeError("The wallet returned an unsupported public key");
}

/** Normalize base64url output and reject anything that is not a 64-byte signature. */
export function normalizeSignature(value) {
  const signature = requireString(value, "signature")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  if (typeof globalThis.atob !== "function") {
    throw new Error("Base64 decoding is unavailable in this browser");
  }
  let decoded;
  try {
    decoded = globalThis.atob(signature);
  } catch {
    throw new TypeError("The wallet returned a malformed signature");
  }
  if (decoded.length !== 64) {
    throw new TypeError("The wallet returned a signature with the wrong length");
  }
  return signature;
}

/** Build the exact JSON body consumed by POST /api/auth/session. */
export function createWalletLoginBody({
  accountId,
  publicKey,
  signature,
  message,
  nonce,
  recipient,
}) {
  const account = requireString(accountId, "accountId");
  const text = requireString(message, "message");
  if (text.length > 512) {
    throw new TypeError("The login message is too long");
  }
  return {
    account_id: account,
    public_key: normalizeEd25519PublicKey(publicKey),
    signature: normalizeSignature(signature),
    message: text,
    nonce: requireString(nonce, "nonce"),
    recipient: requireString(recipient, "recipient"),
    callback_url: null,
  };
}
