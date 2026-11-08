# GatherBond

**Commit to gather. Earn by showing up.**

GatherBond is a crypto-native event commitment protocol for NEAR. Organizers create events with refundable native NEAR deposits; attendees register through a smart contract, receive one-time QR tickets, and can claim refunds and community rewards after organizer-authorized attendance verification.

> **Project status:** the escrow contract, metadata layer, NEP-413 server sessions, rate limiting, versioned publication workflow and the editorial Next.js UI are implemented and locally tested. The Turso database has been created and migrated. The UI now includes a real NEAR Connect wallet session flow using NEP-413. The frontend is live at <https://gatherbond.vercel.app>, but its production environment still needs the server-only Turso, session and contract variables. **No contract is deployed, registration/deposit and on-chain events are not available yet, and no real funds are used.** This is a testnet-only prototype.

## What exists now

- **Escrow contract:** event creation, exact-deposit registration, ticket commitments, organizer check-in, cancellation, permissionless finalization, pull claims, treasury accounting, pagination and failed-transfer recovery.
- **Metadata API:** canonical SHA-256 documents, bounded published listings, a draft read, a public event passport (`GET /api/events/:id`), and append-only publish/unpublish versions. Turso stores display metadata only.
- **Wallet sessions:** NEP-413 signature verification, an HttpOnly HMAC session cookie, one-time nonces and per-account/per-client rate limits on the server. The browser connector is wired through `@hot-labs/near-connect`; it connects without adding a contract key, requests the signed login message, and shows the account only after the server verifies it.
- **UI:** editorial Discover, event passport, organizer studio and My Commitments screens, with wallet connect/sign-out in the header and studio. The empty shelf uses clearly labeled sample events; it never invents balances, transactions or check-ins.
- **Deployment:** the frontend is live at <https://gatherbond.vercel.app>; the testnet contract deploy, production server environment and funded-wallet registration/deposit remain human-gated.

## Run it locally

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. The app reads server-only values from `frontend/.env.local`; copy the names from [`.env.example`](./.env.example) if needed. Never commit that file.

Expected local views:

- **Do** open `/` → **See** the Discover shelf and the header **Connect wallet** control. With no published events it shows four labeled sample events and a “Sample shelf” note.
- **Do** connect a NEAR Testnet wallet → **See** the wallet request a NEP-413 signature. The header and studio only show the account after the server verifies the key; cancelling leaves everything signed out.
- **Do** open `/events/demo-studio-night` → **See** the full event passport, sample badge, commitment mechanic and metadata integrity panel.
- **Do** open `/studio` → **See** the publication console and session card. “Load publication” calls the real API; publish/unpublish remain disabled until a wallet session is verified.
- **Do** open `/commitments` → **See** the honest empty state, the live wallet control and a sample ticket labeled “not on-chain.”

The API also runs without a database: `GET /api/events` answers `503 metadata_store_unavailable` rather than serving unverified content.

## Verify

```bash
npm run build --prefix frontend                 # production Next build
node --test server/metadata/test/handlers.test.mjs \
  server/http/test/routes.test.mjs               # focused detail/route tests
bash scripts/verify-local.sh                     # contract + metadata + auth + live HTTP e2e
```

No deployment, account creation, signature or spend is performed by these commands.

## Truth boundary

The NEAR contract is authoritative for organizer, deposit, capacity, timestamps, reservations, ticket commitments, attendance, cancellation/finalization, escrow and claims. Turso stores descriptive metadata and its hash; it can never prove payment or presence. Event pages re-hash the metadata and cross-check the contract before showing a verified publication.

## Not done yet

- Deploy the contract to NEAR Testnet and fund an account (needs human approval).
- Wire wallet registration/deposit, ticket display/scanning, finalization and claims into the UI.
- Create the first real on-chain event and finish the production Vercel environment.
- Replace the sample shelf with live published events.

## Project documents

- [`HACKATHON.md`](./HACKATHON.md) — official NEAR HACKATHON 2026 organizer instructions, preserved as provided.
- [`MASTERPLAN.md`](./MASTERPLAN.md) — product, architecture, economic rules, milestones and security requirements.
- [`BUILD_LOG.md`](./BUILD_LOG.md) — verified progress, test outputs, decisions and blockers.
- [`docs/METADATA.md`](./docs/METADATA.md) — canonical metadata, publication versions and API contract.
- [`docs/DEPLOY_RUNBOOK.md`](./docs/DEPLOY_RUNBOOK.md) — the human-gated testnet deploy procedure.

## Network

NEAR Testnet only. No mainnet funds are used in the hackathon MVP.
