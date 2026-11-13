import assert from "node:assert/strict";
import test from "node:test";

import { createSingleFlight } from "./singleFlight.js";

test("begin excludes a second action until end", () => {
  const guard = createSingleFlight();
  assert.equal(guard.begin(), true);
  assert.equal(guard.begin(), false);
  guard.end();
  assert.equal(guard.begin(), true);
});

test("end is idempotent and independent guards do not block each other", () => {
  const first = createSingleFlight();
  const second = createSingleFlight();
  assert.equal(first.begin(), true);
  assert.equal(second.begin(), true);
  first.end();
  first.end();
  assert.equal(first.begin(), true);
  assert.equal(second.begin(), false);
});
