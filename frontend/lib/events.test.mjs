import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarFile,
  eventWhenLabel,
  formatDate,
  formatDay,
  formatMonth,
  formatNear,
  mapDetail,
  mapListing,
  statusLabel,
} from "./events.js";

const START_MS = 1_763_000_000_000;
const END_MS = START_MS + 3_600_000;
const ns = (milliseconds) => (BigInt(milliseconds) * 1_000_000n).toString();

function metadata(overrides = {}) {
  return {
    schema_version: 1,
    network_id: "testnet",
    contract_id: "contract.testnet",
    organizer_account_id: "organizer.testnet",
    title: "Demo night",
    description: "Commit to gather.",
    category: "community",
    venue: "Online",
    image_url: "https://images.example/demo.png",
    tags: ["demo", "community"],
    created_at: "2026-11-07T12:00:00Z",
    ...overrides,
  };
}

function onchain(overrides = {}) {
  return {
    event_id: 7,
    organizer: "organizer.testnet",
    start_at: ns(START_MS),
    end_at: ns(END_MS),
    registration_deadline: ns(START_MS - 60 * 60_000),
    checkin_open: ns(START_MS - 30 * 60_000),
    checkin_close: ns(END_MS),
    deposit: "1000000000000000000000000",
    capacity: 10,
    registered: 4,
    checked_in: 2,
    status: "Open",
    ...overrides,
  };
}

function listing(overrides = {}) {
  return {
    event: {
      network_id: "testnet",
      contract_id: "contract.testnet",
      event_id: "7",
    },
    metadata: metadata(),
    publication_version: 2,
    published_at: "2026-11-08T12:00:00Z",
    metadata_sha256: "a".repeat(64),
    create_tx_hash: "1111111111111111111111111111111111111111",
    onchain: onchain(),
    ...overrides,
  };
}

test("mapListing carries on-chain schedule, deposit and status onto a discovery card", () => {
  const mapped = mapListing(listing());
  assert.equal(mapped.id, "7");
  assert.equal(mapped.title, "Demo night");
  assert.equal(mapped.imageUrl, "https://images.example/demo.png");
  assert.deepEqual(mapped.tags, ["demo", "community"]);
  assert.equal(mapped.network, "testnet");
  assert.equal(mapped.contractId, "contract.testnet");
  assert.equal(mapped.startAt, new Date(START_MS).toISOString());
  assert.equal(mapped.endAt, new Date(END_MS).toISOString());
  assert.equal(mapped.checkinOpen, new Date(START_MS - 30 * 60_000).toISOString());
  assert.equal(mapped.checkinClose, new Date(END_MS).toISOString());
  assert.equal(mapped.deposit, "1000000000000000000000000");
  assert.equal(mapped.capacity, 10);
  assert.equal(mapped.registered, 4);
  assert.equal(mapped.checkedIn, 2);
  assert.equal(mapped.status, "Open");
  assert.equal(mapped.version, 2);
  assert.equal(mapped.hash, "a".repeat(64));
  assert.equal(mapped.createTxHash, "1111111111111111111111111111111111111111");
});

test("mapListing falls back safely when the contract read has no terms", () => {
  const mapped = mapListing(
    listing({ onchain: null, metadata: metadata({ image_url: undefined, tags: undefined }) }),
  );
  assert.equal(mapped.startAt, null);
  assert.equal(mapped.endAt, null);
  assert.equal(mapped.deposit, null);
  assert.equal(mapped.capacity, null);
  assert.equal(mapped.registered, null);
  assert.equal(mapped.checkedIn, null);
  assert.equal(mapped.status, "Published");
  assert.equal(mapped.onchain, null);
  assert.equal(mapped.imageUrl, "");
  assert.deepEqual(mapped.tags, []);
});

test("mapListing rejects an invalid contract timestamp instead of inventing a date", () => {
  const mapped = mapListing(listing({ onchain: onchain({ start_at: "not-a-timestamp" }) }));
  assert.equal(mapped.startAt, null);
});

test("mapDetail adds publication and reward fields without losing listing terms", () => {
  const body = {
    ...listing(),
    version: 2,
    published_at: "2026-11-08T12:00:00Z",
    published_by: "organizer.testnet",
    metadata_sha256: "b".repeat(64),
    onchain: onchain({
      reward_per_attendee: "500000000000000000000000",
      reward_pool: "1000000000000000000000000",
      refund_pool: "2000000000000000000000000",
    }),
  };
  const mapped = mapDetail(body);
  assert.equal(mapped.id, "7");
  assert.equal(mapped.title, "Demo night");
  assert.equal(mapped.publishedBy, "organizer.testnet");
  assert.equal(mapped.hash, "b".repeat(64));
  assert.equal(mapped.rewardPerAttendee, "500000000000000000000000");
  assert.equal(mapped.rewardPool, "1000000000000000000000000");
  assert.equal(mapped.refundPool, "2000000000000000000000000");
  assert.equal(mapped.status, "Open");
});

test("the contract status can change while the anchored metadata stays stable", () => {
  const open = mapListing(listing());
  const finalized = mapListing(
    listing({
      onchain: onchain({ status: "Finalized" }),
    }),
  );
  assert.equal(open.title, finalized.title);
  assert.equal(open.hash, finalized.hash);
  assert.equal(open.startAt, finalized.startAt);
  assert.equal(open.status, "Open");
  assert.equal(finalized.status, "Finalized");
});

test("event labels prefer the on-chain start and fall back to publication time", () => {
  assert.match(eventWhenLabel(mapListing(listing())), /Nov 13/);
  assert.match(
    eventWhenLabel(mapListing(listing({ onchain: null }))),
    /Listed Nov 08/,
  );
  assert.equal(eventWhenLabel({ startAt: null, publishedAt: null }), "Schedule on-chain");
  assert.equal(formatNear("1000000000000000000000000"), "1 NEAR");
  assert.equal(statusLabel("RegistrationClosed"), "Registration Closed");
});

test("date formatters are UTC and null-safe", () => {
  assert.equal(formatDay("2026-11-13T23:30:00Z"), "Nov 13");
  assert.equal(formatMonth("2026-11-13T23:30:00Z"), "NOV");
  assert.match(formatDate("2026-11-13T23:30:00Z"), /Nov 13.*11:30 PM UTC/);
  assert.equal(formatDate("not-a-date"), null);
  assert.equal(formatDay(null), null);
  assert.equal(formatMonth(undefined), null);
});

test("calendarFile creates a UTC event and escapes user text", () => {
  const file = calendarFile({
    id: "7",
    title: "Demo, night",
    description: "Line one\nLine two",
    venue: "Room; A",
    startAt: new Date(START_MS).toISOString(),
    endAt: new Date(END_MS).toISOString(),
  });
  assert.match(file, /UID:7@gatherbond/);
  assert.match(file, /SUMMARY:Demo\\, night/);
  assert.match(file, /DESCRIPTION:Line one\\nLine two/);
  assert.match(file, /LOCATION:Room\\; A/);
  assert.match(file, /DTSTART:\d{8}T\d{6}Z/);
  assert.match(file, /DTEND:\d{8}T\d{6}Z/);
  assert.equal(calendarFile({ startAt: null }), null);
});
