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

test("all no-shows leave no attendee reward", () => {
  const summary = flakeFundSummary({
    deposit: NEAR,
    registered: 4,
    checkedIn: 0,
    status: "Finalized",
  });
  assert.equal(summary.state, "finalized");
  assert.equal(summary.flakes, 4);
  assert.equal(summary.pool, 4n * NEAR);
  assert.equal(summary.rewardPerAttendee, 0n);
  assert.equal(summary.totalReturned, 0n);
  assert.equal(summary.remainder, 4n * NEAR);
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
