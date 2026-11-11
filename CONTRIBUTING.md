# Contributing to GatherBond

GatherBond is a testnet-only commitment escrow protocol. Contributions are welcome, but financial correctness and the on-chain/off-chain trust boundary come before visual or convenience changes.

## Before you start

- Read [`README.md`](./README.md) and [`docs/DOCUMENTATION.md`](./docs/DOCUMENTATION.md).
- Never commit credentials, `frontend/.env.local`, wallet keys, Turso tokens or session secrets.
- Do not change contract economics, timing rules or accounting invariants without an explicit product decision and matching tests.
- Treat `contracts/src/lib.rs` as the source of financial truth; metadata can never override it.

## Local setup

```bash
cd frontend
npm install
cp ../.env.example .env.local
npm run dev
```

For contract work:

```bash
cd contracts
cargo fmt --check
cargo test --offline
```

On Windows, put the Visual Studio CMake directory on `PATH` and export `AWS_LC_SYS_PREBUILT_NASM=1` before building.

## Required checks

Run both before opening a pull request:

```bash
bash scripts/verify-local.sh
npm run build --prefix frontend
```

`verify-local.sh` covers contract format/tests, cross-language ticket-commitment parity, display/QR math, metadata/auth/HTTP end-to-end tests and the deploy handover. Do not skip, weaken or delete tests to make a change pass.

For UI changes, check the affected routes at 390, 768, 1024 and 1440 px for horizontal overflow, clipped text, overlapping controls and cramped touch targets.

## Code standards

- Keep the framework-agnostic `server/` modules free of Next.js imports.
- Keep browser bundles free of server secrets; only `NEXT_PUBLIC_*` values may be read in client code.
- Use integer/BigInt arithmetic for NEAR amounts; never floating point.
- Preserve fail-closed behaviour: missing configuration or an unavailable dependency returns an explicit error, never a simulated success.
- Prefer small, focused modules and pure functions that can be tested without credentials.
- Keep the Nocturne design tokens in `frontend/app/nocturne.css`; do not reintroduce content-hiding animation.

## Documentation

Update the relevant document with the code:

- `README.md` — first-read setup and status.
- `docs/DOCUMENTATION.md` — architecture, API, env and security.
- `docs/DEPLOY_RUNBOOK.md` — deployment/release procedure.
- `docs/METADATA.md` — canonical metadata and publication API.
- `BUILD_LOG.md` — append verified progress only.

## Commits and pull requests

- Write a clear, specific commit message.
- Do not include generated build output, `node_modules`, `.next`, databases or secrets.
- Describe the behaviour change, the tests you ran and any known limitation.
- Contract changes need tests for both the happy path and the adversarial path.

## Security

Do not report vulnerabilities in a public issue. See [`SECURITY.md`](./SECURITY.md).
