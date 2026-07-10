#!/usr/bin/env bash
# PortMaster — long-session soak test runner.
#   bash games/harbor/tests/run-soak.sh [minutes]     (default 22)
#
# This is deliberately EXCLUDED from the fast regression suite (tests/run.sh) — it runs a
# weighted-random "monkey" against the real UI for ~20-30 minutes of real wall time to prove
# an evening play session survives (no leak, no fps collapse, no DOM growth, save intact).
# Run it manually / on demand, not as part of every CI pass.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE="$(command -v node || echo /opt/node22/bin/node)"
"$NODE" "$HERE/soak.js" --mins "${1:-22}"
