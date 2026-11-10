// Client-only NEAR Connect bridge.
//
// The connector is loaded lazily so the server bundle and initial page never touch
// browser globals. It connects without adding a function-call key, then requests a
// NEP-413 signature over the same message and nonce that are sent to the server.

import { createWalletLoginBody, encodeNonce, loginMessageFor } from "./walletLogin.mjs";
import { decodeOutcomeValue, outcomeHash } from "./contract";

const TESTNET = "testnet";
const CONNECTOR_OPTIONS = Object.freeze({
  network: TESTNET,
  autoConnect: false,
  footerBranding: null,
  features: { signMessage: true, signAndSendTransaction: true, testnet: true },
});

let connectorPromise = null;

async function getConnector() {
  if (typeof window === "undefined") {
    throw new Error("Wallet connection is only available in the browser");
  }
  if (!connectorPromise) {
    connectorPromise = import("@hot-labs/near-connect")
      .then((module) => {
        const NearConnector = module.NearConnector ?? module.default?.NearConnector;
        if (typeof NearConnector !== "function") {
          throw new Error("The NEAR wallet connector failed to load");
        }
        return new NearConnector(CONNECTOR_OPTIONS);
      })
      .catch((error) => {
        connectorPromise = null;
        throw error;
      });
  }
  return connectorPromise;
}

/**
 * Connect a wallet and sign the GatherBond login message.
 * Returns the JSON body for POST /api/auth/session; it never stores a signature or key.
 */
export async function connectNearWallet({ recipient }) {
  if (typeof recipient !== "string" || recipient.length === 0) {
    throw new Error("Wallet sign-in is not configured");
  }

  const connector = await getConnector();
  const wallet = await connector.connect();
  const accounts = await wallet.getAccounts({ network: TESTNET });
  const accountId = accounts?.[0]?.accountId;
  if (!accountId) {
    throw new Error("The wallet returned no NEAR account");
  }

  const nonceBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(nonceBytes);
  const nonce = encodeNonce(nonceBytes);
  const message = loginMessageFor(accountId);

  const signed = await wallet.signMessage({
    message,
    recipient,
    nonce: nonceBytes,
    signerId: accountId,
    network: TESTNET,
  });

  if (!signed?.signature) {
    throw new Error("The wallet returned no signature");
  }

  return createWalletLoginBody({
    accountId: signed.accountId ?? accountId,
    publicKey: signed.publicKey,
    signature: signed.signature,
    message,
    nonce,
    recipient,
  });
}

async function connectedWallet() {
  const connector = await getConnector();
  let wallet = await connector.wallet().catch(() => null);
  if (!wallet) {
    await connector.connect();
    wallet = await connector.wallet();
  }
  return wallet;
}

/**
 * Send a real contract call through the connected wallet. The caller supplies the exact
 * deposit; no server key and no hidden signer is involved.
 */
export async function sendContractCall({
  contractId,
  methodName,
  args = {},
  deposit = "0",
  gas = "100000000000000",
  expectedAccount = null,
}) {
  if (typeof contractId !== "string" || contractId.length === 0) {
    throw new Error("The contract is not configured on this deployment");
  }
  const wallet = await connectedWallet();
  if (expectedAccount) {
    const accounts = await wallet.getAccounts({ network: TESTNET });
    if (!accounts?.some((account) => account.accountId === expectedAccount)) {
      throw new Error("Connect the same wallet account that signed in to GatherBond.");
    }
  }
  const result = await wallet.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName,
          args,
          gas: String(gas),
          deposit: String(deposit),
        },
      },
    ],
  });
  return {
    result,
    hash: outcomeHash(result),
    value: decodeOutcomeValue(result),
  };
}

/** Disconnect the connector if this page ever initialized it. */
export async function disconnectNearWallet() {
  if (!connectorPromise) {
    return;
  }
  const connector = await connectorPromise.catch(() => null);
  if (!connector) {
    return;
  }
  await connector.disconnect().catch(() => {});
}
