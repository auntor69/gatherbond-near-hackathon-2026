# Contributing to GatherBond

GatherBond is a Testnet-only commitment escrow protocol. Financial correctness and the on-chain/off-chain trust boundary come before visual or convenience changes.

## Before you start

- Read [`README.md`](./README.md), [`docs/DOCUMENTATION.md`](./docs/DOCUMENTATION.md) and [`SECURITY.md`](./SECURITY.md).
- Never commit credentials, `frontend/.env.local`, wallet keys, Turso tokens or session secrets.
- Do not change contract economics, timing rules or accounting invariants without an explicit product decision and matching tests.
- Treat `contracts/src/lib.rs` as the source of financial truth. Metadata can never override it.
- Keep `HACKATHON.md` unchanged; it is organizer-provided.

## Local setup

```bash
cd frontend
npm install
cp ../.env.example .env.local
# Either fill TURSO_* or set METADATA_SQLITE_PATH=.data/gatherbond.sqlite
npm run dev
```

For contract work:

```bash
cd contracts
cargo fmt --check
cargo test --offline
```

On Windows, put the Visual Studio CMake directory on `PATH` and export `AWS_LC_SYS_PREBUILT_NASM=1` before building. `scripts/verify-local.sh` does this when the directory exists.

## Required checks

Run both before opening a pull request:

```bash
bash scripts/verify-local.sh
npm run build --prefix frontend
```

Latest baseline (2026-11-13):

```text
contract format           clean
contract tests            54 passed
ticket vectors            8/8 matched
frontend tests            75 passed
metadata/auth/HTTP tests  107 passed
total                     236 passed
production build          exit 0, 21 routes
```

Do not skip, weaken or delete tests to make a change pass. If a test is wrong, explain why and fix the behavior it describes.

## SEO changes

The public surface is allowed to be crawlable only when it is verified. Preserve these rules:

- Use `frontend/lib/site.js` for canonical origins and paths; never hard-code a second production origin.
- Use `frontend/lib/seo.js` and `JsonLd` for structured data; never hand-write a `<script>` string.
- Do not add an unverified, draft or sample event to metadata, JSON-LD, the sitemap or an OG card.
- Keep `/studio` and `/commitments` `noindex, nofollow`.
- Event and recap pages must server-render verified data; a client-only fetch is not enough.
- A missing/unpublished event must return a real 404.
- Descriptions must be truthful. Do not add reviews, ratings, fake offers or attendance claims.
- After routes or metadata change, run `node --test frontend/lib/seo.test.mjs` and update [`docs/SEO.md`](./docs/SEO.md).

Local SEO verification:

```bash
node --test frontend/lib/seo.test.mjs
npm run build --prefix frontend
npm run start --prefix frontend -- -p 3107
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3107/events/0
curl -sS http://127.0.0.1:3107/sitemap.xml
curl -sS http://127.0.0.1:3107/robots.txt
```

## Code standards

- Keep the framework-agnostic `server/` modules free of Next.js imports.
- Keep browser bundles free of server secrets; only `NEXT_PUBLIC_*` values may be read in client code.
- Use integer/BigInt arithmetic for NEAR amounts; never floating point.
- Preserve fail-closed behavior: missing configuration or an unavailable dependency returns an explicit error, never a simulated success.
- Prefer small, focused modules and pure functions that can be tested without credentials.
- Keep the Nocturne design tokens in `frontend/app/nocturne.css`; do not reintroduce content-hiding animation.
- Keep publication append-only. Do not add an unpublish/delete path without a product decision and migration plan.
- Do not log secrets, session tokens, full database URLs or private keys.

## UI changes

Check the affected routes at 390, 768, 1024 and 1440 px for:

- horizontal overflow;
- clipped text and overlapping controls;
- cramped touch targets;
- focus visibility and keyboard access;
- empty/loading/error states that do not invent data.

The camera/QR path should be exercised through the active pipeline with a fixture when a physical camera is unavailable. State that limitation in the pull request.

## Documentation

Update the relevant document with the code:

| File | When |
| --- | --- |
| `README.md` | Public/judge-facing behavior, live proof, verification counts |
| `docs/DOCUMENTATION.md` | Architecture, contract, API, env, security, operations |
| `docs/SEO.md` | Metadata, structured data, sitemap, indexability |
| `docs/METADATA.md` | Canonical JSON, publication and verification API |
| `docs/DEPLOY_RUNBOOK.md` | Deployment/release procedure |
| `MASTERPLAN.md` | Product scope, milestones, roadmap |
| `BUILD_LOG.md` | Append verified progress only; never rewrite history |
| `SECURITY.md` | Trust model, controls, reporting |

## Commits and pull requests

- Write a clear, specific commit message.
- Do not include generated build output, `node_modules`, `.next`, databases or secrets.
- Describe the behavior change, the tests you ran and any known limitation.
- Contract changes need tests for both the happy path and the adversarial path.
- Do not push, deploy or publish a submission unless the human explicitly authorizes it.

## Security

Do not report vulnerabilities in a public issue. See [`SECURITY.md`](./SECURITY.md).
