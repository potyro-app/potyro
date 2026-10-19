#!/usr/bin/env bash
# The CI benchmark: the same workload on any machine, timed step by step, so CI hosts are compared on
# measurements rather than on core counts. Prints one JSON line (and writes bench-result.json).
#
#   bash scripts/bench-ci.sh            # from a checkout of the commit being measured
#
# Steps: a clean install, the build, every unit test, and a fixed sample of 20 e2e spec files (69
# tests, trusted project, one worker — the suite's own unit of parallelism). Needs Node 22 + pnpm,
# and Playwright's Chromium (`pnpm exec playwright install --with-deps chromium`).
set -uo pipefail
cd "$(dirname "$0")/.."
SAMPLE="e2e/enums-trusted.spec.ts e2e/dates-trusted.spec.ts e2e/number-field-trusted.spec.ts e2e/switch-row-trusted.spec.ts e2e/relation-picker-trusted.spec.ts e2e/search-chip-trusted.spec.ts e2e/grouped-sections-trusted.spec.ts e2e/form-groups-trusted.spec.ts e2e/layouts-trusted.spec.ts e2e/summary-trusted.spec.ts e2e/timeline-trusted.spec.ts e2e/progress-trusted.spec.ts e2e/board-trusted.spec.ts e2e/list-rows-trusted.spec.ts e2e/i18n-trusted.spec.ts e2e/plants-trusted.spec.ts e2e/recipes-trusted.spec.ts e2e/places-trusted.spec.ts e2e/groceries-trusted.spec.ts e2e/storage-owner-trusted.spec.ts"
now() { date +%s.%N; }
secs() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", b - a }'; }
step() { # name, command…
  local name=$1; shift
  local t0; t0=$(now)
  "$@" > "bench-$name.log" 2>&1; local code=$?
  echo "\"$name\": { \"s\": $(secs "$t0" "$(now)"), \"ok\": $([ $code -eq 0 ] && echo true || echo false) }"
}
CPU=$(lscpu 2>/dev/null | awk -F: '/Model name/ { gsub(/^ +/, "", $2); print $2; exit }')
THREADS=$(nproc)
MEM=$(awk '/MemTotal/ { printf "%.0f", $2 / 1048576 }' /proc/meminfo)
rm -rf node_modules/.vite-e2e
R1=$(step install pnpm install --frozen-lockfile)
R2=$(step build pnpm -r build)
R3=$(step unit pnpm -r test)
R4=$(step e2e_sample env POTYRO_E2E_PORT_BASE=23500 pnpm exec playwright test $SAMPLE --project=trusted --workers=1 --retries=0 --reporter=line)
E2E=$(grep -oE '[0-9]+ (passed|failed|flaky)' bench-e2e_sample.log | tr '\n' ' ')
JSON="{ \"host\": \"${BENCH_HOST:-$(hostname)}\", \"cpu\": \"$CPU\", \"threads\": $THREADS, \"memGB\": $MEM, $R1, $R2, $R3, $R4, \"e2e_tests\": \"$E2E\", \"commit\": \"$(git rev-parse --short HEAD)\" }"
echo "$JSON" | tee bench-result.json
