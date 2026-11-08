# GatherBond — Testnet Deploy & Acceptance Runbook

Status: **draft for M1 acceptance**. Nothing in this repository has been deployed. The
commands below are the handover for a human with a funded testnet account; every one of
them requires a signature and is therefore never run by the agent.

Scope: NEAR **testnet only**. There is no mainnet procedure in this project.

- Contract: `contracts/src/lib.rs` (one contract, `gatherbond-escrow`)
- Network: NEAR testnet
- Script that prepares this handover: `scripts/deploy-contract.sh` (prints, never deploys)

---

## 1. Prerequisites

| Item | Detail |
| --- | --- |
| NEAR CLI | near-cli-rs (the `near` binary). Verify with `near --version`. Older `near-cli` uses different flags; this runbook targets near-cli-rs. |
| Contract account | A funded testnet account, e.g. `gatherbond-m2.testnet`, with ≥ 6 NEAR (code stake is ~4.11 NEAR; see §2). |
| Treasury account | An account allowed to withdraw accrued treasury (rounding remainders/all-no-show pools). Can be the same as the organizer for the demo, but must be an account you control. |
| Organizer / attendees | Three attendee accounts and one organizer account, each with testnet funds for a 1 NEAR deposit. |
| Toolchain | Rust with `wasm32-unknown-unknown`, plus `AWS_LC_SYS_PREBUILT_NASM=1` and the VS CMake on `PATH` on Windows. `scripts/deploy-contract.sh` sets both. |

Testnet accounts are free; use the NEAR faucet or wallet. Never put a mainnet key in this
project.

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

With the current artifact (410,817 bytes) that is **4.10817 NEAR**, printed exactly by the
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
  attached-deposit '0 NEAR' prepaid-gas '100 Tgas' \
  sign-as "$CONTRACT_ID" network-config testnet \
  sign-with-keychain send
```

`new(treasury, network_id)` stores the treasury recipient and binds the ticket-commitment
domain to the network name. Both values are immutable afterwards.

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
  registration_deadline: ns(120), checkin_open: ns(180), checkin_close: ns(420) }));
')
META=$(CONTRACT_ID="$CONTRACT_ID" ORGANIZER_ID="$ORGANIZER_ID" node scripts/metadata-tool.mjs demo)
ARGS=$(TIMES="$TIMES" META="$META" node -e '
const times = JSON.parse(process.env.TIMES);
const meta = JSON.parse(process.env.META);
console.log(JSON.stringify({ deposit: "1000000000000000000000000", capacity: 3,
  ...times, metadata_hash: meta.metadata_hash }));
')

near contract call-function as-transaction "$CONTRACT_ID" create_event \
  json-args "$ARGS" attached-deposit '0.05 NEAR' prepaid-gas '100 Tgas' \
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
    console.log(JSON.stringify(commitmentArray({ networkId: NETWORK_ID,
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
  attached-deposit '1 NEAR' prepaid-gas '100 Tgas' \
  sign-as "$ALICE" network-config testnet sign-with-keychain send
```

The attached deposit must equal the event deposit exactly. Keep the secrets; they are never
stored on chain until check-in.

Observable: `get_reservation(0, "alice.testnet")` → `checked_in: false`, `claim: "None"`;
`get_event(0).registered = 3`.

### 4.3 Check in two attendees (organizer, inside the window)

After `checkin_open` and before `checkin_close`:

```bash
near contract call-function as-transaction "$CONTRACT_ID" check_in \
  json-args '{"event_id":0,"attendee":"alice.testnet","secret":"demo-secret-alice"}' \
  prepaid-gas '100 Tgas' sign-as "$ORGANIZER_ID" \
  network-config testnet sign-with-keychain send
```

Repeat with `bob.testnet` / `demo-secret-bob`. Carol does not check in.

Observables: the reservation shows `checked_in: true`; a second check-in fails; a wrong
secret fails and does not mark attendance.

### 4.4 Finalize (anyone, after `end_at`)

```bash
near contract call-function as-transaction "$CONTRACT_ID" finalize_event \
  json-args '{"event_id":0}' prepaid-gas '100 Tgas' \
  sign-as "$ALICE" network-config testnet sign-with-keychain send
```

The contract sets `reward_per_attendee = floor(no_show_deposits / checked_in) = 0.5 NEAR`
(Carol's 1 NEAR split between Alice and Bob), `status: "Finalized"`, and `reward_pool = 1
NEAR` for two attendees.

### 4.5 Claim (Alice, then Bob)

```bash
near contract call-function as-transaction "$CONTRACT_ID" claim_settlement \
  json-args '{"event_id":0}' prepaid-gas '100 Tgas' \
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
  json-args '{"event_id":1}' prepaid-gas '100 Tgas' \
  sign-as "$ORGANIZER_ID" network-config testnet sign-with-keychain send
```

Then claim as Alice:

```bash
near contract call-function as-transaction "$CONTRACT_ID" claim_settlement \
  json-args '{"event_id":1}' prepaid-gas '100 Tgas' \
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
| Deploy fails for lack of balance | Fund the account: code stake ≈ 4.11 NEAR plus state headroom. |

Gas: external calls use 100 Tgas in these commands; the contract forwards 15 Tgas to each
payout callback and rejects claims that leave less than 30 Tgas after the call.

## 7. Human gate

Deploying, creating accounts, funding them and signing are **human-only actions**. After the
sequence above succeeds, record in `BUILD_LOG.md`:

- contract account and transaction hashes,
- event id and the `get_event` result,
- claim transaction hashes and resulting balances,
- anything that deviated from this runbook.

Until then the contract remains un-deployed and un-audited; organizer-authorized check-in
is a disclosed trust assumption of this MVP.
