import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultSchedule,
  formatNearAmount,
  parseNear,
  scheduleError,
  toNanoseconds,
} from "./contract.js";

const NEAR = 1_000_000_000_000_000_000_000_000n;

test("parseNear accepts whole and fractional NEAR with up to 24 decimals", () => {
  assert.equal(parseNear("1"), NEAR.toString());
  assert.equal(parseNear("0.5"), (NEAR / 2n).toString());
  assert.equal(parseNear(" 2.25 "), (2n * NEAR + NEAR / 4n).toString());
  assert.equal(parseNear("0.000000000000000000000001"), "1");
  assert.equal(
    parseNear("1.000000000000000000000000"),
    NEAR.toString(),
  );
});

test("parseNear rejects zero, negative, malformed and over-precise amounts", () => {
  for (const value of [
    "",
    "0",
    "0.0",
    "-1",
    "1e3",
    "1.",
    ".5",
    "1.0000000000000000000000001",
    "not-a-number",
    null,
  ]) {
    assert.throws(() => parseNear(value), /NEAR amount|greater than zero/i);
  }
});

test("formatNearAmount shows whole amounts and truncates fractional display", () => {
  assert.equal(formatNearAmount(0n), "0 NEAR");
  assert.equal(formatNearAmount(NEAR), "1 NEAR");
  assert.equal(formatNearAmount((2n * NEAR).toString()), "2 NEAR");
  assert.equal(formatNearAmount(1n), "<0.0001 NEAR");
  assert.equal(
    formatNearAmount(99_999_999_999_999_999_999n),
    "<0.0001 NEAR",
  );
  assert.equal(
    formatNearAmount(100_000_000_000_000_000_000n),
    "0.0001 NEAR",
  );
  assert.equal(
    formatNearAmount(1_428_571_428_571_428_571_428_571n),
    "1.4285 NEAR",
  );
  assert.equal(
    formatNearAmount(1_999_999_999_999_999_999_999_999n),
    "1.9999 NEAR",
  );
  assert.equal(
    formatNearAmount(1_000_050_000_000_000_000_000_000n),
    "1.0000 NEAR",
  );
});

test("formatNearAmount is safe for missing or invalid values", () => {
  assert.equal(formatNearAmount(null), "—");
  assert.equal(formatNearAmount(undefined), "—");
  assert.equal(formatNearAmount(""), "—");
  assert.equal(formatNearAmount("not-a-number"), "—");
});

const SCHEDULE_BASE = Date.now();
const at = (minutes) =>
  new Date(SCHEDULE_BASE + minutes * 60_000).toISOString();

function validSchedule(overrides = {}) {
  return {
    registration_deadline: at(45),
    start_at: at(60),
    end_at: at(180),
    checkin_open: at(45),
    checkin_close: at(180),
    ...overrides,
  };
}

test("a well-formed future schedule passes validation", () => {
  assert.equal(scheduleError(validSchedule()), null);
  const boundary = validSchedule();
  assert.equal(
    scheduleError({
      ...boundary,
      registration_deadline: boundary.start_at,
      checkin_open: boundary.start_at,
    }),
    null,
  );
});

test("schedule validation rejects every invalid window ordering", () => {
  const cases = [
    [
      { end_at: "not-a-date" },
      /valid registration deadline, start, end and check-in window/i,
    ],
    [{ start_at: at(-1) }, /event start must be in the future/i],
    [{ end_at: at(60) }, /event end must be after the start/i],
    [
      { registration_deadline: at(-1) },
      /registration must close in the future/i,
    ],
    [
      { registration_deadline: at(90) },
      /registration must close no later than the event start/i,
    ],
    [
      { checkin_open: at(30) },
      /check-in cannot open before registration closes/i,
    ],
    [
      { checkin_open: at(90), checkin_close: at(90) },
      /check-in must close after it opens/i,
    ],
    [
      { end_at: at(120), checkin_close: at(180) },
      /check-in must close no later than the event ends/i,
    ],
  ];

  for (const [overrides, expected] of cases) {
    assert.match(scheduleError(validSchedule(overrides)), expected);
  }
});

test("defaultSchedule produces a valid event schedule", () => {
  assert.equal(scheduleError(defaultSchedule()), null);
});

test("toNanoseconds converts a valid instant and rejects invalid input", () => {
  assert.equal(
    toNanoseconds("2026-01-01T00:00:00.000Z"),
    (BigInt(Date.parse("2026-01-01T00:00:00.000Z")) * 1_000_000n).toString(),
  );
  assert.throws(() => toNanoseconds("not-a-date"), /valid date and time/i);
});
