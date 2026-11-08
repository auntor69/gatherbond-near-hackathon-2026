// NEP-413 ("Sign in with NEAR") payload construction and Ed25519 verification.
//
// The wallet signs, per the NEP-413 spec:
//
//   sha256( u32le(2^31 + 413) || borsh({ message, nonce[32], recipient, callbackUrl? }) )
//
// and returns a base64 Ed25519 signature over that 32-byte digest. The account id is not
// part of the signed bytes; ownership is proven by checking `view_access_key(account,
// public_key)` on chain, which the login verifier does through the read-only RPC seam.
//
// Spec: https://github.com/near/NEPs/blob/master/neps/nep-0413.md
// Borsh layout: string = u32le length + UTF-8 bytes; Option<String> = 0x00 | 0x01 + string.

import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";

import { decodeBase58 } from "./base58.mjs";

export const NEP413_TAG = 2147484061;
export const NONCE_BYTES = 32;
export const SIGNATURE_BYTES = 64;

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export class Nep413Error extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Nep413Error";
    this.code = code;
  }
}

function u32le(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0, 0);
  return bytes;
}

function borshString(value, field) {
  if (typeof value !== "string") {
    throw new Nep413Error(`invalid_${field}`, `${field} must be a string`);
  }
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

export function nonceBytes(nonce) {
  const bytes = Buffer.isBuffer(nonce) ? nonce : Buffer.from(nonce ?? []);
  if (bytes.length !== NONCE_BYTES) {
    throw new Nep413Error("invalid_nonce", "nonce must be exactly 32 bytes");
  }
  return bytes;
}

/** Serialize the inner NEP-413 Payload (without the prefix tag). */
export function serializeNep413Payload({ message, nonce, recipient, callbackUrl } = {}) {
  if (typeof message !== "string" || message.length === 0) {
    throw new Nep413Error("invalid_message", "message must be a non-empty string");
  }
  if (message.length > 512) {
    throw new Nep413Error("invalid_message", "message must be at most 512 characters");
  }
  if (typeof recipient !== "string" || recipient.length === 0) {
    throw new Nep413Error("invalid_recipient", "recipient must be a non-empty string");
  }

  const parts = [borshString(message, "message"), nonceBytes(nonce), borshString(recipient, "recipient")];
  if (callbackUrl === undefined || callbackUrl === null) {
    parts.push(Buffer.from([0]));
  } else if (typeof callbackUrl === "string" && callbackUrl.length <= 512) {
    parts.push(Buffer.from([1]), borshString(callbackUrl, "callback_url"));
  } else {
    throw new Nep413Error("invalid_callback_url", "callbackUrl must be a string of at most 512 characters");
  }
  return Buffer.concat(parts);
}

/** The exact 32-byte digest an Ed25519 key signs. */
export function nep413SigningDigest(params) {
  const tagged = Buffer.concat([u32le(NEP413_TAG), serializeNep413Payload(params)]);
  return createHash("sha256").update(tagged).digest();
}

/** Parse `ed25519:<base58>` into the 32 raw key bytes. */
export function parseEd25519PublicKey(value) {
  if (typeof value !== "string") {
    throw new Nep413Error("invalid_public_key", "public_key must be a string");
  }
  const match = /^ed25519:([1-9A-HJ-NP-Za-km-z]+)$/.exec(value);
  if (!match) {
    throw new Nep413Error(
      "invalid_public_key",
      "public_key must use the ed25519:<base58> form (secp256k1 keys are not supported)",
    );
  }
  let raw;
  try {
    raw = decodeBase58(match[1]);
  } catch {
    throw new Nep413Error("invalid_public_key", "public_key is not valid base58");
  }
  if (raw.length !== 32) {
    throw new Nep413Error("invalid_public_key", "ed25519 public key must be 32 bytes");
  }
  return raw;
}

export function parseSignature(value) {
  if (typeof value !== "string" || value.length > 128 || !BASE64.test(value)) {
    throw new Nep413Error("invalid_signature", "signature must be base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== SIGNATURE_BYTES) {
    throw new Nep413Error("invalid_signature", "signature must be 64 bytes");
  }
  return bytes;
}

export function parseNonceBase64(value) {
  if (typeof value !== "string" || value.length > 64 || !BASE64.test(value)) {
    throw new Nep413Error("invalid_nonce", "nonce must be base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== NONCE_BYTES) {
    throw new Nep413Error("invalid_nonce", "nonce must be exactly 32 bytes");
  }
  return bytes;
}

/**
 * Verify a NEP-413 signed message. Returns true/false; malformed keys, signatures or
 * payload fields throw Nep413Error so the caller can answer 400.
 */
export function verifySignedMessage({
  publicKey,
  signature,
  message,
  nonce,
  recipient,
  callbackUrl,
}) {
  const rawKey = parseEd25519PublicKey(publicKey);
  const signatureBytes = parseSignature(signature);
  const digest = nep413SigningDigest({ message, nonce, recipient, callbackUrl });

  let key;
  try {
    key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(rawKey)]),
      format: "der",
      type: "spki",
    });
  } catch {
    throw new Nep413Error("invalid_public_key", "public_key is not a valid ed25519 key");
  }

  try {
    return cryptoVerify(null, digest, key, signatureBytes);
  } catch {
    return false;
  }
}
