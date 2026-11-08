// Runtime wiring: choose the database adapter, build the on-chain read seam and the
// metadata handlers. Everything is dependency-injected so the routes are testable (and
// runnable) without credentials.
//
// Selection:
//   TURSO_DATABASE_URL + TURSO_AUTH_TOKEN -> Turso/libSQL (server-only)
//   METADATA_SQLITE_PATH                  -> local SQLite (development / tests)
//   neither                               -> unavailable; metadata routes return 503
//                                            while the escrow contract stays usable

import { createMetadataHandlers } from "./handlers.mjs";
import { createMetadataStore } from "./store.mjs";
import { libsqlAdapter } from "./libsql.mjs";
import { openSqliteMetadataStore } from "./sqlite.mjs";
import { createContractReader } from "../near/rpc.mjs";
import { createMetadataRoutes } from "../http/routes.mjs";
import { createAuthRoutes } from "../auth/routes.mjs";
import { nonceStoreForSelection } from "../auth/nonceStore.mjs";
import { readSessionCookie } from "../auth/session.mjs";
import { createRateLimiters, readRateLimitConfig } from "../http/rateLimit.mjs";

function unavailableStore(reason) {
  const fail = async () => {
    throw new Error(`metadata store unavailable: ${reason}`);
  };
  return {
    save: fail,
    get: fail,
    verify: fail,
    listPublished: fail,
    getPublication: fail,
    publish: fail,
    unpublish: fail,
    setPublicationStatus: fail,
    count: fail,
  };
}

/** Select the metadata store from environment variables. Never reads credentials from a client. */
export async function selectStore(env = process.env, { importLibsql } = {}) {
  if (env.TURSO_DATABASE_URL && env.TURSO_AUTH_TOKEN) {
    if (typeof importLibsql !== "function") {
      return {
        mode: "unavailable",
        reason: "libsql_loader_not_configured",
        store: null,
      };
    }
    try {
      const { createClient } = await importLibsql();
      const client = createClient({
        url: env.TURSO_DATABASE_URL,
        authToken: env.TURSO_AUTH_TOKEN,
      });
      return { mode: "turso", store: createMetadataStore(libsqlAdapter(client)), client };
    } catch (error) {
      return {
        mode: "unavailable",
        reason: `libsql_unavailable: ${error.message}`,
        store: null,
      };
    }
  }

  if (env.METADATA_SQLITE_PATH) {
    try {
      const { store, db } = openSqliteMetadataStore({ path: env.METADATA_SQLITE_PATH });
      return { mode: "sqlite", store, db };
    } catch (error) {
      return {
        mode: "unavailable",
        reason: `sqlite_unavailable: ${error.message}`,
        store: null,
      };
    }
  }

  return { mode: "unavailable", reason: "no_database_configured", store: null };
}

/**
 * Build handlers and routes for the current process.
 * `fetchImpl` and `selectStoreImpl` are injectable for tests.
 */
export async function createMetadataRuntime({
  env = process.env,
  fetchImpl,
  selectStoreImpl = selectStore,
  importLibsql,
} = {}) {
  const selection = await selectStoreImpl(env, { importLibsql });
  if (selection.mode === "unavailable") {
    const code = String(selection.reason ?? "unknown").split(":")[0];
    console.warn(`[gatherbond] metadata store unavailable (${code})`);
  }

  const networkId = env.NEAR_NETWORK_ID ?? env.NEXT_PUBLIC_NEAR_NETWORK_ID ?? "testnet";
  const configuredContract = env.CONTRACT_NAME ?? env.NEXT_PUBLIC_CONTRACT_NAME ?? null;
  // A placeholder keeps route keys valid; the reader is only built when a contract is
  // configured, and otherwise every write fails closed with 503.
  const contractId = configuredContract ?? "gatherbond.testnet";
  const rpcUrl = env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";

  const reader = configuredContract
    ? createContractReader({ rpcUrl, contractId: configuredContract, fetchImpl })
    : null;

  const getOnChainEvent = async (key) => {
    if (!reader) {
      throw new Error("contract_not_configured");
    }
    const event = await reader.getEvent(key.event_id);
    // Handlers only require metadata_hash, while the public detail route may expose the
    // rest of the read-only EventView (schedule, deposit, capacity, status).
    return event ?? null;
  };

  // Wallet session auth: a NEP-413 login issues an HMAC-signed HttpOnly cookie, and the
  // actor is derived from that verified session. The dev header is a separate, explicit
  // seam for local work and is ignored unless GATHERBOND_ALLOW_DEV_ACTOR=1.
  const authConfig = {
    secret: env.GATHERBOND_SESSION_SECRET ?? "",
    recipient: env.GATHERBOND_AUTH_RECIPIENT ?? "gatherbond.app",
    ttlSeconds: Number(env.GATHERBOND_SESSION_TTL_SECONDS) || 7200,
    secure: env.GATHERBOND_SECURE_COOKIES === "1",
  };
  const allowDevActor = env.GATHERBOND_ALLOW_DEV_ACTOR === "1";
  const rateLimits = createRateLimiters(readRateLimitConfig(env));

  const authRoutes = createAuthRoutes({
    config: authConfig,
    lookupAccessKey: reader
      ? (accountId, publicKey) => reader.viewAccessKey(accountId, publicKey)
      : null,
    nonceStore: nonceStoreForSelection(selection),
    rateLimitLogin: rateLimits.login,
  });

  const getActor = async (request) => {
    const session = readSessionCookie(request, authConfig);
    if (session.accountId) {
      return session.accountId;
    }
    return allowDevActor ? request.headers.get("x-gatherbond-actor") : null;
  };

  const authorize = ({ actor, metadata }) =>
    Boolean(actor && metadata && actor === metadata.organizer_account_id);

  const store = selection.store ?? unavailableStore(selection.reason ?? "unavailable");
  const handlers = createMetadataHandlers({ store, getOnChainEvent, authorize });
  const routes = createMetadataRoutes({
    handlers,
    getActor,
    rateLimitWrite: rateLimits.write,
    networkId,
    contractId,
  });

  return {
    mode: selection.mode,
    reason: selection.reason ?? null,
    handlers,
    routes,
    authRoutes,
  };
}
