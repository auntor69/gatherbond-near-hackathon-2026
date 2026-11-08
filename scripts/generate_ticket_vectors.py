#!/usr/bin/env python3
"""Generate the known-answer vectors for the GatherBond ticket commitment.

This script is an *independent* implementation of the documented byte format. It is
used only to (re)write ``docs/ticket-commitment-vectors.json``; it must never be
imported by the contract or the frontend. Parity is proven by running each real
implementation against the generated file:

    cargo test --offline test_ticket_commitment_known_answer_vectors
    node scripts/verify-ticket-commitment.mjs
"""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

DOMAIN = b"GatherBond:v1"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "ticket-commitment-vectors.json"

NETWORK = "testnet"
CONTRACT = "contract.testnet"


def commitment(network: str, contract: str, event_id: int, attendee: str, secret: str) -> str:
    buf = bytearray(DOMAIN)
    for value in (network, contract):
        raw = value.encode("utf-8")
        buf += struct.pack("<I", len(raw)) + raw
    buf += struct.pack("<Q", event_id)
    for value in (attendee, secret):
        raw = value.encode("utf-8")
        buf += struct.pack("<I", len(raw)) + raw
    return hashlib.sha256(bytes(buf)).hexdigest()


CASES = [
    # name, event_id, attendee, secret
    ("baseline_event_zero", 0, "alice.testnet", "s3cret-ticket-0001"),
    ("empty_secret", 0, "alice.testnet", ""),
    ("unicode_secret", 7, "bob.testnet", "🎟️-ünïcode-秘密"),
    ("leading_zeros_secret", 12, "carol.testnet", "0000000000000001"),
    ("event_id_above_2_53", 9_007_199_254_740_993, "alice.testnet", "s3cret-ticket-0001"),
    ("event_id_u64_max", 18_446_744_073_709_551_615, "dave.testnet", "boundary"),
    (
        "hash_of_hash_secret",
        42,
        "alice.testnet",
        hashlib.sha256(b"GatherBond").hexdigest(),
    ),
    ("long_attendee_id", 3, "a" * 50 + ".testnet", "x" * 100),
]


def main() -> None:
    vectors = []
    for name, event_id, attendee, secret in CASES:
        vectors.append(
            {
                "name": name,
                "network_id": NETWORK,
                "contract_id": CONTRACT,
                "event_id": str(event_id),
                "attendee": attendee,
                "secret": secret,
                "digest_hex": commitment(NETWORK, CONTRACT, event_id, attendee, secret),
            }
        )

    document = {
        "format": "GatherBond ticket commitment v1",
        "encoding": (
            'SHA256("GatherBond:v1" || u32le(len(network_id)) || network_id '
            "|| u32le(len(contract_id)) || contract_id || u64le(event_id) "
            "|| u32le(len(attendee)) || attendee || u32le(len(secret)) || secret); "
            "lengths are UTF-8 byte lengths"
        ),
        "generated_by": "scripts/generate_ticket_vectors.py",
        "note": (
            "Known-answer vectors. Both contracts/src/lib.rs (ticket_commitment) and "
            "frontend/lib/ticketCommitment.mjs must reproduce every digest_hex exactly."
        ),
        "vectors": vectors,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(vectors)} vectors to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
