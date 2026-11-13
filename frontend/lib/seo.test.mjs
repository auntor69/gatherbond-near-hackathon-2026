import assert from "node:assert/strict";
import test from "node:test";

import {
  breadcrumbJsonLd,
  eventJsonLd,
  eventSeoDescription,
  homeGraph,
  itemListJsonLd,
  jsonLdString,
  metaDescription,
  organizationJsonLd,
  recapGraph,
} from "./seo.js";
import { DEFAULT_SITE_URL, absoluteUrl, eventPath, recapPath, siteUrl } from "./site.js";

const event = {
  id: "0",
  title: "Sunday Table",
  description: "",
  category: "Community",
  venue: "Banani Kitchen, Dhaka, Bangladesh",
  organizer: "cynopom.testnet",
  contractId: "cynopom.testnet",
  tags: ["supper", "community"],
  imageUrl: "",
  startAt: "2026-11-12T10:00:00.000Z",
  endAt: "2026-11-12T12:00:00.000Z",
  registrationDeadline: "2026-11-12T09:00:00.000Z",
  publishedAt: "2026-11-10T05:05:21.485Z",
  status: "Open",
};

test("site helpers produce one clean canonical origin and encoded paths", () => {
  assert.equal(siteUrl(), DEFAULT_SITE_URL);
  assert.equal(absoluteUrl("/events/0"), `${DEFAULT_SITE_URL}/events/0`);
  assert.equal(absoluteUrl("events/0"), `${DEFAULT_SITE_URL}/events/0`);
  assert.equal(eventPath("12"), "/events/12");
  assert.equal(recapPath("12"), "/events/12/recap");
  assert.equal(eventPath("a/b"), "/events/a%2Fb");
});

test("meta descriptions collapse whitespace and cut on a word boundary", () => {
  assert.equal(metaDescription("  one   room  "), "one room");
  const long = metaDescription("word ".repeat(80));
  assert.ok(long.length <= 160);
  assert.ok(long.endsWith("…"));
  assert.ok(!long.includes("word…word"));
});

test("event descriptions are useful even when the organizer left them blank", () => {
  const description = eventSeoDescription(event);
  assert.match(description, /Community gathering at Banani Kitchen/);
  assert.match(description, /refundable NEAR Testnet bond/i);
  assert.ok(description.length <= 160);
});

test("Event JSON-LD carries canonical identity, schedule, place and organizer", () => {
  const data = eventJsonLd(event);
  assert.equal(data["@type"], "Event");
  assert.equal(data.name, "Sunday Table");
  assert.equal(data.url, `${DEFAULT_SITE_URL}/events/0`);
  assert.equal(data.startDate, "2026-11-12T10:00:00.000Z");
  assert.equal(data.endDate, "2026-11-12T12:00:00.000Z");
  assert.equal(data.location.name, event.venue);
  assert.equal(data.organizer.name, event.organizer);
  assert.equal(data.eventStatus, "https://schema.org/EventScheduled");
  assert.equal(data.keywords, "supper, community");
  assert.deepEqual(data.image, [`${DEFAULT_SITE_URL}/events/0/opengraph-image`]);
  assert.equal(data.offers, undefined, "a testnet deposit is not a ticket price");
});

test("cancelled events are marked cancelled; incomplete data never invents a page", () => {
  assert.equal(
    eventJsonLd({ ...event, status: "Cancelled" }).eventStatus,
    "https://schema.org/EventCancelled",
  );
  assert.equal(eventJsonLd(null), null);
  assert.equal(eventJsonLd({ id: "0" }), null);
});

test("Event JSON-LD always points at the per-event OG card", () => {
  const data = eventJsonLd({ ...event, imageUrl: "https://example.com/photo.jpg" });
  assert.deepEqual(data.image, [`${DEFAULT_SITE_URL}/events/0/opengraph-image`]);
});

test("home graph is an Organization + WebSite + verified ItemList", () => {
  const graph = homeGraph([event]);
  assert.equal(graph["@context"], "https://schema.org");
  assert.equal(graph["@graph"][0]["@type"], "Organization");
  assert.equal(graph["@graph"][1]["@type"], "WebSite");
  assert.equal(graph["@graph"][2]["@type"], "ItemList");
  assert.equal(graph["@graph"][2].itemListElement[0].url, `${DEFAULT_SITE_URL}/events/0`);
  assert.equal(itemListJsonLd([]), null);
});

test("breadcrumbs and recap graph point at the canonical event and recap", () => {
  const crumbs = breadcrumbJsonLd(event);
  assert.equal(crumbs.itemListElement.length, 2);
  assert.equal(crumbs.itemListElement[1].item, `${DEFAULT_SITE_URL}/events/0`);

  const recap = recapGraph(event);
  assert.equal(recap["@graph"][0]["@type"], "WebPage");
  assert.equal(recap["@graph"][0].url, `${DEFAULT_SITE_URL}/events/0/recap`);
  assert.equal(recap["@graph"][0].about["@type"], "Event");
  assert.equal(recap["@graph"][1]["@type"], "BreadcrumbList");
});

test("JSON-LD serialization cannot close its script tag", () => {
  const serialized = jsonLdString({ value: "</script><script>alert(1)</script>" });
  assert.ok(!serialized.includes("</script>"));
  assert.ok(serialized.includes("\\u003c/script"));
  assert.equal(JSON.parse(serialized).value, "</script><script>alert(1)</script>");
});

test("organization identity is stable for graph references", () => {
  assert.equal(organizationJsonLd()["@id"], `${DEFAULT_SITE_URL}/#organization`);
  assert.equal(organizationJsonLd().sameAs.length, 2);
});
