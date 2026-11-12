// End-to-end proof against the real Next app on a loopback port:
//   - real local SQLite store (METADATA_SQLITE_PATH) with the metadata migration applied;
//   - a local JSON-RPC server implementing the read-only `get_event` and
//     `view_access_key` queries the production reader speaks;
//   - NEP-413 login signed in-process, exchanged over HTTP for an HttpOnly session cookie;
//   - every metadata write derives its actor from that verified session.
//
// No handler or store fakes are used by the server under test.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { encodeBase58 } from "../../auth/base58.mjs";
import { nep413SigningDigest } from "../../auth/nep413.mjs";
import { issueSessionToken } from "../../auth/session.mjs";
import { hashMetadata } from "../../metadata/canonical.mjs";

const TX = "1111111111111111111111111111111111111111";
const SESSION_SECRET = "gatherbond-e2e-session-secret-0123456789abcdef";
const AUTH_RECIPIENT = "gatherbond.app";
const AUTH_MESSAGE = "Sign in to GatherBond";

function demoDoc(overrides = {}) {
  return {
    schema_version: 1,
    network_id: "testnet",
    contract_id: "contract.testnet",
    organizer_account_id: "organizer.testnet",
    title: "Demo night",
    description: "Commit to gather.",
    category: "community",
    venue: "Online",
    image_url: "",
    tags: ["demo"],
    created_at: "2026-11-07T12:00:00Z",
    ...overrides,
  };
}

function account(accountId) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return {
    accountId,
    privateKey,
    raw,
    publicKey: `ed25519:${encodeBase58(raw)}`,
  };
}

function loginBody(
  keys,
  {
    nonce = randomBytes(32),
    recipient = AUTH_RECIPIENT,
    message = AUTH_MESSAGE,
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function cookieFrom(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  const raw = values[0] ?? response.headers.get("set-cookie");
  assert.ok(raw, "expected a Set-Cookie header");
  return raw.split(";")[0];
}

test(
  "NEP-413 session auth and metadata lifecycle over real HTTP",
  { timeout: 240000 },
  async () => {
    const frontendDir = path.resolve(import.meta.dirname, "../../../frontend");
    const nextBin = path.join(frontendDir, "node_modules", "next", "dist", "bin", "next");
    assert.ok(
      existsSync(nextBin),
      "frontend dependencies are missing; run `npm install` in frontend/",
    );

    const tmpDir = path.join(os.tmpdir(), `gatherbond-e2e-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, "metadata.sqlite");

    const documents = {
      0: demoDoc(),
      1: demoDoc({ title: "Anchored event one" }),
      2: demoDoc({ title: "Unpublished draft" }),
      3: demoDoc({ title: "Dev-header event" }),
    };
    const hashes = {};
    for (const [id, document] of Object.entries(documents)) {
      hashes[id] = await hashMetadata(document);
    }

    const organizer = account("organizer.testnet");
    const otherOrganizer = account("other.testnet");
    const stranger = account("stranger.testnet");

    // Local chain state: get_event anchors and the access keys that may sign in.
    const chain = new Map(
      Object.entries(documents).map(([id]) => [
        id,
        {
          event_id: Number(id),
          organizer: "organizer.testnet",
          metadata_hash: hashes[id].array,
          deposit: "1000000000000000000000000",
          capacity: 3,
          registered: 0,
          checked_in: 0,
          start_at: "1763000000000000000",
          end_at: "1763003600000000000",
          registration_deadline: "1762990000000000000",
          checkin_open: "1763000000000000000",
          checkin_close: "1763003600000000000",
          status: "Open",
          refund_pool: "0",
          reward_pool: "0",
          reward_per_attendee: "0",
          locked: false,
        },
      ]),
    );
    const accessKeys = new Map([
      [`${organizer.accountId}:${organizer.publicKey}`, "FullAccess"],
      [`${otherOrganizer.accountId}:${otherOrganizer.publicKey}`, "FullAccess"],
      // A function-call key is not enough for NEP-413 sign-in.
      [`${stranger.accountId}:${stranger.publicKey}`, { FunctionCall: { method_names: [] } }],
    ]);
    let viewAccessKeyCalls = 0;

    const rpc = http.createServer(async (request, response) => {
      let raw = "";
      for await (const chunk of request) {
        raw += chunk;
      }
      const payload = JSON.parse(raw);
      response.writeHead(200, { "content-type": "application/json" });

      if (payload.params.request_type === "view_access_key") {
        viewAccessKeyCalls += 1;
        const { account_id: accountId, public_key: publicKey } = payload.params;
        const permission = accessKeys.get(`${accountId}:${publicKey}`);
        if (!permission) {
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: payload.id,
              error: {
                cause: { name: "UNKNOWN_ACCESS_KEY" },
                message: `access key ${publicKey} does not exist for ${accountId}`,
              },
            }),
          );
          return;
        }
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            result: { block_height: 1, block_hash: "11111111111111111111111111111111", permission },
          }),
        );
        return;
      }

      const args = JSON.parse(Buffer.from(payload.params.args_base64, "base64").toString("utf8"));
      const event = chain.get(String(args.event_id));
      const bytes = event
        ? Array.from(new TextEncoder().encode(JSON.stringify(event)))
        : [];
      response.end(
        JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { result: bytes } }),
      );
    });
    await new Promise((resolve) => rpc.listen(0, "127.0.0.1", resolve));
    const rpcUrl = `http://127.0.0.1:${rpc.address().port}`;

    const build = spawnSync(process.execPath, [nextBin, "build"], {
      cwd: frontendDir,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      encoding: "utf8",
    });
    assert.equal(
      build.status,
      0,
      `next build failed:\n${build.stdout ?? ""}\n${build.stderr ?? ""}`,
    );

    function database() {
      const db = new DatabaseSync(dbPath);
      db.exec("PRAGMA busy_timeout = 5000");
      return db;
    }

    function countRows(eventId) {
      const db = database();
      try {
        const row = db
          .prepare("SELECT COUNT(*) AS total FROM event_metadata WHERE event_id = ?")
          .get(String(eventId));
        return Number(row.total);
      } finally {
        db.close();
      }
    }

    function countPublications(eventId) {
      const db = database();
      try {
        const row = db
          .prepare("SELECT COUNT(*) AS total FROM event_publications WHERE event_id = ?")
          .get(String(eventId));
        return Number(row.total);
      } finally {
        db.close();
      }
    }

    const servers = [];
    process.once("exit", () => {
      for (const server of servers) {
        if (server.child.exitCode === null) {
          server.child.kill("SIGKILL");
        }
      }
    });

    async function startServer({ allowDevActor, overrides = {} }) {
      const port = await freePort();
      const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
        cwd: frontendDir,
        env: {
          ...process.env,
          // The Next app loads frontend/.env.local. Clear Turso explicitly so this
          // test always exercises the temporary SQLite database it just created.
          TURSO_DATABASE_URL: "",
          TURSO_AUTH_TOKEN: "",
          METADATA_SQLITE_PATH: dbPath,
          NEAR_RPC_URL: rpcUrl,
          CONTRACT_NAME: "contract.testnet",
          NEAR_NETWORK_ID: "testnet",
          GATHERBOND_ALLOW_DEV_ACTOR: allowDevActor ? "1" : "0",
          GATHERBOND_SESSION_SECRET: SESSION_SECRET,
          GATHERBOND_AUTH_RECIPIENT: AUTH_RECIPIENT,
          GATHERBOND_SESSION_TTL_SECONDS: "600",
          GATHERBOND_LOGIN_RATE_LIMIT: "6",
          GATHERBOND_LOGIN_ACCOUNT_RATE_LIMIT: "20",
          GATHERBOND_LOGIN_RATE_WINDOW_SECONDS: "2",
          GATHERBOND_WRITE_RATE_LIMIT: "5",
          GATHERBOND_WRITE_RATE_WINDOW_SECONDS: "3",
          NEXT_TELEMETRY_DISABLED: "1",
          ...overrides,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let logs = "";
      child.stdout.on("data", (chunk) => {
        logs += chunk;
      });
      child.stderr.on("data", (chunk) => {
        logs += chunk;
      });

      const base = `http://127.0.0.1:${port}`;
      let stopping = null;
      const stop = () => {
        if (!stopping) {
          stopping = (async () => {
            if (child.exitCode === null) {
              child.kill("SIGTERM");
              const exited = await Promise.race([
                once(child, "exit").then(() => true),
                delay(5000).then(() => false),
              ]);
              if (!exited) {
                child.kill("SIGKILL");
                await Promise.race([once(child, "exit"), delay(2000)]);
              }
            }
          })();
        }
        return stopping;
      };

      const handle = { child, base, port, stop, logs: () => logs };
      servers.push(handle);

      let ready = false;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (child.exitCode !== null) {
          break;
        }
        try {
          await fetch(`${base}/api/events`);
          ready = true;
          break;
        } catch {
          await delay(250);
        }
      }
      assert.equal(ready, true, `Next server failed to start:\n${logs}`);
      return handle;
    }

    async function assertClosed(handle) {
      let closed = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          await fetch(`${handle.base}/api/events`, { signal: AbortSignal.timeout(1000) });
        } catch {
          closed = true;
          break;
        }
        await delay(250);
      }
      assert.equal(closed, true, "the Next server was still listening after shutdown");
    }

    let primary;
    try {
      primary = await startServer({ allowDevActor: false });
      const { base } = primary;

      const login = (body, headers = {}) =>
        fetch(`${base}/api/auth/session`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        });

      const put = (eventId, metadata, { cookie, actor } = {}) =>
        fetch(`${base}/api/events/${eventId}/metadata`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
            ...(actor ? { "x-gatherbond-actor": actor } : {}),
          },
          body: JSON.stringify({ metadata, create_tx_hash: TX }),
        });

      const publication = (eventId, { method = "POST", cookie, actor } = {}) =>
        fetch(`${base}/api/events/${eventId}/publication`, {
          method,
          headers: {
            ...(cookie ? { cookie } : {}),
            ...(actor ? { "x-gatherbond-actor": actor } : {}),
          },
        });

      const getPublication = (eventId) => publication(eventId, { method: "GET" });

      const sessionCookieHeader = (token) => `gatherbond_session=${token}`;

      const schema = database();
      const table = schema
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event_metadata'")
        .get();
      schema.close();
      assert.ok(table, "the real store did not apply the event_metadata migration");

      // 0. No cookie, no actor.
      const anonymousSession = await fetch(`${base}/api/auth/session`);
      assert.equal(anonymousSession.status, 401);
      assert.equal((await anonymousSession.json()).error, "unauthorized");

      // 1. The dev header is refused while the flag is off, before any store write.
      const devRefused = await put(0, documents[0], { actor: organizer.accountId });
      assert.equal(devRefused.status, 401, JSON.stringify(await devRefused.clone().json()));
      assert.equal(countRows(0), 0);

      // 2. A forged signature is rejected even though the claimed key is on chain.
      const attacker = account("organizer.testnet");
      const forged = await login(loginBody(organizer, { signer: attacker.privateKey }));
      assert.equal(forged.status, 401);
      assert.equal((await forged.json()).error, "invalid_signature");

      // 3. A signature for another recipient cannot be used here.
      const wrongRecipient = await login(loginBody(organizer, { recipient: "evil.example" }));
      assert.equal(wrongRecipient.status, 400);
      assert.equal((await wrongRecipient.json()).error, "invalid_recipient");

      // 4. A function-call key is not accepted for sign-in.
      const weakKey = await login(loginBody(stranger));
      assert.equal(weakKey.status, 403);
      assert.equal((await weakKey.json()).error, "full_access_key_required");

      // 5. A valid NEP-413 login issues an HttpOnly session cookie.
      const validBody = loginBody(organizer, {
        callbackUrl: "https://gatherbond.app/callback",
      });
      const validLogin = await login(validBody);
      assert.equal(validLogin.status, 200, JSON.stringify(await validLogin.clone().json()));
      const validPayload = await validLogin.json();
      assert.equal(validPayload.account_id, organizer.accountId);
      const rawCookie = cookieFrom(validLogin);
      assert.match(rawCookie, /^gatherbond_session=/);
      const setCookie = (validLogin.headers.getSetCookie?.() ?? [])[0] ?? "";
      assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /SameSite=Lax/);
      const organizerCookie = rawCookie;

      // 6. Replaying the identical signed message is rejected.
      const replay = await login(validBody);
      assert.equal(replay.status, 400);
      assert.equal((await replay.json()).error, "nonce_already_used");

      // 7. The session identifies the account.
      const whoami = await fetch(`${base}/api/auth/session`, {
        headers: { cookie: organizerCookie },
      });
      assert.equal(whoami.status, 200);
      assert.equal((await whoami.json()).account_id, organizer.accountId);

      // 8. Session-authenticated PUT and idempotent retry.
      const createdResponse = await put(0, documents[0], { cookie: organizerCookie });
      const created = await createdResponse.json();
      assert.equal(createdResponse.status, 201, JSON.stringify(created));
      assert.equal(created.outcome, "inserted");
      assert.equal(created.metadata_sha256, hashes[0].hex);
      assert.equal(countRows(0), 1);

      const repeatResponse = await put(0, documents[0], { cookie: organizerCookie });
      const repeat = await repeatResponse.json();
      assert.equal(repeatResponse.status, 200, JSON.stringify(repeat));
      assert.equal(repeat.outcome, "unchanged");
      assert.equal(countRows(0), 1, "idempotent retry created a duplicate row");

      // 9. A valid cookie is required; a forged/expired one and a bare dev header fail.
      const noCookie = await put(0, documents[0]);
      assert.equal(noCookie.status, 401);

      const expiredToken = issueSessionToken({
        secret: SESSION_SECRET,
        accountId: organizer.accountId,
        ttlSeconds: 1,
        now: Date.now() - 10_000,
      });
      const expired = await put(0, documents[0], {
        cookie: sessionCookieHeader(expiredToken),
      });
      assert.equal(expired.status, 401);
      assert.equal(countRows(0), 1);

      const expiredSession = await fetch(`${base}/api/auth/session`, {
        headers: { cookie: sessionCookieHeader(expiredToken) },
      });
      assert.equal(expiredSession.status, 401);
      assert.equal((await expiredSession.json()).error, "session_expired");

      // 10. A valid session for a different account does not authorize the organizer's row.
      const otherLogin = await login(loginBody(otherOrganizer));
      assert.equal(otherLogin.status, 200);
      const otherCookie = cookieFrom(otherLogin);
      const forbidden = await put(1, documents[1], { cookie: otherCookie });
      assert.equal(forbidden.status, 403);
      assert.equal((await forbidden.json()).error, "forbidden");
      assert.equal(countRows(1), 0);

      // 11. Unknown event, on-chain hash mismatch, and the draft/publication lifecycle.
      const missingResponse = await put(9, documents[0], { cookie: organizerCookie });
      assert.equal(missingResponse.status, 404);

      const mismatchResponse = await put(
        1,
        demoDoc({ title: "Not the anchored document" }),
        { cookie: organizerCookie },
      );
      assert.equal(mismatchResponse.status, 409);
      assert.equal((await mismatchResponse.json()).error, "metadata_hash_mismatch");
      assert.equal(countRows(1), 0, "a hash-mismatched document reached the database");

      const getResponse = await fetch(`${base}/api/events/0/metadata`);
      const stored = await getResponse.json();
      assert.equal(getResponse.status, 200, JSON.stringify(stored));
      assert.equal(stored.verified, true);
      assert.equal(stored.metadata.title, documents[0].title);

      const draftResponse = await put(2, documents[2], { cookie: organizerCookie });
      assert.equal(draftResponse.status, 201);

      // 12b. Organizer writes are limited per account. This is the sixth write in the
      // window; it is rejected before the handler, then the window resets.
      const writeThrottled = await put(2, documents[2], { cookie: organizerCookie });
      assert.equal(writeThrottled.status, 429);
      assert.ok(Number(writeThrottled.headers.get("retry-after")) >= 1);
      assert.deepEqual(await writeThrottled.json(), {
        error: "rate_limited",
        retry_after_seconds: Number(writeThrottled.headers.get("retry-after")),
      });
      assert.equal(countRows(2), 1, "a throttled write must not change the store");

      await delay(3_200);
      const writeAfterReset = await put(2, documents[2], { cookie: organizerCookie });
      assert.equal(writeAfterReset.status, 200);
      assert.equal((await writeAfterReset.json()).outcome, "unchanged");

      // 11b. Publication is an explicit, versioned operation. This window has one write
      // left (writeAfterReset above), so the calls below fill it with publish, identical
      // republish and publishing a second event. There is no unpublish path.
      const publish0 = await publication(0, { cookie: organizerCookie });
      const publish0Body = await publish0.json();
      assert.equal(publish0.status, 201, JSON.stringify(publish0Body));
      assert.equal(publish0Body.outcome, "published");
      assert.equal(publish0Body.version, 1);
      assert.equal(publish0Body.publication_status, "published");

      const unpublishedDraftPage = await fetch(`${base}/api/events?limit=10`);
      const draftPage = await unpublishedDraftPage.json();
      assert.equal(draftPage.items.length, 1, "a draft leaked into discovery");
      assert.equal(draftPage.items[0].event.event_id, "0");
      assert.ok(draftPage.items.every((item) => item.event.event_id !== "2"));

      const firstSnapshot = await getPublication(0);
      const firstSnapshotBody = await firstSnapshot.json();
      assert.equal(firstSnapshot.status, 200, JSON.stringify(firstSnapshotBody));
      assert.equal(firstSnapshotBody.verified, true);
      assert.equal(firstSnapshotBody.version, 1);
      assert.equal(firstSnapshotBody.metadata.title, documents[0].title);

      const detailsResponse = await fetch(`${base}/api/events/0`);
      const detailsBody = await detailsResponse.json();
      assert.equal(detailsResponse.status, 200, JSON.stringify(detailsBody));
      assert.equal(detailsBody.verified, true);
      assert.equal(detailsBody.version, 1);
      assert.equal(detailsBody.onchain.capacity, 3);
      assert.equal(detailsBody.onchain.status, "Open");

      const identicalPublish = await publication(0, { cookie: organizerCookie });
      const identicalPublishBody = await identicalPublish.json();
      assert.equal(identicalPublish.status, 200, JSON.stringify(identicalPublishBody));
      assert.equal(identicalPublishBody.outcome, "unchanged");
      assert.equal(identicalPublishBody.version, 1, "an unchanged republish must not bump");

      const publish2 = await publication(2, { cookie: organizerCookie });
      assert.equal(publish2.status, 201);
      assert.equal((await publish2.json()).version, 1);

      const bothPageResponse = await fetch(`${base}/api/events?limit=10`);
      const bothPage = await bothPageResponse.json();
      assert.deepEqual(
        bothPage.items.map((item) => item.event.event_id).sort(),
        ["0", "2"],
      );

      const unpublish0 = await publication(0, {
        method: "DELETE",
        cookie: organizerCookie,
      });
      assert.equal(unpublish0.status, 405, "publication must be permanent");

      const afterUnpublishPage = await (await fetch(`${base}/api/events?limit=10`)).json();
      assert.deepEqual(
        afterUnpublishPage.items.map((item) => item.event.event_id).sort(),
        ["0", "2"],
      );
      assert.equal(
        (await getPublication(0)).status,
        200,
        "a rejected unpublish must leave the snapshot public",
      );

      // A fresh window lets us confirm the unchanged publish stays version 1, prove a
      // cross-account rejection, then exercise the shared write limit.
      await delay(3_200);
      const republish0 = await publication(0, { cookie: organizerCookie });
      const republish0Body = await republish0.json();
      assert.equal(republish0.status, 200, JSON.stringify(republish0Body));
      assert.equal(republish0Body.version, 1, "an unchanged publish must keep its version");

      const currentSnapshot = await getPublication(0);
      const currentSnapshotBody = await currentSnapshot.json();
      assert.equal(currentSnapshot.status, 200, JSON.stringify(currentSnapshotBody));
      assert.equal(currentSnapshotBody.version, 1);

      const currentPage = await (await fetch(`${base}/api/events?limit=10`)).json();
      const currentEvent0 = currentPage.items.find((item) => item.event.event_id === "0");
      assert.ok(currentEvent0, "the published event must stay listed");
      assert.equal(
        currentEvent0.publication_version,
        1,
        "the listing must expose the latest publish version",
      );

      const crossPublish = await publication(0, { cookie: otherCookie });
      assert.equal(crossPublish.status, 403);
      assert.equal((await crossPublish.json()).error, "forbidden");
      const crossUnpublish = await publication(0, {
        method: "DELETE",
        cookie: otherCookie,
      });
      assert.equal(crossUnpublish.status, 405);

      for (let attempt = 0; attempt < 4; attempt += 1) {
        const unchanged = await publication(0, { cookie: organizerCookie });
        assert.equal(unchanged.status, 200, "the first five writes of the window are allowed");
        assert.equal((await unchanged.json()).version, 1);
      }
      const publicationsBeforeThrottle = countPublications(0);
      const throttledPublish = await publication(0, { cookie: organizerCookie });
      const throttledPublishBody = await throttledPublish.json();
      assert.equal(throttledPublish.status, 429, JSON.stringify(throttledPublishBody));
      assert.ok(Number(throttledPublish.headers.get("retry-after")) >= 1);
      assert.equal(throttledPublishBody.error, "rate_limited");
      assert.equal(
        (await (await getPublication(0)).json()).version,
        1,
        "a throttled publish must not change the stored version",
      );
      assert.equal(
        countPublications(0),
        publicationsBeforeThrottle,
        "a throttled publish must not append a publication row",
      );

      const publishedHistory = database();
      const historyRows = publishedHistory
        .prepare("SELECT version, action FROM event_publications WHERE event_id = '0' ORDER BY version")
        .all();
      publishedHistory.close();
      assert.deepEqual(
        historyRows.map((row) => [Number(row.version), row.action]),
        [[1, "publish"]],
      );

      // 12. Tampered bytes are detected on read.
      const tamper = database();
      tamper
        .prepare("UPDATE event_metadata SET metadata_json = ? WHERE event_id = '0'")
        .run(JSON.stringify(demoDoc({ title: "Tampered after storage" })));
      tamper.close();

      const tamperedResponse = await fetch(`${base}/api/events/0/metadata`);
      assert.equal(tamperedResponse.status, 409);
      assert.equal((await tamperedResponse.json()).error, "metadata_hash_mismatch");

      const tamperedPage = await (await fetch(`${base}/api/events?limit=10`)).json();
      assert.equal(tamperedPage.items.length, 1);
      assert.equal(tamperedPage.items[0].event.event_id, "2");
      assert.equal(tamperedPage.skipped, 1, "a tampered published draft must not be served");
      const immutableSnapshot = await getPublication(0);
      assert.equal(immutableSnapshot.status, 200);
      assert.equal((await immutableSnapshot.json()).metadata.title, documents[0].title);

      // 13. The nonce table is a real, persisted single-use record.
      const nonces = database();
      const nonceRow = nonces.prepare("SELECT COUNT(*) AS total FROM auth_nonces").get();
      nonces.close();
      assert.equal(Number(nonceRow.total), 2, "both successful logins should persist one nonce each");

      // 13b. Failed logins count toward the client limit. Six forged attempts exhaust the
      // window for this client; the next valid attempt is rejected before signature
      // verification, RPC lookup and nonce claim, then succeeds after the reset.
      const throttleHeaders = { "x-forwarded-for": "198.51.100.77" };
      const garbageBody = loginBody(organizer, { signer: attacker.privateKey });
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const garbage = await login(garbageBody, throttleHeaders);
        assert.equal(garbage.status, 401);
        assert.equal((await garbage.json()).error, "invalid_signature");
      }

      const burstBody = loginBody(organizer);
      const rpcBeforeThrottle = viewAccessKeyCalls;
      const countNonces = () => {
        const db = database();
        try {
          return Number(db.prepare("SELECT COUNT(*) AS total FROM auth_nonces").get().total);
        } finally {
          db.close();
        }
      };
      const noncesBeforeThrottle = countNonces();

      const throttled = await login(burstBody, throttleHeaders);
      const throttledBody = await throttled.json();
      assert.equal(throttled.status, 429, JSON.stringify(throttledBody));
      assert.equal(throttled.headers.get("set-cookie"), null);
      assert.ok(Number(throttled.headers.get("retry-after")) >= 1);
      assert.equal(throttledBody.error, "rate_limited");
      assert.equal(viewAccessKeyCalls, rpcBeforeThrottle, "a throttled login must not call RPC");
      assert.equal(countNonces(), noncesBeforeThrottle, "a throttled login must not consume a nonce");

      await delay(2_200);
      const loginAfterReset = await login(burstBody, throttleHeaders);
      assert.equal(loginAfterReset.status, 200, "the valid nonce must still be usable after reset");

      await primary.stop();
      await assertClosed(primary);

      // 14. The dev header works only when explicitly enabled, on its own server.
      const devServer = await startServer({
        allowDevActor: true,
        overrides: { GATHERBOND_WRITE_RATE_LIMIT: "1" },
      });
      const devPut = () =>
        fetch(`${devServer.base}/api/events/3/metadata`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-gatherbond-actor": organizer.accountId,
          },
          body: JSON.stringify({ metadata: documents[3], create_tx_hash: TX }),
        });
      const devFirst = await devPut();
      assert.equal(devFirst.status, 201, JSON.stringify(await devFirst.clone().json()));
      assert.equal(countRows(3), 1);

      const devThrottled = await devPut();
      assert.equal(devThrottled.status, 429, "the dev seam has its own write limit");
      assert.ok(Number(devThrottled.headers.get("retry-after")) >= 1);
      assert.equal(countRows(3), 1);
      await devServer.stop();
      await assertClosed(devServer);
    } finally {
      for (const server of servers) {
        await server.stop().catch(() => {});
      }
      rpc.closeAllConnections?.();
      await new Promise((resolve) => rpc.close(resolve));
      rmSync(tmpDir, { recursive: true, force: true });
    }
  },
);
