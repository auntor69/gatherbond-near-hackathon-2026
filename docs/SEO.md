# GatherBond — SEO & Crawlability

**Status:** live on Vercel · **Last verified:** 2026-11-13 (commit `76439b5`)
**Canonical production origin:** `https://gatherbond.vercel.app`
**Rule:** no unverified event may enter metadata, JSON-LD, the sitemap or a social card.

---

## 1. Objectives

GatherBond needs to be legible to three audiences at once:

1. **Judges and humans** opening a link in a chat or on X.
2. **Search crawlers** that do not execute the wallet app.
3. **The product itself**, which must never turn an unverified database row into public proof.

The implementation therefore has two hard constraints:

- **Server-rendered truth.** Event titles, dates, venues and proof counts are in the initial HTML, not only in a client `useEffect`.
- **Fail closed.** If the metadata store or NEAR RPC is unavailable, the page, sitemap and JSON-LD omit the event. There is no sample or cached substitute.

---

## 2. Canonical origin

One helper (`frontend/lib/site.js`) owns the origin:

```text
NEXT_PUBLIC_SITE_URL=https://gatherbond.vercel.app
```

- It strips a trailing slash and rejects non-HTTP(S) values.
- It falls back to `https://gatherbond.vercel.app` when unset.
- `absoluteUrl()`, `eventPath()` and `recapPath()` are used by metadata, JSON-LD, the sitemap and OpenGraph cards.
- `metadataBase` in `frontend/app/layout.js` is the same origin.
- Local development may use `http://localhost:3000` only to inspect local canonical tags. Never ship a localhost canonical.

**Rule:** set the same value in Vercel Production and Preview unless you explicitly want previews to canonicalize to production.

---

## 3. Route indexability

| Route | Rendering | Indexable | Canonical | In sitemap | Notes |
| --- | --- | --- | --- | --- | --- |
| `/` | Static + 60s ISR | Yes | `/` | Yes | Server-rendered verified shelf + JSON-LD |
| `/events/[id]` | Dynamic server render | Yes, when verified | `/events/[id]` | Yes, if verified | 404 for missing/unpublished; noindex for mismatch/offline |
| `/events/[id]/recap` | Dynamic server render | Yes, only after `closed` | `/events/[id]/recap` | Yes, only when closed | Open rooms are `noindex` because the proof is not final |
| `/studio` | Static app shell | No | `/studio` | No | Wallet/organizer state |
| `/commitments` | Static app shell | No | `/commitments` | No | Wallet/private state |
| `/api/*` | Dynamic | No | — | No | `Disallow: /api/` |
| Unknown path | 404 | No | — | No | Real HTTP 404 + Next noindex |
| `/opengraph-image` | Static image | N/A | — | No | 1200×630 brand card |
| `/events/[id]/opengraph-image` | Dynamic image | N/A | — | No | Generated from the verified publication |
| `/icon.svg`, `/manifest.webmanifest` | Static | N/A | — | No | App/install metadata |

`/robots.txt` allows the public surface and disallows `/api/`, `/studio` and `/commitments`.

---

## 4. Metadata implementation

| File | Responsibility |
| --- | --- |
| `frontend/app/layout.js` | `metadataBase`, title template, description, keywords, authors, canonical root, robots, OpenGraph, Twitter, icons, manifest, Apple web app, viewport |
| `frontend/app/page.js` | `Organization` + `WebSite` + verified `ItemList` JSON-LD; server-rendered listing |
| `frontend/app/events/[id]/page.js` | `generateMetadata`, canonical, per-event OG/Twitter image, Event JSON-LD, server-loaded event |
| `frontend/app/events/[id]/recap/page.js` | Proof-specific title/description, canonical, closed-only indexing, WebPage/BreadcrumbList JSON-LD |
| `frontend/app/studio/page.js` | `noindex, nofollow` + canonical |
| `frontend/app/commitments/page.js` | `noindex, nofollow` + canonical |
| `frontend/app/not-found.js` | “Page not found” title; Next emits the noindex |
| `frontend/app/robots.js` | robots route |
| `frontend/app/sitemap.js` | Verified-only sitemap, 1-hour revalidation |
| `frontend/app/manifest.js` | PWA/install metadata |
| `frontend/app/icon.svg` | Brand icon/favicon |
| `frontend/app/opengraph-image.js` | Root social card |
| `frontend/app/events/[id]/opengraph-image.js` | Event social card |
| `frontend/lib/seo.js` | Pure JSON-LD and description builders |
| `frontend/lib/site.js` | Canonical origin + path builders |
| `frontend/lib/serverEvents.mjs` | Verified server-side event/listing loader, request-cached |
| `frontend/components/json-ld.js` | Escaped JSON-LD script renderer |

### Title and description policy

- Root title: `GatherBond — Make plans. Keep them.`
- Child template: `%s · GatherBond`.
- Event title: the verified metadata title.
- Recap title: `${event.title} — Room proof`.
- Event description: organizer copy when present; otherwise a factual fallback built from category, venue and time. It always ends with the refundable NEAR Testnet bond line.
- Descriptions are collapsed to one line and truncated on a word boundary at 160 characters.
- No review counts, ratings, prices, attendance claims or financial figures are invented for metadata.

### OpenGraph and Twitter

- Root: `type=website`, site name, 1200×630 branded PNG.
- Event/recap: `type=article`, canonical URL, title, description, published time and the dynamic event card.
- Twitter: `summary_large_image` with the same image.
- Dynamic event cards show the verified title, category, UTC time and venue. If the event cannot be verified, the card says **Room unavailable** rather than inventing details.

---

## 5. Structured data

`frontend/lib/seo.js` builds JSON-LD as plain objects. `jsonLdString()` escapes `<`, U+2028 and U+2029 before the script is rendered.

| Graph | Used on | Contents |
| --- | --- | --- |
| `Organization` | Home | Name, URL, logo, GitHub/X `sameAs` |
| `WebSite` | Home | Name, alternate name, URL, description, language, publisher reference |
| `ItemList` | Home | Verified events only, canonical URLs, positions |
| `Event` | Event page | Name, description, canonical URL, per-event OG image, start/end, status, offline attendance, place, organizer, contract event ID, keywords, registration `validThrough` |
| `WebPage` + `BreadcrumbList` | Recap | Proof page identity, event `about`, home → event breadcrumb |

Deliberate omissions:

- **No `offers`.** The Testnet deposit is refundable and is not a ticket price; adding a price would misrepresent the economics.
- **No `aggregateRating` or review claims.** There are none.
- **No fake `performer` or `organizer.url`.** Only verified names are used.
- **No Event JSON-LD for an unverified row.** The event page returns a 404 or an error state instead.

Cancelled/failed event status maps to `https://schema.org/EventCancelled`; everything else maps to `EventScheduled`. A past settled event remains `EventScheduled`.

---

## 6. Sitemap

`frontend/app/sitemap.js`:

- Always includes `/`.
- Paginates the verified publication list in pages of 50 (up to 20 pages / 1,000 events).
- Adds `/events/[id]` only when `eventJsonLd()` can build a valid event.
- Adds `/events/[id]/recap` only when `eventLifecycle(event).closed` is true.
- Uses `publishedAt` as `lastModified`.
- Revalidates hourly.
- If the metadata store or RPC fails, it returns the static home entry instead of stale or invented events.

Observed local output on 2026-11-13:

```xml
<loc>https://gatherbond.vercel.app/</loc>
<loc>https://gatherbond.vercel.app/events/0</loc>
<loc>https://gatherbond.vercel.app/events/0/recap</loc>
```

Only one publication existed at the time. This is the expected result, not a truncated fixture.

---

## 7. Crawl controls

`robots.txt`:

```text
User-Agent: *
Allow: /
Disallow: /api/
Disallow: /studio
Disallow: /commitments

Host: https://gatherbond.vercel.app
Sitemap: https://gatherbond.vercel.app/sitemap.xml
```

- `noindex` is applied independently of `robots.txt` because crawlers may reach a URL from a direct link.
- `/studio` and `/commitments` expose wallet-dependent empty states; indexing them would show a blank product to search users.
- `HACKATHON.md` is not part of the public app and is unchanged.

---

## 8. Failure behavior

| Failure | Event page | Sitemap | JSON-LD | Social card |
| --- | --- | --- | --- | --- |
| Event not published | HTTP 404 | Excluded | None | Not used |
| Stored metadata hash mismatch | Error state, `noindex` metadata | Excluded | None | Generic fallback if requested |
| On-chain hash mismatch | Error state, `noindex` metadata | Excluded | None | Generic fallback |
| Database unavailable | Error/offline state, noindex | Home only | No event | Generic fallback |
| RPC unavailable | Offline state, noindex | Home only | No event | Generic fallback |
| Invalid ID | HTTP 404 | Excluded | None | Generic fallback |

The event page calls `notFound()` for an unpublished/invalid event, so the HTTP status is a real 404. The old client-only behavior (200 shell + error card) is gone.

---

## 9. Verification

### Automated

```bash
node --test frontend/lib/seo.test.mjs
bash scripts/verify-local.sh
npm run build --prefix frontend
```

The SEO test file covers canonical URL construction, path encoding, description truncation, useful fallbacks, Event JSON-LD, per-event OG image selection, cancelled status, graph composition, breadcrumbs, recap graphs and script-tag escaping. The full suite currently reports **75 frontend tests** (10 SEO).

### Local production server

```bash
npm run build --prefix frontend
npm run start --prefix frontend -- -p 3107
```

Observed:

```text
GET /                          200
GET /events/0                  200
GET /events/0/recap            200
GET /events/999999             404
GET /robots.txt                200
GET /sitemap.xml               200
GET /opengraph-image           200  image/png
GET /events/0/opengraph-image  200  image/png
```

Spot checks in the served HTML:

- `<title>Sunday Table · GatherBond</title>`
- `<link rel="canonical" href="https://gatherbond.vercel.app/events/0">`
- `<meta property="og:image" content="https://gatherbond.vercel.app/events/0/opengraph-image">`
- `<meta name="robots" content="index, follow">`
- an `application/ld+json` script containing `"@type":"Event"`
- the event title, venue and verified publication version in the initial HTML
- `/studio` and `/commitments`: `<meta name="robots" content="noindex, nofollow">`
- unknown path: HTTP 404 with only `noindex` robots metadata (Next may emit a second noindex tag for its 404 shell; there must be no `index` tag)

### Post-deploy checks

Completed on `https://gatherbond.vercel.app` at commit `76439b5`:

1. `NEXT_PUBLIC_SITE_URL` resolves to the production origin; canonical URLs use it.
2. `/robots.txt` and `/sitemap.xml` return `200`; the sitemap contains exactly the home page, verified event 0 and its closed recap.
3. The verified event's HTML contains its canonical, per-event OG meta and `Event` JSON-LD; the JSON-LD `image` is `/events/0/opengraph-image`.
4. `/events/0/opengraph-image` returns `image/png` at 1200×630.
5. `/events/999999` returns `404` and `noindex, nofollow`.
6. `/events/0` hydrates without a console hydration error; the timezone label moves from `your local timezone` to the device zone (`Asia/Dhaka`).

**Not yet done:** Google Search Console/Bing Webmaster Tools submission, indexing requests, and Google Rich Results validation. Those require search-engine account access; the production crawl itself has passed.

---

## 10. Maintenance rules

- Add a page only with a deliberate `index`/`noindex` choice and a canonical.
- Never put a draft, unpublished event or unverified RPC row into metadata, JSON-LD or the sitemap.
- Never add `offers`, ratings or attendance claims that the contract does not prove.
- Keep `NEXT_PUBLIC_SITE_URL` free of paths and trailing slashes.
- Keep JSON-LD serialization through `jsonLdString()`; do not hand-write a `<script>` string.
- After publishing a new event, allow up to one hour for the sitemap ISR or trigger a redeploy.
- Update this file and the README SEO section when routes, metadata or indexability change.
