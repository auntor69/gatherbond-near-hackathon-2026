#!/usr/bin/env bash
# One clean local verification run: contract format + tests (zero warnings), ticket
# commitment parity, event-metadata tests, and the print-only deploy handover.
# No deployment, no accounts, no signatures, no funds.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$(mktemp -t gatherbond-cargo-XXXXXX.log)"
trap 'rm -f "$LOG"' EXIT

VS_CMAKE="/f/vsbuild/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin"
if [ -d "$VS_CMAKE" ]; then
  export PATH="$VS_CMAKE:$PATH"
fi
export AWS_LC_SYS_PREBUILT_NASM="${AWS_LC_SYS_PREBUILT_NASM:-1}"

echo "== 1/6 contract format =="
(cd "$ROOT/contracts" && cargo fmt --check)
echo "fmt: clean"

echo "== 2/6 contract tests =="
(cd "$ROOT/contracts" && cargo test --offline) 2>&1 | tee "$LOG"
if grep -q '^warning' "$LOG"; then
  echo "FAIL: compiler warnings present" >&2
  exit 1
fi
grep -E '^test result' "$LOG"

echo "== 3/6 ticket-commitment parity =="
node "$ROOT/scripts/verify-ticket-commitment.mjs"

echo "== 4/6 frontend event state, display, contract math and QR helpers =="
node --test "$ROOT"/frontend/lib/*.test.mjs

echo "== 5/6 metadata + auth + publication + HTTP tests (incl. live Next + SQLite end-to-end) =="
node --test "$ROOT"/server/metadata/test/*.test.mjs "$ROOT"/server/auth/test/*.test.mjs "$ROOT"/server/http/test/*.test.mjs "$ROOT"/server/near/test/*.test.mjs

echo "== 6/6 deploy handover (print-only) =="
bash "$ROOT/scripts/deploy-contract.sh"

echo
echo "ALL LOCAL CHECKS PASSED"
