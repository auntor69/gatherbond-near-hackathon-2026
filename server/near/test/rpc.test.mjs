import test from "node:test";
import assert from "node:assert/strict";

import { createContractReader } from "../rpc.mjs";

function rpcResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function viewBytes(value) {
  const encoded = JSON.stringify(value);
  return Array.from(new TextEncoder().encode(encoded));
}

test("get_event encodes the argument and decodes the contract view", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return rpcResponse({
      jsonrpc: "2.0",
      result: { result: viewBytes({ status: "Open", metadata_hash: Array(32).fill(7) }) },
    });
  };
  const reader = createContractReader({
    rpcUrl: "https://rpc.testnet.near.org",
    contractId: "contract.testnet",
    fetchImpl,
  });

  const event = await reader.getEvent("7");
  assert.deepEqual(event.metadata_hash, Array(32).fill(7));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://rpc.testnet.near.org");
  assert.equal(calls[0].body.method, "query");
  assert.deepEqual(calls[0].body.params, {
    request_type: "call_function",
    finality: "final",
    account_id: "contract.testnet",
    method_name: "get_event",
    args_base64: Buffer.from('{"event_id":"7"}').toString("base64"),
  });
});

test("empty and null views map to null", async () => {
  const empty = createContractReader({
    rpcUrl: "https://rpc.testnet.near.org",
    contractId: "contract.testnet",
    fetchImpl: async () => rpcResponse({ jsonrpc: "2.0", result: { result: [] } }),
  });
  assert.equal(await empty.getEvent("1"), null);

  const jsonNull = createContractReader({
    rpcUrl: "https://rpc.testnet.near.org",
    contractId: "contract.testnet",
    fetchImpl: async () =>
      rpcResponse({ jsonrpc: "2.0", result: { result: viewBytes(null) } }),
  });
  assert.equal(await jsonNull.getEvent("1"), null);
});

test("RPC errors, HTTP failures and malformed results throw", async () => {
  const rpcError = createContractReader({
    rpcUrl: "https://rpc.testnet.near.org",
    contractId: "contract.testnet",
    fetchImpl: async () =>
      rpcResponse({ jsonrpc: "2.0", error: { message: "account does not exist" } }),
  });
  await assert.rejects(() => rpcError.getEvent("1"), /account does not exist/);

  const httpError = createContractReader({
    rpcUrl: "https://rpc.testnet.near.org",
    contractId: "contract.testnet",
    fetchImpl: async () => rpcResponse({}, 502),
  });
  await assert.rejects(() => httpError.getEvent("1"), /HTTP 502/);

  const malformed = createContractReader({
    rpcUrl: "https://rpc.testnet.near.org",
    contractId: "contract.testnet",
    fetchImpl: async () => rpcResponse({ jsonrpc: "2.0", result: {} }),
  });
  await assert.rejects(() => malformed.getEvent("1"), /malformed/);
});

test("construction requires an RPC URL and a contract", () => {
  assert.throws(() => createContractReader({ contractId: "contract.testnet" }), /rpcUrl/);
  assert.throws(() => createContractReader({ rpcUrl: "https://rpc.testnet.near.org" }), /contractId/);
});
