#!/usr/bin/env bash
# factory/build-portal.sh — PortMaster (HARBOR) self-contained portal builds.
#
# games/harbor/* references shared libs as `../../shared/*.js` and the root icons as
# `../../icon-*.png` — paths that only resolve when served from inside the full repo checkout.
# Web-game portals (CrazyGames, Poki) want ONE flat, self-contained folder with no
# "reach outside itself" paths, no service worker, no PWA manifest, and forced portal mode.
# This script assembles that folder per TARGET and zips it. It is the SINGLE canonical builder
# (supersedes factory/ship.py, which injected an SDK but forgot to strip the SW / force portal
# mode — a half-built bundle that would ship a live service worker + privacy link).
#
# Usage:
#   bash factory/build-portal.sh [crazygames|poki|bare|all]   (default: all)
# Targets (all share the flatten + SW/manifest strip + PORTAL_MODE force + headless verify):
#   crazygames -> dist/portmaster-crazygames/  + CrazyGames SDK v3 <script> (window.CrazyGames.SDK)
#   poki       -> dist/portmaster-poki/         + PokiSDK <script> AND window.__POKI_BUILD__=true
#                                                 (the marker makes sim.js drop the 'gamble' wager
#                                                  event — Poki forbids ANY gambling mechanic)
#   bare       -> dist/portmaster-portal/        no SDK (itch.io / a CrazyGames no-SDK basic launch)
# The injected SDK <script> is the ONE allowed external reference (the portal's own CDN); offline
# (e.g. in headless verify) it simply fails to load and shared/portal.js no-ops, so the game still
# boots identically — window.ADS falls back to the free stub. On the real portal the CDN loads and
# window.ADS routes rewarded/commercial/gameplay to the SDK (see games/harbor/ads.js activeSDK()).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
SRC="$REPO/games/harbor"
NODE="$(command -v node || echo /opt/node22/bin/node)"

TARGETS_ARG="${1:-all}"
case "$TARGETS_ARG" in
  all) TARGETS=(crazygames poki bare) ;;
  crazygames|poki|bare) TARGETS=("$TARGETS_ARG") ;;
  *) echo "unknown target '$TARGETS_ARG' (want: crazygames | poki | bare | all)" >&2; exit 2 ;;
esac

CG_SDK='  <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>'
POKI_SDK='  <script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>'

OVERALL_OK=1

build_one() {
  local target="$1"
  local name sdk_tag poki_marker
  case "$target" in
    crazygames) name="portmaster-crazygames"; sdk_tag="$CG_SDK";   poki_marker="" ;;
    poki)       name="portmaster-poki";        sdk_tag="$POKI_SDK"; poki_marker="1" ;;
    bare)       name="portmaster-portal";      sdk_tag="";          poki_marker="" ;;
  esac
  local OUT="$REPO/dist/$name"
  local ZIP="$REPO/dist/$name.zip"
  local STEP_OK=1
  fail() { echo "FAIL[$target]: $*" >&2; STEP_OK=0; }

  echo "======================================"
  echo "BUILD TARGET: $target  ->  dist/$name/"
  echo "-- [1/7] clean output dir"
  rm -rf "$OUT" "$ZIP"
  mkdir -p "$OUT/shared"

  echo "-- [2/7] copy games/harbor/* (excluding tests/, sw.js, assetfetch.sh, manifest.json)"
  local EXCLUDE=(tests sw.js assetfetch.sh manifest.json)
  local entry name0 ex skip
  for entry in "$SRC"/*; do
    name0="$(basename "$entry")"; skip=0
    for ex in "${EXCLUDE[@]}"; do [ "$name0" = "$ex" ] && skip=1 && break; done
    [ "$skip" -eq 1 ] && continue
    cp -R "$entry" "$OUT/"
  done
  [ -f "$OUT/CREDITS.md" ] || fail "CREDITS.md missing from build (license compliance for the bundled KayKit glTF)"

  echo "-- [3/7] copy root icons + shared libs + license files"
  cp "$REPO/icon-192.png" "$REPO/icon-512.png" "$OUT/"
  local f
  for f in juice retention portal progression stage; do
    cp "$REPO/shared/$f.js" "$OUT/shared/$f.js"
  done
  # Font licences (OFL) travel with the bundle so a copyright review is self-service. Copy any
  # LICENSE/OFL file living in fonts/ if present; never fatal (fonts are all OFL Google Fonts).
  [ -d "$SRC/fonts" ] && find "$SRC/fonts" -maxdepth 1 -iname '*licen*' -exec cp {} "$OUT/fonts/" \; 2>/dev/null || true

  echo "-- [4/7] rewrite index.html (paths, strip manifest+SW, inject build marker${sdk_tag:+ + SDK}${poki_marker:+ + poki flag})"
  SDK_TAG="$sdk_tag" POKI_MARKER="$poki_marker" python3 - "$OUT/index.html" <<'PY'
import os, re, sys
path = sys.argv[1]
with open(path) as f:
    html = f.read()

html = html.replace('../../shared/', 'shared/')
html = html.replace('../../icon-192.png', 'icon-192.png')

# strip the <link rel="manifest" ...> tag (PWA install is meaningless inside a portal embed)
html = re.sub(r'\s*<link rel="manifest"[^>]*>\n?', '\n', html)

# strip the service-worker-registration <script>...</script> block specifically (leave every other
# <script> tag untouched) by splitting on script tags and dropping the one that registers the SW.
parts = re.split(r'(<script\b[^>]*>.*?</script>)', html, flags=re.DOTALL)
parts = [p for p in parts if 'serviceWorker.register' not in p]
html = ''.join(parts)

# inject the portal-SDK <script> (if any) into <head> so window.CrazyGames.SDK / window.PokiSDK is
# available before shared/portal.js's Portal.init() runs at boot.
sdk = os.environ.get('SDK_TAG', '')
if sdk and 'sdk.crazygames.com' not in html and 'poki-sdk.js' not in html:
    if '</head>' in html:
        html = html.replace('</head>', sdk + '\n</head>', 1)

# build markers injected immediately before the first remaining <script> tag (so they run before
# any game script — critically before sim.js reads window.__POKI_BUILD__ to drop the gamble event).
markers = '<script>window.__PORTAL_BUILD__=true'
if os.environ.get('POKI_MARKER'):
    markers += ';window.__POKI_BUILD__=true'
markers += '</script>\n  '
idx = html.find('<script')
if idx == -1:
    sys.exit('build-portal.sh: no <script> tag found to inject the portal-build marker before')
html = html[:idx] + markers + html[idx:]

with open(path, 'w') as f:
    f.write(html)
PY

  echo "-- [5/7] force PORTAL_MODE true in the copied game.js"
  # game.js sets PORTAL_MODE in TWO statements — an initial `= false` declaration, then an
  # unconditional reassignment from location.search / ADS.provider. Both must be neutralised
  # (replaced as one exact block) so the build FAILS LOUDLY if this text moved, rather than
  # silently shipping a non-portal build.
  local GJS="$OUT/game.js"
  if ! python3 - "$GJS" <<'PY'
import sys
path = sys.argv[1]
with open(path) as f:
    js = f.read()
needle = (
    "  var PORTAL_MODE = false;\n"
    "  try { PORTAL_MODE = /[?&]portal=/.test(window.location.search) || "
    "!!(window.ADS && window.ADS.provider && window.ADS.provider !== 'stub'); } catch (e) {}\n"
)
replacement = (
    "  var PORTAL_MODE = true;  // forced true by factory/build-portal.sh "
    "— this build always behaves as portal-hosted\n"
)
if needle not in js:
    sys.exit(1)
js = js.replace(needle, replacement, 1)
with open(path, 'w') as f:
    f.write(js)
PY
  then
    fail "expected PORTAL_MODE declaration block not found (verbatim) in games/harbor/game.js — build-portal.sh's patch needs updating to match the current source (refusing to silently ship a non-portal build)"
  fi
  if [ "$STEP_OK" -eq 1 ] && ! grep -q 'var PORTAL_MODE = true;' "$GJS"; then
    fail "PORTAL_MODE patch did not take effect"
  fi
  if [ "$STEP_OK" -eq 1 ] && grep -q 'PORTAL_MODE = /\[?&\]portal=/' "$GJS"; then
    fail "PORTAL_MODE reassignment still present — the force-patch didn't remove it"
  fi

  if [ "$STEP_OK" -ne 1 ]; then
    echo "BUILD[$target] FAILED — see FAIL lines above. Skipping zip/verify."
    OVERALL_OK=0
    return
  fi

  echo "-- [6/7] zip"
  mkdir -p "$REPO/dist"
  ( cd "$REPO/dist" && zip -rq "$name.zip" "$name" )

  echo "-- [7/7] verify (static + headless iframe boot)"
  local STATIC_OK=1
  # a leftover ../../ or a live serviceWorker.register() in the SERVED entry file would be a real
  # broken/portal-disallowed reference (grep is scoped to index.html — game.js legitimately still
  # contains the dead non-portal "../../privacy.html" string, proven unreachable by the headless run).
  grep -q '\.\./\.\./' "$OUT/index.html" && { fail "index.html still contains a ../../ reference"; STATIC_OK=0; } || echo "  PASS  index.html has no ../../ references"
  grep -q 'serviceWorker'  "$OUT/index.html" && { fail "index.html still references serviceWorker"; STATIC_OK=0; } || echo "  PASS  index.html has no serviceWorker reference"
  grep -q '<link rel="manifest"' "$OUT/index.html" && { fail "index.html still links a manifest"; STATIC_OK=0; } || echo "  PASS  index.html has no manifest link"
  if [ -n "$sdk_tag" ]; then
    grep -q 'crazygames-sdk\|poki-sdk' "$OUT/index.html" && echo "  PASS  portal SDK <script> injected" || { fail "portal SDK <script> missing for target $target"; STATIC_OK=0; }
  fi

  local HEADLESS_OK=1
  VERIFY_OUT="$name" VERIFY_TARGET="$target" "$NODE" "$HERE/verify-portal-build.js" || HEADLESS_OK=0

  if [ "$STATIC_OK" -eq 1 ] && [ "$HEADLESS_OK" -eq 1 ]; then
    echo "BUILD[$target] PASS — dist/$name/ and dist/$name.zip ready to upload."
  else
    echo "BUILD[$target] FAIL — see failures above."
    OVERALL_OK=0
  fi
}

for t in "${TARGETS[@]}"; do build_one "$t"; done

echo "======================================"
if [ "$OVERALL_OK" -eq 1 ]; then
  echo "ALL BUILDS PASS."
  exit 0
else
  echo "ONE OR MORE BUILDS FAILED — see failures above."
  exit 1
fi
