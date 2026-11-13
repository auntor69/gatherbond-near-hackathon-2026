# GatherBond — Testnet Deploy & Acceptance Runbook

**Scope:** NEAR Testnet only. No mainnet. No real funds.
**Last verified:** 2026-11-13
**Contract:** `cynopom.testnet`
**Artifact:** 415,893 bytes · SHA-256 `af6b8bbc13c9ec589345a50df62ab73183033d5ad15b71da1deff96e4691da4b`

> The signing key for the live contract is **not in this workspace**. This runbook is for the maintainer who holds it. It prints commands; it does not execute a deploy by itself.

---

## 1. Prerequisites

- Rust toolchain with `wasm32-unknown-unknown`
- `near-cli-rs` 0.31+ with the signing account already imported in the keychain
- Funded Testnet accounts for organizer and attendees
- A Turso database and server credentials for the frontend
- Node.js 22+ for the frontend and verification suite

Never paste a private key, seed phrase or Turso token into chat, a document or a commit.

---

## 2. Build, hash and storage arithmetic

```bash
bash scripts/verify-local.sh
```

The print-only handover at the end builds the release artifact and reports:

```text
artifact: contracts/target/wasm32-unknown-unknown/release/gatherbond_escrow.wasm
size:     415893 bytes
sha256:   af6b8bbc13c9ec589345a50df62ab73183033d5ad15b71da1deff96e4691da4b
methods:  all 17 required methods present
code stake: 4.15893 NEAR
```

Storage arithmetic:

```text
code stake = 415,893 bytes × 10^19 yoctoNEAR/byte = 4.15893 NEAR
state      = measured at runtime; every growth receipt checks the actual delta
buffer     = max(0.001 NEAR, storage_stake / 20)
suggested  = fund the contract account with at least 6 NEAR total
```

`EXPECTED_SHA256` can be set for `scripts/deploy-contract.sh` to fail the build when the artifact hash changes.

---

## 3. Deploy or upgrade

### 3.1 First deploy

```bash
near contract deploy "$CONTRACT_ID" \
  use-file contracts/target/wasm32-unknown-unknown/release/gatherbond_escrow.wasm \
  with-init-call new \
  json-args '{"treasury":"<TREASURY_ACCOUNT>","network_id":"testnet"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-keychain send
```

### 3.2 Upgrade an existing contract

Upgrades preserve state. **Do not call `new` on an upgrade.**

```bash
near contract deploy "$CONTRACT_ID" \
  use-file contracts/target/wasm32-unknown-unknown/release/gatherbond_escrow.wasm \
  without-init-call \
  network-config testnet sign-with-keychain send
```

### 3.3 Verify

```bash
near contract call-function as-read-only "$CONTRACT_ID" get_network_id \
  json-args '{}' network-config testnet now

near contract call-function as-read-only "$CONTRACT_ID" get_event_count \
  json-args '{}' network-config testnet now

near contract call-function as-read-only "$CONTRACT_ID" get_total_liability \
  json-args '{}' network-config testnet now
```

Expected: `testnet`, a count, and a liability consistent with pools. Do not proceed if the init identity is wrong.

---

## 4. Acceptance sequence

This sequence proves the money path, the timing rules and the auto-settlement path. Use three funded Testnet accounts:

```bash
export CONTRACT_ID=cynopom.testnet
export ORGANIZER_ID=<organizer.testnet>
export ALICE=<alice.testnet>
export BOB=<bob.testnet>
export CAROL=<carol.testnet>
```

The examples use a 1 NEAR deposit and capacity 3. Use real UTC nanosecond timestamps. `U64` arguments are JSON **strings**, not numbers.

### 4.1 Create the event

Prepare canonical metadata and compute its SHA-256 with the project's canonicalizer. The contract only accepts a 32-byte hash.

```bash
near contract call-function as-transaction "$CONTRACT_ID" create_event \
  json-args '{
    "deposit":"1000000000000000000000000",
    "capacity":3,
    "start_at":"<START_NS>",
    "end_at":"<END_NS>",
    "registration_deadline":"<REGISTRATION_DEADLINE_NS>",
    "checkin_open":"<CHECKIN_OPEN_NS>",
    "checkin_close":"<CHECKIN_CLOSE_NS>",
    "metadata_hash":[<32 comma-separated bytes>]
  }' \
  prepaid-gas '100 Tgas' attached-deposit '0.05 NEAR' \
  sign-as "$ORGANIZER_ID" network-config testnet sign-with-keychain send
```

Rules enforced by the contract:

```text
now < start_at
start_at < end_at
registration_deadline > now and <= start_at
checkin_open >= registration_deadline
checkin_open < checkin_close
checkin_close <= end_at
```

The attached deposit is a disclosed, non-refundable storage contribution. The contract minimum is 0.01 NEAR; the studio default is 0.1 NEAR.

Record the event ID from the transaction/logs and read it back:

```bash
near contract call-function as-read-only "$CONTRACT_ID" get_event \
  json-args '{"event_id":"0"}' network-config testnet now
```

### 4.2 Register three attendees

Each attendee sends exactly 1 NEAR plus a 32-byte commitment:

```bash
for WHO in "$ALICE" "$BOB" "$CAROL"; do
  near contract call-function as-transaction "$CONTRACT_ID" register \
    json-args '{"event_id":"0","ticket_commitment":[<32 commitment bytes for this attendee>]}' \
    prepaid-gas '100 Tgas' attached-deposit '1 NEAR' \
    sign-as "$WHO" network-config testnet sign-with-keychain send
done
```

Observables:

- `registered: 3`
- one reservation per account
- a wrong deposit, duplicate registration, closed registration or full capacity rejects
- the ticket secret is not on chain

### 4.3 Check in two attendees

The organizer checks in Alice and Bob inside the window. Carol does not check in.

```bash
near contract call-function as-transaction "$CONTRACT_ID" check_in \
  json-args '{"event_id":"0","attendee":"<alice.testnet>","secret":"<alice secret>"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  sign-as "$ORGANIZER_ID" network-config testnet sign-with-keychain send
```

Repeat for Bob. Expected:

- `registered: 3`, `checked_in: 2`
- a second check-in for the same ticket fails
- a wrong secret fails without marking attendance
- a non-organizer call fails
- a check-in outside the window fails

### 4.4 Wait for `end_at`, then claim (settles automatically)

There is **no required finalize step** in the product. The first claim on an ended `Open` event calls `settle_event` and then pays the caller.

Wait until `block_timestamp >= end_at`:

```bash
near contract call-function as-transaction "$CONTRACT_ID" claim_settlement \
  json-args '{"event_id":"0"}' \
  prepaid-gas '150 Tgas' attached-deposit '0 NEAR' \
  sign-as "$ALICE" network-config testnet sign-with-keychain send
```

Expected:

- event status becomes `Finalized`
- `reward_per_attendee = floor(1 NEAR no-show / 2 checked in) = 0.5 NEAR`
- Alice receives 1.5 NEAR (1 NEAR refund + 0.5 NEAR reward), minus fees
- Alice's reservation claim becomes `Claimed` after the callback
- Carol (no-show) cannot claim

Then claim as Bob:

```bash
near contract call-function as-transaction "$CONTRACT_ID" claim_settlement \
  json-args '{"event_id":"0"}' \
  prepaid-gas '150 Tgas' attached-deposit '0 NEAR' \
  sign-as "$BOB" network-config testnet sign-with-keychain send
```

Expected after both callbacks:

```text
get_event(0).status          Finalized
get_event(0).refund_pool     0
get_event(0).reward_pool     0
get_total_liability()        0
get_pending_amount()         0
```

**Optional tooling path:** `finalize_event` remains permissionless and can be called before the first claim. It is not part of the product UI and is not required for users.

### 4.5 Refund path (cancellation)

Create a second event in the future, register Alice, then cancel before start:

```bash
near contract call-function as-transaction "$CONTRACT_ID" cancel_event \
  json-args '{"event_id":"1"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  sign-as "$ORGANIZER_ID" network-config testnet sign-with-keychain send

near contract call-function as-transaction "$CONTRACT_ID" claim_settlement \
  json-args '{"event_id":"1"}' \
  prepaid-gas '150 Tgas' attached-deposit '0 NEAR' \
  sign-as "$ALICE" network-config testnet sign-with-keychain send
```

Expected: status `Cancelled`, full 1 NEAR back to Alice, no pool, no reward.

### 4.6 Failed-floor path

Create a third event, register Alice and Bob, check nobody in, wait for the end, and claim as Alice:

- status becomes `Finalized`
- `refund_pool = 2 NEAR`, `reward_pool = 0`
- Alice and Bob each claim their full 1 NEAR back
- no treasury reward is minted by this path

### 4.7 Ticket recovery path

Before check-in closes, the reservation owner can replace a lost ticket:

```bash
near contract call-function as-transaction "$CONTRACT_ID" rotate_ticket_commitment \
  json-args '{"event_id":"0","ticket_commitment":[<new 32 commitment bytes>]}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  sign-as "$ALICE" network-config testnet sign-with-keychain send
```

The old QR/code is invalid immediately. The deposit, attendance and claim state do not change.

---

## 5. Expected observables

| Check | Expected |
| --- | --- |
| Event creation | ID increments; `Open`; exact terms |
| Registration | exact deposit accepted; capacity respected; deadline enforced |
| Duplicate registration | rejected |
| Check-in | organizer-only, inside window, one-time |
| Rotation | old ticket invalid; no financial change |
| Claim before end | rejected |
| First claim | auto-settles, locks event, pays entitlement |
| Second concurrent claim | lock rejects; no double pay |
| Above-floor settlement | reward = floor(pool / checked-in) |
| Below-floor settlement | everyone refunded; no pool |
| Cancellation | full refunds; no pool |
| Treasury | only rounding remainder; bounded withdrawal |
| Solvency | `get_total_liability` + `get_pending_amount` consistent |

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `WebAssembly trap: unreachable` | Contract `panic = "abort"` hides the message | Re-check the rule order and arguments; the studio validates schedules client-side |
| `U64` argument traps | Numeric ID passed instead of a JSON string | Use `{"event_id":"0"}`, not `{"event_id":0}` |
| `Insufficient prepaid gas` | No callback reserve | Use at least 30 Tgas for claims/treasury; 150 Tgas is the UI default |
| Registration rejected | Wrong deposit, closed deadline, capacity, duplicate or lock | Read `get_event` and `get_reservation` |
| Check-in rejected | Outside window, wrong secret, used ticket, non-organizer | Verify the event and ticket state |
| Claim rejected | Before end, no attendance on a normal room, already claimed, or lock | Read event/reservation state |
| Cancel rejected | Event already started or not organizer | Cancellation is before `start_at` only |
| Deployment hash mismatch | Artifact changed | Rebuild and compare `EXPECTED_SHA256` |
| Upgrade fails | Wrong key/account | Confirm the signer holds the contract account key; never share the key |

---

## 7. Live Testnet record

Verified 2026-11-13:

| Item | Value |
| --- | --- |
| Network | NEAR Testnet |
| Contract | `cynopom.testnet` |
| On-chain event count | **8** |
| Verified public snapshots | **1** |
| Public event | `Sunday Table` (event `0`) |
| Deposit / capacity | 1 NEAR / 20 |
| Registered / checked in | 1 / 0 |
| Current status | `Finalized` |
| Metadata hash | `e0257fe70d537f0ca6e6eb6c2851210833039cb76b6fc740e655f213232d99fc` |
| Create tx | `2xymPbgCGRsEXZMFxYhhmqJFKuXt6x5nTop3TyHBDk5a` |
| Contract artifact | 415,893 bytes · `af6b8bbc13c9ec589345a50df62ab73183033d5ad15b71da1deff96e4691da4b` |

The other seven on-chain events are development/acceptance records with no current verified publication. Discovery intentionally hides them. This is not a data-loss bug.

`/api/health` at verification time:

```json
{
  "database_mode": "turso",
  "database_read": "ok",
  "auth_configured": true,
  "contract_configured": true,
  "contract_id": "cynopom.testnet",
  "network_id": "testnet"
}
```

---

## 8. Frontend release (Vercel)

### 8.1 Build

```bash
npm run build --prefix frontend
```

Latest expected shape: exit `0`, **21 routes**, including:

```text
/                              static, 1m revalidate
/events/[id]                   dynamic server render
/events/[id]/recap             dynamic server render
/events/[id]/opengraph-image   dynamic image
/opengraph-image               static image
/robots.txt                    static
/sitemap.xml                   static, 1h revalidate
/manifest.webmanifest          static
/studio, /commitments          static noindex shells
/api/*                         dynamic Node.js handlers
```

### 8.2 Production environment

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_NEAR_NETWORK_ID` | `testnet` |
| `NEXT_PUBLIC_NEAR_NODE_URL` | `https://rpc.testnet.near.org` |
| `NEXT_PUBLIC_CONTRACT_NAME` | `cynopom.testnet` |
| `NEXT_PUBLIC_SITE_URL` | `https://gatherbond.vercel.app` |
| `CONTRACT_NAME` | `cynopom.testnet` |
| `NEAR_RPC_URL` | `https://rpc.testnet.near.org` |
| `TURSO_DATABASE_URL` | Turso libSQL URL |
| `TURSO_AUTH_TOKEN` | server-only Turso token |
| `GATHERBOND_SESSION_SECRET` | ≥32 random characters |
| `GATHERBOND_AUTH_RECIPIENT` | `gatherbond.app` (must match wallet) |
| `GATHERBOND_SECURE_COOKIES` | `1` |

Never set `GATHERBOND_ALLOW_DEV_ACTOR` or `GATHERBOND_RATE_LIMIT_DISABLED` in production.

### 8.3 Post-deploy checklist

```bash
BASE=https://gatherbond.vercel.app
curl -sS "$BASE/api/health"
curl -sS "$BASE/api/contract/event-count"
curl -sS "$BASE/api/events?limit=10"
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/"
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/events/0"
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/events/999999"
curl -sS "$BASE/robots.txt"
curl -sS "$BASE/sitemap.xml"
curl -sSI "$BASE/events/0/opengraph-image"
```

Expected:

- health: `database_mode: turso`, `database_read: ok`, contract/auth configured
- event count: live chain count
- event list: only verified rows, no fixtures
- home/event: `200`
- missing event: `404`
- robots: `/api/`, `/studio`, `/commitments` disallowed
- sitemap: home + verified event + closed recap, no drafts
- OG: `content-type: image/png`

Then view source on the event page and confirm `<title>`, canonical, `og:image` and `Event` JSON-LD. See [SEO.md](./SEO.md) for the full post-deploy SEO sequence.

### 8.4 Rollback

- Vercel: promote the previous deployment. The metadata schema is additive.
- Contract: upgrades preserve state; there is no automatic rollback. The maintainer holds the key.
- Database: no destructive migration is documented.

---

## 9. Human gate

Before any mainnet consideration:

- [ ] Independent contract audit
- [ ] Multi-account production pilot with two browsers
- [ ] Physical printed QR camera check
- [ ] Shared nonce/rate-limit store for multiple replicas
- [ ] Privacy policy, terms and jurisdiction review
- [ ] Mainnet deployment and incident runbook
- [ ] Real-funds test with a small capped deposit
- [ ] Monitoring/alerting and on-call ownership
- [ ] Legal/trademark clearance for the GatherBond name

Until then, this is a Testnet prototype. No real funds.
