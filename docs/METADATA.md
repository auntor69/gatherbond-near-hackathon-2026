# GatherBond — Event Metadata Layer (M3)

Status: **implemented, locally tested and running in production.** The Turso database is
created and migrated, the Next.js UI consumes the public listing, publication and event
passport routes, and a real NEAR Connect NEP-413 wallet session is wired into the UI. The
contract (`cynopom.testnet`) and the frontend (<https://gatherbond.vercel.app>) are
deployed; four on-chain events exist, one of them published with verified metadata (event 3
is an unpublished scripted lifecycle check for the fixed-window schedule).
On-chain registration and deposit from the browser are still pending (see §7). The
database is optional: the escrow contract remains fully usable without it.

## 1. Source-of-truth boundary

Authoritative on-chain (never mirrored as truth):

- organizer, deposit, capacity, timestamps, status
- reservations, ticket commitments, attendance
- escrow, refunds, rewards, claims, treasury

Stored off-chain only:

- title, description, category, venue, image URL, tags, organizer display identity
- the canonical metadata JSON and its SHA-256
- the create transaction reference and publication status

A metadata row can never prove payment, registration, attendance or claim entitlement, and
the metadata document rejects financial fields outright (`deposit`, `capacity`, `status`,
timestamps and any unknown key are validation errors).

## 2. Canonical document

Defined by `server/metadata/canonical.mjs` (browser-safe; M4 will import it to hash before
calling `create_event`).

Fields (all required except `schema_version`, `image_url`, `tags`):

| field | limit | notes |
| --- | --- | --- |
| `schema_version` | must be `1` | defaults to 1 |
| `network_id` | 32 bytes | e.g. `testnet` |
| `contract_id` | NEAR account id | must equal the event key |
| `organizer_account_id` | NEAR account id | must equal the event key's creator |
| `title` | 140 bytes | non-empty |
| `description` | 4000 bytes | may be empty |
| `category` | 40 bytes | non-empty |
| `venue` | 200 bytes | may be empty |
| `image_url` | 500 bytes | `https://` only, or empty |
| `tags` | ≤ 8 entries, 32 bytes each | unique, order preserved |
| `created_at` | RFC 3339 UTC (`Z`) | set before the on-chain transaction |

Canonicalization:

1. object keys sorted lexicographically and recursively,
2. `JSON.stringify` with no whitespace,
3. UTF-8 bytes as provided (no Unicode normalization),
4. SHA-256 over those bytes.

**Decision — `event_id` is excluded.** The contract assigns the event id inside
`create_event`, which already has to carry the metadata hash, so the id cannot be part of
the hashed document. Binding is provided by the unique
`(network_id, contract_id, event_id)` row plus the create transaction hash. The same
reasoning applies to all contract-derived terms.

**Decision — no title/description on-chain.** The contract keeps only the 32-byte hash
(`metadata_hash`), which is what `create_event` accepts today; no contract change was
needed for M3 and no accounting rule was touched.

The hash is exposed three ways: `hex`, `Uint8Array`, and the `[u8; 32]` JSON array that
`create_event` expects. `scripts/metadata-tool.mjs` prints all of them for the runbook.

Known-answer vectors: `docs/metadata-vectors.json`, generated independently by
`scripts/generate_metadata_vectors.py` and executed by the JS tests.

## 3. Database schema

Migration: `database/migrations/0001_event_metadata.sql`.

- identity: `PRIMARY KEY (network_id, contract_id, event_id)`
- `event_id` is `TEXT` decimal u64 so values above 2^53 survive (the contract's `u64`
  serializes as a string over JSON anyway)
- `metadata_json` stores the canonical string, `metadata_sha256` its digest
- `publication_status` ∈ `pending | published | hidden` (default `pending`)
- indexes for published listings, category listings and organizer history

Publication is a separate append-only log, `event_publications`:

- `(network_id, contract_id, event_id, version)` is the primary key; versions are
  monotonically increasing per event
- `action = 'publish'` carries the immutable `metadata_json`, `metadata_sha256` and
  `create_tx_hash` snapshot that was made public at that version
- `published_by` is the authenticated organizer actor; `published_at` is the transition time
- Publication is permanent. A new publish appends a version; there is no unpublish path.
  Legacy `unpublish` rows are retained for audit but ignored by public reads, so an earlier
  publish becomes visible again.

The highest publish version is authoritative. Because every publish is one INSERT, a failure
cannot leave the event half-published; a retry either reports the same version (unchanged
republish) or allocates the next one. The table remains in
`database/migrations/0001_event_metadata.sql`; the migration was applied to the configured
Turso database on 2026-11-08, so the operator command is unchanged.

Local SQLite is the reference implementation (`server/metadata/sqlite.mjs`, Node's
`node:sqlite`); production uses the same store over Turso/libSQL through
`server/metadata/libsql.mjs` (an `@libsql/client`-shaped adapter, no dependency import).

## 4. Server API (framework-agnostic)

`server/metadata/handlers.mjs` exports `createMetadataHandlers({ store, getOnChainEvent,
authorize })`. The Next.js App Router route handlers in
`frontend/app/api/events/route.js`, `frontend/app/api/events/[id]/route.js`,
`frontend/app/api/events/[id]/metadata/route.js` and
`frontend/app/api/events/[id]/publication/route.js` wrap these through
`server/http/routes.mjs` (Web `Request`/`Response`). Nothing here reads environment
variables, so `TURSO_AUTH_TOKEN` cannot reach a client bundle.

`PUT /api/events/:id/metadata` — body `{ key, metadata, create_tx_hash }`, actor from the
server session:

| status | meaning |
| --- | --- |
| 201 | inserted |
| 200 | idempotent retry, same key + hash (no duplicate row) |
| 400 | invalid key/metadata, including financial fields |
| 401 / 403 | missing actor / not the organizer |
| 404 | event does not exist on-chain |
| 409 | submitted hash ≠ on-chain `metadata_hash`, or a different hash is already anchored |
| 503 | RPC or database unavailable (fail closed) |

`GET /api/events/:id/metadata` — returns `{ verified: true, metadata, metadata_hash, ... }`
only when the stored JSON re-hashes to the stored digest **and** equals the on-chain hash.
Mismatch returns `409 metadata_hash_mismatch`; the altered content is never returned as
verified.

`GET /api/events` — published rows only, bounded (`limit ≤ 50`), optionally filtered by
category; rows whose stored JSON no longer hashes correctly are skipped and counted in
`skipped`. It selects only the latest `publish` version, so drafts, never-published events
and superseded versions are never listed; a legacy tombstone does not hide a publish. Detail pages perform the on-chain check; list pages
verify integrity locally.

Publication endpoints:

| route | auth | result |
| --- | --- | --- |
| `POST /api/events/:id/publication` | organizer session | `201` first publish, `200 unchanged` with the same version, `401`/`403`, `404` missing draft/event, `409` hash mismatch, `503` fail closed |
| `DELETE /api/events/:id/publication` | none | `405`; publications are permanent and cannot be unpublished |
| `GET /api/events/:id/publication` | public | `200` current verified snapshot (`version`, `metadata`, hashes, publisher/time), `404 not_published`, `409` mismatch, `503` fail closed |
| `GET /api/events/:id` | public | `200` verified publication plus read-only `onchain` EventView (schedule, deposit, capacity, status), `404 not_published`, `409` mismatch, `503` fail closed |

Publishing verifies the stored draft against both its stored digest and the on-chain
`metadata_hash` before appending the snapshot. An identical republish of unchanged content
returns the existing version and does not write a row. Unpublishing appends a tombstone;
republishing afterwards produces the next version. All three operations use the same
server-derived event key, never a client-supplied network/contract.

The pre-existing `GET /api/events/:id/metadata` remains the draft/verification read required
by the organizer flow and its contract tests; public event pages and discovery use
`GET /api/events/:id/publication`, `GET /api/events/:id` and `GET /api/events`, which never
select drafts or superseded versions. The editorial Next.js pages call the public list and
event-passport routes; sample event IDs are static client content and never call the chain.

Partial failure follows MASTERPLAN §9.5: hash first, submit `create_event`, then save with
the idempotent key and allow a user-triggered retry. A database failure never creates a
second event and never affects escrow.

### Runtime selection and HTTP wiring

`server/metadata/runtime.mjs` chooses the store from server-side environment variables:

| configuration | mode | behaviour |
| --- | --- | --- |
| `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | `turso` | `@libsql/client` from `frontend/`; migrations are applied explicitly (runbook), not at startup |
| `METADATA_SQLITE_PATH` | `sqlite` | local SQLite; migration applied automatically for dev/tests |
| neither | `unavailable` | routes answer `503 metadata_store_unavailable`; escrow stays usable |

Other server variables: `CONTRACT_NAME` (falls back to `NEXT_PUBLIC_CONTRACT_NAME`),
`NEAR_RPC_URL` (default `https://rpc.testnet.near.org`), `NEAR_NETWORK_ID`.

On-chain reads use `server/near/rpc.mjs`: a read-only JSON-RPC `query`/`call_function` of
`get_event`, with no keys and no writes. The event id comes from the URL, while
network/contract identity comes from server configuration, never from the request body.

Authorization binds the actor to the validated `organizer_account_id`. The actor comes from
a verified NEP-413 wallet session (`server/auth/`): the client signs
`sha256(u32le(2147484061) || borsh({ message, nonce[32], recipient, callbackUrl? }))` with
an Ed25519 full-access key, `POST /api/auth/session` verifies it and checks
`view_access_key(account, public_key)` through the read-only RPC seam, then sets an
HttpOnly `gatherbond_session` cookie. The nonce is single-use per account, persisted in
`auth_nonces` (created with `IF NOT EXISTS`, so the Turso migration command is unchanged).
`GET`/`DELETE /api/auth/session` report and clear the session; the GET body also publishes
`configured` and `recipient` so the browser can decide whether to start a login and which
recipient to sign for. The browser uses `@hot-labs/near-connect` and requests
`wallet.signMessage` after connecting; it never adds a function-call key. Without
`GATHERBOND_SESSION_SECRET` login is disabled (503) and writes stay 401.

The development-only `GATHERBOND_ALLOW_DEV_ACTOR=1` + `x-gatherbond-actor` seam remains for
local work and is ignored unless explicitly enabled; it is never a production actor. Reads
(the published snapshot and listing) stay public so discovery and event pages do not require
login.

Login and every authenticated metadata write are throttled by a process-local fixed-window
limiter (`server/http/rateLimit.mjs`): limits are per client and per account for login, and
per actor for writes. Over-limit requests answer `429` with `Retry-After` (and
`retry_after_seconds` in the body) before signature verification, RPC lookup, nonce claim
or the write handler runs. Failed signatures, replays and wrong-actor writes count toward
the limit. State is in-process, so separate instances/replicas each enforce their own
counters; a shared limiter would require a new service and is deliberately out of scope.
Defaults and tuning are in `.env.example`; invalid values fall back to safe defaults and
the limiter is only disabled by the explicit `GATHERBOND_RATE_LIMIT_DISABLED=1`.

Local HTTP check (no credentials, no database):

```bash
cd frontend && npx next build && npx next start -p 3105
# GET /api/events                     -> 503 metadata_store_unavailable
# GET /api/events/0                   -> 503 metadata_store_unavailable
# GET /api/events/0/metadata          -> 503 metadata_store_unavailable
# GET /api/events/0/publication       -> 503 metadata_store_unavailable
# GET /api/auth/session               -> 401 configured:false (when auth is unset)
# PUT /api/events/0/metadata          -> 401 unauthorized
# POST /api/events/0/publication      -> 401 unauthorized
```

`server/http/test/e2eHttp.test.mjs` automates the full lifecycle against the real Next app
and a temporary SQLite file: PUT success, idempotent retry, 401/403/404, 409 before storing,
GET, draft/superseded isolation, versioned publish/republish, permanent-publication, cross-account
rejection, a real throttled publish (`429`) and tamper detection. It runs inside
`scripts/verify-local.sh`.

## 5. Turso / Vercel check (M3 task 1)

Checked 2026-11-07:

- The free plan still exists: 100 databases, 5 GB storage, 500M rows read/month, 10M rows
  written/month, 3 GB sync/month; free databases are archived after 10 days of inactivity
  (vendor pricing page and a 2026-10-30 third-party read of it). Recheck
  <https://turso.tech/pricing> before launch.
- The Vercel Marketplace integration ("Turso Cloud") injects `TURSO_DATABASE_URL` and
  `TURSO_AUTH_TOKEN` and instructs projects to install `@libsql/client`; Turso's current
  docs also offer `@tursodatabase/serverless` for fetch-only runtimes.
- Chosen: `@libsql/client` for the server route handlers, matching the Vercel integration
  and the adapter already implemented here. The adapter is dependency-injected so the
  local tests never need the package or a token.

Sources: <https://turso.tech/pricing>, <https://docs.turso.tech/sdk/ts/reference>,
<https://changelog.vercel.com/marketplace/tursocloud>.

The database was created and `database/migrations/0001_event_metadata.sql` was applied on
2026-11-08 with the user's credentials. `event_metadata` and `event_publications` exist;
`event_publications` was empty at the time of writing. Credentials remain server-only in
`frontend/.env.local`, which is ignored by Git.

## 6. Local verification

```bash
python scripts/generate_metadata_vectors.py     # regenerate vectors
node --test server/metadata/test/*.test.mjs     # metadata handler/store tests
bash scripts/verify-local.sh                    # full local suite, including Next e2e
```

Covered: canonical bytes and 7 independent vectors, key normalization including u64 max,
financial-field rejection, bounds/control characters, idempotent save, hash conflicts,
tampering detection, on-chain mismatch on write and read, auth failures, fail-closed RPC/DB
errors, published-only bounded listings, publication version monotonicity, unchanged
republish no-ops, legacy-tombstone permanence, draft/superseded isolation, failed-publication
atomicity, and the libSQL adapter mapping. Session coverage adds NEP-413 byte vectors,
Ed25519 verification, session expiry/tampering, nonce replay, full-access key enforcement,
the fixed-window limiter (including throttled logins that do not reach RPC or consume a
nonce), and the live signed-login lifecycle over real HTTP.

## 7. Not done

- Wallet-driven registration/deposit, ticket display/scanning, finalization and claims in
  the UI. The contract supports the full lifecycle and the runbook exercises it with the
  NEAR CLI; the browser flow stops at discovery, event pages and organizer metadata.
- Saving metadata from a create-event flow; the server publication workflow exists, but the
  organizer UI currently works from an existing event ID.
- A multi-account published pilot across two browsers. The live Testnet acceptance used one
  account and an unpublished hash.

Deployed on 2026-11-11: contract `cynopom.testnet` (WASM SHA-256
`8b8817aa9da9f0a0784a9059f59e3c2640c26c9228648b2196a306e78c54e1f0`), frontend on Vercel,
Turso metadata live behind `/api/events`. Discovery shows the published on-chain event and
keeps its labeled sample shelf for the remaining empty slots; sample cards never carry
financial activity.
