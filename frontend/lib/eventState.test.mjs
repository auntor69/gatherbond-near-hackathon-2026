import assert from "node:assert/strict";
import test from "node:test";

import {
  eventBelowFloor,
  eventCheckinState,
  eventClaimState,
  eventEnded,
  eventLifecycle,
  eventStarted,
  timestampMs,
} from "./eventState.js";

const START_MS = 1_763_000_000_000;
const END_MS = START_MS + 60 * 60_000;
const ns = (milliseconds) => (BigInt(milliseconds) * 1_000_000n).toString();

function event(overrides = {}) {
  return {
    status: "Open",
    start_at: ns(START_MS),
    end_at: ns(END_MS),
    checkin_open: ns(START_MS - 30 * 60_000),
    checkin_close: ns(END_MS),
    registered: 6,
    checked_in: 3,
    ...overrides,
  };
}

test("timestampMs accepts contract nanoseconds, milliseconds, seconds and ISO", () => {
  assert.equal(timestampMs(ns(START_MS)), START_MS);
  assert.equal(timestampMs(BigInt(ns(START_MS))), START_MS);
  assert.equal(timestampMs(START_MS), START_MS);
  assert.equal(timestampMs(String(START_MS)), START_MS);
  assert.equal(timestampMs(1_763_000_000), START_MS);
  assert.equal(timestampMs("1763000000"), START_MS);
  assert.equal(timestampMs(" 1763000000000000000 "), START_MS);
  assert.equal(
    timestampMs("2026-11-13T00:00:00.000Z"),
    Date.parse("2026-11-13T00:00:00.000Z"),
  );
});

test("timestampMs rejects absent, invalid and negative values", () => {
  for (const value of [
    null,
    undefined,
    "",
    "not-a-date",
    "1.5",
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    assert.equal(timestampMs(value), null, String(value));
  }
  assert.equal(timestampMs(0), 0);
  assert.equal(timestampMs("0"), 0);
});

test("event start and end boundaries include the exact instant", () => {
  const value = event();
  assert.equal(eventStarted(value, START_MS - 1), false);
  assert.equal(eventStarted(value, START_MS), true);
  assert.equal(eventEnded(value, END_MS - 1), false);
  assert.equal(eventEnded(value, END_MS), true);
  assert.equal(eventEnded(event({ end_at: null }), END_MS), false);
});

test("below-floor is inclusive at one fifth attendance and ignores empty events", () => {
  assert.equal(eventBelowFloor({ registered: 0, checked_in: 0 }), false);
  assert.equal(eventBelowFloor({ registered: 6, checked_in: 1 }), true);
  assert.equal(eventBelowFloor({ registered: 5, checked_in: 1 }), false);
  assert.equal(eventBelowFloor({ registered: 10, checked_in: 2 }), false);
  assert.equal(eventBelowFloor({ registered: 10, checked_in: 1 }), true);
  assert.equal(eventBelowFloor({ registered: 4, checked_in: 0 }), true);
});

test("an ended Open event is a UI-only settlement state, not a new contract status", () => {
  const pending = eventLifecycle(event(), END_MS + 1);
  assert.equal(pending.status, "Open");
  assert.equal(pending.ended, true);
  assert.equal(pending.closed, true);
  assert.equal(pending.settlementPending, true);
  assert.equal(pending.finalized, false);
  assert.equal(pending.refundsEveryone, false);
  assert.equal(pending.displayStatus, "Ended · settlement pending");

  const belowFloor = eventLifecycle(event({ registered: 10, checked_in: 1 }), END_MS + 1);
  assert.equal(belowFloor.refundsEveryone, true);

  const empty = eventLifecycle(event({ registered: 0, checked_in: 0 }), END_MS + 1);
  assert.equal(empty.displayStatus, "Ended · no reservations");
  assert.equal(empty.refundsEveryone, false);

  const open = eventLifecycle(event(), END_MS - 1);
  assert.equal(open.closed, false);
  assert.equal(open.settlementPending, false);
  assert.equal(open.displayStatus, "Open");
});

test("terminal statuses are closed, and cancellation or failure refunds everyone", () => {
  const finalized = eventLifecycle(event({ status: "Finalized" }), START_MS);
  assert.equal(finalized.closed, true);
  assert.equal(finalized.finalized, true);
  assert.equal(finalized.settlementPending, false);
  assert.equal(finalized.refundsEveryone, false);

  const finalizedBelowFloor = eventLifecycle(
    event({ status: "Finalized", registered: 10, checked_in: 1 }),
    START_MS,
  );
  assert.equal(finalizedBelowFloor.refundsEveryone, true);

  const cancelled = eventLifecycle(event({ status: "Cancelled" }), START_MS);
  assert.equal(cancelled.closed, true);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.refundsEveryone, true);

  const failed = eventLifecycle(event({ status: "Failed" }), START_MS);
  assert.equal(failed.closed, true);
  assert.equal(failed.failedStatus, true);
  assert.equal(failed.refundsEveryone, true);

  const unknown = eventLifecycle(event({ status: "SomethingElse" }), START_MS);
  assert.equal(unknown.closed, false);
  assert.equal(unknown.refundsEveryone, false);
  assert.equal(unknown.displayStatus, "SomethingElse");
});

test("check-in is open only inside the configured window on an Open event", () => {
  const value = event();
  assert.deepEqual(
    pick(eventCheckinState(value, START_MS - 30 * 60_000)),
    { allowed: true, reason: null },
  );
  assert.deepEqual(
    pick(eventCheckinState(value, START_MS - 30 * 60_000 - 1)),
    { allowed: false, reason: "not_open" },
  );
  assert.deepEqual(pick(eventCheckinState(value, END_MS)), { allowed: true, reason: null });
  assert.deepEqual(pick(eventCheckinState(value, END_MS + 1)), {
    allowed: false,
    reason: "closed",
  });
  assert.deepEqual(
    pick(eventCheckinState(event({ checkin_open: null }), START_MS)),
    { allowed: false, reason: "unavailable" },
  );
  assert.deepEqual(
    pick(eventCheckinState(event({ status: "Finalized" }), START_MS)),
    { allowed: false, reason: "closed" },
  );
});

function pick(state) {
  return { allowed: state.allowed, reason: state.reason };
}

test("claim eligibility follows settlement, attendance and refund rules", () => {
  const ended = { end_at: ns(END_MS - 1) };
  const now = END_MS;
  const claim = (overrides, reservation) =>
    eventClaimState(event({ ...ended, ...overrides }), reservation, now).canClaim;

  assert.equal(claim({}, { claim: "Unclaimed", checked_in: true }), true);
  assert.equal(claim({}, { claim: "Unclaimed", checkedIn: true }), true);
  assert.equal(claim({}, { claim: "Unclaimed", checked_in: false }), false);
  assert.equal(claim({}, { claim: "Claimed", checked_in: true }), false);
  assert.equal(claim({}, null), false);

  assert.equal(claim({ registered: 10, checked_in: 1 }, { claim: "Unclaimed", checked_in: false }), true);
  assert.equal(claim({ registered: 10, checked_in: 2 }, { claim: "Unclaimed", checked_in: false }), false);

  assert.equal(
    claim({ status: "Finalized" }, { claim: "Unclaimed", checked_in: false }),
    false,
  );
  assert.equal(
    claim(
      { status: "Finalized", registered: 10, checked_in: 1 },
      { claim: "Unclaimed", checked_in: false },
    ),
    true,
  );
  assert.equal(
    claim({ status: "Cancelled" }, { claim: "Unclaimed", checked_in: false }),
    true,
  );
  assert.equal(claim({ status: "Failed" }, { claim: "Unclaimed", checked_in: false }), true);
  assert.equal(
    claim({ status: "Finalized" }, { claim: "Claimed", checked_in: true }),
    false,
  );
});

test("an Open event before its end never offers a claim", () => {
  const state = eventClaimState(
    event(),
    { claim: "Unclaimed", checked_in: true },
    END_MS - 1,
  );
  assert.equal(state.canClaim, false);
  assert.equal(state.lifecycle.settlementPending, false);

  const atEnd = eventClaimState(
    event(),
    { claim: "Unclaimed", checked_in: true },
    END_MS,
  );
  assert.equal(atEnd.canClaim, true);
  assert.equal(atEnd.lifecycle.settlementPending, true);
});
