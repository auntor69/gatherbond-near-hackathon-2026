# GatherBond Build Log

Use this file to record only verified progress. Update it after each implementation session.

## 2026-11-06 — Project definition and repository bootstrap

**Status:** Planning. No contract deployed; no wallet transactions or application features implemented yet.

### Confirmed decisions

- Working project name: GatherBond (clearance not complete).
- NEAR testnet, native NEAR deposits, one Rust smart contract.
- Organizer sets deposit per event.
- Support campus/community and professional events.
- On-chain attendance record in MVP; no NFT minting.
- Refund plus equal share of no-show deposits for verified attendees.
- No-show forfeits deposit; organizer cancellation before event start gives full refunds.
- Turso may store off-chain event metadata/search only. NEAR contract remains authoritative for money, reservations, attendance and claims.
- Vercel free tier target; $0 budget target.

### Verified work

- Product scope and implementation plan drafted.
- Official hackathon instructions copied into `HACKATHON.md` without modification from the supplied file.

### Not yet done

- GitHub repository creation and upload.
- Environment/toolchain audit.
- Rust contract or frontend implementation.
- Testnet deployment, wallet connection, deposit, refund or QR check-in.
- Turso database creation.
- Vercel deployment or public demo.

### Next action

Create the private GitHub repository, add the project documents, then ask the coding agent to perform Milestone 0 (inspection only) from `MASTERPLAN.md`.

## 2026-11-07 — Toolchain fix, M1A hardening, and the complete M2 escrow contract

**Status:** M2 contract implemented and green locally (36/36 unit tests). No deployment, no
NEAR accounts, no signed transactions, no funds spent. Frontend and Turso not started.

### Toolchain (verified)

- Target: `x86_64-pc-windows-msvc`, rustc 1.99.1, `wasm32-unknown-unknown` installed.
- `aws-lc-sys` v0.47.0 compiles with **`AWS_LC_SYS_PREBUILT_NASM=1`** plus the Visual Studio
  CMake on `PATH`. NASM is **not** installed; no NASM install, no `Cargo.toml` change and no
  crypto dependency change.
- Required in every fresh shell:

  ```bash
  export PATH="/f/vsbuild/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin:$PATH"
  export AWS_LC_SYS_PREBUILT_NASM=1
  cargo test --offline
  ```

### M1A hardening (superseded the same day by M2)

- Single-flight payout lock; solvency invariant `balance >= L + P + stake + buffer` checked at
  deposit, claim, every callback and reserve withdrawal; storage admission from a measured
  `storage_usage()` delta.
- Verified with 33/33 tests and mutation runs proving each guard test fails when its check is
  removed, then restored byte-identically.

### M2 — complete escrow contract (`contracts/src/lib.rs`)

Implemented methods (MASTERPLAN §7.4): `create_event`, `register`, `check_in`, `cancel_event`,
`finalize_event`, `claim_settlement`, `on_claim_callback`, `withdraw_treasury`,
`on_treasury_callback`, plus views `get_event`, `get_events` (bounded, ≤20 per page),
`get_event_count`, `get_reservation`, `get_reservations_for_account`, `get_attendance_history`,
`get_treasury_balance`, `get_total_liability`, `get_pending_amount`, `get_storage_stake`,
`get_required_balance`, `get_surplus`, `get_last_storage_delta`, `get_max_record_bytes`,
`get_treasury_account`, `get_network_id`.

Rules enforced: immutable event terms; deposit > 0; capacity 1..=500; `start < end`;
registration deadline in the future and no later than start; check-in window inside the event;
exact-deposit registration; duplicate/capacity/deadline rejection; organizer-only one-time
check-in with ticket commitment; organizer-only cancellation before start; permissionless
finalization after end; owner-only pull claims; treasury-only withdrawal bounded by accrual.

Accounting:

```text
total_liability = Σ_event(refund_pool + reward_pool) + treasury_accrued
pending_total   = Σ in-flight payout amounts (claims + treasury withdrawals)
invariant       = balance >= total_liability + pending_total + storage_stake + buffer
```

`buffer = max(0.001 NEAR, stake / 20)`. Moving an amount from a pool into `pending_total`
keeps `liability + pending` constant, so the initiation check also proves the transfer
receipt cannot fail for lack of balance. Payout locks are single-flight **per event**, plus
one treasury lock, so callbacks perform local accounting only.

Storage policy: the organizer's attached contribution is **non-refundable** and disclosed
(MASTERPLAN §5.1 permits this); minimum 0.01 NEAR. Admission is never based on a byte
estimate: each growing receipt flushes the maps and compares `storage_usage()` before and
after, then enforces the global invariant. Re-funding is available via `fund_reserve`.

Ticket commitment (to be mirrored by the frontend in M5):

```text
SHA256("GatherBond:v1"
       || u32le(len(network)) || network
       || u32le(len(contract)) || contract
       || event_id_le_u64
       || u32le(len(attendee)) || attendee
       || u32le(len(secret)) || secret)
```

### Verified results (fresh run, 2026-11-07)

- `cargo fmt --check` — clean.
- `cargo test --offline` — `36 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`,
  zero warnings.
- WASM release build: `410,718` bytes (M1A: 272,390; original prototype: 248,400).
- Coverage includes: event creation and validation, exact deposits, duplicate/capacity/deadline
  rejection, check-in success and rejection (wrong secret, replay, unauthorized, outside
  window), finalization timing, partial/no-show/rounding settlement, cancellation refunds,
  failed-transfer restoration, double-claim rejection, per-event lock isolation, treasury
  withdrawal bounds and failure restore, pagination bounds, liability identity across the
  lifecycle, and measured storage deltas.

### Decisions

- Storage contributions are non-refundable rather than withdrawable; this removes a reserve
  withdrawal path and the class of bugs around it.
- Payout locks are per event (not global) so unrelated events stay usable; the global
  invariant is therefore checked at every initiation and never in a callback.
- Capacity is capped but not storage-bonded; registrations fail closed if the reserve is
  insufficient. The UI must attach a generous event contribution and surface a clear error.

### Not done / risks

- No testnet deployment, wallet connection, QR UI, Turso database or frontend.
- M1 acceptance (real testnet deposit and refund) still outstanding: requires a human-approved
  funded testnet account and signing.
- Cross-language ticket-commitment test vectors are not written yet (needed before M5).
- Contract code is ~410 KB, i.e. roughly 4.1 NEAR of storage stake for the code alone at
  `10^19` yoctoNEAR/byte; the deploy account must be funded for code plus state.
- Contract is unaudited; organizer-authorized check-in is a disclosed trust assumption.

### Next action

M1 testnet proof: deploy this contract to testnet from a human-approved funded account, run
create → register → check-in → finalize → claim, and record explorer links here. The deploy
runbook and commitment vectors requested by this step now exist (see the next session).

## 2026-11-07 (session 2) — M1 unblock package: commitment parity and deploy handover

**Status:** M1 is code-complete and locally verified. The only remaining gate is human:
a funded testnet account, the deployment itself and its signatures. This session did not
deploy, create accounts, sign, spend, or start any UI work.

### Ticket-commitment parity

- `ticket_commitment` in `contracts/src/lib.rs` is now `pub` (deliberately outside the
  `#[near]` impl, so it is not a contract method) and documented as the single source of
  truth for the byte format.
- `frontend/lib/ticketCommitment.mjs` is a dependency-free, browser-safe implementation:
  `commitmentBytes` (canonical bytes), `commitmentArray` (the `[u8; 32]` JSON argument) and
  `ticketCommitmentHex` (WebCrypto SHA-256). `eventId` accepts bigint or string, so ids
  above 2^53 are safe.
- `docs/ticket-commitment-vectors.json` holds 8 known-answer vectors covering event id 0,
  empty secret, unicode secret, leading-zero secret, event id 2^53+1, u64::MAX, a
  hash-of-hash secret and a long attendee id. The digests were produced by an independent
  Python implementation (`scripts/generate_ticket_vectors.py`), not by either shipped
  implementation.
- Both implementations were executed against the same file:

```text
node scripts/verify-ticket-commitment.mjs                8/8 vectors matched (each hex printed)
cargo test test_ticket_commitment_known_answer_vectors   ok (all 8 digests compared)
```

  Every digest is byte-identical on both sides; the vectors were not edited to make them
  agree.

### Deploy handover

- `scripts/deploy-contract.sh` builds the release WASM, rejects an empty or oversized
  artifact, honors `EXPECTED_SHA256`, prints size and SHA-256, computes the code storage
  stake with exact integer arithmetic, verifies that all 16 methods used by the handover
  still exist and that init is `(treasury, network_id)`, then prints the near-cli-rs deploy
  command. It never invokes `near` and completes with no account configured.
- Captured run: size `410817`, sha256
  `359fef6fd7b6e158e595d6a8c566d880229ae070608c34792ed776bf46c95db0`, code stake
  `4.10817 NEAR`, suggested funding `6 NEAR`, all 16 methods present, exit `0`.
- `docs/DEPLOY_RUNBOOK.md` documents prerequisites, build/hash/stake arithmetic, the deploy
  command, and the full acceptance sequence: create → register ×3 (with commitment
  generation) → check-in ×2 → finalize → claim ×2, plus the cancellation/refund path, the
  optional treasury path, expected observables and a troubleshooting table.

### Verified results

```text
cargo fmt --check          clean
cargo test --offline       37 passed; 0 failed; 0 ignored; 0 warnings
node verify                8/8 vectors matched
deploy script              exit 0, print-only
```

The previous 36 tests are unchanged; the only addition is the known-answer vector test.
WASM size moved from 410,718 to 410,817 bytes because the helper is now public.

### Remaining human gate

Fund a testnet account, deploy, and sign the acceptance sequence in runbook §4. The
contract is still unaudited, and check-in remains organizer-authorized by design.

### Next action

After M1 acceptance: M3 (Turso event metadata) and M4 (frontend, importing
`frontend/lib/ticketCommitment.mjs`). Until then, no further contract work is required.

## 2026-11-07 (session 3) — M3 event metadata layer

**Status:** M3 implemented and locally verified as a framework-agnostic server module with
its own tests. No Turso database was created, nothing was deployed, no signature or funds
were used, no UI was started, and `contracts/src/lib.rs` was not modified (accounting rules
untouched).

### Plan interpretation (M3 is underspecified without M4)

M3 calls for "server-side database client and API routes", but the Next.js app does not exist
until M4 and M3 explicitly forbids UI work. Smallest coherent interpretation: pure request
handlers plus a database port, so M4 only wraps them in route handlers. No framework,
package install, credential or deployment was required.

### Canonical metadata and hashing

- `server/metadata/canonical.mjs` (browser-safe) defines the canonical document, bounded
  fields, NEAR account/u64 validation, canonical JSON (sorted keys, no whitespace, UTF-8)
  and SHA-256. It exposes hex, `Uint8Array` and the `[u8; 32]` array that `create_event`
  already accepts, so no contract change was needed.
- `docs/metadata-vectors.json`: 7 known-answer vectors generated by an independent Python
  implementation (`scripts/generate_metadata_vectors.py`), covering unicode, empty display
  fields, JSON escapes/tabs/backslashes, tag order, field bounds and subaccounts.
- `scripts/metadata-tool.mjs hash|demo` prints the canonical JSON, digest and contract array;
  the deploy runbook now derives `metadata_hash` with it instead of a placeholder.

### Database layer

- `database/migrations/0001_event_metadata.sql`: identity `(network_id, contract_id,
  event_id)`, `event_id` stored as TEXT decimal u64 (above 2^53 survives), canonical JSON +
  digest, publication status, create transaction hash, listing indexes.
- `server/metadata/store.mjs`: async SQL port; idempotent `save` (same key + hash is a no-op,
  a different hash is a conflict), verified reads, bounded published listings, status changes.
- `server/metadata/sqlite.mjs` (Node `node:sqlite`, used by tests/local dev) and
  `server/metadata/libsql.mjs` (`@libsql/client`-shaped adapter, dependency-injected) run the
  same store. `TURSO_AUTH_TOKEN` is only ever read server-side; no module here reads env.

### API handlers

`server/metadata/handlers.mjs`: `createMetadataHandlers({ store, getOnChainEvent, authorize })`.
PUT validates metadata, compares its hash with the on-chain `get_event().metadata_hash`
**before** storing, is idempotent on retry, and fails closed (401/403/404/409/503). GET
re-hashes the stored JSON and cross-checks the chain; mismatches return
`409 metadata_hash_mismatch` and never return altered content as verified. List exposes only
published, still-verifying rows and reports how many it skipped.

### Turso / Vercel check (M3 task 1)

Verified 2026-11-07: free plan still exists (100 databases, 5 GB, 500M rows read, 10M rows
written, 3 GB sync/month; idle free databases archived after 10 days). Vercel Marketplace
injects `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` and recommends `@libsql/client`; Turso docs
also offer `@tursodatabase/serverless` for fetch-only runtimes. Chosen: `@libsql/client`,
whose adapter is already implemented and tested. Sources and caveats: `docs/METADATA.md` §5.
No database was created.

### Observed verification output (single run, `bash scripts/verify-local.sh`, exit 0)

```text
== 1/5 contract format ==
fmt: clean
== 2/5 contract tests ==
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.66s
(no compiler warnings)
== 3/5 ticket-commitment parity ==
8/8 vectors matched
== 4/5 event-metadata tests ==
tests 23 | pass 23 | fail 0 | skipped 0
== 5/5 deploy handover (print-only) ==
size:     410817 bytes
sha256:   359fef6fd7b6e158e595d6a8c566d880229ae070608c34792ed776bf46c95db0
code stake:  4.10817 NEAR  (410817 bytes x 10^19 yoctoNEAR/byte)
all 16 required methods present; init args match (treasury, network_id)
Nothing was deployed and no account was touched.
ALL LOCAL CHECKS PASSED
```

Sample metadata tool run: `metadata_sha256`
`04862e35be299a1e24435be68b79ab8571b4dbf5a2cbd827cc8d9279b8613027` for the demo document
(the digest changes with `created_at`, as expected).

### Decisions

- `event_id` is excluded from the canonical document: the contract assigns it inside
  `create_event`, which must already carry the hash. Binding comes from the row key plus the
  create transaction hash; contract terms are never duplicated into metadata.
- Metadata hashing lives in a browser-safe module because M4 must hash before signing; the
  database store stays server-only.
- Partial failure follows MASTERPLAN §9.5: hash, submit `create_event`, then idempotent save
  with a user-triggered retry; a DB failure cannot create a second event or touch escrow.

### Remaining human gate (exact next commands)

1. Create the Turso database only after approval, then apply the migration:

```bash
turso db create gatherbond-metadata
turso db show gatherbond-metadata --url          # -> TURSO_DATABASE_URL
turso db tokens create gatherbond-metadata      # -> TURSO_AUTH_TOKEN (server-side only)
turso db shell gatherbond-metadata < database/migrations/0001_event_metadata.sql
```

2. M1 testnet acceptance is still the deploy gate:

```bash
bash scripts/deploy-contract.sh                 # prints the exact deploy command
# then follow docs/DEPLOY_RUNBOOK.md §4 and record hashes/balances here
```

### Files added

`server/metadata/{canonical,store,handlers,schema,sqlite,libsql}.mjs`,
`server/metadata/test/{canonical,store,handlers}.test.mjs`,
`database/migrations/0001_event_metadata.sql`, `docs/METADATA.md`,
`docs/metadata-vectors.json`, `scripts/generate_metadata_vectors.py`,
`scripts/metadata-tool.mjs`, `scripts/verify-local.sh`; updated `docs/DEPLOY_RUNBOOK.md`,
`README.md`, `BUILD_LOG.md`.

## 2026-11-07 (session 4) — M4 server shell: metadata API over Next.js route handlers

**Status:** the metadata layer is reachable over HTTP through Next.js App Router route
handlers, locally proven. No UI screens, no deploy, no signatures, no funds; the contract
and its accounting rules were not modified.

### What changed

- Next.js 16.4.5 app scaffold in `frontend/` (`package.json`, `next.config.mjs`). Installed
  `next`, `react`, `react-dom` and `@libsql/client` (lockfile present at
  `frontend/package-lock.json`).
  `next.config.mjs` points Turbopack's root and output tracing at the workspace root so
  the route handlers can import the server modules kept at the repo root.
- `server/http/routes.mjs`: Web `Request`/`Response` route factory. The event id comes from
  the URL; network/contract identity comes from server configuration, never from the body.
- `server/metadata/runtime.mjs`: dependency-injected runtime. Store selection:
  `TURSO_DATABASE_URL`+`TURSO_AUTH_TOKEN` → Turso/libSQL; `METADATA_SQLITE_PATH` → local
  SQLite; neither → `unavailable`, and every metadata route answers 503 while escrow stays
  usable. `getOnChainEvent` reads `get_event` through the read-only JSON-RPC client in
  `server/near/rpc.mjs` (no keys, no writes).
- `server/http/nextRuntime.mjs`: lazily caches the runtime and resolves `@libsql/client`
  from the app manifest at call time, because the package lives in `frontend/` while the
  metadata layer lives at the repo root.
- `frontend/app/api/events/route.js` and `frontend/app/api/events/[id]/metadata/route.js`:
  thin handlers (`runtime = "nodejs"`, `dynamic = "force-dynamic"`).
- `server/metadata/handlers.mjs`: `authorize` now receives the validated metadata document
  so the runtime binds the actor to `organizer_account_id`; authentication (401) is still
  checked first. The existing 23 metadata tests were not changed.
- `server/http/test/{routes,nextRoutes,runtime}.test.mjs`, `server/near/test/rpc.test.mjs`:
  request-level tests, including the four actual Next route modules invoked with Web
  `Request` objects.
- `.env.example` documented `METADATA_SQLITE_PATH`, `NEAR_RPC_URL`, `CONTRACT_NAME` and the
  development-only `GATHERBOND_ALLOW_DEV_ACTOR`; `scripts/verify-local.sh` now runs the
  metadata, HTTP and RPC tests in its single step 4.

### Ambiguity decisions

- **Next app stays in `frontend/`** per MASTERPLAN §11 while the shared server layer stays
  at the repo root. Turbopack root + output tracing point at the workspace, and the libSQL
  loader resolves lazily from the app manifest. This avoids duplicating the metadata
  modules or moving M3 code.
- **No startup migration against Turso.** Local SQLite auto-applies the migration for
  dev/tests; production applies `database/migrations/0001_event_metadata.sql` explicitly.
  Running DDL on every serverless cold start is not desirable.
- **No real auth yet.** Until wallet/session auth arrives with the UI, the only actor
  source is the development-only header mode; production writes return 401, which is the
  honest fail-closed behaviour rather than a fake organizer identity.
- **Route keys are server-derived** (`network_id`/`contract_id` from env) so a client
  cannot post metadata against a different contract identity.

### Observed verification

```text
node --test (metadata + http + near)   tests 47 | pass 47 | fail 0
npx next build                          exit 0; compiled successfully
  routes: /api/events (dynamic), /api/events/[id]/metadata (dynamic), /_not-found
live next start -p 3105, no credentials:
  GET /api/events               -> 503 {"error":"metadata_store_unavailable"} (no-store)
  GET /api/events/0/metadata    -> 503 {"error":"metadata_store_unavailable"} (no-store)
  PUT /api/events/0/metadata    -> 401 {"error":"unauthorized"} (no-store)

bash scripts/verify-local.sh    exit 0
  fmt: clean
  cargo test: 37 passed; 0 failed; 0 ignored; 0 warnings
  ticket-commitment parity: 8/8 vectors matched
  metadata + HTTP + RPC tests: 47 passed; 0 failed
  deploy handover: exit 0; 16 methods verified; size 410817 bytes;
    sha256 359fef6fd7b6e158e595d6a8c566d880229ae070608c34792ed776bf46c95db0;
    code stake 4.10817 NEAR; nothing deployed
  ALL LOCAL CHECKS PASSED
```

No previously passing test was removed or weakened: 37 contract and 23 metadata tests are
unchanged, and 24 new Node tests were added (9 route, 4 Next-route, 7 runtime, 4 RPC).

### Remaining human gate (exact commands)

1. Turso database creation and migration (needs approval + credentials):

```bash
turso db create gatherbond-metadata
turso db show gatherbond-metadata --url          # -> TURSO_DATABASE_URL
turso db tokens create gatherbond-metadata      # -> TURSO_AUTH_TOKEN (server-side only)
turso db shell gatherbond-metadata < database/migrations/0001_event_metadata.sql
```

2. M1 testnet deploy and acceptance (unchanged):

```bash
bash scripts/deploy-contract.sh                 # prints the exact deploy command
# then docs/DEPLOY_RUNBOOK.md §4
```

### Next

M4 UI work: wallet/session auth (replacing the dev actor seam), rate limiting, then the
Discover / Create Event / My Commitments screens consuming these endpoints. No UI was
started in this session.

## 2026-11-07 (session 5) — M4 metadata API proven end to end over real HTTP

**Status:** the metadata endpoints are driven by the real Next app on a loopback port with
the real local SQLite store and the real read-only RPC seam. No production code change was
needed: the full lifecycle passed against the existing server on its first run. No UI,
deploy, signature or spend.

### What changed

- `server/http/test/e2eHttp.test.mjs`: builds and starts the Next app (`next build`, then
  `next start -p <free port>`) with `METADATA_SQLITE_PATH` pointing at a temporary SQLite
  file, `CONTRACT_NAME`/`NEAR_NETWORK_ID` set and `GATHERBOND_ALLOW_DEV_ACTOR=1`. A local
  JSON-RPC server answers the same `query`/`call_function` shape as NEAR and serves
  `get_event` state, so the running server hashes metadata and reads the on-chain value
  through `server/near/rpc.mjs` for real (no handler or store fakes).
- The test drives, over `fetch`: organizer PUT 201; identical repeat PUT 200 `unchanged`
  with exactly one row; 401 unauthenticated; 403 wrong actor; 404 unknown event id; 409
  on-chain hash mismatch with zero rows stored; GET 200 returning the document; publication
  then listing returning only the published event (unpublished draft absent); direct SQLite
  tampering followed by GET 409 `metadata_hash_mismatch`; shutdown with no listener left.
- `scripts/verify-local.sh`: step 4 label reflects the live end-to-end case (the existing
  `server/http/test/*.test.mjs` glob already includes it).
- `docs/METADATA.md`: records the automated end-to-end check.

### Observed outputs

```text
node --test server/http/test/e2eHttp.test.mjs   exit 0; 1 passed; 0 failed (4.7s)

bash scripts/verify-local.sh                    exit 0
  fmt: clean
  cargo test: 37 passed; 0 failed; 0 ignored; 0 warnings
  ticket-commitment parity: 8/8 vectors matched
  metadata + HTTP tests: 48 passed; 0 failed
  deploy handover: exit 0; 16 methods verified; size 410817 bytes;
    sha256 359fef6fd7b6e158e595d6a8c566d880229ae070608c34792ed776bf46c95db0;
    code stake 4.10817 NEAR; nothing deployed
  ALL LOCAL CHECKS PASSED
```

Tree cleanliness after the run: no listener on the former test port, no `next start`
process, no `*.sqlite`/`*.db` files in the repository, and `git status` contains only the
expected tracked edits (`BUILD_LOG.md`, `README.md`) and untracked project directories.
Only the two API route files exist under `frontend/app`; the framework's `/_not-found` is
the only non-API route. `frontend/.next` is the standard build output and is gitignored.

### Decisions

- The on-chain seam is a local JSON-RPC server rather than a deployed contract because the
  human deploy gate is still closed; it implements the exact `query`/`call_function`
  response the production reader parses, so the real route/RPC path is exercised.
- The end-to-end test builds Next itself and picks a free port, keeping
  `verify-local.sh` as the only entry point. The SQLite file lives in the OS temp directory
  and is deleted, so no local database pollutes the repository.
- No test was weakened or replaced: 37 contract, 23 metadata and 24 route/runtime/RPC tests
  are unchanged, plus 1 new end-to-end test (48 Node tests total).

### Remaining human gate (unchanged, exact commands)

1. Turso database creation and migration:

```bash
turso db create gatherbond-metadata
turso db show gatherbond-metadata --url          # -> TURSO_DATABASE_URL
turso db tokens create gatherbond-metadata      # -> TURSO_AUTH_TOKEN (server-side only)
turso db shell gatherbond-metadata < database/migrations/0001_event_metadata.sql
```

2. M1 testnet deploy and acceptance:

```bash
bash scripts/deploy-contract.sh                 # prints the exact deploy command
# then docs/DEPLOY_RUNBOOK.md §4
```

### Next

M4 UI: wallet/session auth to replace the dev actor header, rate limiting, then the
Discover / Create Event / My Commitments screens. No UI was started.

## 2026-11-07 (session 6) — NEP-413 wallet sessions replace the dev actor seam

**Status:** organizer writes now authenticate with a NEP-413 signed message exchanged for an
HttpOnly session cookie; the actor is derived from the verified session. The dev header is
ignored unless `GATHERBOND_ALLOW_DEV_ACTOR=1`. No UI, no deploy, no on-chain signature, no
spend and no contract change.

### What changed

- `server/auth/nep413.mjs` + `base58.mjs`: NEP-413 payload as
  `sha256(u32le(2147484061) || borsh({message, nonce[32], recipient, callbackUrl?}))`,
  matching the spec and `near-api-js` `signNep413Message`. Ed25519 only; `secp256k1:` keys
  are rejected with `400 invalid_public_key` rather than silently accepted.
- `server/auth/login.mjs`: validates the body, enforces the configured recipient, verifies
  the signature, confirms the key belongs to the account via `view_access_key` (read-only
  `query` in `server/near/rpc.mjs`), requires `FullAccess`, then claims the nonce.
- `server/auth/nonceStore.mjs`: single-use nonce table scoped by account, persisted in the
  same SQLite/libSQL database. The table is created with `IF NOT EXISTS`, so the existing
  Turso migration command did not change.
- `server/auth/session.mjs`: HMAC-SHA256 stateless token (`v1.payload.signature`), expiry,
  HttpOnly/SameSite=Lax cookie, constant-time signature comparison, 32-character minimum
  secret. Missing secret disables login (503) and leaves writes at 401.
- `server/auth/routes.mjs` + `frontend/app/api/auth/session/route.js`:
  `POST /api/auth/session` (login), `GET` (who am I), `DELETE` (logout).
- `server/metadata/runtime.mjs`: actor precedence is verified session, then the dev header
  only when explicitly enabled; auth routes are built from the same store/RPC selection.
- `scripts/verify-local.sh`: step 4 now includes `server/auth/test/*.test.mjs`.
- `.env.example`, `docs/METADATA.md`, `README.md`: session variables and the new trust path.

### Defect found and fixed during the session

The first live run showed an expired session still authorizing a PUT (200 instead of 401).
`verifySessionToken` returns the subject for logging even when expired, and
`readSessionCookie` passed that through as the actor. It now exposes `accountId` only for a
valid token; the e2e re-run observed the expected 401 and no row change. No test was
weakened — the e2e caught the bug before any assertion was adjusted.

### Observed outputs

```text
node --test server/auth/test/*.test.mjs                         17 passed; 0 failed
node --test server/http/test/e2eHttp.test.mjs                    1 passed; 0 failed (5.2s)
bash scripts/verify-local.sh                                     exit 0
  fmt: clean
  cargo test: 37 passed; 0 failed; 0 ignored; 0 warnings
  ticket-commitment parity: 8/8 vectors matched
  metadata + auth + HTTP tests: 69 passed; 0 failed
  deploy handover: exit 0; 16 methods verified; size 410817 bytes;
    sha256 359fef6fd7b6e158e595d6a8c566d880229ae070608c34792ed776bf46c95db0;
    code stake 4.10817 NEAR; nothing deployed
  ALL LOCAL CHECKS PASSED
```

Live statuses observed against the running Next app and the real SQLite file: login 200;
forged signature 401; replayed nonce 400 `nonce_already_used`; wrong recipient 400;
function-call key 403; session-authenticated PUT 201 and repeat PUT 200 `unchanged`; bare
dev header with the flag off 401; expired cookie 401 (`session_expired` on whoami);
valid session for another account 403; unknown event 404; on-chain hash mismatch 409 with
zero rows; GET 200; published-only listing; tampered row 409; dev header enabled 201.

### Decisions

- The account id is not part of the NEP-413 signed bytes (the standard binds the account
  through key ownership), so the server does not pretend it is. `view_access_key` is the
  binding check, and only `FullAccess` keys may sign in.
- Sessions are stateless HMAC cookies; nonce replay is the only stateful part. The nonce
  store uses the existing database rather than memory so a replay is rejected after a
  restart and across instances.
- Reads remain public. The session is required for writes, which is where organizer
  identity matters; making GET detail private would break public event discovery and the
  preserved GET tests.
- The dev header remains, but only behind `GATHERBOND_ALLOW_DEV_ACTOR=1`, and the live test
  proves it is refused without that flag.
- No test was weakened, skipped or deleted: all 48 prior Node test cases still run, and
  the live e2e keeps every lifecycle assertion while switching its actor source from the
  dev header to a signed session. 21 new auth tests were added (17 unit + 3 route-handler +
  1 Next-route).

### Remaining human gate (unchanged, exact commands)

1. Turso database creation and migration:

```bash
turso db create gatherbond-metadata
turso db show gatherbond-metadata --url          # -> TURSO_DATABASE_URL
turso db tokens create gatherbond-metadata      # -> TURSO_AUTH_TOKEN (server-side only)
turso db shell gatherbond-metadata < database/migrations/0001_event_metadata.sql
```

2. M1 testnet deploy and acceptance:

```bash
bash scripts/deploy-contract.sh                 # prints the exact deploy command
# then docs/DEPLOY_RUNBOOK.md §4
```

### Next

Rate limiting, the publication workflow, then the Discover / Create Event / My Commitments
screens. No UI was started.

## 2026-11-07 (session 7) — rate limits on login and organizer writes

**Status:** login attempts (per client and per account) and authenticated metadata writes
(per actor) are throttled with a process-local fixed-window limiter. Over-limit requests
return `429` with `Retry-After` before signature verification, the `view_access_key` RPC,
the nonce claim or the write handler. Failed signatures, replays and wrong-actor attempts
count toward the limit. No UI, deploy, on-chain signature, spend or contract change.

### What changed

- `server/http/rateLimit.mjs`: fixed-window limiter, explicit config, `clientKey`
  (`X-Forwarded-For` first hop, then `X-Real-IP`, then a shared local bucket), and the
  shared `429 { error: "rate_limited", retry_after_seconds }` + `Retry-After` response.
  New keys fail closed at the 10k-key cap instead of evicting an active limit.
- `server/auth/routes.mjs`: client check runs before the body is parsed; the account check
  runs before signature verification. Throttled attempts therefore issue no cookie, make
  no RPC call and claim no nonce.
- `server/http/routes.mjs`: authenticated writes call the limiter after actor derivation
  and before `handlers.put`, so a throttled write never touches the chain or store. The
  dev-header actor uses the same per-actor write limit.
- `server/metadata/runtime.mjs`: builds the limiters from the explicit config and passes
  them to the auth and metadata routes.
- `.env.example`, `docs/METADATA.md`: limits, defaults and the multi-instance limitation.
- New tests: `server/http/test/rateLimit.test.mjs`,
  `server/http/test/writeRateLimit.test.mjs`, `server/auth/test/loginRateLimit.test.mjs`.
  The live e2e now also proves login and write throttling against the real Next app.

### Limiter state and its limitation

The store is a per-process `Map` of fixed windows. It opens no dependency, service or
network write and survives no restart. **It is not distributed:** multiple Next
instances/serverless replicas each enforce their own counters, so the effective aggregate
limit can be N x the configured value. A shared limiter needs a stateful service (or
Turso writes per attempt) and is intentionally deferred. Limits are safe by default
(10 login attempts per client and per account per 60s; 30 writes per actor per 60s) and
only invalid config falls back; disabling requires the explicit
`GATHERBOND_RATE_LIMIT_DISABLED=1` (local tests only).

### Observed outputs

```text
node --test server/http/test/rateLimit.test.mjs
node --test server/http/test/writeRateLimit.test.mjs
node --test server/auth/test/loginRateLimit.test.mjs
  12 passed; 0 failed total

node --test server/http/test/e2eHttp.test.mjs   1 passed; 0 failed (11.0s)
bash scripts/verify-local.sh                    exit 0
  fmt: clean
  cargo test: 37 passed; 0 failed; 0 ignored; 0 warnings
  ticket-commitment parity: 8/8 vectors matched
  metadata + auth + HTTP tests: 81 passed; 0 failed
  deploy handover: exit 0; 16 methods verified; size 410817 bytes;
    sha256 359fef6fd7b6e158e595d6a8c566d880229ae070608c34792ed776bf46c95db0;
    code stake 4.10817 NEAR; nothing deployed
  ALL LOCAL CHECKS PASSED
```

Live statuses observed (test overrides: login 6 per client / 20 per account per 2s, writes
5 per actor per 3s, dev server writes 1): six forged logins returned `401`, the seventh
valid attempt returned `429` with `Retry-After`, **no `Set-Cookie`**, no additional
`view_access_key` call and no nonce row; after the window the same signed body returned
`200`. The sixth organizer write returned `429` and left the row unchanged; after the
window the identical PUT returned `200 unchanged`. The dev-header server accepted the
first write (`201`) and throttled the second (`429`). The normal signed-session lifecycle
still returned PUT `201`, repeat `200 unchanged`, GET `200` and the published-only listing.

### Decisions

- Process-local state was chosen over a new service or per-request database writes: no
  dependency, no network write, and the existing tests stay hermetic. The cost is that
  throttling is per instance, stated above rather than implied to be distributed.
- Login is checked before parsing the body, so even malformed attempts count; the account
  bucket is applied once an account id is present, closing the spoofable-IP gap.
- Writes are limited only when an actor exists. Unauthenticated writes remain the existing
  free `401`; this matches "per authenticated account" and avoids charging anonymous
  probes to a shared bucket.
- No existing assertion was removed, skipped or weakened: all 69 prior Node cases still
  pass, and the live e2e retains every lifecycle/rejection assertion while gaining throttle
  coverage. 12 new limiter tests were added; 37 contract tests and 8/8 parity vectors are
  unchanged.

### Remaining human gate (unchanged, exact commands)

1. Turso database creation and migration:

```bash
turso db create gatherbond-metadata
turso db show gatherbond-metadata --url          # -> TURSO_DATABASE_URL
turso db tokens create gatherbond-metadata      # -> TURSO_AUTH_TOKEN (server-side only)
turso db shell gatherbond-metadata < database/migrations/0001_event_metadata.sql
```

2. M1 testnet deploy and acceptance:

```bash
bash scripts/deploy-contract.sh                 # prints the exact deploy command
# then docs/DEPLOY_RUNBOOK.md §4
```

### Next

The Discover / Create Event / My Commitments screens. No UI was started.

## 2026-11-08 (session 8) — versioned organizer publication workflow

**Status:** publishing and unpublishing are explicit organizer operations backed by an
append-only publication log. Versions are monotonic, an identical republish is a no-op,
unpublish appends a tombstone, and only the latest published version is publicly readable.
All publish/unpublish calls use the existing per-actor write limiter. No UI, deploy,
on-chain signature, spend or contract change.

### Design and migration

- New table `event_publications` in
  `database/migrations/0001_event_metadata.sql`: primary key
  `(network_id, contract_id, event_id, version)`, `action` in
  `publish | unpublish`, immutable `metadata_json`/`metadata_sha256`/`create_tx_hash` for
  publish rows, `published_by`, and `published_at`.
- The highest version is current. A publish appends a snapshot; an unpublish appends a
  tombstone. The public list and snapshot read require the highest row to be a `publish`,
  so drafts, tombstones and every older version are excluded by construction.
- One INSERT is the whole transition. A failed insert leaves no row and no public state; a
  unique-key race retries after re-reading the latest version, or reports it unchanged.
- The table was added to the existing bootstrap migration rather than a second migration
  **because no Turso database exists yet**. This keeps the human gate's single migration
  command exactly as written. Local SQLite applies the same file.
- `POST /api/events/:id/publication` verifies the stored draft locally and against the
  on-chain `metadata_hash`, then publishes. It returns `201` on a new version and `200
  unchanged` with the existing version for identical content. `DELETE` appends the
  tombstone and returns `200` with the new version. `GET .../publication` is public and
  returns the current verified snapshot, or `404 not_published`.
- The pre-existing `GET .../metadata` keeps its draft/verification behavior and all of its
  tests; public event pages and discovery use the publication snapshot and listing, which
  never select drafts or superseded versions.
- Publication routes use the same `rateLimitWrite` call as PUT, after actor derivation and
  before the handler. There is no separate or disabled bypass.

### Observed outputs

```text
node --test server/http/test/e2eHttp.test.mjs   1 passed; 0 failed (13.2s)
bash scripts/verify-local.sh                    exit 0
  fmt: clean
  cargo test: 37 passed; 0 failed; 0 ignored; 0 warnings
  ticket-commitment parity: 8/8 vectors matched
  metadata + auth + publication + HTTP tests: 87 passed; 0 failed
  deploy handover: exit 0; 16 methods verified; size 410817 bytes;
    sha256 359fef6fd7b6e158e595d6a8c566d880229ae070608c34792ed776bf46c95db0;
    code stake 4.10817 NEAR; nothing deployed
  ALL LOCAL CHECKS PASSED
```

Live statuses against the real Next app and a temporary SQLite file: publish event 0
returned `201` version `1`; the identical republish returned `200 unchanged` version `1`;
publishing draft event 2 returned `201` version `1`; unpublish event 0 returned `200`
version `2` and removed it from the listing and snapshot read (`404`); republish after
unpublish returned `201` version `3`. The publication history was exactly
`1 publish, 2 unpublish, 3 publish`; the listing only ever showed the latest publish.
Cross-account publish and unpublish both returned `403 forbidden` and left version `3`
intact. Five writes filled the test window and the next publish returned `429` with
`Retry-After`; the stored version remained `3`. Tampering with the draft then produced
`GET .../metadata` `409` and a listing with `skipped: 1`, while `GET .../publication`
continued to serve the immutable published snapshot.

### Decisions

- Publication gets its own append-only history instead of mutating
  `event_metadata.publication_status`. This makes version monotonicity, auditability and
  crash atomicity explicit; the old status setter now delegates to the same publish /
  unpublish path, so no caller can bypass versioning.
- The listing still verifies the current draft bytes. If an operator edits the draft row in
  place, the latest published version is withheld and counted in `skipped` rather than
  serving altered bytes; the immutable snapshot remains available through the publication
  route.
- No new environment variable was needed. Publication writes inherit the existing
  `GATHERBOND_WRITE_RATE_LIMIT` / `GATHERBOND_WRITE_RATE_WINDOW_SECONDS` limit and its
  safe defaults, and `.env.example` now says so explicitly.
- No existing assertion was removed or weakened. 81 prior Node cases still pass, plus six
  new publication/limiter cases (three store, two handler, one route); the live e2e keeps
  the prior session/write/login assertions and adds the publication lifecycle. 37 contract
  tests and 8/8 parity vectors are unchanged.

### Remaining human gate (unchanged, exact commands)

1. Turso database creation and migration:

```bash
turso db create gatherbond-metadata
turso db show gatherbond-metadata --url          # -> TURSO_DATABASE_URL
turso db tokens create gatherbond-metadata      # -> TURSO_AUTH_TOKEN (server-side only)
turso db shell gatherbond-metadata < database/migrations/0001_event_metadata.sql
```

2. M1 testnet deploy and acceptance:

```bash
bash scripts/deploy-contract.sh                 # prints the exact deploy command
# then docs/DEPLOY_RUNBOOK.md §4
```

### Next

The Discover / Create Event / My Commitments screens, consuming the publication snapshot
for public event detail. No UI was started.

## 2026-11-08 (session 9) — event passport, editorial UI, and live Turso read path

**Status:** the public event passport and the editorial UI are implemented. Turso is
live and migrated; discovery now exercises the real published-only read path (currently an
empty shelf, so the UI shows clearly labeled sample events). No contract or frontend was
deployed, no wallet was connected, and no on-chain event exists.

### What changed

- Added `GET /api/events/:id` in `server/metadata/handlers.mjs` and
  `server/http/routes.mjs`, with a thin Next wrapper in
  `frontend/app/api/events/[id]/route.js`. It returns the verified publication plus the
  read-only `onchain` EventView (deposit, capacity, registrations, schedule, status);
  drafts, tombstones and mismatched hashes remain unavailable.
- Added the event-passport UI and the shared editorial system: cream paper, ink, lime,
  oversized serif display type, ticket-stub cards, poster geometry and restrained CSS
  motion. Pages: Discover (`/`), event passport (`/events/[id]`), organizer studio
  (`/studio`) and My Commitments (`/commitments`).
- The empty shelf uses four labeled sample events. They have no balances, transaction
  hashes, deposits or check-ins. Live discovery remains empty until a verified publication
  is written to Turso.
- Applied `database/migrations/0001_event_metadata.sql` to the user's Turso database. Both
  `event_metadata` and `event_publications` exist; the publication table had zero rows when
  checked. Credentials remain only in git-ignored `frontend/.env.local`.
- Fixed the server-only libSQL loader after Next dev reported `libsql_unavailable`: it now
  requires the package's CJS export from either the app directory or the workspace root.
  The same code answers 200 with the real Turso database after the fix.
- Added a safe warning when the runtime selects the unavailable store; it logs only a
  reason code such as `no_database_configured`, never a URL, token or secret.
- Isolated the live HTTP e2e test from the developer's `.env.local` by explicitly clearing
  `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` in the child process, so the test always uses
  its temporary SQLite file.

### Verified outputs

```text
npm run build (frontend)                         exit 0
  /, /_not-found, /commitments, /studio          static
  /api/auth/session, /api/events, /api/events/[id],
  /api/events/[id]/metadata, /api/events/[id]/publication,
  /events/[id]                                    dynamic

bash scripts/verify-local.sh                     exit 0
  contract format: clean
  contract tests: 37 passed; 0 failed; 0 warnings
  ticket-commitment parity: 8/8 vectors matched
  metadata + auth + publication + HTTP tests: 89 passed; 0 failed
  deploy handover: 16 methods; size 410817 bytes;
    sha256 359fef6fd7b6e158e595d6a8c566d880229ae070608c34792ed776bf46c95db0;
    code stake 4.10817 NEAR; nothing deployed
  ALL LOCAL CHECKS PASSED
```

Live checks against the running Next app: `/api/events?limit=3` returned
`{"items":[],"skipped":0,"next_offset":0}` from Turso; the public sample passport rendered
at 431px with no horizontal overflow; the Food filter reduced the shelf to one event
("Sunday Table"); desktop captures showed the hero, passport, commitments and studio
layouts. No browser console errors were observed.

### Decisions and limitations

- The chosen visual direction is the cream/ink/lime editorial event-poster system, not the
  earlier MASTERPLAN suggestion of deep charcoal/electric violet. This was selected in the
  conversation and is now implemented consistently across the screens.
- Sample content is always labeled. The UI never invents a balance, transaction hash,
  ticket, check-in or published event.
- The organizer studio is wired to the real verify/publish/unpublish routes, but the UI has
  no wallet connector yet; publish attempts without a verified NEP-413 session fail closed
  with 401, and the screen says so.
- The event passport is public and reads contract terms only when `onchain` is returned.
  With no contract configured, the detail route fails closed rather than guessing.
- No contract deployment, funded account, signature, spend or external write was performed.

### Remaining human gate (unchanged)

1. Deploy the contract to NEAR Testnet with a funded account after reviewing
   `docs/DEPLOY_RUNBOOK.md`.
2. Create the first real event and publish its verified metadata.
3. Connect a wallet for registration, ticket display, check-in and claims.
4. Deploy the Next frontend and verify the live auth/callback origin.

### Next

Wire wallet connect and the attendee registration/ticket path; then create one real
testnet event so discovery can replace the labeled sample shelf with live publications.

## 2026-11-08 (session 10) — real NEAR Connect wallet session in the UI

**Status:** the missing wallet connection was a real gap, not a deployment detail. The UI
now uses a real NEAR Connect flow: connect a Testnet wallet, request a NEP-413 signature,
verify it on the server, and show the account only after the HttpOnly session is issued.
No contract or frontend was deployed, no funded wallet signature or registration was
performed, and no on-chain event exists yet.

### What changed

- Added `@hot-labs/near-connect@0.12.0` (zero-dependency connector, Testnet filtering,
sandboxed wallet execution, `signMessage`, and connect without adding a function-call key).
- Added `frontend/lib/nearWallet.js`: lazy-loads the connector only in the browser, calls
`connect()`, reads the selected account, signs the GatherBond NEP-413 message with a fresh
32-byte nonce, and returns only the login body. It never stores a key or signature.
- Added `frontend/lib/walletLogin.mjs` and tests: exact 32-byte nonce encoding, message
length, public-key normalization, 64-byte signature validation, and the server request
shape.
- Added `WalletProvider` / `WalletButton` and wired the header (desktop + mobile), organizer
studio, event passport and My Commitments page. The studio now signs in/out and gates
publish on the shared verified session instead of a static notice.
- `GET /api/auth/session` now exposes only public `{configured, recipient}` alongside the
session result, so the browser can decide whether to start login and which recipient to
sign for. It never exposes the session secret or Turso token.
- The local `GATHERBOND_SESSION_SECRET` was present but empty/short, so auth was disabled.
A fresh 48-byte secret was written only to the git-ignored `frontend/.env.local`; the value
was never printed or committed. The live endpoint then reported `configured:true`.

### Verified outputs

```text
focused auth/helper/route tests                13 passed; 0 failed
npm run build (frontend)                       exit 0; compiled successfully
bash scripts/verify-local.sh                   exit 0
  contract format: clean
  contract tests: 37 passed; 0 failed
  ticket-commitment parity: 8/8 vectors matched
  metadata + auth + publication + HTTP tests: 94 passed; 0 failed
  deploy handover: all 16 methods present; nothing deployed
  ALL LOCAL CHECKS PASSED
```

Live browser check against `http://localhost:3100`:

- Desktop header rendered `CONNECT WALLET`; clicking it opened the real NEAR Connector
  `Select wallet` dialog. The wallet manifest request returned 200 and the dialog listed
  Meteor Wallet, Intear Wallet, Ledger, Nightly Wallet and NEAR CLI.
- The studio rendered `NO WALLET SESSION`, a Connect wallet button, and the verified-session
  copy; the event passport and commitments page use the same shared control.
- The only console errors were the expected `401` responses from the signed-out
  `GET /api/auth/session` probe.

### Limit of this verification

A real wallet extension and a funded Testnet account are not available in this browser, so
the final signature/login and registration were **not** completed in the UI. The server
NEP-413 path (including real Ed25519 signatures, full-access key lookup, nonce replay and
HttpOnly cookies) is covered by the passing live HTTP e2e test. The connector modal and its
manifest are verified; the wallet approval step is still a human gate.

### Remaining human gate

1. Deploy the contract to NEAR Testnet with a funded account after reviewing
   `docs/DEPLOY_RUNBOOK.md`.
2. Connect a funded Testnet wallet in the running UI and approve the NEP-413 signature.
3. Implement and verify registration/deposit, ticket display, check-in and claims against
   that deployed contract; then create the first real event.
4. Deploy the frontend with the production auth secret and verify the exact callback origin.

### Next

Deploy the contract, complete one funded wallet sign-in and registration, and replace the
labeled sample shelf with the first verified on-chain publication.

## 2026-11-08 (session 11) — Vercel serverless trace fix for Turso

**Status:** the live frontend at <https://gatherbond.vercel.app> accepted a wallet
signature and verified the account's access key, then failed at the nonce write. The
server returned `auth_store_unavailable`, and `GET /api/events` returned
`metadata_store_unavailable`, even with the session secret configured.

### Root cause

The metadata runtime loads `@libsql/client` with a runtime `createRequire` so the shared
server layer stays outside the frontend dependency graph. Next's static file tracer cannot
see that require, and the generated `.nft.json` for the API routes contained **zero**
libSQL files. The local server works because `frontend/node_modules` is present; a Vercel
function can boot without it, so every Turso request fails closed.

### What changed

- `frontend/next.config.mjs` now declares `outputFileTracingIncludes` for `/api/**` with
  the libSQL client, its transitive runtime packages and the platform binding packages.
- No authentication rule, database schema, contract code or test assertion was changed or
  weakened.

### Follow-up: the live bundle still could not load libSQL

The first trace fix was deployed, but the live health endpoint still reported
`libsql_unavailable`. A safe readiness endpoint was added to expose only booleans,
reason codes and a redacted error detail. It identified `MODULE_NOT_FOUND: Cannot find
module 'ws'` from `@libsql/isomorphic-ws`, a dependency of the libSQL client.

Two further fixes were applied:

- The loader now uses `@libsql/client/http`, the pure HTTPS Hrana client. It accepts
  `libsql://` URLs and avoids the native `libsql` binding entirely.
- `outputFileTracingIncludes` now carries `ws` as well as `@libsql/**`, `js-base64` and
  `promise-limit` into the API function bundle.

### Verified outputs

```text
npm run build (frontend)                       exit 0; compiled successfully
/api/events route .nft.json                   333 files; 19 ws files included
live /api/health                               200
  database_mode: turso
  database_read: ok
  auth_configured: true
  contract_configured: true
live /api/events?limit=1                       200 {"items":[],"skipped":0,"next_offset":0}
live /api/auth/session                         401 configured:true recipient:gatherbond.app
```

The live Turso connection is now working. The wallet signature path can reach the nonce
store; a full live wallet approval still needs to be retried with a funded Testnet wallet.

### Remaining human gate

1. Retry the wallet sign-in on the live origin after the deployment finishes.
2. Deploy the contract and complete a funded registration before claiming the event flow
   is end to end.

## 2026-11-10 (session 12) — real lifecycle and live testnet contract

**Status:** the escrow contract is deployed to NEAR Testnet at `cynopom.testnet`, and the
live app now exposes the real create → reserve → ticket → check-in → finalize → claim
flow. The sample shelf and sample ticket were removed. The contract has zero events, so
the first real event is still created by an organizer wallet through the live studio.

### Deployed contract

- Account: `cynopom.testnet`
- Deploy transaction: `2L2FSxqBKwCoAGMwLPRchVNsqBtDTZe8PrW9QQtMgJLD`
- Code hash: `4cL4DwiJTZeANDo2P33VsoCwELwtXwpjaj9DPyh3BeSb`
- Init: `new({ treasury: "cynopom.testnet", network_id: "testnet" })`
- Post-deploy RPC: `get_network_id` returned `testnet`; `get_event_count` returned `"0"`.
- Live `/api/config`: `{"network_id":"testnet","contract_id":"cynopom.testnet","contract_configured":true}`.
- Live `/api/contract/event-count`: `{"count":"0"}`.

### Real application paths

- `frontend/components/create-event.js`: wallet-signed `create_event`, then authenticated
  metadata PUT and publication POST.
- `frontend/components/reserve-panel.js`: wallet-signed `register` with the exact deposit
  and a browser-generated ticket secret; only the commitment is sent on chain.
- `frontend/components/ticket-card.js`: one-time ticket code with copy support.
- `frontend/components/check-in.js`: organizer `check_in`, `finalize_event`, `cancel_event`.
- `frontend/components/commitments.js`: authenticated `/api/me/commitments` reads
  `get_reservations_for_account`, shows claim state, and submits `claim_settlement`.
- `frontend/app/api/config/route.js`, `/api/contract/event-count` and
  `/api/me/commitments`: public config, read-only count and session-bound reservation reads.
- `frontend/lib/nearWallet.js`: real `signAndSendTransaction`, selecting only wallets that
  support signing and requiring the transaction account to match the verified session.
- Discovery no longer falls back to sample events; empty means empty.

### Verified outputs

```text
npm run build (frontend)                       exit 0
routes: /api/config, /api/contract/event-count, /api/me/commitments, /api/events, ...
bash scripts/verify-local.sh                   exit 0
  37 contract tests passed
  8/8 ticket-commitment vectors matched
  94 metadata/auth/HTTP tests passed
  deploy handover: 16 methods; 410817-byte WASM
live /api/health                               database turso, read ok, auth/contract true
live /api/config                               contract cynopom.testnet
live /api/contract/event-count                 count 0
```

### Remaining human gate

1. Connect an organizer wallet on the live site and create the first event.
2. Complete a funded Testnet registration, check-in, finalization and claim.
3. Add QR rendering/scanning and commission a contract audit before any mainnet use.

## 2026-11-10 (session 13) — check-in may open before the event

**Rule change:** check-in is no longer required to start at the event start. It may open any
time at or after `registration_deadline`, including before the event begins, so organizers
can process attendees who arrive early. It must still close after it opens and no later
than `end_at`.

### Contract

- `create_event` now requires: `checkin_open >= registration_deadline`,
  `checkin_open < checkin_close`, and `checkin_close <= end_at`.
- `check_in` continues to require the current chain time to be inside that window.
- Added tests for early check-in creation, rejection before registration closes, and an
  attendee checking in before the event starts.
- Deployed with `without-init-call` to preserve state (there were zero events).
- Deploy transaction: `4PsmakUvRKUgyLfuE28JtyYerXUxDopKx18n3ridoMH9`
- New code hash: `AfLQpJXSMdG2RcUrKu198QHD17Y7bk2fPFtNzDWUH1c8`
- Post-deploy: `get_network_id` = `testnet`; `get_event_count` = `"0"`.

### Verification

```text
bash scripts/verify-local.sh                 exit 0
  40 contract tests passed (including early check-in)
  8/8 ticket-commitment vectors matched
  94 metadata/auth/HTTP tests passed
  WASM: 410850 bytes, sha256 8f8b33632e1d80b1868020e1945c4d69be0c5449c97fe4ad51f17eaeadf26ac5
npm run build --prefix frontend              exit 0
frontend schedule check: early check-in accepted; before registration rejected

## 2026-11-10 (session 14) — standalone product direction and hackathon proof scope

**Status:** Scope locked. Documentation updated before implementation. The three proof
features are in progress and are not claimed as verified until the final test run below.

### Direction changes recorded

- GatherBond is a standalone commitment-first event platform, not a plugin or link inside
  another event product. The event page, deposit, check-in, Flake Fund and show-up proof are
  owned by GatherBond.
- Mission: **Make every yes count.** Vision: **A world where a yes is a promise.**
- Public business model is one plan: **$19/month per organizer**, first event free, no cut of
  refundable deposits and no cut of no-show penalties. Paid ticketing, sponsor pools and
  white-label deals are later sales-led additions, not public tiers.
- Hackathon scope is limited to three features plus a real pilot: Flake Fund preview, public
  recap plus attendee receipt, and organizer proof dashboard. No contract-economics changes.

### Documents updated

- `MASTERPLAN.md`: product direction, non-goals, M9 proof-feature milestone and current actions.
- `README.md`: standalone positioning, one-plan business model and proof increment.
- `BUILD_LOG.md`: this session record.
- `local/HACKATHON_PRIVATE_QNA.md`: private Q&A, demo script and submission checklist, excluded
  through `.git/info/exclude`; never committed.

### Implementation and verified results

Implemented:

- `frontend/lib/flakeFund.js` — pure BigInt settlement math for finalized events, plus an
explicitly labelled projection for open events.
- `frontend/components/flake-fund.js` — event-detail and recap Flake Fund card.
- `frontend/app/events/[id]/recap/page.js` and `frontend/components/event-recap.js` — public
recap for finalized, open, cancelled, missing and unavailable states.
- `frontend/components/settlement-receipt.js` — attendee show-up and cancellation receipts,
wired into `commitments.js`.
- `frontend/components/room-proof.js` — organizer proof panel in `studio.js`.
- `frontend/lib/events.js` — maps reward/refund contract fields.

Verified 2026-11-10:

```text
bash scripts/verify-local.sh                 exit 0 (6/6 steps)
  40 contract tests passed
  8/8 ticket-commitment vectors matched
  10 Flake Fund math tests passed
  94 metadata/auth/HTTP tests passed
  deploy handover: 16 methods; 410850-byte WASM
npm run build --prefix frontend              exit 0
  /events/[id]/recap present
```

Browser verification used a local-only contract-shaped fixture in `local/` (excluded from
Git), not product data:

- finalized recap: 10 registered, 7 showed up, 3 flaked, 3 NEAR pool, 0.4285 NEAR extra,
  remainder shown as `<0.0001 NEAR` instead of `0.0000`;
- open recap: no-shows and show-up rate show `—` with “After finalization”; pool is labelled
  projected;
- cancelled recap: no-shows and show-up rate show `—`; full-refund copy is correct;
- missing event: honest 404 recap state;
- event-detail Flake Fund: finalized actual and open projection both render;
- studio proof panel: finalized actual values render from the same API;
- commitments: claimed show-up receipt (1.4285 NEAR total) and cancelled refund receipt
  (1 NEAR) render; the open reservation renders no receipt;
- 390 px viewport: no horizontal overflow on recap, event detail, studio or commitments.

A real funded testnet pilot is still pending. No fake on-chain event, balance or check-in was
created for the live app; the fixture only ran on loopback for UI verification.

## 2026-11-11 (session 15) — proof edge-condition audit

**Status:** no contract or deployment change. The proof UI and its pure money/display math
were re-audited against the contract's claim rule. A finalized no-show could still see a
claim button even though `claim_settlement` pays that reservation nothing; the button, claim
fact and status label are now consistent with the contract.

### Fixed

- `frontend/components/commitments.js`: only a cancelled reservation or a checked-in
  finalized reservation can claim. Finalized no-shows show `No-show · no refund`, and the
  claim fact says `No refund`; no claim button is rendered.
- `frontend/lib/flakeFund.js`: settlement status now wins over an empty room, so a cancelled
  or finalized event with zero reservations is no longer presented as an open room waiting
  for its first attendee. Show-up-rate formatting is clamped to 0–100%.
- `frontend/components/flake-fund.js`, `event-recap.js` and `room-proof.js`: added honest
  zero-reservation, all-no-show and all-showed-up states. An all-showed-up event no longer
  claims that “the flakes funded the room”; an all-no-show event sends the pool to treasury
  without inventing an attendee reward.
- Cancelled events with zero reservations now say there is nothing to refund and show no
  per-attendee refund value.

### Added tests

- New `frontend/lib/contract.test.mjs`: `parseNear`, `formatNearAmount`, `scheduleError`,
  `defaultSchedule` and `toNanoseconds`, including malformed amounts, over-precision,
  zero/negative values, every invalid schedule ordering and the registration-equals-start
  boundary.
- `frontend/lib/flakeFund.test.mjs`: zero-registration finalized/cancelled events, checked-in
  count clamping, one attendee, all no-shows, projection rounding and bps boundaries,
  invalid/negative rates, unknown status, zero deposit and malformed counters. Total: 30
  Flake Fund + contract tests.
- `scripts/verify-local.sh` step 4 now runs both test files. The local-only fixture in
  `local/` (never committed) was expanded to ten events covering finalized, all-no-show,
  one-attendee, claimable, pending, open, waiting, empty, zero-registration-finalized and
  zero-registration-cancelled states.

### Verified outputs

```text
bash scripts/verify-local.sh                 exit 0 (6/6 steps)
  40 contract tests passed
  8/8 ticket-commitment vectors matched
  30 Flake Fund + contract display/schedule tests passed
  94 metadata/auth/HTTP tests passed
  deploy handover: 16 methods; 410850-byte WASM
npm run build --prefix frontend              exit 0
  /events/[id]/recap present
```

Browser verification used the loopback-only contract-shaped fixture, not product data:

- commitments: seven reservation rows; event 3 (finalized no-show) shows `No-show · no
  refund` and no claim button; event 9 (checked-in, unclaimed) still shows `Claim
  settlement`; event 4 (claim pending) shows no button; cancelled event 2 still claims.
- recaps: finalized all-no-show, single-attendee/all-showed-up, open waiting, open empty,
  finalized zero-reservation and cancelled zero-reservation states all render honest copy;
  show-up rate is `—` when there are no reservations.
- studio proof: finalized actual state; invalid ID (`abc`) and missing ID (`999`) show honest
  empty/missing states rather than guessed data.
- 390 px viewport: no horizontal overflow on recap, event detail, studio or commitments.

A real funded testnet pilot is still pending. No fake on-chain event, balance, check-in or
claim was created for the live app; the fixture only ran on loopback for UI verification.
