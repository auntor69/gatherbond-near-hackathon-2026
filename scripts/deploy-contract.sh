#!/usr/bin/env bash
# GatherBond deploy handover.
#
# Builds the release WASM, verifies the artifact, prints the storage-stake arithmetic
# and the exact deploy command. It NEVER deploys, creates accounts, signs anything or
# spends funds: every value is printed for a human to review and paste.
#
# Usage:
#   bash scripts/deploy-contract.sh
#
# Optional environment variables (all are printed with placeholders when unset):
#   CONTRACT_ACCOUNT  account that will host the contract
#   TREASURY_ACCOUNT  account allowed to withdraw accrued treasury funds
#   NETWORK_ID        defaults to "testnet"
#   EXPECTED_SHA256   when set, the build fails unless the artifact hash matches
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT_DIR="$ROOT/contracts"
SOURCE="$CONTRACT_DIR/src/lib.rs"
WASM="$CONTRACT_DIR/target/wasm32-unknown-unknown/release/gatherbond_escrow.wasm"
MAX_WASM_BYTES=4194304

# The Windows AWS-LC build needs prebuilt NASM and the Visual Studio CMake.
VS_CMAKE="/f/vsbuild/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin"
if [ -d "$VS_CMAKE" ]; then
  export PATH="$VS_CMAKE:$PATH"
fi
export AWS_LC_SYS_PREBUILT_NASM="${AWS_LC_SYS_PREBUILT_NASM:-1}"

echo "== GatherBond deploy handover =="
echo "workspace: $ROOT"
echo

echo "-- 1. Build (release, wasm32-unknown-unknown) --"
cargo build --release --target wasm32-unknown-unknown --manifest-path "$CONTRACT_DIR/Cargo.toml"
if [ ! -f "$WASM" ]; then
  echo "ERROR: missing artifact: $WASM" >&2
  exit 1
fi

SIZE="$(wc -c < "$WASM" | tr -d ' ')"
if [ "$SIZE" -le 0 ]; then
  echo "ERROR: artifact is empty" >&2
  exit 1
fi
if [ "$SIZE" -gt "$MAX_WASM_BYTES" ]; then
  echo "ERROR: artifact is ${SIZE} bytes, above the 4 MiB contract limit" >&2
  exit 1
fi

SHA="$(sha256sum "$WASM" | cut -d' ' -f1)"
if [ -n "${EXPECTED_SHA256:-}" ] && [ "${EXPECTED_SHA256}" != "$SHA" ]; then
  echo "ERROR: artifact hash mismatch" >&2
  echo "  expected: $EXPECTED_SHA256" >&2
  echo "  actual:   $SHA" >&2
  exit 1
fi

echo "artifact: $WASM"
echo "size:     $SIZE bytes"
echo "sha256:   $SHA"
echo

echo "-- 2. Storage-stake arithmetic (10^19 yoctoNEAR per byte) --"
# NEAR = bytes * 10^19 / 10^24 = bytes / 10^5; integer math keeps it exact.
WHOLE=$((SIZE / 100000))
FRAC=$((SIZE % 100000))
printf 'code stake:  %d.%05d NEAR  (%d bytes x 10^19 yoctoNEAR/byte)\n' "$WHOLE" "$FRAC" "$SIZE"
echo "state stake: measured at runtime; every growth receipt checks the actual delta"
echo "buffer:      0.001 NEAR minimum, or 5% of the storage stake"
printf 'suggested:   fund the testnet account with at least %d NEAR total\n' "$((WHOLE + 2))"
echo

echo "-- 3. Contract surface check --"
REQUIRED_METHODS=(
  new
  create_event
  register
  check_in
  rotate_ticket_commitment
  cancel_event
  finalize_event
  claim_settlement
  withdraw_treasury
  get_event
  get_events
  get_reservation
  get_reservations_for_account
  get_attendance_history
  get_treasury_balance
  get_total_liability
  get_pending_amount
)
for method in "${REQUIRED_METHODS[@]}"; do
  if ! grep -q "pub fn ${method}(" "$SOURCE"; then
    echo "ERROR: contract source is missing 'pub fn ${method}('" >&2
    exit 1
  fi
done
if ! grep -q "treasury: AccountId" "$SOURCE" || ! grep -q "network_id: String" "$SOURCE"; then
  echo "ERROR: init signature changed; update the deploy command's JSON args" >&2
  exit 1
fi
echo "all ${#REQUIRED_METHODS[@]} required methods present; init args match (treasury, network_id)"
echo

CONTRACT_ACCOUNT="${CONTRACT_ACCOUNT:-<CONTRACT_ACCOUNT>}"
TREASURY_ACCOUNT="${TREASURY_ACCOUNT:-<TREASURY_ACCOUNT>}"
NETWORK_ID="${NETWORK_ID:-testnet}"
INIT_ARGS="$(printf '{"treasury":"%s","network_id":"%s"}' "$TREASURY_ACCOUNT" "$NETWORK_ID")"

echo "-- 4. Deploy command (near-cli-rs; nothing is executed by this script) --"
cat <<EOF
near contract deploy $CONTRACT_ACCOUNT \\
  use-file $WASM \\
  with-init-call new json-args '$INIT_ARGS' \\
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \\
  network-config $NETWORK_ID sign-with-keychain send
EOF
echo
echo "Upgrade an existing contract (preserves state; do NOT call new):"
cat <<EOF
near contract deploy $CONTRACT_ACCOUNT \\
  use-file $WASM \\
  without-init-call network-config $NETWORK_ID \\
  sign-with-keychain send
EOF
echo
echo "Verify after deploy:"
cat <<EOF
near contract call-function as-read-only $CONTRACT_ACCOUNT get_network_id json-args '{}' network-config $NETWORK_ID now
near contract call-function as-read-only $CONTRACT_ACCOUNT get_event_count json-args '{}' network-config $NETWORK_ID now
EOF
echo
echo "Full acceptance sequence: docs/DEPLOY_RUNBOOK.md"
echo "Nothing was deployed and no account was touched."
