# Security Policy

GatherBond is a **NEAR Testnet** project. It is not audited and must not be used with mainnet funds.

## Reporting a vulnerability

Do not open a public issue for a security vulnerability. Report it privately to the maintainer:

- GitHub: `auntor69`
- Email: `gatherbond.app@gmail.com`

Include:

- a description of the issue and its impact;
- the affected route, component or contract method;
- reproduction steps or a proof of concept;
- any suggested mitigation.

This is a Testnet project with no bug bounty. Please allow reasonable time for a fix before disclosure.

## Scope

In scope:

- `contracts/src/lib.rs` — escrow, accounting, ticket commitments, claims, treasury.
- `server/` — NEP-413 verification, sessions, nonces, rate limits, metadata handlers and RPC reads.
- `frontend/app/api/` — HTTP route handlers.
- `frontend/lib/` — canonicalization, ticket crypto, contract math and server loaders.
- Metadata canonicalization, hashing and publication semantics.
- SEO/structured-data injection paths.

Out of scope:

- Mainnet deployment (no procedure exists).
- Third-party wallet extensions and NEAR RPC infrastructure.
- Social engineering or physical access to a user's machine.
- Testnet funds loss, which has no monetary value.

## Trust model

- The **contract** is authoritative for deposits, capacity, attendance, cancellation, finalization, rewards, claims and treasury.
- The **metadata database** stores descriptive data and its hash only; it can never prove payment, attendance or claim entitlement.
- The **server** verifies wallet sessions, hashes and RPC state; it never holds user funds and never signs user transactions.
- The **organizer** authorizes check-in in this MVP. This is a disclosed trust assumption.
- The **browser** holds the ticket secret and the wallet signature. Losing the browser means losing the ticket code until the attendee rotates the commitment with the same wallet.
- The **metadata operator** can withhold a listing, but cannot change financial state.

## Security controls

### Contract

- Native NEAR escrow with a single liability pool.
- Solvency invariant checked before state changes that can affect it.
- Per-event payout locks and a global treasury lock.
- Failed transfer callbacks restore entitlements.
- Ticket commitments use a domain-separated SHA-256 encoding; secrets never go on chain.
- Organizer-only check-in and cancellation; cancellation only before start.
- Bounded/paginated views; capacity capped at 500.
- Treasury can withdraw only accrued remainder.

### Authentication and authorization

- NEP-413 signature verification over the exact tagged Borsh digest.
- On-chain full-access-key check through read-only RPC.
- Single-use, server-persisted 32-byte nonces scoped to the account.
- HttpOnly, `SameSite=Lax`, HMAC-signed session cookie; `Secure` in production.
- Server-derived actor for metadata writes; no client-supplied actor.
- Per-client/account login limits and per-actor write limits.

### Metadata

- Canonical JSON with strict allowed fields; financial fields rejected.
- SHA-256 verified on read and write.
- On-chain `metadata_hash` compared on every public read.
- Mismatch returns `409` and hides the row.
- Publication is append-only; no unpublish/delete endpoint.

### Frontend and SEO

- No server secrets in the browser bundle; only `NEXT_PUBLIC_*` values are public.
- JSON-LD is escaped so a value cannot close the script tag.
- Only verified published events enter metadata, JSON-LD, sitemap or OG cards.
- Private wallet surfaces are `noindex, nofollow`.
- Missing/unpublished events return a real 404.
- No server signing key exists in the deployment.

## Secrets

Never commit:

- `frontend/.env.local` or any real `.env` file;
- `TURSO_AUTH_TOKEN`;
- `GATHERBOND_SESSION_SECRET`;
- wallet keys, seed phrases or `.near-credentials`;
- production logs containing tokens or full database URLs.

If a secret is exposed, rotate it immediately and remove it from history before continuing. The Turso token and session secret must be rotated independently.

## Known limitations

- No independent contract audit.
- Testnet only; no mainnet funds.
- Process-local rate limiting and nonces are not shared across replicas.
- The metadata operator can withhold listings but cannot alter money or attendance.
- Organizer check-in is a trust assumption; it is not physical proof of presence.
- The camera check-in path has been verified through the active pipeline with a fixture, not a physical printed QR.
- The release contract uses `panic = "abort"`, so rejected on-chain calls surface as opaque WASM traps.
- No privacy policy, terms of service or legal review.

## Disclosure policy

- We will acknowledge a report and investigate.
- We will credit the reporter if desired and if disclosure is safe.
- Please do not access another user's data, disrupt the live deployment or spend funds during research.
- Testnet-only findings are still welcome; they may become mainnet blockers.

## Safe harbor

Good-faith research that respects this policy, avoids privacy violations and does not degrade the service is welcome. This project cannot offer a formal bug bounty or legal safe harbor beyond its own maintainers' intent; do not assume one.
