#!/usr/bin/env python3
"""Generate known-answer vectors for the canonical event-metadata hash.

This is an independent implementation of the documented canonical JSON + SHA-256
format (see server/metadata/canonical.mjs and docs/METADATA.md). It writes
``docs/metadata-vectors.json``; it is never imported by the application. Parity is
checked by executing the JavaScript implementation against the generated file:

    node --test server/metadata/test/canonical.test.mjs
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "metadata-vectors.json"


def document(**overrides: object) -> dict:
    base = {
        "schema_version": 1,
        "network_id": "testnet",
        "contract_id": "contract.testnet",
        "organizer_account_id": "organizer.testnet",
        "title": "GatherBond demo night",
        "description": "Commit to gather.",
        "category": "community",
        "venue": "Online",
        "image_url": "https://example.com/poster.png",
        "tags": ["demo", "testnet"],
        "created_at": "2026-11-07T12:00:00Z",
    }
    base.update(overrides)
    return base


CASES = [
    ("baseline", document()),
    (
        "unicode",
        document(
            title="GatherBond 聚会 🎉",
            description="Ünïcode and 日本語 — emoji 🎟️.",
            venue="Dhaka · বাংলাদেশ",
            tags=["社区", "🎟️"],
        ),
    ),
    (
        "minimal_display_fields",
        document(description="", venue="", image_url="", tags=[], category="meetup"),
    ),
    (
        "escaped_characters",
        document(
            title='Quote "test"',
            description='He said "hello"\nand left\\a path\tend',
            tags=["a\\b", 'c"d'],
        ),
    ),
    (
        "tag_order_is_preserved",
        document(tags=["zeta", "alpha", "middle"]),
    ),
    (
        "bounds",
        document(title="x" * 140, description="y" * 500, tags=["t" * 32]),
    ),
    (
        "subaccounts",
        document(
            contract_id="app.gatherbond.testnet",
            organizer_account_id="org.gatherbond.testnet",
        ),
    ),
]


def main() -> None:
    vectors = []
    for name, doc in CASES:
        canonical = json.dumps(
            doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        )
        vectors.append(
            {
                "name": name,
                "input": doc,
                "canonical_json": canonical,
                "digest_hex": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
            }
        )

    payload = {
        "format": "GatherBond event metadata v1",
        "encoding": (
            "SHA-256 over canonical JSON: sorted keys, no whitespace, UTF-8, tags in "
            "order; event_id is excluded and bound by the create_event transaction + row key"
        ),
        "generated_by": "scripts/generate_metadata_vectors.py",
        "vectors": vectors,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"wrote {len(vectors)} vectors to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
