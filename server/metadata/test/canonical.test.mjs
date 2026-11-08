import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MetadataValidationError,
  canonicalJson,
  canonicalMetadata,
  hashEquals,
  hashMetadata,
  hashToHex,
  normalizeEventKey,
} from "../canonical.mjs";

const vectors = JSON.parse(
  readFileSync(new URL("../../../docs/metadata-vectors.json", import.meta.url), "utf8"),
);

test("known-answer metadata vectors", async () => {
  assert.ok(vectors.vectors.length >= 5, "expected at least 5 vectors");
  for (const vector of vectors.vectors) {
    assert.equal(
      canonicalJson(canonicalMetadata(vector.input)),
      vector.canonical_json,
      `canonical json: ${vector.name}`,
    );
    const hashed = await hashMetadata(vector.input);
    assert.equal(hashed.hex, vector.digest_hex, `digest: ${vector.name}`);
    assert.deepEqual(
      hashed.array,
      Array.from(Buffer.from(vector.digest_hex, "hex")),
      `[u8;32] array: ${vector.name}`,
    );
  }
});

test("canonical bytes ignore object key order", async () => {
  const base = {
    schema_version: 1,
    network_id: "testnet",
    contract_id: "contract.testnet",
    organizer_account_id: "organizer.testnet",
    title: "Order test",
    description: "",
    category: "community",
    venue: "",
    image_url: "",
    tags: [],
    created_at: "2026-11-07T12:00:00Z",
  };
  const reordered = Object.fromEntries(Object.entries(base).reverse());
  assert.equal(canonicalJson(canonicalMetadata(reordered)), canonicalJson(canonicalMetadata(base)));
  assert.equal((await hashMetadata(reordered)).hex, (await hashMetadata(base)).hex);
});

test("event keys normalize u64 and reject out-of-range ids", () => {
  assert.deepEqual(normalizeEventKey({ network_id: "testnet", contract_id: "contract.testnet", event_id: "0" }), {
    network_id: "testnet",
    contract_id: "contract.testnet",
    event_id: "0",
  });
  assert.equal(
    normalizeEventKey({ network_id: "testnet", contract_id: "contract.testnet", event_id: "018446744073709551615" }).event_id,
    "18446744073709551615",
  );
  assert.equal(
    normalizeEventKey({ network_id: "testnet", contract_id: "contract.testnet", event_id: 9007199254740993n }).event_id,
    "9007199254740993",
  );
  assert.throws(
    () => normalizeEventKey({ network_id: "testnet", contract_id: "contract.testnet", event_id: "18446744073709551616" }),
    MetadataValidationError,
  );
  assert.throws(
    () => normalizeEventKey({ network_id: "testnet", contract_id: "contract.testnet", event_id: -1 }),
    MetadataValidationError,
  );
});

test("financial and unknown fields are rejected", () => {
  const base = {
    network_id: "testnet",
    contract_id: "contract.testnet",
    organizer_account_id: "organizer.testnet",
    title: "Demo",
    description: "",
    category: "community",
    venue: "",
    image_url: "",
    tags: [],
    created_at: "2026-11-07T12:00:00Z",
  };
  for (const field of ["deposit", "capacity", "start_at", "status"]) {
    assert.throws(
      () => canonicalMetadata({ ...base, [field]: "1" }),
      MetadataValidationError,
      `${field} must be rejected`,
    );
  }
});

test("bounds and unsafe values are rejected", () => {
  const base = {
    network_id: "testnet",
    contract_id: "contract.testnet",
    organizer_account_id: "organizer.testnet",
    title: "Demo",
    description: "",
    category: "community",
    venue: "",
    image_url: "",
    tags: [],
    created_at: "2026-11-07T12:00:00Z",
  };
  assert.throws(() => canonicalMetadata({ ...base, title: "x".repeat(141) }), MetadataValidationError);
  assert.throws(() => canonicalMetadata({ ...base, tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }), MetadataValidationError);
  assert.throws(() => canonicalMetadata({ ...base, tags: ["dup", "dup"] }), MetadataValidationError);
  assert.throws(() => canonicalMetadata({ ...base, image_url: "javascript:alert(1)" }), MetadataValidationError);
  assert.throws(() => canonicalMetadata({ ...base, description: "bad\u0000byte" }), MetadataValidationError);
  assert.throws(() => canonicalMetadata({ ...base, created_at: "2026-11-07" }), MetadataValidationError);
  assert.throws(() => canonicalMetadata({ ...base, organizer_account_id: "Not An Account" }), MetadataValidationError);
});

test("hash representations compare consistently", async () => {
  const hashed = await hashMetadata({
    network_id: "testnet",
    contract_id: "contract.testnet",
    organizer_account_id: "organizer.testnet",
    title: "Formats",
    description: "",
    category: "community",
    venue: "",
    image_url: "",
    tags: [],
    created_at: "2026-11-07T12:00:00Z",
  });
  assert.equal(hashToHex(hashed.hex), hashed.hex);
  assert.equal(hashToHex(hashed.array), hashed.hex);
  assert.equal(hashToHex(hashed.bytes), hashed.hex);
  assert.ok(hashEquals(hashed.hex, hashed.array));
  assert.ok(!hashEquals(hashed.hex, "00".repeat(32)));
  assert.equal(hashToHex("not-a-hash"), null);
});
