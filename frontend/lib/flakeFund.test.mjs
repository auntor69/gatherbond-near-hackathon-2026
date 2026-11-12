import assert from "node:assert/strict";
import test from "node:test";

import {
  flakeFundSummary,
  formatShowUpRate,
  showUpRate,
  toBigInt,
} from "./flakeFund.js";

const NEAR = 1_000_000_000_000_000_000_000_000n;

test("empty event has no invented pool", () => {
  const summary = flakeFundSummary({ deposit: NEAR, registered: 0, checkedIn: 0 });
  assert.equal(summary.state, "empty");
  assert.equal(summary.pool, 0n);
  assert.equal(summary.projectedPool, 0n);
});

test("missing or invalid amounts become zero, never NaN", () => {
  assert.equal(toBigInt(undefined), 0n);
  assert.equal(toBigInt("not-a-number"), 0n);
  assert.equal(toBigInt("-5"), 0n);
});

test("finalized event distributes the pool equally with integer rounding", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 10,
    checkedIn: 8,
    status: "Finalized",
  });
  assert.equal(summary.state, "finalized");
  assert.equal(summary.flakes, 2);
  assert.equal(summary.pool, 2n * NEAR);
  assert.equal(summary.rewardPerAttendee, NEAR / 4n);
  assert.equal(summary.totalRefund, 8n * NEAR);
  assert.equal(summary.totalReturned, 10n * NEAR);
  assert.equal(summary.remainder, 0n);
  assert.equal(formatShowUpRate(summary.showUpRate), "80%");
});

test("integer remainder goes to treasury, not to an attendee", () => {
  const deposit = 7n;
  const summary = flakeFundSummary({
    deposit,
    registered: 3,
    checkedIn: 2,
    status: "Finalized",
  });
  assert.equal(summary.pool, 7n);
  assert.equal(summary.rewardPerAttendee, 3n);
  assert.equal(summary.totalReturned, 14n + 6n);
  assert.equal(summary.remainder, 1n);
});

test("all no-shows refund every deposit and leave no attendee reward", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 4,
    checkedIn: 0,
    status: "Finalized",
  });
  assert.equal(summary.state, "failed");
  assert.equal(summary.flakes, 4);
  assert.equal(summary.pool, 0n);
  assert.equal(summary.rewardPerAttendee, 0n);
  assert.equal(summary.totalRefund, 4n * NEAR);
  assert.equal(summary.totalReturned, 4n * NEAR);
  assert.equal(summary.remainder, 0n);
});

test("below 20% attendance refunds every reservation", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 6,
    checkedIn: 1,
    status: "Finalized",
  });
  assert.equal(summary.state, "failed");
  assert.equal(summary.totalRefund, 6n * NEAR);
  assert.equal(summary.pool, 0n);
  assert.equal(summary.rewardPerAttendee, 0n);
});

test("exactly 20% attendance settles the no-show pool equally", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 5,
    checkedIn: 1,
    status: "Finalized",
  });
  assert.equal(summary.state, "finalized");
  assert.equal(summary.pool, 4n * NEAR);
  assert.equal(summary.rewardPerAttendee, 4n * NEAR);
  assert.equal(summary.totalRefund, NEAR);
  assert.equal(summary.totalReturned, 5n * NEAR);
});

test("cancelled event refunds every registered deposit and has no pool", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 3,
    checkedIn: 1,
    status: "Cancelled",
  });
  assert.equal(summary.state, "cancelled");
  assert.equal(summary.totalRefund, 3n * NEAR);
  assert.equal(summary.pool, 0n);
  assert.equal(summary.rewardPerAttendee, 0n);
});

test("open event projection is labelled and uses the requested no-show rate", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 10,
    checkedIn: 2,
    status: "Open",
    projectedNoShowBps: 2000,
  });
  assert.equal(summary.state, "open");
  assert.equal(summary.projections.flakes, 2);
  assert.equal(summary.projections.attendees, 8);
  assert.equal(summary.projections.pool, 2n * NEAR);
  assert.equal(summary.projections.rewardPerAttendee, NEAR / 4n);
  assert.equal(summary.oneFlakeReward, NEAR / 9n);
});

test("open event with one reservation waits for a second person", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 1,
    checkedIn: 0,
    status: "Open",
  });
  assert.equal(summary.state, "waiting");
  assert.equal(summary.projectedPool, 0n);
});

test("projection never allocates the pool to zero attendees", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 2,
    checkedIn: 0,
    status: "Open",
    projectedNoShowBps: 10_000,
  });
  assert.equal(summary.projections.flakes, 1);
  assert.equal(summary.projections.attendees, 1);
  assert.equal(summary.projections.rewardPerAttendee, NEAR);
});

test("show-up rate is bounded and empty is zero", () => {
  assert.equal(showUpRate(0, 0), 0);
  assert.equal(showUpRate(10, 20), 1);
  assert.equal(showUpRate(10, -5), 0);
  assert.equal(formatShowUpRate(0.756), "76%");
});

test("a finalized event with no reservations is still finalized", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 0,
    checkedIn: 0,
    status: "Finalized",
  });
  assert.equal(summary.state, "finalized");
  assert.equal(summary.registered, 0);
  assert.equal(summary.pool, 0n);
  assert.equal(summary.rewardPerAttendee, 0n);
  assert.equal(summary.totalRefund, 0n);
  assert.equal(summary.totalReturned, 0n);
});

test("a cancelled event with no reservations is still cancelled", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 0,
    checkedIn: 0,
    status: "Cancelled",
  });
  assert.equal(summary.state, "cancelled");
  assert.equal(summary.registered, 0);
  assert.equal(summary.totalRefund, 0n);
  assert.equal(summary.pool, 0n);
});

test("checked-in count is clamped to registrations, never over 100%", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 2,
    checkedIn: 9,
    status: "Finalized",
  });
  assert.equal(summary.checkedIn, 2);
  assert.equal(summary.flakes, 0);
  assert.equal(summary.pool, 0n);
  assert.equal(summary.showUpRate, 1);
  assert.equal(formatShowUpRate(summary.showUpRate), "100%");
});

test("a single attendee gets the deposit back but no flake reward", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 1,
    checkedIn: 1,
    status: "Finalized",
  });
  assert.equal(summary.state, "finalized");
  assert.equal(summary.pool, 0n);
  assert.equal(summary.rewardPerAttendee, 0n);
  assert.equal(summary.totalRefund, NEAR);
  assert.equal(summary.totalReturned, NEAR);
  assert.equal(summary.remainder, 0n);
});

test("a failed event exposes a full refund and no treasury capture", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 4,
    checkedIn: 0,
    status: "Finalized",
  });
  assert.equal(summary.state, "failed");
  assert.equal(summary.flakes, 4);
  assert.equal(summary.pool, 0n);
  assert.equal(summary.rewardPerAttendee, 0n);
  assert.equal(summary.totalRefund, 4n * NEAR);
  assert.equal(summary.totalReturned, 4n * NEAR);
  assert.equal(summary.remainder, 0n);
  assert.equal(formatShowUpRate(summary.showUpRate), "0%");
});

test("projection rounds to the nearest attendee at the halfway point", () => {
  assert.equal(
    flakeFundSummary({ deposit: NEAR, registered: 3, checkedIn: 0 }).projectedFlakes,
    1,
  );
  assert.equal(
    flakeFundSummary({ deposit: NEAR, registered: 8, checkedIn: 0 }).projectedFlakes,
    2,
  );
  assert.equal(
    flakeFundSummary({ deposit: NEAR, registered: 10, checkedIn: 0 }).projectedFlakes,
    2,
  );
});

test("projection clamps a zero, negative or invalid no-show rate to one flake", () => {
  for (const projectedNoShowBps of [0, -1000, "not-a-number"]) {
    const summary = flakeFundSummary({
      deposit: NEAR,
      registered: 4,
      checkedIn: 0,
      projectedNoShowBps,
    });
    assert.equal(summary.projections.flakes, 1);
    assert.equal(summary.projections.attendees, 3);
  }
});

test("projection clamps rates above 100% and leaves one attendee", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 5,
    checkedIn: 0,
    projectedNoShowBps: 20_000,
  });
  assert.equal(summary.projections.noShowBps, 10_000);
  assert.equal(summary.projections.flakes, 4);
  assert.equal(summary.projections.attendees, 1);
  assert.equal(summary.projections.rewardPerAttendee, 4n * NEAR);
});

test("formatShowUpRate clamps values and handles invalid input", () => {
  assert.equal(formatShowUpRate(1.5), "100%");
  assert.equal(formatShowUpRate(-0.2), "0%");
  assert.equal(formatShowUpRate(Number.NaN), "0%");
  assert.equal(formatShowUpRate(Number.POSITIVE_INFINITY), "0%");
  assert.equal(formatShowUpRate(0.005), "1%");
});

test("an unknown status is treated as an open projection, not a settlement", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 3,
    checkedIn: 1,
    status: "Paused",
  });
  assert.equal(summary.state, "open");
  assert.equal(summary.rewardPerAttendee, 0n);
  assert.equal(summary.pool, 0n);
  assert.ok(summary.projectedPool > 0n);
});

test("an open event with no deposit is empty, not a projection", () => {
  const summary = flakeFundSummary({
    deposit: 0,
    registered: 4,
    checkedIn: 0,
    status: "Open",
  });
  assert.equal(summary.state, "empty");
  assert.equal(summary.pool, 0n);
  assert.equal(summary.projectedPool, 0n);
});

test("non-integer and fractional counters are normalized safely", () => {
  assert.equal(toBigInt(1.5), 0n);
  assert.equal(toBigInt(true), 0n);
  assert.equal(showUpRate(4, 2), 0.5);
  assert.equal(showUpRate(3.9, 1.9), 1 / 3);
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: "3.9",
    checkedIn: "9.9",
    status: "Finalized",
  });
  assert.equal(summary.registered, 3);
  assert.equal(summary.checkedIn, 3);
});
