# GatherBond — Event Metadata Layer

**Status:** implemented and live on Turso · **Updated:** 2026-11-14
**Boundary:** display metadata only. The NEAR contract is authoritative for money, capacity, attendance, settlement and claims.

---

## 1. Why this layer exists

The contract needs a 32-byte `metadata_hash` for each event, but it should not store titles, descriptions, images or tags. GatherBond stores one canonical JSON document off-chain, anchors its SHA-256 on chain at `create_event`, and verifies both representations on every public read.

The metadata layer can:

- make a room readable and discoverable;
- preserve publication history;
- reject financial or unknown fields;
- hide a row whose hash no longer matches the chain.

It cannot:

- change a deposit, capacity or attendance;
- prove payment or check-in;
- make an unverified row visible;
- unpublish or delete a published event as its organizer through the current API. A separate allowlisted moderator can hide a public listing.

---

## 2. Canonical document

### 2.1 Allowed fields

| Field | Type | Limit | Required | Notes |
| --- | --- | --- | --- | --- |
| `schema_version` | integer | `1` | yes | Must be exactly `1` |
| `network_id` | string | 32 bytes | yes | `testnet` |
| `contract_id` | string | valid NEAR account | yes | `cynopom.testnet` |
| `organizer_account_id` | string | valid NEAR account | yes | Must match the authenticated actor |
| `title` | string | 140 bytes | yes | Non-blank |
| `description` | string | 4,000 bytes | yes | May be empty |
| `category` | string | 40 bytes | yes | Non-blank |
| `venue` | string | 200 bytes | yes | May be empty |
| `image_url` | string | 500 bytes | no | HTTP(S) URL or empty; no data URLs |
| `tags` | string[] | 8 items × 32 bytes | no | Trimmed, unique, no control characters |
| `created_at` | string | 40 bytes | yes | RFC3339 UTC |

Any other field is rejected, including `deposit`, `capacity`, `registered`, `checked_in`, `status`, `refund_pool` and `reward_pool`. Control characters (except normal whitespace) are rejected.

### 2.2 Canonicalization

1. Validate all fields and bounds.
2. Rebuild the object with only allowed fields.
3. Sort object keys recursively.
4. Serialize with `JSON.stringify` and no whitespace.
5. Compute SHA-256 over the UTF-8 bytes.

The digest is lowercase hex in the database and a 32-byte array on chain.

### 2.3 Verified example

This is the current live publication for event `12`:

```json
{
  "category": "Community",
  "contract_id": "cynopom.testnet",
  "created_at": "2026-11-14T21:33:51.815Z",
  "description": "An intimate builders' meetup for people curious about NEAR, Web3, and community-led projects. Bring a project, a question, or an idea to share. This is a GatherBond product demonstration on NEAR Testnet, not a confirmed public event. Reservations use testnet NEAR only, which has no real-world monetary value. Attendees receive a one-time ticket code, and the organizer records attendance during the event window. Refunds and any no-show pool distribution follow the on-chain contract rules.",
  "image_url": "https://i.ibb.co.com/5gVGdWDm/Gather-Bond-Dhaka-Builders-Table-Cover.png",
  "network_id": "testnet",
  "organizer_account_id": "gatherbond-demo-organizer.testnet",
  "schema_version": 1,
  "tags": ["NEAR", "Dhaka", "Builders", "Community", "Web3", "Meetup", "Testnet"],
  "title": "Dhaka Builders' Table",
  "venue": "Banani, Dhaka, Bangladesh"
}
```

```text
metadata_sha256  24c7ab39b08019d6bf4d2ba6c5090ce2f51dec760b48ec05863239e9d1696b5e
create_tx_hash   9PrJ26Y6TBYDs4MZv5mG2ndbs1XvuYxd8QbTaKT2ski3
publication v1   published 2026-11-14T21:34:31.293Z
```

---

## 3. Database schema

Migrations: `database/migrations/0001_event_metadata.sql` and `0002_event_moderation.sql`.

### 3.1 `event_metadata`

| Column | Purpose |
| --- | --- |
| `network_id`, `contract_id`, `event_id` | Primary identity; `event_id` is `TEXT` to preserve u64 above 2^53 |
| `organizer_account_id` | Authorized writer |
| `title`, `description`, `category`, `venue`, `image_url`, `tags_json` | Denormalized listing columns |
| `metadata_json` | Canonical document |
| `metadata_sha256` | 64-char hex digest |
| `create_tx_hash` | Contract creation transaction |
| `publication_status` | `pending`, `published`, legacy `hidden` |
| `created_at`, `updated_at` | Audit timestamps |

### 3.2 `event_publications`

Append-only log:

| Column | Purpose |
| --- | --- |
| `version` | Monotonic per event, starting at 1 |
| `action` | `publish` or legacy `unpublish` |
| `metadata_json`, `metadata_sha256`, `create_tx_hash` | Immutable snapshot for a publish |
| `published_by`, `published_at` | Actor and timestamp |

The highest version is current. A publish row is never mutated. The schema retains legacy `unpublish` tombstones because a database may predate the permanent-publication policy; **the current organizer API does not create new tombstones and exposes no delete action.** The store still understands an old tombstone as “the next publish must append a new version.” An allowlisted moderator can hide a listing using the separate `event_moderation` registry; that is reversible, audited and never edits publication history.

### 3.3 `event_moderation` and `event_moderation_log`

`event_moderation` holds only the currently hidden listings, keyed by `(network_id, contract_id, event_id)` with the reason, actor and timestamp. `event_moderation_log` is an append-only hide/restore audit trail. Restoring deletes the current hidden row and appends a restore entry; publication and contract history are never touched.

---

## 4. Verification rules

A row is public only if all of these are true:

1. `event_publications` has a current `publish` version.
2. The stored `metadata_json` re-hashes to `metadata_sha256`.
3. `get_event(event_id)` returns an event on the configured contract.
4. The on-chain `metadata_hash` equals `metadata_sha256`.

| Failure | Response |
| --- | --- |
| No publication | `404 not_published` |
| Event missing from chain | `409 event_not_found_on_chain` |
| Local or on-chain hash mismatch | `409 metadata_hash_mismatch` |
| Store unavailable | `503 metadata_store_unavailable` |
| RPC unavailable | `503 chain_unavailable` |
| Hidden by moderation | `404 not_published`; omitted from discovery/sitemap |
| Invalid event ID | `400 invalid_key` |

Discovery does not fail the whole list when one row is bad. It skips that row and increments `skipped`.

---

## 5. HTTP API

Base: `/api`. All responses are JSON with `cache-control: no-store`.

### 5.1 Public reads

#### `GET /api/events?limit=20&offset=0&category=Community`

```json
{
  "items": [
    {
      "event": {
        "network_id": "testnet",
        "contract_id": "cynopom.testnet",
        "event_id": "12"
      },
      "metadata": { "title": "Dhaka Builders' Table", "venue": "Banani, Dhaka, Bangladesh" },
      "metadata_sha256": "24c7ab39b08019d6bf4d2ba6c5090ce2f51dec760b48ec05863239e9d1696b5e",
      "metadata_hash": [36, 199, 171, 57, "..."],
      "publication_version": 1,
      "published_at": "2026-11-14T21:34:31.293Z",
      "create_tx_hash": "9PrJ26Y6TBYDs4MZv5mG2ndbs1XvuYxd8QbTaKT2ski3",
      "onchain": {
        "status": "Finalized",
        "deposit": "1000000000000000000000000",
        "capacity": 2,
        "registered": 2,
        "checked_in": 1
      }
    }
  ],
  "skipped": 0,
  "next_offset": 1
}
```

- `limit` is clamped to 1..50.
- `category` is an exact filter.
- Only verified current publications are returned.
- `onchain` is read live from RPC and may change without republishing metadata.

#### `GET /api/events/:id`

Returns the verified publication plus public contract terms. This is the event page's source.

```json
{
  "verified": true,
  "event": { "network_id": "testnet", "contract_id": "cynopom.testnet", "event_id": "12" },
  "version": 1,
  "publication_status": "published",
  "metadata": { "title": "Dhaka Builders' Table" },
  "metadata_sha256": "24c7ab39b08019d6bf4d2ba6c5090ce2f51dec760b48ec05863239e9d1696b5e",
  "published_by": "gatherbond-demo-organizer.testnet",
  "published_at": "2026-11-14T21:34:31.293Z",
  "onchain": { "status": "Finalized", "capacity": 2, "registered": 2, "checked_in": 1 }
}
```

#### `GET /api/events/:id/publication`

Returns only the current public snapshot. A draft returns `404 not_published`. The response contains `version`, `metadata`, `metadata_sha256`, `metadata_hash`, `create_tx_hash`, `published_by` and `published_at`.

#### `GET /api/events/:id/metadata`

Returns the organizer's current stored draft if it verifies against the chain, including `publication_status: "pending"` when it has never been published. A draft is **not** public discovery data.

### 5.2 Authenticated writes

Both endpoints require a valid NEP-413 session cookie. The actor is derived from the session, never from the body.

#### `PUT /api/events/:id/metadata`

```json
{
  "metadata": { "schema_version": 1, "title": "Dhaka Builders' Table", "..." : "..." },
  "create_tx_hash": "9PrJ26Y6TBYDs4MZv5mG2ndbs1XvuYxd8QbTaKT2ski3"
}
```

Flow:

1. Parse and validate canonical metadata.
2. Require actor = `organizer_account_id`.
3. Read `get_event(event_id)`.
4. Compare the submitted hash to the on-chain hash.
5. Store the draft idempotently.

Responses: `201` inserted, `200` idempotent update, `400` invalid metadata, `401` no session, `403` wrong organizer, `404` event not on chain, `409` hash mismatch, `503` store/RPC unavailable.

#### `POST /api/events/:id/publication`

No body. Appends the current verified draft as a new public version.

- `201` when a new version is appended.
- `200` when the current version already has identical content.
- `401` no session.
- `403` not the organizer.
- `404` no draft or no chain event.
- `409` draft no longer matches the chain.
- `503` store/RPC unavailable.

There is no `DELETE` and no organizer unpublish route. A private admin route can hide or restore the public listing without deleting publication or contract history.

### 5.3 Error envelope

```json
{ "error": "metadata_hash_mismatch", "detail": "optional safe diagnostic" }
```

Never expect the server to include credentials, tokens, full URLs or private keys.

---

## 6. Runtime selection

`server/metadata/runtime.mjs` wires the store, RPC reader, auth routes and handlers.

| Environment | Store |
| --- | --- |
| `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | Turso/libSQL via `@libsql/client/http` |
| `METADATA_SQLITE_PATH` | Local Node `node:sqlite` |
| neither | Unavailable store; routes return `503` |

The runtime is lazy. Importing a page or route during `next build` does not require credentials, does not open a database and does not read the migration file. The migration is loaded only when a SQLite/libSQL store opens.

`@libsql/client` is resolved through `createRequire` because the metadata layer lives outside `frontend/`. `frontend/next.config.mjs` traces the client and its transitive dependencies into API, home, event and sitemap functions.

---

## 7. Local verification

```bash
python scripts/generate_metadata_vectors.py     # regenerate known-answer vectors
node --test server/metadata/test/*.test.mjs     # handlers/store/canonical
bash scripts/verify-local.sh                    # full suite incl. live Next e2e
```

Covered:

- canonical bytes and known-answer vectors;
- object key ordering;
- u64 event IDs above 2^53;
- unknown and financial field rejection;
- bounds, control characters, URL schemes;
- idempotent save and hash conflicts;
- tamper detection;
- on-chain mismatch on write and read;
- cross-account rejection;
- append-only publication versions;
- unchanged republish no-op;
- legacy tombstone permanence;
- failed publication atomicity;
- concurrent identical and conflicting saves;
- concurrent publish version allocation;
- bounded lists and verification filtering;
- real HTTP login → PUT → publish → GET over Next + SQLite;
- fail-closed missing DB/RPC/auth paths.

Latest counts: **126 server/metadata/auth/admin/HTTP tests**, part of **257 total**.

---

## 8. Operations

### Publish a new event

```text
create_event(metadata_hash) on chain
  → PUT /api/events/:id/metadata
  → GET /api/events/:id/metadata   (verify)
  → POST /api/events/:id/publication
  → GET /api/events/:id            (public)
```

### Correct a mistake

Save a new draft whose canonical hash matches a new on-chain metadata hash, then publish a new version. You cannot edit a published version in place. Earlier versions remain.

### Withhold a listing

An allowlisted moderator can hide a listing from `/admin`. The action is reversible, audited, and scoped to the active contract. It does not delete the on-chain event, publication history or funds; the contract remains authoritative and directly callable.

### Health

```bash
curl -sS https://gatherbond.vercel.app/api/health
```

Expected live shape:

```json
{
  "database_mode": "turso",
  "database_reason": null,
  "database_error_code": null,
  "database_error_detail": null,
  "auth_configured": true,
  "contract_configured": true,
  "contract_id": "cynopom.testnet",
  "network_id": "testnet",
  "database_read": "ok"
}
```

---

## 9. Limits and non-goals

- Metadata is not a financial ledger.
- There is no rich-text/HTML rendering; descriptions are plain text.
- Images are URL references, not uploaded/stored blobs.
- There is no search index beyond SQL filtering and the client-side filter.
- Publication history is permanent; organizer deletion is a deliberate non-goal. A moderator can hide a listing, but cannot delete the contract event, publication history or funds.
- Rate limits are process-local.
- The operator can withhold; the contract remains authoritative.
- No analytics or audit-log export. The private moderation console is intentionally limited to hide/restore.

See [DOCUMENTATION.md](./DOCUMENTATION.md) for the full system and [SEO.md](./SEO.md) for how verified metadata becomes crawlable HTML.
