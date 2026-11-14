import assert from "node:assert/strict";
import test from "node:test";

import { publicationRevalidationTargets } from "./publicationRevalidation.mjs";

test("publication revalidation covers the shelf, event, recap and card", () => {
  assert.deepEqual(publicationRevalidationTargets("12"), [
    { path: "/", type: "layout" },
    { path: "/events/12", type: "page" },
    { path: "/events/12/recap", type: "page" },
    { path: "/events/12/opengraph-image" },
  ]);
});

test("publication revalidation rejects non-canonical event ids", () => {
  for (const value of ["", " 12 ", "012", "-1", "1.5", "all", null, undefined]) {
    assert.deepEqual(publicationRevalidationTargets(value), []);
  }
});
