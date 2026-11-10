# GatherBond — Master Plan

> **Product:** Commitment-first event platform for real-world communities  
> **Hackathon:** NEAR HACKATHON 2026 — Build Beyond Boundaries  
> **Current status:** Testnet v1 live; hackathon proof features implemented and locally verified  
> **Plan last updated:** 2026-11-10  
> **Network target:** NEAR Testnet only  
> **Primary hackathon track candidate:** Social Money (`social`)  
> **Secondary track candidate:** Open Innovation (`open`), only if the final implementation genuinely fits

---

## 0. How an AI coding agent must use this repository

Before doing any work, read these files in this order:

1. `HACKATHON.md` — organizer-provided requirements and submission rules. Keep this file unchanged. Before submission, re-check the live version at <https://nearhackathon.com/HACKATHON.md> because organizer rules can change.
2. `MASTERPLAN.md` — the product scope, architectural decisions, execution sequence, acceptance criteria, and safety rules. This file is the project specification.
3. `BUILD_LOG.md` — current implementation status, verified tests, decisions, and blockers.
4. `README.md` — public-facing project summary and setup status. Keep it accurate; do not claim unfinished features work.

If instructions conflict:

- The latest official hackathon rules govern hackathon eligibility and submission.
- This master plan governs the agreed product requirements and scope.
- The code and tests describe what is actually implemented; never claim a requirement is complete merely because it appears in this plan.
- If implementation evidence shows a requirement is unsafe or technically infeasible, stop, explain the evidence, and propose the smallest safe change. Do not silently change product economics or security rules.

### Mandatory first action: inspection only

On the first run, inspect the repository, Git status, existing files, runtimes, package manager, Rust toolchain, NEAR tooling, and environment configuration. Do not modify files, install packages, deploy contracts, create accounts, sign transactions, or spend funds during this first inspection.

Return a concise report with:

- What already exists and what is missing.
- Whether the working tree is clean.
- Node/package-manager versions.
- Rust/Cargo version and installed WASM target.
- `cargo-near` availability and version.
- Compatibility of the proposed NEAR SDK, Rust toolchain, wallet connector, and frontend packages, checked against current official documentation.
- Any environment or account setup required from the human.
- The exact next milestone and its acceptance criteria.

Wait for the human to approve implementation after the report. The human is new to Web3; explain wallet, deployment, and transaction steps in plain language.

---

## 1. Product definition

### 1.1 Product name

**GatherBond** is the current working name. It has not received legal, trademark, domain, or GitHub-name clearance. Do not claim that those are available. If a conflict is found, recommend a replacement before public branding.

### 1.2 One-sentence description

GatherBond is a NEAR-based event commitment protocol where organizers create events, attendees lock refundable native NEAR deposits in a smart contract, organizers verify attendance using one-time QR tickets, and the contract calculates refunds and community rewards while recording attendance on-chain.

### 1.3 Product promise

**Commit to gather. Earn by showing up.**

GatherBond makes an event commitment financially meaningful while making the rules and settlement auditable on-chain.

### 1.4 The problem

Event organizers often face registrations from people who do not attend. Empty seats waste capacity, planning effort, venues, refreshments, and opportunities for people who would have attended. Conventional registration forms do not create a strong commitment and can leave cancellation/no-show handling opaque.

### 1.5 The solution

- The organizer creates an event and chooses a refundable deposit amount.
- The attendee connects a NEAR wallet and registers by depositing the exact amount of native NEAR into the GatherBond contract.
- The attendee receives a one-time QR ticket.
- An authorized organizer checks in the attendee during the permitted window.
- After the event, anyone can finalize the event.
- Verified attendees can claim their original deposit plus an equal share of the no-show pool.
- No-shows forfeit their deposits under the published event rules.
- Attendance is represented by a permanent on-chain record in the MVP.

### 1.6 Confirmed product decisions

| Decision | Confirmed choice |
|---|---|
| Project name | GatherBond (working name; clearance still required) |
| Deposit amount | Organizer chooses per event |
| Event types | Both campus/community and professional events |
| Payment asset | Native NEAR |
| Network | NEAR Testnet |
| Attendance credential | On-chain attendance record; no NFT in MVP |
| Escrow custody | One NEAR smart contract |
| Settlement model | Permissionless finalization; individual pull claims |
| Platform fee | Zero in MVP |
| Database | Turso may be used for off-chain metadata/indexing; never for financial authority |
| Hosting | Vercel free tier target |
| AI in the product | No chatbot; AI coding tools are development assistance only |
| Budget | Target $0; small incidental spend only with human approval |
| Mainnet | Out of scope |

### 1.7 Current product direction (2026-11-10)

GatherBond is a **standalone commitment-first event platform**. The event page, commitment, check-in, Flake Fund and show-up proof live on GatherBond. It is not a plugin, link or add-on for another event product.

- **Mission:** Make every yes count.
- **Vision:** A world where a yes is a promise.
- **Category:** Attendance assurance for real-world communities.
- **Product promise:** Show up. Get it back. Split the flake fund.
- **Business model:** One public plan at **$19/month** per organizer, first event free. No cut of refundable deposits and no cut of no-show penalties. Paid ticketing, sponsor pools and white-label deals are later sales-led additions, not public pricing tiers.
- **Beachhead:** Recurring, capacity-constrained communities — run clubs, social fitness, workshops, classes and coworking.
- **Hackathon proof scope:** Flake Fund preview, public recap plus attendee receipt, and an organizer proof dashboard. No contract-economics changes before submission.

---

## 2. Hackathon constraints and submission obligations

The organizer-provided `HACKATHON.md` is the primary local reference. Recheck its live URL before submitting.

Known event schedule from the provided rules:

- Development/submission deadline: **2026-11-14 23:59 UTC**.
- Bangladesh local equivalent: **2026-11-15 05:59 Asia/Dhaka**.
- Judging: November 16–18, 2026.
- Results due by November 18, 2026 at 23:59 UTC.

Rules relevant to this project:

- No advance registration is required.
- Repository can remain private during development, but must be public before the deadline.
- Public demo post on X must mention that the project was built for NEAR HACKATHON, tag `@NEARProtocol`, include `#NEARHackathon`, and attach a demo video or screenshots.
- README must be reproducible and use clear "Do X → See Y" steps.
- Human judges make final decisions; Claude Code and Codex screen for reproducibility and feature verification.
- Testnet projects are eligible. NEAR Intents has no testnet, and mainnet Intents execution requires real funds.
- No integrations are mandatory. Only integrate protocols that materially serve the product.
- Keep the demo available through judging, ideally through November 25.
- Add a LICENSE file. Keep the repository public through judging.
- There is one submission per project/repository. Human must review the final form payload and explicitly approve submission.

**Primary track candidate:** Social Money (`social`), because community incentives and shared reward distribution are core.  
**Possible secondary track:** Open Innovation (`open`) only if the final implementation makes a distinctive protocol contribution. Do not select tracks merely to increase the count.

Do not build NEAR Intents into the MVP. Native NEAR testnet escrow is the core crypto feature and can be tested without risking mainnet funds.

---

## 3. Goals and non-goals

### 3.1 Must-have MVP goals

1. A user can connect a NEAR testnet wallet.
2. An organizer can create a real on-chain event with immutable financial and timing rules.
3. An attendee can deposit native testnet NEAR and receive a reservation.
4. The app can issue and display a one-time QR ticket whose secret is not stored on-chain in plaintext.
5. The organizer can authorize a check-in transaction that verifies and consumes the ticket.
6. The contract can finalize the event after its deadline.
7. Verified attendees can claim refunds and reward shares.
8. Cancelled events provide full refunds under the cancellation rule.
9. The app can show on-chain attendance history and link to NEAR Explorer transactions/state where available.
10. All money-related UI is driven by actual contract state, not mock transaction data.
11. The README allows a new judge to reproduce one complete workflow.

### 3.2 Non-goals for the hackathon MVP

- NEAR Intents or cross-chain deposit collection.
- Mainnet transactions or real customer funds.
- NFT minting, transferable credentials, or NFT marketplaces.
- DAO governance or complex multisig administration.
- Native iOS/Android application.
- AI chatbot, AI event planner, or autonomous wallet agent.
- Commercial billing or subscription enforcement inside the hackathon MVP; the post-hackathon model is one $19/month plan.
- Operating as a plugin, link or integration layer inside another event product.
- A platform or organizer cut of refundable deposits or no-show penalties.
- Sponsor-pool pricing, white-label/API pricing, or multiple commercial tiers before 100 paying organizers.
- Token, points, or chain-incentive mechanics.
- Complex identity verification or KYC.
- GPS-based proof of attendance.
- Arbitrary external token deposits; native NEAR only.
- Unnecessary microservices or infrastructure.

A stretch feature must never delay the complete deposit → check-in → settlement → claim workflow.

---

## 4. Users and product roles

### 4.1 Organizer

- Connects a NEAR testnet wallet.
- Creates an event and chooses its deposit, capacity and schedule.
- Publishes event details.
- Uses the organizer check-in station to scan tickets.
- Can cancel only before the event starts.
- Can view registrations, verified attendance and settlement state.
- Cannot withdraw attendee escrow or alter published financial rules.

### 4.2 Attendee

- Connects a NEAR testnet wallet.
- Browses events and reads the exact deposit and terms.
- Approves a payable registration transaction.
- Receives a one-time ticket/QR secret.
- Presents it to the organizer at check-in.
- Can claim the refund/reward only if eligible.
- Can view public on-chain attendance history.

### 4.3 Public visitor / judge

- Can browse published event metadata.
- Can inspect contract address and event rules.
- Can verify transactions and attendance records using public testnet data.
- Can follow README steps without needing the developer's private wallet.

---

## 5. Product workflow

### 5.1 Create event

Organizer enters:

- Title and description.
- Category: campus, community, meetup, workshop, conference, professional, or other.
- Venue or online location.
- Event poster/image URL (optional).
- Start and end timestamps.
- Registration deadline.
- Check-in opening and closing timestamps.
- Capacity.
- Deposit in NEAR.

The frontend converts NEAR to yoctoNEAR using integer-safe decimal parsing. Never use JavaScript floating-point arithmetic for amount conversion.

Before wallet approval, show a clear confirmation of the deposit rules, capacity, times, cancellation policy, and any separate non-refundable storage/network costs.

The contract stores the financial and timing rules and a cryptographic hash/reference for the published event metadata. Rich display metadata can be stored off-chain in Turso (see Section 9).

### 5.2 Register / deposit

- Event must be open.
- Registration deadline must not have passed.
- Capacity must be available.
- Attendee must not already be registered for this event.
- Attached native NEAR deposit must exactly equal the event deposit, excluding any separately specified storage mechanism.
- Contract stores the reservation and ticket hash.
- Wallet prompts the attendee to approve the transaction.
- UI displays pending/confirmed/failed state and transaction link.

Do not assume a transaction is successful just because the frontend submitted it. Wait for the actual final transaction result and refresh contract state.

### 5.3 Ticket generation

- Generate a high-entropy random secret with a cryptographically secure browser API.
- Construct a domain-separated hash bound to chain/network, contract, event ID, attendee account and secret.
- Store only the hash/commitment on-chain.
- Keep the secret in browser-local storage and allow ticket download/backup.
- Do not put the secret into analytics, application logs, URLs, query strings, or public database rows.
- QR payload must include enough context to prevent use on another contract/network/event.
- Explain that loss of the secret can make check-in impossible; consider a wallet-authorized rotation flow only if time permits.

The secret will be revealed as an input to the organizer's check-in transaction. The design relies on one-time consumption and organizer authorization, not on secrecy after a confirmed check-in.

### 5.4 Check-in

- Only the event's organizer account can call `check_in`.
- Current chain timestamp must fall inside the event's check-in window, which may open after registration closes and before the event starts.
- Reservation must exist and belong to the claimed attendee.
- Ticket hash must match.
- Ticket must not have been consumed previously.
- Contract records checked-in status and chain timestamp.
- Frontend displays success only after the NEAR transaction is confirmed.
- Provide manual token entry if camera scanning is unavailable.

**Trust limitation:** This proves that the organizer-authorized account accepted a valid one-time ticket during the check-in window. It does not independently prove GPS location or physical presence. An organizer can refuse to check in a legitimate attendee; this is a known MVP trust assumption that must be disclosed.

### 5.5 Finalize and claim

- Event cannot be finalized before its end/check-in close conditions are satisfied.
- Any account may call finalization after the configured deadline.
- Finalization snapshots attendance counts and computes liabilities.
- A checked-in attendee can claim their deposit plus reward share.
- A no-show cannot claim a refund under a normally completed event.
- A cancelled event lets every registered attendee claim their full deposit.
- Claims are individual pull withdrawals; do not loop over all attendees to send payouts in one transaction.
- All-no-show pool and rounding remainder accrue to the configured treasury.

---

## 6. Economic specification

Let:

- `D` = fixed deposit per attendee for the event, in yoctoNEAR.
- `R` = number of registered attendees.
- `A` = number of verified attendees.
- `N = R - A` = number of no-shows.
- `P = N * D` = no-show reward pool.

If `A > 0`:

- `reward_per_attendee = floor(P / A)`.
- Eligible attendee receives `D + reward_per_attendee`.
- `P - (reward_per_attendee * A)` is the integer remainder and accrues to treasury.
- No-show attendee receives zero for a normally completed event.

If `A = 0`:

- No-show pool `P` accrues to the configured treasury.
- No attendee can claim a normal-attendance reward.

If organizer cancels before the event start:

- Every registered attendee is eligible to claim exactly `D`.
- No reward pool is distributed.
- Cancellation must not permit organizer withdrawal of attendee deposits.

No organizer share or protocol fee is charged in the MVP.

### Financial invariants

At every state transition, the contract must preserve:

1. Total escrow assets are at least equal to outstanding attendee refund/reward liabilities plus treasury liabilities plus required storage reserve.
2. One reservation cannot be claimed twice.
3. A pending asynchronous transfer cannot be claimed again concurrently.
4. A failed transfer restores the claim entitlement.
5. A successful transfer marks the claim as paid exactly once.
6. Organizer and treasury withdrawals cannot consume attendee liabilities.
7. Storage-staked balance is never treated as spendable escrow.
8. All arithmetic is checked; overflow/underflow causes a safe revert.

The contract must account for NEAR transaction gas, storage staking, callbacks and pending transfers. The agent must verify exact current SDK semantics from official documentation and write tests for edge cases.

---

## 7. Smart-contract design

### 7.1 Contract count and language

- Exactly one Rust smart contract for the MVP.
- NEAR Testnet deployment only.
- Verify the current stable `near-sdk` release, Rust toolchain, WASM target and `cargo-near` version from official documentation before pinning dependencies. The organizer-provided research snapshot mentioned `near-sdk` 5.30.1 and Rust 1.95; re-verify current compatibility at implementation time.

### 7.2 Event state (conceptual schema)

- `event_id: u64`
- `organizer: AccountId`
- `metadata_hash: [u8; 32]` or a documented compatible representation
- `deposit_yocto: u128`
- `capacity: u32`
- `registered_count: u32`
- `checked_in_count: u32`
- `start_at_ns: u64`
- `end_at_ns: u64`
- `registration_deadline_ns: u64`
- `checkin_open_ns: u64`
- `checkin_close_ns: u64`
- `status: Open | Cancelled | Finalized`
- `settlement_snapshot` (counts, pool, reward per attendee, treasury remainder)

The exact Rust representation may differ if the SDK recommends a safer structure, but the state must preserve these semantics.

### 7.3 Reservation state (conceptual schema)

- Event ID.
- Attendee AccountId.
- Deposit amount.
- Ticket commitment/hash.
- Check-in status.
- Check-in timestamp.
- Claim state: Unclaimed | Pending | Claimed.
- Any amount snapshot required to make claims deterministic after finalization.

### 7.4 Required methods

Change names only for a documented technical reason.

- `create_event`
- `register` (payable)
- `check_in`
- `cancel_event`
- `finalize_event`
- `claim_settlement`
- `get_event`
- `get_events` (bounded, paginated)
- `get_reservation`
- `get_reservations_for_account`
- `get_attendance_history`
- `get_treasury_balance` or equivalent view
- `withdraw_treasury` (restricted to configured treasury and only accrued treasury liabilities)

Required internal callback/resolver:

- Handle asynchronous transfers.
- Restore entitlement after failure.
- Complete claim after success.
- Use current supported NEAR promise APIs and correct callback gas.

### 7.5 Contract validation

- Event title, description, metadata size and other input lengths are bounded.
- Capacity is positive and capped at a sensible MVP maximum.
- Deposit is above zero and within safe limits.
- Timestamps are ordered: `start < end`, registration deadline is before/at the allowed start boundary, check-in opens at or after registration closes and closes no later than the event end (it may open before the event starts), and all timestamps are future-valid on creation.
- Event creation is organizer-owned and event IDs cannot collide.
- Registration is disabled after deadline/cancellation/finalization.
- Duplicate registration is rejected.
- Organizer identity is derived from transaction predecessor, not a caller-supplied account string.
- Check-in is organizer-only and one-time.
- `finalize_event` is permissionless but deadline-gated and idempotency-protected.
- Cancellation is organizer-only and before event start.
- Refund claims are reservation-owner-only.
- Treasury withdrawal is restricted and cannot invade escrow or user claim liabilities.
- Events and histories are paginated; no unbounded collection iteration in contract calls.

### 7.6 QR commitment design

Use a domain-separated commitment so a secret cannot be replayed across networks, contracts, events or attendees. The exact serialization and hash algorithm must be documented and tested in both frontend and Rust contract.

A possible conceptual hash input is:

`SHA256("GatherBond:v1" || network_id || contract_id || event_id || attendee_id || secret)`

Do not rely on ambiguous concatenation. Use a canonical encoding (e.g. length-prefixing or a documented structured encoding) and cross-language test vectors. Test that JavaScript and Rust produce identical hashes.

Do not invent cryptography. Use audited standard libraries/SDK primitives and verify their compatibility.

### 7.7 Storage and contract balance

Storage staking is a major risk. Before implementing registration, measure actual state growth for an event and reservation. Design an explicit storage funding policy.

Potential safe approaches to evaluate:

- Pre-fund the testnet contract's storage reserve and enforce a minimum reserve before accepting registrations; or
- Require a clearly disclosed separate storage deposit that is accounted for independently and refundable under a defined rule.

Do not silently take storage cost from refundable event deposits. Do not claim the full attached contract balance is available for payout. Keep separate accounting for storage stake, event escrow, outstanding claims, treasury accruals and operational reserve. Document the chosen model and test it.

---

## 8. Wallet and frontend architecture

### 8.1 Frontend stack

- Next.js + TypeScript.
- Tailwind CSS.
- Framer Motion for restrained motion.
- Lucide icons.
- `qrcode.react` or another maintained QR generator.
- `@zxing/browser` or another maintained browser scanner.
- Wallet connector: investigate current official HOT Labs NEAR Connect docs first; use another maintained NEAR wallet integration if it is more stable or materially easier. Verify package versions and testnet support before install.

### 8.2 Pages

1. **Discover:** featured events, categories, search, event cards and registration availability.
2. **Event Details:** event information, organizer, location, schedule, deposit, capacity, rules and registration.
3. **Organizer Studio:** event creation, registrations, escrow summary, check-in station and settlement state.
4. **My Commitments:** reservations, ticket QR, deposit, attendance state, pending claim and transaction history.
5. **Check-in Station:** organizer-only scanning screen, manual entry fallback, attendee result and live count.
6. **My Reputation:** public on-chain attendance history and verification links.

### 8.3 UI principles

- Premium Web3 editorial direction: deep charcoal, electric violet accents, striking event photography, confident typography and tasteful motion.
- The product must feel like a high-quality event platform, not a generic crypto admin panel.
- Do not use glow effects on every card or button.
- Mobile ticket and QR scanning experiences are essential.
- Clearly show the selected network (NEAR Testnet) in wallet and transaction contexts.
- Show exact amounts and explain each wallet signature.
- Distinguish Pending, Confirmed, Failed, Cancelled, Finalized, Claimed and Unclaimed states.
- Do not display fake balances, fake transaction hashes, or sample check-ins as real on-chain records.
- Sample event content may be used for an empty discovery page, but label it as demo/sample content and do not show fake financial activity.

### 8.4 Wallet rules

- Wallet connection must not imply custody by GatherBond.
- Never ask users to paste seed phrases or private keys.
- Never store private keys.
- Never automatically sign transactions.
- Every write action requires an explicit user wallet approval.
- Confirm transaction success from actual network outcome, then refresh contract state.
- Handle rejected wallet prompts, timeouts, RPC failures and wallet disconnects.

---

## 9. Database decision: Turso for off-chain metadata only

### 9.1 Recommendation

Use Turso if its current free plan remains available and its current SDK is compatible with the deployed Vercel runtime. The live official pricing page currently lists a $0 Free tier with 5 GB storage, 500 million monthly rows read, 10 million monthly rows written and 3 GB monthly sync. This is more than the 1 GB figure initially assumed, but pricing/limits must be rechecked before launch.

Official pricing: <https://turso.tech/pricing>

### 9.2 Strict source-of-truth boundary

**NEAR contract is authoritative for:**

- Event ID and organizer wallet.
- Deposit amount and capacity.
- Registration and reservation ownership.
- Ticket commitment/hash.
- Attendance/check-in status and timestamp.
- Cancellation/finalization state.
- Escrow, refund, reward and claim accounting.
- Treasury accrual.

**Turso may store:**

- Event title and long description for discovery.
- Category and tags.
- Venue display details.
- Poster image URL (not necessarily binary image files).
- Public organizer display name/logo URL, if provided.
- Search fields and list-page indexes.
- A canonical metadata JSON document and its SHA-256 hash.
- Contract ID, network ID, event ID and creation transaction reference.

Never use Turso as proof that a user paid, registered, attended, or can claim money.

### 9.3 Metadata integrity

- Compute a deterministic canonical JSON representation of event metadata.
- Compute its SHA-256 hash.
- Include that hash in the on-chain `create_event` transaction.
- Store the corresponding metadata and hash in Turso.
- On event detail pages, verify that the fetched metadata hashes to the on-chain hash before marking it verified.
- If hashes differ, show a clear integrity error and do not silently display the altered content as verified.
- Critical event terms (deposit, capacity, deadlines, organizer and contract status) must always be read from the contract, not trusted from the database.

### 9.4 Suggested minimal schema

`event_metadata`

- `network_id`
- `contract_id`
- `event_id`
- `organizer_account_id`
- `title`
- `description`
- `category`
- `venue`
- `image_url`
- `tags_json`
- `metadata_json`
- `metadata_sha256`
- `create_tx_hash`
- `publication_status`
- `created_at`

Use `(network_id, contract_id, event_id)` as the unique identity. Add indexes for event category, publication status, creation date and searchable title as justified by queries.

Keep schema migrations in `database/migrations/`. Use server-side Vercel route handlers for writes. Keep `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in environment variables; never expose the auth token to the browser or commit it.

### 9.5 Failure handling

The chain transaction and metadata insert cannot be one atomic transaction. Design for partial failure:

1. Prepare and hash metadata.
2. Submit the on-chain create-event transaction.
3. Wait for confirmed success and obtain event ID/transaction hash.
4. Save metadata to Turso using an idempotent key.
5. If step 4 fails, show that the event is on-chain but its public listing metadata is pending; allow a retry without creating a second event.
6. Discovery lists only metadata rows that match the on-chain contract event and hash.

Do not create a background service unless needed. For the hackathon, a user-triggered retry is acceptable.

### 9.6 Keep Turso optional

The core escrow, registration, attendance and settlement flow must still be verifiable from NEAR even if Turso is unavailable. If database integration threatens the critical path, reduce discovery/search functionality rather than weakening the on-chain financial workflow.

---

## 10. Security, privacy and operational constraints

- Testnet only; never use mainnet for hackathon development/demo.
- No real attendee funds.
- Never commit wallet secrets, API keys, Turso tokens, `.env` files or private keys.
- Provide `.env.example` with names and descriptions only.
- No private user data on-chain. Wallet addresses and transaction data are public by design.
- Avoid storing attendee email/phone in the MVP.
- Validate all user inputs on both client and contract/server boundaries.
- Do not trust browser-supplied organizer identity; derive authority from signed transaction predecessor.
- Do not trust client-calculated balance, attendance count or settlement values.
- The contract is source of truth for money and attendance.
- Rate-limit public metadata write endpoints and validate contract/network/event references server-side.
- Use bounded database queries and paginated contract views.
- Use safe logging; never log QR secrets or auth tokens.
- Clearly disclose that organizer-authorized check-in carries organizer trust.
- Add a README security note that this is a hackathon prototype, unaudited, and testnet-only.

---

## 11. Repository structure

Start with documentation only. Create implementation folders when their milestone begins; do not generate a large number of empty folders.

Target structure:

```text
gatherbond/
├── HACKATHON.md              # Official organizer instructions; unchanged
├── MASTERPLAN.md             # This project specification
├── README.md                 # Public-facing project explanation and setup
├── BUILD_LOG.md              # Verified progress, tests, blockers, decisions
├── LICENSE
├── .gitignore
├── .env.example
├── frontend/                 # Next.js application
├── contracts/                # Rust NEAR contract
├── database/
│   └── migrations/           # Turso schema migrations
├── docs/                     # Architecture notes, test vectors, demo guide
└── scripts/                  # Reproducible local/testnet helper scripts
```

Do not add a monorepo tool or workspace orchestrator unless there is a concrete need. Keep the structure simple enough for one developer and AI agents to understand.

---

## 12. Git and coding-agent workflow

### 12.1 Repository setup

- Create a dedicated GitHub repository named along the lines of `gatherbond-near-hackathon-2026`; verify the exact name is available before creating.
- Keep it private during development.
- Add `HACKATHON.md` and `MASTERPLAN.md` before implementation.
- Add the initial README and BUILD_LOG.
- Use `main` as the stable base branch.
- Use a focused implementation branch such as `feat/gatherbond-mvp`.
- Make small, understandable commits.
- Do not push, publish, or change repository visibility without human approval.

### 12.2 Agent responsibilities

Every coding session must:

1. Read `HACKATHON.md`, `MASTERPLAN.md`, `BUILD_LOG.md` and `README.md` first.
2. Inspect Git status before editing.
3. State the milestone and files it intends to touch.
4. Implement only the current milestone.
5. Run relevant tests and report actual output.
6. Update `BUILD_LOG.md` with what changed, tests, commit hash if available, blockers, and next step.
7. Never claim work is complete without evidence.

The agent must not:

- Expand scope without explicit discussion.
- Replace real blockchain actions with mocks to make a demo look complete.
- Deploy to mainnet.
- Sign transactions, spend tokens or create wallet accounts without approval.
- Make the repository public, push or force-push without approval.
- Publish X posts or submit the hackathon form.
- Rewrite the master plan silently. Propose changes and record approved decisions.

### 12.3 Pull request workflow

When implementation is ready for review:

- Push the feature branch only after user approval.
- Open a pull request against `main`.
- Include summary, changed files, test results, known risks and demo steps.
- The human reviews and merges.
- Never merge automatically.

---

## 13. Milestone execution plan and acceptance criteria

The schedule is aggressive. The developer can usually spend 2–3 hours per day. Target roughly 18–24 focused hours, reserving time for debugging and submission. If time is lost, cut optional UI/features, not financial correctness.

### M0 — Repository and environment audit

**Goal:** Establish the source of truth and verify the environment.

Tasks:

1. Create private GitHub repository.
2. Add `HACKATHON.md`, `MASTERPLAN.md`, `README.md`, `BUILD_LOG.md`.
3. Inspect existing workstation/toolchain and Git status.
4. Verify live hackathon instructions and current NEAR SDK/wallet docs.
5. Pin compatible package and Rust versions only after verification.
6. Record environment variables needed in `.env.example` (no secrets).

Acceptance:

- Repo exists and is private.
- Official HACKATHON.md is unchanged.
- Agent has produced an inspection report.
- No code changes before the human approves M1.

### M1 — Minimal testnet proof of concept

**Goal:** Prove a real native NEAR deposit and refund before UI work.

Tasks:

1. Create minimal Rust contract with an owner-controlled test event or equivalent minimal reservation flow.
2. Build WASM using verified tooling.
3. Run unit tests.
4. Deploy to NEAR testnet only after explicit human approval.
5. Connect a browser wallet.
6. Make one small testnet deposit (target example: 0.1 NEAR) after wallet confirmation.
7. Read the resulting reservation from contract view state.
8. Refund and verify the actual transfer.

Acceptance:

- Contract address and deployment transaction are real.
- Deposit transaction is confirmed on testnet.
- Reservation is visible from contract state.
- Refund transfer is confirmed.
- Explorer links are saved in BUILD_LOG.md.

If this fails, stop and diagnose. Do not build the full UI on top of an unproven integration.

### M2 — Complete escrow contract

**Goal:** Implement the full event/registration/settlement contract.

Tasks:

1. Implement event creation and immutable terms.
2. Implement exact-deposit registration and capacity.
3. Implement reservation and ticket-hash storage.
4. Implement organizer check-in and timing rules.
5. Implement cancellation.
6. Implement permissionless finalization.
7. Implement individual claims and async transfer callbacks.
8. Implement treasury accounting and storage-reserve policy.
9. Implement paginated read methods and attendance history.
10. Add unit tests for normal and adversarial cases.

Acceptance:

- Every financial invariant in Section 6 passes tests.
- Async failed transfer restores the claim.
- No unbounded loops in contract write methods.
- Storage liabilities are measured and separately accounted.
- Testnet integration test passes.

### M3 — Turso metadata layer

**Goal:** Make events discoverable without placing large descriptive content in contract state.

Tasks:

1. Verify current Turso free-tier availability/limits and official Vercel integration guidance.
2. Create Turso database only after human approval.
3. Add schema migration for `event_metadata`.
4. Implement server-side database client and API routes.
5. Implement canonical metadata serialization and SHA-256 hash test vectors.
6. Bind metadata hash to the on-chain event.
7. Implement idempotent post-transaction metadata save/retry.
8. Verify metadata against contract state before displaying it as trusted.

Acceptance:

- No Turso auth token reaches browser bundles.
- DB cannot alter financial rules or attendance.
- Metadata hash mismatch is detected and shown.
- Failed DB save does not cause a duplicate event or loss of escrow.
- Core contract flow remains usable without Turso.

If Turso threatens the critical path, defer it and store only bounded metadata on-chain for the hackathon demo.

### M4 — Wallet and core frontend

**Goal:** Connect the user experience to real contract state.

Tasks:

1. Set up Next.js and TypeScript.
2. Implement wallet connect/disconnect and testnet indicator.
3. Implement contract read/write client.
4. Build Discover and Event Details.
5. Build Create Event flow.
6. Build My Commitments.
7. Implement transaction confirmation/error handling.

Acceptance:

- Organizer can create an actual testnet event.
- Attendee can register with an actual native NEAR deposit.
- UI reflects contract view state, not local mock state.
- Network and exact amount are visible before signing.

### M5 — QR check-in and attendance history

**Goal:** Prove one-time organizer-authorized check-in.

Tasks:

1. Implement browser random secret generation.
2. Implement shared Rust/TypeScript commitment test vectors.
3. Display/download ticket QR.
4. Implement camera scanning and manual fallback.
5. Submit organizer check-in transaction.
6. Add check-in station and verified attendee list.
7. Add My Reputation/attendance history.

Acceptance:

- Valid ticket is accepted once.
- Invalid ticket rejected.
- Replayed ticket rejected.
- Unauthorized account rejected.
- Attendance appears in contract state and UI.

### M6 — Settlement and claims

**Goal:** Complete the full economic lifecycle.

Tasks:

1. Finalize after permitted deadline.
2. Show registered, attended, no-show and reward calculations from contract state.
3. Enable attendee refund/reward claim.
4. Show cancelled event refund path.
5. Show treasury/rounding behavior for edge cases.
6. Verify actual testnet payouts.

Acceptance:

- Demonstration event with multiple attendees settles correctly.
- Checked-in attendees receive deposit plus reward.
- No-show cannot claim.
- Cancellation returns full deposits.
- Failed transfer handling passes tests.
- All balances reconcile.

### M7 — UX, accessibility and responsive polish

**Goal:** Make the product memorable and usable without weakening the core workflow.

Tasks:

1. Implement final visual system.
2. Polish event poster cards and event detail layout.
3. Add loading, empty, pending, success and error states.
4. Make mobile wallet and QR ticket experience usable.
5. Check keyboard access and contrast.
6. Add restrained transitions and micro-interactions.
7. Remove all fake transaction/activity data from real views.

Acceptance:

- Main flows work at desktop and mobile sizes.
- No broken navigation or dead controls.
- Amounts and financial status are unambiguous.
- Testnet-only status is clear.

### M8 — Release, README and demo

**Goal:** Make the work reproducible and ready for judges.

Tasks:

1. Run contract tests, frontend lint/typecheck/build and end-to-end testnet flow.
2. Fix critical issues; record known limitations.
3. Produce public README instructions with "Do X → See Y" for every demo step.
4. Include contract address, network, real transaction links and setup instructions.
5. Add LICENSE.
6. Deploy frontend to Vercel and verify it remains available.
7. Record a short demo video showing one complete real workflow.
8. Prepare public X post with `@NEARProtocol` and `#NEARHackathon`.
9. Make repo public before deadline after human approval.
10. Review final submission data and obtain explicit approval before submitting once.

Acceptance:

- A judge can follow README from a clean environment.
- Demo performs real testnet interactions.
- Public repository and public demo post are live before the deadline.
- User has reviewed final submission payload and approved it.

### M9 — Hackathon proof features (2026-11-10) — complete, locally verified

**Goal:** Make the unique mechanic legible before, during and after an event without changing the contract economics.

Tasks:

1. Add a **Flake Fund preview** to the event page using live contract counts and an explicitly labelled 20% no-show illustration.
2. Add a **public recap page** that reads finalized contract state and an **attendee receipt** after claim.
3. Add an **organizer proof dashboard** showing registered, checked in, no-shows, show-up rate, deposit and pool.
4. Add pure unit tests for the Flake Fund math, including rounding and zero-count edge cases.
5. Keep the current deposit-only contract authoritative; no ticket-price, sponsor or platform-fee fields before the deadline.

Acceptance:

- Every displayed number is derived from contract state or clearly labelled as an illustration.
- A finalized event produces an actual recap with no-shows, pool, per-attendee share and total returned.
- A checked-in attendee sees a receipt with deposit, flake share and total after claim.
- An organizer can load an event ID in the studio and see its proof without inventing data.
- The Flake Fund unit tests pass and are included in the local verification script.
- Mobile layouts do not overflow; empty, open, cancelled and finalized states all render honestly.

**Verified 2026-11-10:** `scripts/verify-local.sh` passed all six steps (40 contract tests, 8/8 parity vectors, 10 Flake Fund tests, 94 metadata/auth/HTTP tests, deploy handover). The production build includes `/events/[id]/recap`. A local contract-shaped browser fixture exercised finalized, open, cancelled and missing recap states, the event-detail Flake Fund, the studio proof panel, a claimed show-up receipt and a cancelled refund receipt. The open/cancelled recap initially displayed invented no-show counts and a 0% show-up rate; both now render `—` until finalization. A 390 px viewport had no horizontal overflow on the recap, event detail, studio or commitments pages. A real funded testnet pilot remains the next proof.

---

## 14. Required tests

### Contract tests

- Create event with valid parameters.
- Reject invalid title/metadata lengths.
- Reject invalid timestamp ordering.
- Reject zero/invalid capacity.
- Reject zero/unsafe deposit.
- Accept exact attached deposit.
- Reject too-small and too-large attached deposits.
- Reject duplicate registration.
- Reject registration after deadline.
- Reject registration after capacity.
- Reject registration after cancellation.
- Permit valid organizer check-in.
- Reject check-in by non-organizer.
- Reject wrong ticket hash.
- Reject ticket replay.
- Reject check-in outside window.
- Reject finalization before deadline.
- Permit permissionless finalization after deadline.
- Compute all-attend settlement.
- Compute partial-attendance settlement.
- Compute one-attendee/one-no-show settlement.
- Handle all-no-show treasury settlement.
- Handle rounding remainder.
- Refund all attendees after organizer cancellation.
- Reject claim by wrong account.
- Reject no-show claim.
- Reject double claim.
- Restore claim after failed async transfer.
- Complete claim after successful transfer.
- Prevent treasury withdrawal from consuming user liabilities.
- Verify storage accounting under maximum supported event/reservation counts.

### Frontend tests

- Wallet disconnected state.
- Wallet connection on testnet.
- Wallet wrong-network state.
- Transaction pending/success/failure states.
- Amount formatting and parsing without floating point.
- QR generation and download.
- Cross-language hash test vectors.
- QR scanning and manual fallback.
- Invalid/expired/replayed check-in response.
- Database metadata hash mismatch.
- DB write failure and retry.
- Empty event list and pagination.
- Mobile ticket and scanner layout.

### End-to-end testnet demo

Use separately controlled testnet accounts for organizer and attendees. Demonstrate:

1. Organizer creates an event.
2. At least three attendee accounts register and deposit.
3. Organizer scans two valid tickets.
4. A ticket replay is rejected.
5. Event is finalized after the deadline (use a test-only shortened schedule or test harness, not a production bypass).
6. Attendees claim.
7. Actual NEAR testnet transactions and final balances are verified.
8. Attendance history is visible.

Do not add backdoors or time-bypass methods to the deployed production contract for the demo. Use a local test harness or properly configured short test event parameters.

---

## 15. Demo story for judges

The demo should begin with the user problem, not an architecture slide.

Suggested demo sequence:

1. Show an organizer creating a meetup and setting a refundable 0.1 NEAR commitment.
2. Show an attendee connecting a wallet and registering with an actual testnet transaction.
3. Show a second and third attendee registering.
4. Scan a valid ticket; show the contract confirming attendance.
5. Attempt to scan the same ticket again; show that the contract rejects replay.
6. Show finalization and transparent reward calculation.
7. Show an attendee claiming the refund plus their share of the no-show pool.
8. Open the testnet explorer/contract state and attendance history.

Explain exactly what NEAR provides:

- Native NEAR deposits held by the contract.
- Publicly verifiable event rules and financial state.
- Organizer-authorized check-in recorded on-chain.
- Deterministic, transparent refund/reward calculations.
- Public attendance records tied to wallet identities.

Never say that the application is fully trustless: the organizer controls check-in authorization in this MVP.

---

## 16. README requirements for AI and human judges

README must include:

- What GatherBond is.
- The no-show attendance problem.
- Why crypto/smart-contract escrow is necessary to the product.
- The exact MVP features implemented.
- What is intentionally out of scope.
- Architecture diagram or readable architecture explanation.
- Contract address and network.
- Real demo URL.
- Setup prerequisites and commands.
- Environment variable table (names only; never secrets).
- Database setup/migrations if Turso is used.
- Demo accounts/faucet guidance without publishing private keys.
- Step-by-step "Do X → See Y" instructions.
- Expected result for every step.
- Links to real testnet transactions and explorer state.
- Automated test commands and actual passing results.
- Known limitations and security assumptions.
- License and attribution for libraries/assets.

No marketing claims in place of reproducibility instructions.

---

## 17. Time and priority management

The developer is solo, new to Web3, and can generally spend 2–3 hours per day. Available coding assistance includes GLM 5.3 Flash, DeepSeek V4.1 Flash, and Gemini AI Plus models/tools. The target is approximately 18–24 focused hours, but actual remaining time must be recalculated from the current Bangladesh date/time and official UTC deadline at every planning update.

Priority order if time becomes tight:

1. Real testnet deposit and refund proof.
2. Correct contract escrow, attendance and settlement logic.
3. Real wallet-connected frontend.
4. QR check-in and attendance records.
5. Reproducible README and demo.
6. Visual polish.
7. Turso discovery/search enhancements.
8. Stretch features.

Do not cut tests for financial accounting or claim handling to add animations or optional features.

---

## 18. Definition of done

GatherBond MVP is done only when all of the following are true:

- [ ] Publicly reproducible repository structure and documentation.
- [ ] Rust contract compiles and its unit tests pass.
- [ ] Contract deployed to NEAR testnet with documented address.
- [ ] Real wallet connection works on testnet.
- [ ] Real native NEAR deposit is confirmed.
- [ ] Reservation is readable from contract state.
- [ ] One-time QR check-in works and replay is rejected.
- [ ] Attendance is recorded on-chain.
- [ ] Event finalization is permissionless and deadline-gated.
- [ ] Correct refund/reward calculations are verified.
- [ ] Actual testnet claim transfer succeeds.
- [ ] Failed claim transfer is safely recoverable in tests.
- [ ] Cancellation refund path works.
- [ ] No fake financial activity is presented as real.
- [ ] Mobile and desktop core flows are usable.
- [ ] README contains reproducible "Do X → See Y" steps.
- [ ] Vercel demo is accessible during judging.
- [ ] Demo video shows a complete working flow.
- [ ] Public X post meets hackathon tagging requirements.
- [ ] Repository is public before the official deadline.
- [ ] Human explicitly approves the single final submission.

---

## 19. Current next actions

Do these in order; do not jump ahead:

1. Keep the official `HACKATHON.md` unchanged.
2. Run one real testnet pilot with a small group and record the actual deposits, check-ins, no-shows and claims.
3. Update `README.md` and `BUILD_LOG.md` with the pilot transaction links.
4. Rehearse the 2-minute demo and the judge Q&A, especially the NEAR-only, non-crypto-user and fraud questions.
5. Submit early; do not add contract-economics features after the feature freeze.

**Human approval is required for repository publishing, pushes, deployment, wallet signatures, spending, mainnet actions, X posts and final hackathon submission.**
