#!/usr/bin/env bash
# PortMaster regression suite — run from anywhere.
#   bash games/harbor/tests/run.sh
# Runs: headless sim/systems test (Node) + headless browser integration (Playwright) +
# the portal pre-flight (factory/playtest.py). Non-zero exit if any stage fails.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
NODE="$(command -v node || echo /opt/node22/bin/node)"
fail=0

echo "== [1/3] sim + systems (Node, deterministic) =="
"$NODE" "$HERE/sim.test.js" || fail=1

echo "== [2/3] browser integration (headless swiftshader) =="
"$NODE" "$HERE/browser.test.js" || fail=1

echo "== [3/3] portal pre-flight (factory/playtest.py) =="
if command -v python3 >/dev/null 2>&1; then
  ( cd "$REPO" && python3 factory/playtest.py harbor 2>&1 | tail -1 ) || fail=1
else
  echo "  (python3 unavailable — skipped)"
fi

echo "======================================"
if [ "$fail" -eq 0 ]; then echo "SUITE GREEN"; else echo "SUITE RED — see failures above"; fi
exit $fail
