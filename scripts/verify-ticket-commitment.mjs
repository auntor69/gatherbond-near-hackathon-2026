#!/usr/bin/env node
// Verify the frontend ticket-commitment implementation against every known-answer
// vector. Exits non-zero on the first mismatch, printing the full comparison.
//
//   node scripts/verify-ticket-commitment.mjs
//
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { ticketCommitmentHex } from "../frontend/lib/ticketCommitment.mjs";

const vectorsUrl = new URL("../docs/ticket-commitment-vectors.json", import.meta.url);
const document = JSON.parse(readFileSync(vectorsUrl, "utf8"));

let failures = 0;
for (const vector of document.vectors) {
  const actual = await ticketCommitmentHex(
    {
      networkId: vector.network_id,
      contractId: vector.contract_id,
      eventId: vector.event_id,
      attendee: vector.attendee,
      secret: vector.secret,
    },
    webcrypto.subtle,
  );
  const ok = actual === vector.digest_hex;
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? "ok  " : "FAIL"} ${vector.name.padEnd(24)} ${actual}`);
  if (!ok) {
    console.log(`     expected                  ${vector.digest_hex}`);
  }
}

const total = document.vectors.length;
console.log(`\n${total - failures}/${total} vectors matched`);
process.exit(failures === 0 ? 0 : 1);
