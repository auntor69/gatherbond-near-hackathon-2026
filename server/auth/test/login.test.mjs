import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

import { encodeBase58 } from "../base58.mjs";
import { AuthError, verifyLoginRequest } from "../login.mjs";
import { nep413SigningDigest } from "../nep413.mjs";

const RECIPIENT = "gatherbond.app";

function account(accountId) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return { accountId, raw, publicKey: `ed25519:${encodeBase58(raw)}`, privateKey };
}

function signedBody(
  keys,
  {
    nonce = randomBytes(32),
    recipient = RECIPIENT,
    message = "Sign in to GatherBond",
    callbackUrl,
    signer = keys.privateKey,
  } = {},
) {
  const digest = nep413SigningDigest({ message, nonce, recipient, callbackUrl });
  return {
    account_id: keys.accountId,
    public_key: keys.publicKey,
    signature: sign(null, digest, signer).toString("base64"),
    message,
    nonce: nonce.toString("base64"),
    recipient,
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
  };
}

function memoryNonceStore() {
  const used = new Set();
  return {
    async claim(accountId, nonce) {
      const key = `${accountId}:${nonce}`;
      if (used.has(key)) {
        return false;
      }
      used.add(key);
      return true;
    },
  };
}

function fullAccess(keys) {
  return async (accountId, publicKey) =>
    accountId === keys.accountId && publicKey === keys.publicKey
      ? { permission: "FullAccess" }
      : null;
}

async function rejectsWith(promise, status, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof AuthError, `expected AuthError, got ${error}`);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test("a valid NEP-413 login returns the account id", async () => {
  const keys = account("organizer.testnet");
  const result = await verifyLoginRequest({
    body: signedBody(keys, { callbackUrl: "https://gatherbond.app/callback" }),
    recipient: RECIPIENT,
    lookupAccessKey: fullAccess(keys),
    nonceStore: memoryNonceStore(),
  });
  assert.equal(result.accountId, "organizer.testnet");
});

test("a forged signature is rejected before the chain is read", async () => {
  const keys = account("organizer.testnet");
  const attacker = account("attacker.testnet");
  let chainReads = 0;
  const lookup = async () => {
    chainReads += 1;
    return { permission: "FullAccess" };
  };

  await rejectsWith(
    verifyLoginRequest({
      body: signedBody(keys, { signer: attacker.privateKey }),
      recipient: RECIPIENT,
      lookupAccessKey: lookup,
      nonceStore: memoryNonceStore(),
    }),
    401,
    "invalid_signature",
  );
  assert.equal(chainReads, 0);
});

test("replaying the same signed nonce is rejected", async () => {
  const keys = account("organizer.testnet");
  const body = signedBody(keys);
  const nonceStore = memoryNonceStore();
  const options = {
    body,
    recipient: RECIPIENT,
    lookupAccessKey: fullAccess(keys),
    nonceStore,
  };

  await verifyLoginRequest(options);
  await rejectsWith(verifyLoginRequest(options), 400, "nonce_already_used");
});

test("simultaneous logins with the same signed nonce create only one session", async () => {
  const keys = account("organizer.testnet");
  const body = signedBody(keys);
  const nonceStore = memoryNonceStore();
  const options = {
    body,
    recipient: RECIPIENT,
    lookupAccessKey: fullAccess(keys),
    nonceStore,
  };

  const results = await Promise.allSettled([
    verifyLoginRequest(options),
    verifyLoginRequest(options),
    verifyLoginRequest(options),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  for (const result of results.filter((item) => item.status === "rejected")) {
    assert.ok(result.reason instanceof AuthError);
    assert.equal(result.reason.status, 400);
    assert.equal(result.reason.code, "nonce_already_used");
  }
});

test("a signature for a different recipient is rejected", async () => {
  const keys = account("organizer.testnet");
  await rejectsWith(
    verifyLoginRequest({
      body: signedBody(keys, { recipient: "evil.example" }),
      recipient: RECIPIENT,
      lookupAccessKey: fullAccess(keys),
      nonceStore: memoryNonceStore(),
    }),
    400,
    "invalid_recipient",
  );
});

test("a key that does not belong to the account is rejected", async () => {
  const keys = account("organizer.testnet");
  await rejectsWith(
    verifyLoginRequest({
      body: signedBody(keys),
      recipient: RECIPIENT,
      lookupAccessKey: async () => null,
      nonceStore: memoryNonceStore(),
    }),
    401,
    "unknown_public_key",
  );
});

test("a function-call key is rejected; full access is required", async () => {
  const keys = account("organizer.testnet");
  await rejectsWith(
    verifyLoginRequest({
      body: signedBody(keys),
      recipient: RECIPIENT,
      lookupAccessKey: async () => ({ permission: { FunctionCall: { method_names: [] } } }),
      nonceStore: memoryNonceStore(),
    }),
    403,
    "full_access_key_required",
  );
});

test("malformed fields are 400 and an unusable backend is 503", async () => {
  const keys = account("organizer.testnet");
  const base = {
    recipient: RECIPIENT,
    lookupAccessKey: fullAccess(keys),
    nonceStore: memoryNonceStore(),
  };

  await rejectsWith(
    verifyLoginRequest({ ...base, body: { ...signedBody(keys), nonce: "AAAA" } }),
    400,
    "invalid_nonce",
  );
  await rejectsWith(
    verifyLoginRequest({ ...base, body: { ...signedBody(keys), signature: "AAAA" } }),
    400,
    "invalid_signature",
  );
  await rejectsWith(
    verifyLoginRequest({
      ...base,
      body: { ...signedBody(keys), public_key: "secp256k1:1111" },
    }),
    400,
    "invalid_public_key",
  );

  await rejectsWith(
    verifyLoginRequest({
      body: signedBody(keys),
      recipient: RECIPIENT,
      lookupAccessKey: null,
      nonceStore: memoryNonceStore(),
    }),
    503,
    "auth_chain_unavailable",
  );
  await rejectsWith(
    verifyLoginRequest({
      body: signedBody(keys),
      recipient: RECIPIENT,
      lookupAccessKey: fullAccess(keys),
      nonceStore: null,
    }),
    503,
    "auth_store_unavailable",
  );
  await rejectsWith(
    verifyLoginRequest({
      body: signedBody(keys),
      recipient: RECIPIENT,
      lookupAccessKey: async () => {
        throw new Error("rpc down");
      },
      nonceStore: memoryNonceStore(),
    }),
    503,
    "auth_chain_unavailable",
  );
});
