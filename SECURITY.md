# Security Policy

GatherBond is a **NEAR Testnet** project. It is not audited and must not be used with mainnet funds.

## Reporting a vulnerability

Do not open a public issue for a security vulnerability. Report it privately to the repository maintainer (`auntor69` on GitHub) with:

- a description of the issue and its impact,
- the affected route, component or contract method,
- reproduction steps or a proof of concept,
- any suggested mitigation.

Because this is a testnet project with no bug bounty, please allow reasonable time for a fix before disclosure.

## Scope

In scope:

- `contracts/src/lib.rs` — escrow, accounting, ticket commitments, claims, treasury.
- `server/` — NEP-413 verification, session cookies, nonces, rate limits, metadata handlers and RPC reads.
- `frontend/app/api/` — HTTP route handlers.
- Metadata canonicalization, hashing and publication semantics.

Out of scope for this project:

- Mainnet deployment (no procedure exists).
- Third-party wallet extensions and NEAR RPC infrastructure.
- Social engineering or physical access to a user's machine.

## Trust model

- The **contract** is authoritative for deposits, capacity, attendance, cancellation, finalization, rewards, claims and treasury.
- The **metadata database** stores descriptive data and its hash only; it can never prove payment, attendance or claim entitlement.
- The **server** verifies wallet sessions and serves data; it never holds user funds and never signs user transactions.
- The **organizer** authorizes check-in in this MVP. This is a disclosed trust assumption.
- The **browser** holds the ticket secret and the wallet signature. Losing the browser means losing the ticket code until the attendee rotates the commitment with the same wallet.

## Security controls

- NEP-413 signature verification over a domain-separated message.
- Full-access-key check through read-only RPC.
- Single-use, server-persisted nonces.
- HttpOnly, `SameSite=Lax` HMAC session cookies; `Secure` in production.
- Server-derived actor for metadata writes; organizer ownership verified against the canonical document.
- Per-client/account login limits and per-actor write limits.
- Canonical SHA-256 verification on read and write; mismatched metadata is never shown as verified.
- Contract solvency invariant, per-event payout locks and failed-transfer entitlement restoration.
- No server signing key; every user transaction is wallet-signed.

## Known limitations

- No independent contract audit.
- Testnet only; no mainnet funds.
- Process-local rate limiting and nonces are not shared across replicas.
- The metadata database operator can withhold listings but cannot alter money or attendance.
- The camera check-in path has been verified through the active pipeline with a fixture, not a physical printed QR.

## Secrets

Never commit `frontend/.env.local`, `TURSO_AUTH_TOKEN`, `GATHERBOND_SESSION_SECRET`, wallet keys or `.near-credentials`. If a secret is exposed, rotate it immediately and remove it from history before continuing.
