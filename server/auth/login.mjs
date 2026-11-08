// NEP-413 login verification.
//
// Trust chain:
//   1. the signed payload matches the configured recipient (so a signature for another app
//      cannot be replayed here);
//   2. the Ed25519 signature verifies against the claimed public key;
//   3. the chain confirms that key currently belongs to the claimed account;
//   4. the key has FullAccess permission (NEP-413 wallets sign with a full-access key);
//   5. the nonce has never been used before for this account.
//
// Only then does the caller issue a session. Any failure is an AuthError with an HTTP
// status; no session and no metadata row is created.

import {
  Nep413Error,
  parseNonceBase64,
  parseEd25519PublicKey,
  verifySignedMessage,
} from "./nep413.mjs";

const ACCOUNT_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;

export class AuthError extends Error {
  constructor(status, code, message) {
    super(message ?? code);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

function textField(value, name, maxLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new AuthError(400, `invalid_${name}`, `${name} must be a non-empty string`);
  }
  return value;
}

export async function verifyLoginRequest({
  body,
  recipient,
  lookupAccessKey,
  nonceStore,
} = {}) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new AuthError(400, "invalid_body", "body must be a JSON object");
  }

  const accountId = body.account_id;
  if (typeof accountId !== "string" || !ACCOUNT_ID.test(accountId)) {
    throw new AuthError(400, "invalid_account_id", "account_id is not a valid NEAR account id");
  }

  const message = textField(body.message, "message", 512);
  const publicKey = textField(body.public_key, "public_key", 128);
  const signature = textField(body.signature, "signature", 128);
  const claimedRecipient = textField(body.recipient, "recipient", 256);

  let nonce;
  try {
    nonce = parseNonceBase64(body.nonce);
  } catch (error) {
    if (error instanceof Nep413Error) {
      throw new AuthError(400, error.code, error.message);
    }
    throw error;
  }

  try {
    parseEd25519PublicKey(publicKey);
  } catch (error) {
    if (error instanceof Nep413Error) {
      throw new AuthError(400, error.code, error.message);
    }
    throw error;
  }

  if (claimedRecipient !== recipient) {
    throw new AuthError(400, "invalid_recipient", "recipient does not match this application");
  }

  const callbackUrl = body.callback_url ?? null;
  if (callbackUrl !== null && (typeof callbackUrl !== "string" || callbackUrl.length > 512)) {
    throw new AuthError(400, "invalid_callback_url", "callback_url must be a string");
  }

  let valid = false;
  try {
    valid = verifySignedMessage({
      publicKey,
      signature,
      message,
      nonce,
      recipient: claimedRecipient,
      callbackUrl,
    });
  } catch (error) {
    if (error instanceof Nep413Error) {
      throw new AuthError(400, error.code, error.message);
    }
    throw error;
  }
  if (!valid) {
    throw new AuthError(401, "invalid_signature", "signature does not verify");
  }

  if (typeof lookupAccessKey !== "function") {
    throw new AuthError(503, "auth_chain_unavailable", "chain reader is not configured");
  }

  let accessKey;
  try {
    accessKey = await lookupAccessKey(accountId, publicKey);
  } catch {
    throw new AuthError(503, "auth_chain_unavailable", "could not read the access key");
  }
  if (!accessKey) {
    throw new AuthError(401, "unknown_public_key", "public key does not belong to the account");
  }
  if (accessKey.permission !== "FullAccess") {
    throw new AuthError(403, "full_access_key_required", "sign-in requires a full-access key");
  }

  if (!nonceStore) {
    throw new AuthError(503, "auth_store_unavailable", "nonce store is not configured");
  }
  let claimed;
  try {
    claimed = await nonceStore.claim(accountId, nonce.toString("base64"));
  } catch {
    throw new AuthError(503, "auth_store_unavailable", "could not record the nonce");
  }
  if (!claimed) {
    throw new AuthError(400, "nonce_already_used", "this signed message was already used");
  }

  return { accountId, publicKey, nonce: nonce.toString("base64") };
}
