#!/usr/bin/env python3
"""Playtest — automated pre-flight checks for a game before the live MCP playtest.

The deep "is it fun / does it render" check is done by driving the game in a real
browser via the Claude Preview MCP. This script is the cheap gate that runs first:
it catches the boring, common breakages (missing files, broken asset paths, no
viewport meta, missing shared libs or test hook) and, if the dev server is up,
confirms the game and its assets actually serve over HTTP.

Exit code is non-zero if any check fails, so it can gate the pipeline.

Usage:
    python3 factory/playtest.py <slug> [--port 8000]
"""
import argparse
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    gdir = os.path.join(ROOT, "games", args.slug)
    passed, failed = [], []

    def check(ok, label):
        (passed if ok else failed).append(label)

    # --- structural ---
    check(os.path.isdir(gdir), "game folder exists")
    index_path = os.path.join(gdir, "index.html")
    check(os.path.isfile(index_path), "index.html present")
    check(os.path.isfile(os.path.join(gdir, "game.js")), "game.js present")

    html = ""
    if os.path.isfile(index_path):
        with open(index_path) as f:
            html = f.read()
        check("viewport" in html, "has viewport meta (mobile)")
        check("shared/juice.js" in html, "includes shared/juice.js")
        check("shared/retention.js" in html, "includes shared/retention.js")
        check("shared/portal.js" in html, "includes shared/portal.js (CrazyGames + Poki SDK adapter)")
        check('id="loader"' in html, "has a loading screen (#loader)")

        # portal compliance: NO external links anywhere (instant CrazyGames reject)
        ext_links = re.findall(r'(?:src|href)="(https?://[^"]+)"', html)
        check(not ext_links, "no external http(s) links" + (" -- found %s" % ext_links if ext_links else ""))
        check("itch.io" not in html, "no itch.io references (competitor portal)")
        check('href="/"' not in html, 'no portal-root link (href="/")')
        check('href="../../"' not in html, 'no portal back-link (href="../../")')

        # every referenced local src/href resolves on disk
        refs = re.findall(r'(?:src|href)="([^"]+)"', html)
        for ref in refs:
            if ref.startswith(("http://", "https://", "data:", "#")):
                continue
            clean = ref.split("?", 1)[0].split("#", 1)[0]
            # skip navigation hrefs (directory links, no file extension)
            if clean.endswith("/") or "." not in os.path.basename(clean):
                continue
            target = os.path.normpath(os.path.join(gdir, clean))
            check(os.path.isfile(target), "asset resolves: %s" % ref)

    gjs = os.path.join(gdir, "game.js")
    if os.path.isfile(gjs):
        with open(gjs) as f:
            js = f.read()
        check(re.search(r"window\.__\w+\s*=", js) is not None,
              "exposes a window.__<slug> test hook")
        check("Portal.init" in js, "calls Portal.init() (SDK boot)")
        # The gameplay bracket is wired through adsGameplayStart/Stop (called on found / resume /
        # visibility) → window.ADS → the portal SDK's gameStart/gameStop — a single choke point, so
        # the bracket opens on ACTUAL gameplay, not merely at boot. (Older builds called
        # Portal.gameStart() directly at boot, which opened the CrazyGames bracket too early.)
        check("adsGameplayStart" in js and "adsGameplayStop" in js,
              "wires the gameplay bracket (found/resume/visibility → window.ADS → SDK)")
        check("itch.io" not in js, "no itch.io references in game.js")

    # ads.js must ROUTE rewarded/commercial/gameplay to the real portal SDK when one is hosting us —
    # otherwise a "watch ad" button grants a reward with no ad shown (a portal-QA rejection risk).
    ajs = os.path.join(gdir, "ads.js")
    if os.path.isfile(ajs):
        with open(ajs) as f:
            aj = f.read()
        check("activeSDK" in aj and "rewardedAd" in aj and "gameStart" in aj,
              "ads.js routes rewarded/commercial/gameplay to the portal SDK (window.Portal)")

    # --- HTTP smoke (only if the dev server is running) ---
    base = "http://localhost:%d" % args.port
    url = "%s/games/%s/" % (base, args.slug)
    try:
        with urllib.request.urlopen(url, timeout=2) as r:
            check(r.status == 200, "HTTP 200 for %s" % url)
        for asset in ("shared/juice.js", "shared/retention.js"):
            with urllib.request.urlopen("%s/%s" % (base, asset), timeout=2) as r:
                check(r.status == 200, "HTTP 200 for /%s" % asset)
    except (urllib.error.URLError, OSError):
        print("(dev server not running on :%d — skipping HTTP smoke; "
              "run `python3 factory/serve.py` to enable)\n" % args.port)

    # --- report ---
    for label in passed:
        print("  PASS  %s" % label)
    for label in failed:
        print("  FAIL  %s" % label)
    print("\n%d passed, %d failed" % (len(passed), len(failed)))
    if failed:
        print("\nNot ready: fix the failures above, then run the live MCP playtest "
              "(load the game in the preview, check console, drive the __hook).")
        sys.exit(1)
    print("\nPre-flight OK. Next: live playtest in the browser preview "
          "(screenshot + console + drive window.__%s)." % args.slug)


if __name__ == "__main__":
    main()
