import test from "node:test";
import assert from "node:assert/strict";

import {
  createWalletLoginBody,
  encodeNonce,
  loginMessageFor,
  normalizeEd25519PublicKey,
  normalizeSignature,
} from "../../../frontend/lib/walletLogin.mjs";

const NONCE_BYTES = Uint8Array.from({ length: 32 }, (_, index) => index);
const SIGNATURE = Buffer.alloc(64, 9).toString("base64");

test("a wallet nonce is exactly 32 bytes and round-trips as base64", () => {
  const encoded = encodeNonce(NONCE_BYTES);
  assert.equal(encoded, Buffer.from(NONCE_BYTES).toString("base64"));
  assert.throws(() => encodeNonce(new Uint8Array(31)), /exactly 32 bytes/);
});

test("the login message identifies the account and stays under the server limit", () => {
  const message = loginMessageFor("alice.testnet");
  assert.match(message, /alice\.testnet/);
  assert.ok(message.length < 512);
  assert.throws(() => loginMessageFor(""));
});

test("wallet public keys are normalized to ed25519 and malformed keys fail closed", () => {
  assert.equal(normalizeEd25519PublicKey("ed25519:abc"), "ed25519:abc");
  assert.equal(normalizeEd25519PublicKey("abc"), "ed25519:abc");
  assert.throws(() => normalizeEd25519PublicKey("not a key"), /unsupported public key/);
});

test("signatures must decode to 64 bytes and base64url is normalized", () => {
  assert.equal(normalizeSignature(SIGNATURE), SIGNATURE);
  const urlSafe = SIGNATURE.replace(/\+/g, "-").replace(/\//g, "_");
  assert.equal(normalizeSignature(urlSafe), SIGNATURE);
  assert.throws(() => normalizeSignature("short"), /wrong length|malformed/);
});

test("the login body matches the server's NEP-413 request shape", () => {
  const message = loginMessageFor("alice.testnet");
  const body = createWalletLoginBody({
    accountId: "alice.testnet",
    publicKey: "abc",
    signature: SIGNATURE,
    message,
    nonce: encodeNonce(NONCE_BYTES),
    recipient: "gatherbond.app",
  });

  assert.deepEqual(body, {
    account_id: "alice.testnet",
    public_key: "ed25519:abc",
    signature: SIGNATURE,
    message,
    nonce: Buffer.from(NONCE_BYTES).toString("base64"),
    recipient: "gatherbond.app",
    callback_url: null,
  });
});
