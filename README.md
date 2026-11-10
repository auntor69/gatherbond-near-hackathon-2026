# GatherBond

**Commit to gather. Earn by showing up.**

GatherBond is a crypto-native event commitment protocol for NEAR. Organizers create events with refundable native NEAR deposits; attendees register through the escrow contract, receive one-time ticket codes, and can claim their deposit plus a share of the no-show pool after organizer-authorized attendance verification.

> **Project status:** the escrow contract is deployed to NEAR Testnet at **`cynopom.testnet`**. The live frontend at <https://gatherbond.vercel.app> now creates real on-chain events, accepts exact-deposit registrations, issues one-time tickets, checks attendees in, finalizes events and submits claims. Turso stores only verified display metadata. This is testnet-only; no mainnet funds are used. The contract currently has zero events, so the first event must be created by an organizer through the live studio.

## What exists now

- **Escrow contract (`cynopom.testnet`):** event creation, exact-deposit registration, ticket commitments, organizer check-in, cancellation, permissionless finalization, pull claims, treasury accounting, pagination and failed-transfer recovery.
- **Real organizer flow:** the studio submits `create_event` with the organizer wallet, saves the canonical metadata through an authenticated API, and publishes it to discovery.
- **Real attendee flow:** event pages send the exact NEAR deposit through `register`, generate a one-time ticket code, and show the reservation in **My commitments**.
- **Real settlement flow:** organizers check in ticket codes and can finalize or cancel; attendees claim settlements and see the contract claim state.
- **Wallet sessions:** NEP-413 signature verification, an HttpOnly HMAC session cookie, one-time nonces and rate limits. Only wallets that support message signing and transaction sending are offered.
- **Metadata API:** canonical SHA-256 documents, verified published listings, drafts and append-only publish/unpublish versions. Turso is display-only.
- **No sample events:** discovery renders only verified published events. An empty shelf is an honest empty state, not sample content.

## Try the live app

Open <https://gatherbond.vercel.app>.

1. Connect a NEAR Testnet wallet and sign the NEP-413 message.
2. Open **Organizer studio** and use **Create a real event**. The form sends `create_event`, stores the canonical metadata and publishes it.
3. Open the event page and reserve with the exact deposit.
4. Copy the ticket code from **My commitments**; the organizer pastes it into **Check in & settle** after registration closes. Check-in may open before the event starts and must close by the event end.
5. After the event ends, finalize it and claim the settlement from **My commitments**.

Every transaction is signed by the wallet. There are no server-held signing keys and no simulated balances.

## Run it locally

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. Server-only values live in `frontend/.env.local`; copy the names from [`.env.example`](./.env.example) if needed. Never commit that file.

Without a configured `CONTRACT_NAME`, the UI disables create/reserve and reports that the contract is missing. It does not substitute sample events or fake balances.

## Verify

```bash
npm run build --prefix frontend                 # production Next build
bash scripts/verify-local.sh                    # contract + parity + metadata + auth + HTTP e2e
```

The last verified local run passed:

```text
37 contract tests
8/8 ticket-commitment vectors
94 Node metadata/auth/HTTP tests
deploy handover: 16 methods, 410,817-byte WASM
```

## Truth boundary

The NEAR contract is authoritative for organizer, deposit, capacity, timestamps, reservations, ticket commitments, attendance, cancellation/finalization, escrow and claims. Turso stores descriptive metadata and its hash; it can never prove payment or presence. Event pages re-hash the metadata and cross-check the contract before showing a verified publication.

Ticket secrets are stored in the attendee's browser, not on chain and not in a URL. The contract stores only the SHA-256 commitment. Losing the browser means losing the ticket code, although the reservation and claim right remain on chain.

## Remaining work

- Create the first real event and complete a funded-wallet registration/check-in/settlement run on Testnet.
- Add QR rendering/scanning for the ticket code (the current one-time code is copy/paste friendly).
- Contract audit and production hardening before any mainnet consideration.

## Project documents

- [`HACKATHON.md`](./HACKATHON.md) — official NEAR HACKATHON 2026 organizer instructions.
- [`MASTERPLAN.md`](./MASTERPLAN.md) — product, architecture, economic rules and milestones.
- [`BUILD_LOG.md`](./BUILD_LOG.md) — verified progress, test outputs and deploy evidence.
- [`docs/METADATA.md`](./docs/METADATA.md) — canonical metadata and publication API.
- [`docs/DEPLOY_RUNBOOK.md`](./docs/DEPLOY_RUNBOOK.md) — testnet deployment and acceptance procedure.

## Network

NEAR Testnet only. Contract: [`cynopom.testnet`](https://testnet.nearblocks.io/address/cynopom.testnet).
