// GatherBond — browser-side ticket commitment (single source of truth for the frontend).
//
// Byte format (must match `ticket_commitment` in contracts/src/lib.rs):
//
//   SHA256(
//     "GatherBond:v1"
//     || u32le(byte_length(networkId)) || networkId
//     || u32le(byte_length(contractId)) || contractId
//     || u64le(eventId)
//     || u32le(byte_length(attendee)) || attendee
//     || u32le(byte_length(secret)) || secret
//   )
//
// Lengths are UTF-8 *byte* lengths, not character counts. `eventId` is a u64 and must
// be passed as a bigint/string when it can exceed Number.MAX_SAFE_INTEGER (2^53 - 1).
//
// Known-answer vectors: docs/ticket-commitment-vectors.json
// Parity runner:        scripts/verify-ticket-commitment.mjs
//
// This module is dependency-free and safe to import from the Next.js client bundle.

const DOMAIN = new TextEncoder().encode("GatherBond:v1");

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function lengthPrefixed(value, field) {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string`);
  }
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 0xffffffff) {
    throw new RangeError(`${field} is too long`);
  }
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, bytes.length, true);
  return concatBytes([prefix, bytes]);
}

/**
 * Canonical commitment bytes for one reservation.
 *
 * @param {object} input
 * @param {string} input.networkId  e.g. "testnet"
 * @param {string} input.contractId e.g. "gatherbond.testnet"
 * @param {bigint|number|string} input.eventId
 * @param {string} input.attendee   NEAR account id
 * @param {string} input.secret     high-entropy ticket secret (may be empty in vectors)
 * @returns {Uint8Array} 56 + byte lengths of the variable fields
 */
export function commitmentBytes({ networkId, contractId, eventId, attendee, secret }) {
  let id;
  try {
    id = BigInt(eventId);
  } catch {
    throw new TypeError("eventId must be an integer (bigint, number or decimal string)");
  }
  if (id < 0n || id > 18446744073709551615n) {
    throw new RangeError("eventId must fit in an unsigned 64-bit integer");
  }

  const idBytes = new Uint8Array(8);
  new DataView(idBytes.buffer).setBigUint64(0, id, true);

  return concatBytes([
    DOMAIN,
    lengthPrefixed(networkId, "networkId"),
    lengthPrefixed(contractId, "contractId"),
    idBytes,
    lengthPrefixed(attendee, "attendee"),
    lengthPrefixed(secret, "secret"),
  ]);
}

/**
 * The commitment as a 32-element array, which is what the contract's JSON argument
 * `ticket_commitment: [u8; 32]` expects.
 */
export function commitmentArray(input) {
  return Array.from(commitmentBytes(input));
}

/**
 * Lowercase hex digest. Pass an explicit `subtle` (e.g. `webcrypto.subtle` in Node)
 * when `globalThis.crypto.subtle` is unavailable.
 */
export async function ticketCommitmentHex(input, subtle = globalThis.crypto?.subtle) {
  if (!subtle || typeof subtle.digest !== "function") {
    throw new Error("WebCrypto subtle.digest is required to compute the commitment");
  }
  const digest = new Uint8Array(await subtle.digest("SHA-256", commitmentBytes(input)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
