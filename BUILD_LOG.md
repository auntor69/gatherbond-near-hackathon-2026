# GatherBond Build Log

Use this file to record only verified progress. Update it after each implementation session.

## 2026-11-06 — Project definition and repository bootstrap

**Status:** Planning. No contract deployed; no wallet transactions or application features implemented yet.

### Confirmed decisions

- Working project name: GatherBond (clearance not complete).
- NEAR testnet, native NEAR deposits, one Rust smart contract.
- Organizer sets deposit per event.
- Support campus/community and professional events.
- On-chain attendance record in MVP; no NFT minting.
- Refund plus equal share of no-show deposits for verified attendees.
- No-show forfeits deposit; organizer cancellation before event start gives full refunds.
- Turso may store off-chain event metadata/search only. NEAR contract remains authoritative for money, reservations, attendance and claims.
- Vercel free tier target; $0 budget target.

### Verified work

- Product scope and implementation plan drafted.
- Official hackathon instructions copied into `HACKATHON.md` without modification from the supplied file.

### Not yet done

- GitHub repository creation and upload.
- Environment/toolchain audit.
- Rust contract or frontend implementation.
- Testnet deployment, wallet connection, deposit, refund or QR check-in.
- Turso database creation.
- Vercel deployment or public demo.

### Next action

Create the private GitHub repository, add the project documents, then ask the coding agent to perform Milestone 0 (inspection only) from `MASTERPLAN.md`.
