# GatherBond

**Commit to gather. Earn by showing up.**

GatherBond is a proposed crypto-native event commitment protocol for NEAR. Organizers create events with refundable native NEAR deposits; attendees register through a smart contract, receive one-time QR tickets, and can claim refunds and community rewards after organizer-authorized attendance verification.

> **Project status:** Escrow contract, off-chain metadata layer, a server-only HTTP metadata
> API with NEP-413 wallet sessions, rate limiting and a versioned organizer publication
> workflow implemented and locally tested; **nothing is deployed** and no UI screens exist
> yet. Do not treat this README as evidence of working features — see
> [`BUILD_LOG.md`](./BUILD_LOG.md) for verified results.

## Project documents

- [`HACKATHON.md`](./HACKATHON.md) — official NEAR HACKATHON 2026 organizer instructions, preserved as provided.
- [`MASTERPLAN.md`](./MASTERPLAN.md) — product, architecture, economic rules, development milestones, security requirements and definition of done.
- [`BUILD_LOG.md`](./BUILD_LOG.md) — verified progress, tests, deployment references and blockers.

## Planned network

NEAR Testnet only. No mainnet funds are used in the hackathon MVP.

## Planned MVP

1. Organizer creates an event and sets the native NEAR deposit.
2. Attendees connect wallets and register on-chain.
3. Organizer scans one-time QR tickets to record attendance.
4. Anyone can finalize after the event ends.
5. Verified attendees claim their deposit plus an equal share of no-show deposits.
6. Attendance history is queryable on-chain.

See [`MASTERPLAN.md`](./MASTERPLAN.md) for full requirements and implementation order.
