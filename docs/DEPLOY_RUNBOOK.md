# GatherBond — Testnet Deploy & Acceptance Runbook

Status: **contract live on Testnet, frontend live on Vercel, single-account acceptance
passed**. The contract was upgraded without re-running `new`, so existing events are
preserved. The commands below are the handover for a funded testnet account; every write
requires a signature. For shipping the web app, see §9.

Scope: NEAR **testnet only**. There is no mainnet procedure in this project.

- Contract: `contracts/src/lib.rs` (one contract, `gatherbond-escrow`)
- Network: NEAR testnet
- Script that prepares this handover: `scripts/deploy-contract.sh` (prints, never deploys)

---

## 1. Prerequisites

| Item | Detail |
| --- | --- |
| NEAR CLI | near-cli-rs (the `near` binary). Verify with `near --version`. Older `near-cli` uses different flags; this runbook targets near-cli-rs. |
| Contract account | A funded testnet account, e.g. `cynopom.testnet`, with ≥ 5 NEAR (code stake is ~4.15 NEAR; see §2). |
| Treasury account | An account allowed to withdraw accrued treasury (rounding remainders/all-no-show pools). Can be the same as the organizer for the demo, but must be an account you control. |
| Organizer / attendees | Three attendee accounts and one organizer account, each with testnet funds for a 1 NEAR deposit. |
| Toolchain | Rust with `wasm32-unknown-unknown`, plus `AWS_LC_SYS_PREBUILT_NASM=1` and the VS CMake on `PATH` on Windows. `scripts/deploy-contract.sh` sets both. |

Testnet accounts are free; use the NEAR faucet or wallet. Never put a mainnet key in this
project.

CLI argument order matters. With near-cli-rs 0.31 the function-call subcommands are
`prepaid-gas` → `attached-deposit` → `sign-as` → `network-config` → `sign-with-keychain`
→ `send`, and **every** call needs an explicit `attached-deposit`, including `'0 NEAR'`.
The commands in §4 follow that order; the same rule applies to `as-read-only` calls with
`U64` arguments, which must be JSON strings (`{"event_id":"0"}`, not `{"event_id":0}`).

## 2. Build, hash and storage-stake arithmetic

```bash
bash scripts/deploy-contract.sh
```

The script:

1. builds the release WASM (`contracts/target/wasm32-unknown-unknown/release/gatherbond_escrow.wasm`),
2. fails if the artifact is empty, above 4 MiB, or does not match `EXPECTED_SHA256` when set,
3. prints `size` and `sha256`,
4. prints the code storage stake,
5. verifies that every method named in the deploy/acceptance commands still exists in the
   contract source and that the init signature is `(treasury: AccountId, network_id: String)`,
6. prints the deploy command.

Storage arithmetic: NEAR charges `10^19` yoctoNEAR per stored byte, so

```text
code stake (NEAR) = wasm_bytes × 10^19 / 10^24 = wasm_bytes / 100_000
```

With the current artifact (414,933 bytes) that is **4.14933 NEAR**, printed exactly by the
script. On top of that:

- per event: ~0.05 NEAR attached at `create_event` (minimum 0.01 NEAR) covers the event
  record and the first reservations; the contract admits registrations only if the
  measured surplus covers them,
- per reservation: measured at runtime (~0.002 NEAR at current record sizes),
- buffer: `max(0.001 NEAR, 5% of storage stake)` is always kept free.

Fund the contract account with at least code stake + 1 NEAR of state headroom; the script
prints a rounded suggestion.

## 3. Deploy

The script prints the exact command. With the variables set it is:

```bash
near contract deploy "$CONTRACT_ID" \
  use-file contracts/target/wasm32-unknown-unknown/release/gatherbond_escrow.wasm \
  with-init-call new json-args "{\"treasury\":\"$TREASURY_ID\",\"network_id\":\"testnet\"}" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-keychain send
```

`new(treasury, network_id)` stores the treasury recipient and binds the ticket-commitment
domain to the network name. Both values are immutable afterwards.

### 3.1 Upgrade an existing contract

To upgrade a contract that already holds events, do **not** call `new` again. Deploy only
the code; the existing state is preserved:

```bash
near contract deploy "$CONTRACT_ID" \
  use-file contracts/target/wasm32-unknown-unknown/release/gatherbond_escrow.wasm \
  without-init-call network-config testnet \
  sign-with-keychain send
```

Post-deploy checks:

```bash
near contract call-function as-read-only "$CONTRACT_ID" get_network_id \
  json-args '{}' network-config testnet now
near contract call-function as-read-only "$CONTRACT_ID" get_event_count \
  json-args '{}' network-config testnet now
```

Expected: `"testnet"` and `"0"`.

## 4. Acceptance sequence

Set the variables used below:

```bash
export CONTRACT_ID=gatherbond-m2.testnet
export TREASURY_ID=treasury.testnet
export ORGANIZER_ID=organizer.testnet
export ALICE=alice.testnet BOB=bob.testnet CAROL=carol.testnet
```

The demo event is deliberately short: registration closes 2 minutes after creation, the
event starts 3 minutes after creation and ends 7 minutes after creation. Have all three
terminals/keys ready before creating it, or create a new event with larger offsets.

### 4.1 Create the event (organizer)

```bash
TIMES=$(node -e '
const now = BigInt(Math.floor(Date.now() / 1000));
const ns = (d) => String((now + BigInt(d)) * 1000000000n);
console.log(JSON.stringify({ start_at: ns(180), end_at: ns(420),
  registration_deadline: ns(120), checkin_open: ns(120), checkin_close: ns(420) }));
')
META=$(CONTRACT_ID="$CONTRACT_ID" ORGANIZER_ID="$ORGANIZER_ID" node scripts/metadata-tool.mjs demo)
ARGS=$(TIMES="$TIMES" META="$META" node -e '
const times = JSON.parse(process.env.TIMES);
const meta = JSON.parse(process.env.META);
console.log(JSON.stringify({ deposit: "1000000000000000000000000", capacity: 3,
  ...times, metadata_hash: meta.metadata_hash }));
')

near contract call-function as-transaction "$CONTRACT_ID" create_event \
  json-args "$ARGS" prepaid-gas '100 Tgas' attached-deposit '0.05 NEAR' \
  sign-as "$ORGANIZER_ID" network-config testnet sign-with-keychain send
```

Args: `deposit` (U128 string, 1 NEAR), `capacity` (3), five `U64` timestamps in nanoseconds
(strings, because they exceed JavaScript's safe integer range), `metadata_hash` (32 bytes,
computed from the canonical metadata printed by `scripts/metadata-tool.mjs`). The result is
the event id; the sequence assumes `0`. M4 stores the printed canonical JSON off-chain and
verifies it against this hash.

Observable: `get_event(0)` → `status: "Open"`, `deposit: "1000000000000000000000000"`,
`capacity: 3`, `registered: 0`.

### 4.2 Register three attendees (each 1 NEAR)

The commitment must be computed off-chain from the same bytes the contract hashes:

```bash
commitment() {
  NETWORK_ID=testnet CONTRACT_ID="$CONTRACT_ID" EVENT_ID="$1" ATTENDEE="$2" SECRET="$3" \
  node --input-type=module -e '
    import { commitmentArray } from "./frontend/lib/ticketCommitment.mjs";
    const { NETWORK_ID, CONTRACT_ID, EVENT_ID, ATTENDEE, SECRET } = process.env;
    console.log(JSON.stringify(await commitmentArray({ networkId: NETWORK_ID,
      contractId: CONTRACT_ID, eventId: EVENT_ID, attendee: ATTENDEE, secret: SECRET })));
  '
}

ALICE_COMMITMENT="$(commitment 0 "$ALICE" demo-secret-alice)"
BOB_COMMITMENT="$(commitment 0 "$BOB" demo-secret-bob)"
CAROL_COMMITMENT="$(commitment 0 "$CAROL" demo-secret-carol)"
```

For each attendee (`ALICE`, then `BOB`, then `CAROL`), using their own signer and their own
commitment:

```bash
near contract call-function as-transaction "$CONTRACT_ID" register \
  json-args "{\"event_id\":0,\"ticket_commitment\":$ALICE_COMMITMENT}" \
  prepaid-gas '100 Tgas' attached-deposit '1 NEAR' \
  sign-as "$ALICE" network-config testnet sign-with-keychain send
```

The attached deposit must equal the event deposit exactly. Keep the secrets; they are never
stored on chain until check-in.

Observable: `get_reservation(0, "alice.testnet")` → `checked_in: false`, `claim: "None"`;
`get_event(0).registered = 3`.

### 4.3 Check in two attendees (organizer, inside the window)

After `checkin_open` and before `checkin_close`. Check-in may open before the event starts, once registration has closed:

```bash
near contract call-function as-transaction "$CONTRACT_ID" check_in \
  json-args '{"event_id":0,"attendee":"alice.testnet","secret":"demo-secret-alice"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as "$ORGANIZER_ID" \
  network-config testnet sign-with-keychain send
```

If an attendee loses the browser holding their ticket, they can replace the ticket
commitment themselves. The wallet must be the reservation owner, the event must still be
open, the reservation must not already be checked in, and the check-in window must not
have closed. The old QR/code becomes invalid immediately:

```bash
near contract call-function as-transaction "$CONTRACT_ID" rotate_ticket_commitment \
  json-args '{"event_id":0,"ticket_commitment":[<32 commitment bytes>]}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as "$ALICE" \
  network-config testnet sign-with-keychain send
```

Repeat with `bob.testnet` / `demo-secret-bob`. Carol does not check in.

Observables: the reservation shows `checked_in: true`; a second check-in fails; a wrong
secret fails and does not mark attendance.

### 4.4 Finalize (anyone, after `end_at`)

```bash
near contract call-function as-transaction "$CONTRACT_ID" finalize_event \
  json-args '{"event_id":0}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  sign-as "$ALICE" network-config testnet sign-with-keychain send
```

The contract sets `reward_per_attendee = floor(no_show_deposits / checked_in) = 0.5 NEAR`
(Carol's 1 NEAR split between Alice and Bob), `status: "Finalized"`, and `reward_pool = 1
NEAR` for two attendees.

### 4.5 Claim (Alice, then Bob)

```bash
near contract call-function as-transaction "$CONTRACT_ID" claim_settlement \
  json-args '{"event_id":0}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  sign-as "$ALICE" network-config testnet sign-with-keychain send
```

Repeat as `$BOB`.

Expected per attendee: 1 NEAR refund + 0.5 NEAR reward = **1.5 NEAR**. Observables:
`get_reservation(0, alice)` → `claim: "Claimed"`; a second claim fails with
`"Already claimed"` (or the lock error while the first is in flight); Alice's and Bob's
balances each rise by ~1.5 NEAR minus fees; `get_total_liability()` returns to `0` after
both callbacks and `get_pending_amount()` is `0`.

### 4.6 Refund path (cancellation)

Create a second event with `start_at` far enough in the future, register Alice (1 NEAR),
then cancel it as the organizer before `start_at`:

```bash
near contract call-function as-transaction "$CONTRACT_ID" cancel_event \
  json-args '{"event_id":1}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  sign-as "$ORGANIZER_ID" network-config testnet sign-with-keychain send
```

Then claim as Alice:

```bash
near contract call-function as-transaction "$CONTRACT_ID" claim_settlement \
  json-args '{"event_id":1}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  sign-as "$ALICE" network-config testnet sign-with-keychain send
```

Expected: the full 1 NEAR deposit comes back; `get_event(1).status = "Cancelled"`,
`get_reservation(1, alice).claim = "Claimed"`.

Optional treasury check: create a third event, register one attendee, do **not** check
anyone in, finalize it, then `get_treasury_balance()` shows the whole deposit and the
treasury account can call `withdraw_treasury` with `{"amount":"1000000000000000000000000"}`.

## 5. Expected observables summary

| Step | View | Expected |
| --- | --- | --- |
| create | `get_event(0)` | `status Open`, `registered 0`, `capacity 3` |
| register ×3 | `get_event(0)` | `registered 3`, `refund_pool 3 NEAR` |
| check-in ×2 | `get_reservation(0, alice)` | `checked_in true` |
| finalize | `get_event(0)` | `status Finalized`, `reward_per_attendee 0.5 NEAR` |
| claim ×2 | `get_total_liability()` | `0`, `get_pending_amount()` `0` |
| cancel | `get_event(1)` | `status Cancelled`, full refund on claim |

## 6. Troubleshooting

| Message | Cause / fix |
| --- | --- |
| `Event storage contribution` | `create_event` needs ≥ 0.01 NEAR attached; use 0.05 NEAR. |
| `Deposit must match event deposit` | `register` must attach exactly the event's deposit. |
| `Event capacity is full` | Capacity is capped; create a larger event. |
| `Registration deadline has passed` | The 2-minute window closed; create a new event. |
| `Only the event organizer can check in attendees` | Check-in is organizer-authorized in this MVP. |
| `Check-in window is closed` | Must be between `checkin_open` and `checkin_close`. |
| `Settlement in flight for this event` | A claim/withdraw for that event is still pending; retry after the callback. |
| `Reserve too low to cover storage` | Fund the contract account (`fund_reserve` or a plain transfer) and retry. |
| `Invalid ticket commitment` | The secret/attendee/event id does not match the registered commitment; recompute with the command in §4.2. |
| Deploy fails for lack of balance | Fund the account: code stake ≈ 4.15 NEAR plus state headroom. |

Gas: external calls use 100 Tgas in these commands; the contract forwards 15 Tgas to each
payout callback and rejects claims that leave less than 30 Tgas after the call.

## 7. Human gate

Deploying, creating accounts, funding them and signing are **human-only actions**. After the
sequence above succeeds, record in `BUILD_LOG.md`:

- contract account and transaction hashes,
- event id and the `get_event` result,
- claim transaction hashes and resulting balances,
- anything that deviated from this runbook.

The contract remains unaudited; organizer-authorized check-in is a disclosed trust assumption
of this MVP.

## 8. Live Testnet record (2026-11-11)

- `cynopom.testnet` upgraded without re-running `new`: transaction
  `6SaqtVQEgdckYhfRvuNZCfcrVWjEtBBYYTDhhnwQvX6D`; WASM SHA-256
  `8b8817aa9da9f0a0784a9059f59e3c2640c26c9228648b2196a306e78c54e1f0`.
- State survived the upgrade: `get_event_count` remained `1` before and after; event 0
  retained its organizer, deposit, schedule, reservation and `Open` status.
- Acceptance event 2: create `39mgXRTJkqErk4ZFp8ypY8BgpbV9FhKXkRY7Qs45scrY`, register
  `99DPJNqP9tUvCtT3hVAniHM6FFoyLD8HrbCXypH8Hoar`, rotate
  `DnA5ikVu6iPko34zQ9o4hAFQwLAiRty5KwN3Z9aRLxQw`; the old-secret check-in failed
  (`8iNhvtG3tBgQF4SPyq9eDkHmCJeXhRZ8Ny5sbPrmcBFM`) and the new-secret check-in succeeded
  (`63ncG3T3r37cqZGUHxfgBXGV21g6e4YrfeMvJ1dA64N5`).
- Finalize `5v4cA4CPU1Didkjyrm7HMTHz9p9RDKrMy5L11tkFVRTC`; claim
  `HQeYhW36gZgMJ1qn7A1AYLcK8EVkJL8AsKp4NYy1C9kD`. Final state: event 2 `Finalized`,
  reservation claim `Claimed`, refund and reward pools `0`.
- This was a single-account acceptance event with an unpublished metadata hash, not a
  multi-user published pilot.

## 9. Frontend release (Vercel)

Status: **live at <https://gatherbond.vercel.app>**. The web app deploys from GitHub; there
is no CLI deploy in this project and no `.vercel/` directory to commit.

### 9.1 Release steps

1. Verify locally before pushing:

   ```bash
   bash scripts/verify-local.sh
   npm run build --prefix frontend
   ```

2. Commit on `main` and push. Vercel's Git integration builds `frontend/` from the
   repository root; a push to `main` is the production deploy trigger.
3. Poll the production URL until the new markup is served, then check the API:

   ```bash
   curl -s https://gatherbond.vercel.app/api/health
   curl -s https://gatherbond.vercel.app/api/contract/event-count
   curl -s "https://gatherbond.vercel.app/api/events?limit=2"
   ```

### 9.2 Production environment variables

Set these in the Vercel project (never in a committed file):

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_NEAR_NETWORK_ID` | yes | `testnet` |
| `NEXT_PUBLIC_NEAR_NODE_URL` | yes | `https://rpc.testnet.near.org` |
| `NEXT_PUBLIC_CONTRACT_NAME` | yes | `cynopom.testnet` |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | yes | metadata store; server-only |
| `GATHERBOND_SESSION_SECRET` | yes | NEP-413 sessions; login is 503 without it |
| `GATHERBOND_SECURE_COOKIES` | yes | must be `1` on HTTPS |
| `GATHERBOND_AUTH_RECIPIENT` | optional | defaults to the documented recipient |

Never set `GATHERBOND_ALLOW_DEV_ACTOR` or `GATHERBOND_RATE_LIMIT_DISABLED` in a deployed
environment: both are local-test escape hatches.

### 9.3 Post-deploy checklist

- `/` serves the current editorial home page (heading `Make plans. Keep them.`).
- `/api/health` reports `database_mode: turso`, `auth_configured: true`,
  `contract_configured: true`, `database_read: ok`.
- `/api/contract/event-count` matches `get_event_count` on chain.
- `/api/events` returns published events only, with verified metadata hashes.
- An unknown route renders the app's own not-found page, not a Vercel default.
- The session cookie is `HttpOnly`, `SameSite=Lax` and `Secure` on the live origin.

### 9.4 Rollback

Revert the offending commit on `main` and push; Vercel rebuilds the previous state. A
contract upgrade is separate (§3.1) and is never triggered by a frontend deploy.
