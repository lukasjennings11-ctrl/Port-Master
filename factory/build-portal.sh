#!/usr/bin/env bash
# factory/build-portal.sh — PortMaster (HARBOR) self-contained portal build.
#
# games/harbor/* references shared libs as `../../shared/*.js` and the root icons as
# `../../icon-*.png` — paths that only resolve when the game is served from inside the
# full repo checkout. Web-game portals (CrazyGames, Poki) want ONE flat, self-contained
# folder with no "reach outside itself" paths, no service worker, and no PWA manifest.
# This script assembles that folder at dist/portmaster-portal/ and zips it.
#
# What it does, in order:
#   1. Copies games/harbor/* (index.html, style.css, all *.js, fonts/, assets/,
#      meta.json, screenshot.png, CREDITS.md — license compliance for the bundled
#      KayKit glTF models) into dist/portmaster-portal/, EXCLUDING:
#        - tests/          (dev-only, never shipped)
#        - sw.js            (service workers are disallowed inside a portal iframe —
#                             see index.html's own SW-registration comment)
#        - assetfetch.sh    (dev-only asset downloader)
#        - manifest.json    (PWA installability is meaningless inside a portal embed;
#                             the <link rel="manifest"> tag is stripped from index.html
#                             below too, so nothing references it)
#   2. Copies the two root icons (icon-192.png, icon-512.png) that index.html points at
#      via ../../icon-*.png, and shared/{juice,retention,portal,progression,stage}.js
#      into dist/portmaster-portal/shared/.
#   3. Rewrites the copied index.html:
#        - ../../shared/       -> shared/
#        - ../../icon-192.png  -> icon-192.png
#        - strips <link rel="manifest">
#        - strips the whole service-worker-registration <script> block
#        - injects <script>window.__PORTAL_BUILD__=true</script> as the very first
#          script tag — a cheap build fingerprint read by verify-portal-build.js
#          (game.js never reads it; it's just a marker that this IS a portal build).
#   4. Forces portal mode. game.js computes PORTAL_MODE once, at parse time:
#          /[?&]portal=/.test(location.search) || (ADS.provider && ADS.provider !== 'stub')
#      Two ways exist to force it on in a build without touching the checked-in source:
#        (a) inject a script that runs history.replaceState(...) to rewrite the URL
#            with a ?portal=build query param BEFORE game.js parses, so its own
#            location.search check picks it up.
#        (b) sed-patch the ONE line in the *copied* game.js:
#            `var PORTAL_MODE = false;` -> `var PORTAL_MODE = true;`
#      We use (b) — see the sed step below for why: it's one deterministic line, it's
#      verified (the build FAILS LOUDLY if that exact line has moved rather than
#      silently shipping a non-portal build), and it only ever touches the disposable
#      dist/ copy — games/harbor/game.js in the repo is never modified. (a) was
#      rejected: it depends on script execution order (fragile to a future reorder of
#      the <script> tags), and it leaves a fake query string sitting in the address bar
#      of whatever page embeds the build, which is confusing in devtools/screenshots
#      and in front of a portal's own QA reviewers.
#   5. Zips dist/portmaster-portal/ to dist/portmaster-portal.zip.
#   6. VERIFY (static): serves the dist folder with `python3 -m http.server`, curls
#      index.html for 200, and greps index.html for leftover `../../` references and
#      any `serviceWorker` register() call. (Scoped to index.html deliberately: game.js
#      still contains the literal string "../../privacy.html" inside its *non-portal*
#      Settings-panel branch — dead code once PORTAL_MODE is forced true, verified live
#      by verify-portal-build.js below, not a broken reference a browser would request.)
#   7. VERIFY (headless boot): runs factory/verify-portal-build.js — a real Chromium
#      (swiftshader) boot of the built package asserting WebGL boots, the founded-flow
#      works, __harbor.portalMode() === true, the dead non-portal Settings rows never
#      render, and zero console/page errors.
#
# Usage: bash factory/build-portal.sh [--crazygames]
#
#   --crazygames  additionally injects the CrazyGames SDK v3 tag + games/harbor/crazygames.js
#                 (the window.ADS adapter) into the COPIED index.html, immediately before the
#                 ads.js tag. crazygames.js registers itself on ADS_PROVIDERS and declares
#                 itself the default provider (ads.js honours it when no ?adprovider= override
#                 is present) — game.js is untouched, exactly as the ads.js contract intends.
#                 Without the flag the build is byte-identical to before: stub provider, no
#                 CrazyGames network calls (DISTRIBUTION.md "path 1" no-SDK submission).
set -euo pipefail

CRAZYGAMES=0
for arg in "$@"; do
  case "$arg" in
    --crazygames) CRAZYGAMES=1 ;;
    *) echo "unknown option: $arg (supported: --crazygames)" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
SRC="$REPO/games/harbor"
OUT="$REPO/dist/portmaster-portal"
ZIP="$REPO/dist/portmaster-portal.zip"
NODE="$(command -v node || echo /opt/node22/bin/node)"

STEP_OK=1
note() { echo "-- $*"; }
fail() { echo "FAIL: $*" >&2; STEP_OK=0; }

note "[1/7] clean output dir"
rm -rf "$OUT" "$ZIP"
mkdir -p "$OUT/shared"

note "[2/7] copy games/harbor/* (excluding tests/, sw.js, assetfetch.sh, manifest.json)"
EXCLUDE=(tests sw.js assetfetch.sh manifest.json)
# crazygames.js only ships when the --crazygames flavor asks for it — the plain build stays
# byte-identical to the pre-adapter output (no unreferenced adapter file for portal QA to wonder about)
[ "$CRAZYGAMES" -eq 0 ] && EXCLUDE+=(crazygames.js)
for entry in "$SRC"/*; do
  name="$(basename "$entry")"
  skip=0
  for ex in "${EXCLUDE[@]}"; do [ "$name" = "$ex" ] && skip=1 && break; done
  [ "$skip" -eq 1 ] && continue
  cp -R "$entry" "$OUT/"
done
[ -f "$OUT/CREDITS.md" ] || fail "CREDITS.md missing from build (license compliance)"

note "[3/7] copy root icons + shared libs"
cp "$REPO/icon-192.png" "$REPO/icon-512.png" "$OUT/"
for f in juice retention portal progression stage; do
  cp "$REPO/shared/$f.js" "$OUT/shared/$f.js"
done

note "[4/7] rewrite index.html (paths, strip manifest link + SW block, inject build marker)"
python3 - "$OUT/index.html" <<'PY'
import re, sys
path = sys.argv[1]
with open(path) as f:
    html = f.read()

html = html.replace('../../shared/', 'shared/')
html = html.replace('../../icon-192.png', 'icon-192.png')

# strip the <link rel="manifest" ...> tag
html = re.sub(r'\s*<link rel="manifest"[^>]*>\n?', '\n', html)

# strip the service-worker-registration <script>...</script> block specifically (leave
# every other <script> tag untouched) by splitting on script tags and dropping the one
# whose body calls serviceWorker.register(...).
parts = re.split(r'(<script\b[^>]*>.*?</script>)', html, flags=re.DOTALL)
parts = [p for p in parts if 'serviceWorker.register' not in p]
html = ''.join(parts)

# inject the build-marker script immediately before the first remaining <script> tag
marker = '<script>window.__PORTAL_BUILD__=true</script>\n  '
idx = html.find('<script')
if idx == -1:
    sys.exit('build-portal.sh: no <script> tag found to inject the portal-build marker before')
html = html[:idx] + marker + html[idx:]

with open(path, 'w') as f:
    f.write(html)
PY

note "[5/7] force PORTAL_MODE true in the copied game.js (see script header for rationale)"
GJS="$OUT/game.js"
# game.js sets PORTAL_MODE in TWO statements — an initial `= false` declaration, then an
# unconditional reassignment from location.search / ADS.provider inside a try block. Both
# must be neutralised (patching only the first left the second silently overwriting it
# back to false on every load) — replaced as one exact two-line block so the build FAILS
# LOUDLY if this text has moved, rather than silently shipping a non-portal build.
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

if [ "$CRAZYGAMES" -eq 1 ]; then
  note "[5b] --crazygames: inject SDK v3 + crazygames.js adapter tags before ads.js"
  [ -f "$OUT/crazygames.js" ] || fail "--crazygames requested but games/harbor/crazygames.js missing from the copied build"
  if ! python3 - "$OUT/index.html" <<'PY'
import sys
path = sys.argv[1]
with open(path) as f:
    html = f.read()
needle = '<script src="ads.js'
if needle not in html:
    sys.exit(1)
inject = ('<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>\n'
          '  <script src="crazygames.js?v=60"></script>\n  ')
html = html.replace(needle, inject + needle, 1)
with open(path, 'w') as f:
    f.write(html)
PY
  then
    fail "could not find the ads.js <script> tag in the copied index.html to inject before"
  fi
  if [ "$STEP_OK" -eq 1 ] && ! grep -q 'crazygames-sdk-v3.js' "$OUT/index.html"; then
    fail "CrazyGames SDK tag injection did not take effect"
  fi
fi

if [ "$STEP_OK" -ne 1 ]; then
  echo "======================================"
  echo "BUILD FAILED — see FAIL lines above. Aborting before zip/verify."
  exit 1
fi

note "[6/7] zip"
mkdir -p "$REPO/dist"
( cd "$REPO/dist" && zip -rq portmaster-portal.zip portmaster-portal )

note "[7/7] verify"
echo "======================================"
echo "STATIC VERIFY"
STATIC_OK=1

# leftover ../../ or a live serviceWorker.register() call in the *served entry file*
# (index.html) would mean a real broken/portal-disallowed reference a browser would
# actually request — grep is deliberately scoped to index.html, not the whole tree,
# because game.js legitimately still contains the string "../../privacy.html" inside
# its dead non-portal Settings branch (never reached now PORTAL_MODE is forced true;
# verify-portal-build.js below asserts that live, in a real browser).
if grep -q '\.\./\.\./' "$OUT/index.html"; then
  fail "index.html still contains a ../../ reference"; STATIC_OK=0
else
  echo "  PASS  index.html has no ../../ references"
fi
if grep -q 'serviceWorker' "$OUT/index.html"; then
  fail "index.html still references serviceWorker"; STATIC_OK=0
else
  echo "  PASS  index.html has no serviceWorker reference"
fi
if grep -q '<link rel="manifest"' "$OUT/index.html"; then
  fail "index.html still links a manifest"; STATIC_OK=0
else
  echo "  PASS  index.html has no manifest link"
fi

PORT="$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")"
SERVE_LOG="$(mktemp)"
( cd "$OUT" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 ) >"$SERVE_LOG" 2>&1 &
SRV_PID=$!
trap 'kill "$SRV_PID" 2>/dev/null || true; rm -f "$SERVE_LOG"' EXIT

CODE=""
for _ in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/index.html" || true)"
  [ "$CODE" = "200" ] && break
  sleep 0.2
done
if [ "$CODE" = "200" ]; then
  echo "  PASS  curl http://127.0.0.1:$PORT/index.html -> 200"
else
  fail "curl http://127.0.0.1:$PORT/index.html -> ${CODE:-no response}"; STATIC_OK=0
fi
kill "$SRV_PID" 2>/dev/null || true
trap - EXIT
rm -f "$SERVE_LOG"

if [ "$STATIC_OK" -eq 1 ]; then
  echo "STATIC VERIFY: PASS"
else
  echo "STATIC VERIFY: FAIL"
fi

echo "======================================"
echo "HEADLESS BOOT VERIFY (Chromium/swiftshader)"
HEADLESS_OK=1
"$NODE" "$HERE/verify-portal-build.js" || HEADLESS_OK=0

echo "======================================"
if [ "$STATIC_OK" -eq 1 ] && [ "$HEADLESS_OK" -eq 1 ]; then
  echo "BUILD PASS — dist/portmaster-portal/ and dist/portmaster-portal.zip are ready to upload."
  exit 0
else
  echo "BUILD FAIL — see failures above."
  exit 1
fi
