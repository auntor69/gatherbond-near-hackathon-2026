// Read-only NEAR JSON-RPC access. No signing, no keys, no writes.
//
// Used by the metadata API to verify a submitted document against the contract's
// `get_event(event_id).metadata_hash` before it is stored or served as verified, and by
// NEP-413 login to confirm that a signing key currently belongs to the claimed account
// (`view_access_key`). Neither call sends a transaction.

const BASE64_ALPHABET = /^[A-Za-z0-9+/]*={0,2}$/;

function encodeArgs(args) {
  return Buffer.from(JSON.stringify(args), "utf8").toString("base64");
}

export function createContractReader({ rpcUrl, contractId, fetchImpl = globalThis.fetch } = {}) {
  if (!rpcUrl) {
    throw new Error("createContractReader requires rpcUrl");
  }
  if (!contractId) {
    throw new Error("createContractReader requires contractId");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createContractReader requires a fetch implementation");
  }

  async function query(params) {
    const payload = {
      jsonrpc: "2.0",
      id: "gatherbond-metadata",
      method: "query",
      params,
    };

    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`NEAR RPC returned HTTP ${response.status}`);
    }
    return response.json();
  }

  async function callView(methodName, args) {
    const json = await query({
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: methodName,
      args_base64: encodeArgs(args),
    });
    if (json.error) {
      throw new Error(json.error.message ?? "NEAR RPC error");
    }
    const result = json.result;
    if (!result || !Array.isArray(result.result)) {
      throw new Error("NEAR RPC returned a malformed query result");
    }

    const text = new TextDecoder().decode(Uint8Array.from(result.result));
    if (text === "" || text === "null") {
      return null;
    }
    return JSON.parse(text);
  }

  return {
    /** Returns the contract's EventView for `event_id`, or null when absent. */
    async getEvent(eventId) {
      return callView("get_event", { event_id: String(eventId) });
    },

    /**
     * Returns { permission, block_height } for a key on an account, or null when the key
     * is not present. Errors other than UNKNOWN_ACCESS_KEY are surfaced so login can fail
     * closed with 503 instead of treating an RPC outage as "no key".
     */
    async viewAccessKey(accountId, publicKey) {
      const json = await query({
        request_type: "view_access_key",
        finality: "final",
        account_id: accountId,
        public_key: publicKey,
      });
      if (json.error) {
        const cause = json.error.cause?.name ?? "";
        const message = json.error.message ?? "";
        if (cause === "UNKNOWN_ACCESS_KEY" || /unknown access key/i.test(message)) {
          return null;
        }
        throw new Error(message || "NEAR RPC error");
      }
      const result = json.result;
      if (!result || typeof result !== "object") {
        throw new Error("NEAR RPC returned a malformed access key result");
      }
      return {
        permission: result.permission ?? null,
        block_height: result.block_height ?? null,
      };
    },
  };
}

export { encodeArgs as encodeViewArgs, BASE64_ALPHABET };
