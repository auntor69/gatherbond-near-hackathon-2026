import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";

import { decodeBase58, encodeBase58 } from "../base58.mjs";
import {
  NEP413_TAG,
  Nep413Error,
  nep413SigningDigest,
  parseEd25519PublicKey,
  serializeNep413Payload,
  verifySignedMessage,
} from "../nep413.mjs";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return { raw, privateKey, publicKey: `ed25519:${encodeBase58(raw)}` };
}

const NONCE = Buffer.from(Array.from({ length: 32 }, (_, index) => index));

test("NEP-413 payload is borsh({message, nonce, recipient, callbackUrl})", () => {
  const serialized = serializeNep413Payload({
    message: "hi",
    nonce: NONCE,
    recipient: "myapp.com",
    callbackUrl: "myapp.com/callback",
  });

  const expected = Buffer.concat([
    Buffer.from([2, 0, 0, 0]),
    Buffer.from("hi"),
    NONCE,
    Buffer.from([9, 0, 0, 0]),
    Buffer.from("myapp.com"),
    Buffer.from([1, 18, 0, 0, 0]),
    Buffer.from("myapp.com/callback"),
  ]);
  assert.equal(serialized.toString("hex"), expected.toString("hex"));

  // Option<String> = 0x00 when the wallet omitted the callback URL.
  const withoutCallback = serializeNep413Payload({
    message: "hi",
    nonce: NONCE,
    recipient: "myapp.com",
  });
  assert.equal(withoutCallback.at(-1), 0);
});

test("the signed digest is sha256(tag || payload) with tag 2^31 + 413", () => {
  assert.equal(NEP413_TAG, 2147484061);
  const digest = nep413SigningDigest({
    message: "hi",
    nonce: NONCE,
    recipient: "myapp.com",
    callbackUrl: "myapp.com/callback",
  });
  const expected = createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from("9d010080", "hex"),
        serializeNep413Payload({
          message: "hi",
          nonce: NONCE,
          recipient: "myapp.com",
          callbackUrl: "myapp.com/callback",
        }),
      ]),
    )
    .digest("hex");
  assert.equal(digest.toString("hex"), expected);
});

test("a real ed25519 signature verifies and tampering is rejected", () => {
  const keys = keypair();
  const payload = {
    message: "Sign in to GatherBond",
    nonce: NONCE,
    recipient: "gatherbond.app",
    callbackUrl: undefined,
  };
  const signature = sign(null, nep413SigningDigest(payload), keys.privateKey).toString("base64");

  assert.equal(
    verifySignedMessage({ ...payload, publicKey: keys.publicKey, signature }),
    true,
  );
  assert.equal(
    verifySignedMessage({
      ...payload,
      message: "Send all the money",
      publicKey: keys.publicKey,
      signature,
    }),
    false,
  );
  assert.equal(
    verifySignedMessage({
      ...payload,
      nonce: Buffer.alloc(32, 9),
      publicKey: keys.publicKey,
      signature,
    }),
    false,
  );

  const other = keypair();
  assert.equal(
    verifySignedMessage({ ...payload, publicKey: other.publicKey, signature }),
    false,
  );
});

test("base58 round-trips 32-byte keys and rejects malformed keys", () => {
  const raw = Buffer.from(Array.from({ length: 32 }, (_, index) => (index * 7) % 256));
  const encoded = encodeBase58(raw);
  assert.equal(Buffer.from(decodeBase58(encoded)).toString("hex"), raw.toString("hex"));
  assert.deepEqual(Array.from(parseEd25519PublicKey(`ed25519:${encoded}`)), Array.from(raw));

  assert.throws(() => decodeBase58("0OIl"), /invalid base58/);
  assert.throws(
    () => parseEd25519PublicKey("secp256k1:2Y7Y8Y7Y8Y7Y8Y7Y8Y7Y8Y7Y8Y7Y8Y7Y8Y7Y8Y7Y8Y7Y"),
    (error) => error instanceof Nep413Error && error.code === "invalid_public_key",
  );
  assert.throws(
    () => parseEd25519PublicKey("ed25519:1111"),
    (error) => error instanceof Nep413Error && error.code === "invalid_public_key",
  );
});

test("payload construction rejects bad field shapes", () => {
  assert.throws(
    () => serializeNep413Payload({ message: "", nonce: NONCE, recipient: "app" }),
    /message/,
  );
  assert.throws(
    () => serializeNep413Payload({ message: "hi", nonce: Buffer.alloc(31), recipient: "app" }),
    /32 bytes/,
  );
  assert.throws(
    () => serializeNep413Payload({ message: "hi", nonce: NONCE, recipient: "" }),
    /recipient/,
  );
});
