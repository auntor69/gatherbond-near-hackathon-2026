import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { commitmentArray, ticketCommitmentHex } from "./ticketCommitment.mjs";
import {
  contractError,
  defaultSchedule,
  defaultScheduleForm,
  decodeTicket,
  encodeTicket,
  formatNearAmount,
  newTicketSecret,
  parseNear,
  scheduleError,
  scheduleFromForm,
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

test("scheduleFromForm keeps the organizer's own registration and check-in windows", () => {
  const schedule = scheduleFromForm({
    date: "2030-05-01",
    start_time: "19:00",
    end_time: "22:30",
    registration_date: "2030-04-28",
    registration_time: "18:00",
    checkin_open_time: "18:30",
    checkin_close_time: "22:00",
  });
  assert.equal(schedule.registration_deadline, "2030-04-28T18:00");
  assert.equal(schedule.start_at, "2030-05-01T19:00");
  assert.equal(schedule.end_at, "2030-05-01T22:30");
  assert.equal(schedule.checkin_open, "2030-05-01T18:30");
  assert.equal(schedule.checkin_close, "2030-05-01T22:00");
  assert.equal(scheduleError(schedule), null);
  assert.equal(scheduleFromForm({}), null);
  assert.match(
    scheduleError(
      scheduleFromForm({
        date: "2030-05-01",
        start_time: "19:00",
        end_time: "18:00",
        registration_date: "2030-05-01",
        registration_time: "17:00",
        checkin_open_time: "18:00",
        checkin_close_time: "18:30",
      }),
    ),
    /event end must be after the start/i,
  );
});

test("defaultScheduleForm produces a valid future window", () => {
  const form = defaultScheduleForm();
  assert.match(form.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(form.start_time, /^\d{2}:\d{2}$/);
  assert.match(form.end_time, /^\d{2}:\d{2}$/);
  const schedule = scheduleFromForm(form);
  assert.equal(scheduleError(schedule), null);
  assert.ok(schedule.registration_deadline <= schedule.start_at);
  assert.ok(schedule.checkin_open <= schedule.start_at);
  assert.equal(schedule.checkin_close, schedule.end_at);
});

test("toNanoseconds converts a valid instant and rejects invalid input", () => {
  assert.equal(
    toNanoseconds("2026-01-01T00:00:00.000Z"),
    (BigInt(Date.parse("2026-01-01T00:00:00.000Z")) * 1_000_000n).toString(),
  );
  assert.throws(() => toNanoseconds("not-a-date"), /valid date and time/i);
});

test("ticket codes round-trip without losing the event or attendee", () => {
  const source = {
    v: 1,
    networkId: "testnet",
    contractId: "cynopom.testnet",
    eventId: "42",
    attendee: "alice.testnet",
    secret: "ticket-secret_ABC-123",
  };
  const code = encodeTicket(source);
  assert.match(code, /^GB1\./);
  assert.deepEqual(decodeTicket(code), source);
});

test("ticket decoding rejects a wrong prefix, malformed payload and incomplete fields", () => {
  assert.throws(() => decodeTicket("GB2.abc"), /not a GatherBond ticket code/i);
  assert.throws(() => decodeTicket("GB1.%%%"));

  const incomplete = btoa(
    JSON.stringify({
      v: 1,
      networkId: "testnet",
      contractId: "cynopom.testnet",
      eventId: "0",
      attendee: "alice.testnet",
    }),
  );
  assert.throws(() => decodeTicket(`GB1.${incomplete}`), /incomplete/i);
});

test("newTicketSecret is URL-safe, full-length and non-repeating", () => {
  const first = newTicketSecret();
  const second = newTicketSecret();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("commitmentArray returns the 32-byte digest, not the canonical preimage", async () => {
  const input = {
    networkId: "testnet",
    contractId: "cynopom.testnet",
    eventId: "2",
    attendee: "cynopom.testnet",
    secret: "test-secret",
  };
  const hex = await ticketCommitmentHex(input, webcrypto.subtle);
  const array = await commitmentArray(input, webcrypto.subtle);
  assert.equal(array.length, 32);
  assert.equal(
    array.map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    hex,
  );
});

test("contractError surfaces ticket rotation failures without inventing success", () => {
  assert.match(
    contractError(new Error("No reservation for this attendee")),
    /No reservation for this attendee\. Nothing was changed\./,
  );
  assert.match(
    contractError(new Error("Settlement in flight for this event")),
    /Settlement in flight for this event\. Nothing was changed\./,
  );
});
