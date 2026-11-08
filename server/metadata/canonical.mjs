// GatherBond event metadata — canonical document, validation and SHA-256 hashing.
//
// The NEAR contract stores only `metadata_hash: [u8; 32]`. This module defines the
// off-chain document that hash commits to, so the browser (create-event flow), the
// server (metadata API) and the database all agree byte-for-byte.
//
// Canonical form:
//   - exactly the fields listed in `canonicalMetadata`, with `schema_version: 1`
//   - JSON object keys sorted lexicographically, recursively
//   - no whitespace, UTF-8 encoded as-is (no Unicode normalization)
//   - `tags` keeps its order
//   - SHA-256 over the canonical JSON bytes
//
// `event_id` is deliberately NOT part of the canonical document: the contract assigns
// it during `create_event`, which must already carry the hash. Binding happens through
// the (network_id, contract_id, event_id) row plus the create transaction reference.
// Financial terms (deposit, capacity, deadlines) are rejected here and must always be
// read from the contract.
//
// Known-answer vectors: docs/metadata-vectors.json
// Generator:            scripts/generate_metadata_vectors.py

const encoder = new TextEncoder();

export const METADATA_SCHEMA_VERSION = 1;
export const MAX_EVENT_ID = 18446744073709551615n;

export const LIMITS = Object.freeze({
  network_id: 32,
  account_id: 64,
  title: 140,
  description: 4000,
  category: 40,
  venue: 200,
  image_url: 500,
  tag: 32,
  tags: 8,
  created_at: 40,
  tx_hash: 88,
});

const ALLOWED_FIELDS = new Set([
  "schema_version",
  "network_id",
  "contract_id",
  "organizer_account_id",
  "title",
  "description",
  "category",
  "venue",
  "image_url",
  "tags",
  "created_at",
]);

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ACCOUNT_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export class MetadataValidationError extends Error {
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.name = "MetadataValidationError";
    this.field = field;
  }
}

export class MetadataConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "MetadataConflictError";
  }
}

function requireText(field, value, maxBytes, { allowEmpty = false } = {}) {
  if (typeof value !== "string") {
    throw new MetadataValidationError(field, "must be a string");
  }
  if (!allowEmpty && value.trim().length === 0) {
    throw new MetadataValidationError(field, "must not be empty");
  }
  if (encoder.encode(value).length > maxBytes) {
    throw new MetadataValidationError(field, `must be at most ${maxBytes} UTF-8 bytes`);
  }
  if (CONTROL_CHARACTERS.test(value)) {
    throw new MetadataValidationError(field, "contains control characters");
  }
  return value;
}

function requireAccountId(field, value) {
  requireText(field, value, LIMITS.account_id);
  if (!ACCOUNT_ID.test(value)) {
    throw new MetadataValidationError(field, "is not a valid NEAR account id");
  }
  return value;
}

/** Normalize a (network, contract, event) key; event ids normalize to decimal u64 text. */
export function normalizeEventKey(key) {
  if (key === null || typeof key !== "object" || Array.isArray(key)) {
    throw new MetadataValidationError("key", "must be an object");
  }
  const networkId = requireText("network_id", key.network_id, LIMITS.network_id);
  const contractId = requireAccountId("contract_id", key.contract_id);

  let eventId;
  try {
    eventId = typeof key.event_id === "bigint" ? key.event_id : BigInt(String(key.event_id));
  } catch {
    throw new MetadataValidationError("event_id", "must be a decimal u64");
  }
  if (eventId < 0n || eventId > MAX_EVENT_ID) {
    throw new MetadataValidationError("event_id", "must fit in an unsigned 64-bit integer");
  }

  return { network_id: networkId, contract_id: contractId, event_id: eventId.toString() };
}

/** Validate and normalize the canonical metadata document. */
export function canonicalMetadata(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new MetadataValidationError("metadata", "must be an object");
  }
  for (const field of Object.keys(input)) {
    if (!ALLOWED_FIELDS.has(field)) {
      throw new MetadataValidationError(
        field,
        "unknown field; financial terms must stay on-chain",
      );
    }
  }
  if (input.schema_version !== undefined && input.schema_version !== METADATA_SCHEMA_VERSION) {
    throw new MetadataValidationError(
      "schema_version",
      `must be ${METADATA_SCHEMA_VERSION} when present`,
    );
  }

  const networkId = requireText("network_id", input.network_id, LIMITS.network_id);
  const contractId = requireAccountId("contract_id", input.contract_id);
  const organizer = requireAccountId("organizer_account_id", input.organizer_account_id);
  const title = requireText("title", input.title, LIMITS.title);
  const description = requireText("description", input.description, LIMITS.description, {
    allowEmpty: true,
  });
  const category = requireText("category", input.category, LIMITS.category);
  const venue = requireText("venue", input.venue, LIMITS.venue, { allowEmpty: true });

  const imageUrl = input.image_url ?? "";
  requireText("image_url", imageUrl, LIMITS.image_url, { allowEmpty: true });
  if (imageUrl !== "" && !/^https:\/\/[^\s]+$/.test(imageUrl)) {
    throw new MetadataValidationError("image_url", "must be an https URL or empty");
  }

  const tags = input.tags ?? [];
  if (!Array.isArray(tags)) {
    throw new MetadataValidationError("tags", "must be an array of strings");
  }
  if (tags.length > LIMITS.tags) {
    throw new MetadataValidationError("tags", `must contain at most ${LIMITS.tags} entries`);
  }
  const seen = new Set();
  for (const tag of tags) {
    requireText("tags", tag, LIMITS.tag);
    if (seen.has(tag)) {
      throw new MetadataValidationError("tags", "must not contain duplicates");
    }
    seen.add(tag);
  }

  const createdAt = requireText("created_at", input.created_at, LIMITS.created_at);
  if (!RFC3339_UTC.test(createdAt) || Number.isNaN(Date.parse(createdAt))) {
    throw new MetadataValidationError("created_at", "must be an RFC 3339 UTC timestamp (Z)");
  }

  return {
    schema_version: METADATA_SCHEMA_VERSION,
    network_id: networkId,
    contract_id: contractId,
    organizer_account_id: organizer,
    title,
    description,
    category,
    venue,
    image_url: imageUrl,
    tags: [...tags],
    created_at: createdAt,
  };
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortValue(value[key]);
    }
    return sorted;
  }
  return value;
}

/** Deterministic canonical JSON bytes as a string (UTF-8 when encoded). */
export function canonicalJson(metadata) {
  return JSON.stringify(sortValue(metadata));
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex) {
  if (typeof hex !== "string" || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(hex)) {
    throw new MetadataValidationError("hash", "must be 32 bytes of hex");
  }
  const clean = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Accepts a hex string, a 32-byte Uint8Array, or the contract's [u8; 32] JSON array. */
export function hashToHex(value) {
  if (typeof value === "string") {
    try {
      return bytesToHex(hexToBytes(value));
    } catch {
      return null;
    }
  }
  if (value instanceof Uint8Array) {
    return value.length === 32 ? bytesToHex(value) : null;
  }
  if (Array.isArray(value) && value.length === 32) {
    if (!value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      return null;
    }
    return bytesToHex(Uint8Array.from(value));
  }
  return null;
}

export function hashEquals(left, right) {
  const leftHex = hashToHex(left);
  const rightHex = hashToHex(right);
  return leftHex !== null && rightHex !== null && leftHex === rightHex;
}

/**
 * Hash the canonical document.
 * @returns {Promise<{metadata: object, canonical: string, bytes: Uint8Array, hex: string, array: number[]}>}
 */
export async function hashMetadata(input, subtle = globalThis.crypto?.subtle) {
  if (!subtle || typeof subtle.digest !== "function") {
    throw new Error("WebCrypto subtle.digest is required to hash event metadata");
  }
  const metadata = canonicalMetadata(input);
  const canonical = canonicalJson(metadata);
  const digest = new Uint8Array(await subtle.digest("SHA-256", encoder.encode(canonical)));
  return {
    metadata,
    canonical,
    bytes: digest,
    hex: bytesToHex(digest),
    array: Array.from(digest),
  };
}

/**
 * Re-canonicalize a stored JSON document and compare its digest with the stored/on-chain
 * expected hash. Never trust `metadata_json` as-is.
 */
export async function verifyMetadataJson(metadataJson, expectedHash, subtle) {
  try {
    const parsed = JSON.parse(metadataJson);
    const hashed = await hashMetadata(parsed, subtle);
    return { matches: hashEquals(hashed.hex, expectedHash), canonical: hashed.canonical, hex: hashed.hex };
  } catch (error) {
    return { matches: false, error: error.message };
  }
}
