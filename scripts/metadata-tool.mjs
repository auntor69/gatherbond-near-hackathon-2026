#!/usr/bin/env node
// GatherBond metadata CLI.
//
//   node scripts/metadata-tool.mjs hash < metadata.json
//       Validate the document, print canonical JSON, SHA-256 hex and the [u8;32] array.
//
//   CONTRACT_ID=gatherbond.testnet ORGANIZER_ID=organizer.testnet \
//     node scripts/metadata-tool.mjs demo
//       Build a demo document (used by docs/DEPLOY_RUNBOOK.md) and print the same fields.
//
// The `metadata_hash` array is the value `create_event` expects on-chain.
import { readFileSync } from "node:fs";
import { hashMetadata } from "../server/metadata/canonical.mjs";

const [command] = process.argv.slice(2);

async function emit(input) {
  const hashed = await hashMetadata(input);
  console.log(
    JSON.stringify(
      {
        metadata: hashed.metadata,
        metadata_json: hashed.canonical,
        metadata_sha256: hashed.hex,
        metadata_hash: hashed.array,
      },
      null,
      2,
    ),
  );
}

if (command === "hash") {
  const raw = readFileSync(0, "utf8");
  await emit(JSON.parse(raw));
} else if (command === "demo") {
  await emit({
    schema_version: 1,
    network_id: process.env.NETWORK_ID ?? "testnet",
    contract_id: process.env.CONTRACT_ID ?? "contract.testnet",
    organizer_account_id: process.env.ORGANIZER_ID ?? "organizer.testnet",
    title: "GatherBond demo event",
    description: "M1 acceptance run: create, register, check in, finalize, claim.",
    category: "community",
    venue: "Online",
    image_url: "",
    tags: ["demo", "testnet"],
    created_at: new Date().toISOString(),
  });
} else {
  console.error("usage: node scripts/metadata-tool.mjs hash < metadata.json | demo");
  process.exit(2);
}
