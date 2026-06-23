#!/usr/bin/env python3
"""Ship — assemble a self-contained, portal-ready package for a game.

Games live in games/<slug>/ and reference the repo's shared libs via
`../../shared/...`, which won't exist inside a zip of one game folder. This stage
bundles a standalone copy: it inlines the referenced shared files into
dist/<slug>/shared/, rewrites the paths, copies local assets, writes a submission
metadata template (title/tagline/controls/tags), and zips it for upload to
itch.io / CrazyGames / GameDistribution.

Usage:
    python3 factory/ship.py <slug>
Output:
    dist/<slug>/        self-contained game
    dist/<slug>.zip     ready to upload
    dist/<slug>/SUBMISSION.md   copy-paste metadata for the portal forms
"""
import argparse
import json
import os
import re
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# CrazyGames SDK v3 — loaded in <head> so window.CrazyGames.SDK exists before
# shared/portal.js runs. (Verify the URL against docs.crazygames.com.)
SDK_TAG = '  <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    args = ap.parse_args()
    slug = args.slug

    src = os.path.join(ROOT, "games", slug)
    if not os.path.isfile(os.path.join(src, "index.html")):
        print("No games/%s/index.html — nothing to ship." % slug)
        sys.exit(1)

    out = os.path.join(ROOT, "dist", slug)
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(os.path.join(out, "shared"), exist_ok=True)

    with open(os.path.join(src, "index.html")) as f:
        html = f.read()

    # copy local files (everything in the game folder except PORTAL.md notes)
    for name in os.listdir(src):
        sp = os.path.join(src, name)
        if name in ("PORTAL.md",):
            continue
        if os.path.isdir(sp):
            shutil.copytree(sp, os.path.join(out, name))
        elif name != "index.html":
            shutil.copy2(sp, os.path.join(out, name))

    # inline referenced shared libs and rewrite ../../shared/ -> shared/
    for ref in re.findall(r'(?:src|href)="(\.\./\.\./shared/[^"]+)"', html):
        base = os.path.basename(ref.split("?", 1)[0])
        shutil.copy2(os.path.join(ROOT, "shared", base), os.path.join(out, "shared", base))
    html = html.replace("../../shared/", "shared/")
    # inject the CrazyGames SDK so window.CrazyGames.SDK is available to portal.js
    if "sdk.crazygames.com" not in html:
        html = html.replace("</head>", SDK_TAG + "\n</head>", 1)
    with open(os.path.join(out, "index.html"), "w") as f:
        f.write(html)

    # pull real metadata from meta.json when present
    meta = {}
    mpath = os.path.join(src, "meta.json")
    if os.path.isfile(mpath):
        try:
            with open(mpath) as mf:
                meta = json.load(mf)
        except Exception:
            meta = {}
    title = meta.get("title", slug.capitalize())
    tagline = meta.get("tagline", "<one punchy line — fill in>")
    controls = meta.get("controls", "Mobile + desktop (touch / mouse / keys)")
    tags = ", ".join(meta.get("tags", ["casual", "mobile", "highscore"]))

    sub = os.path.join(out, "SUBMISSION.md")
    with open(sub, "w") as f:
        f.write("# %s — CrazyGames submission\n\n" % title)
        f.write("**Title:** %s\n\n" % title)
        f.write("**Tagline / short description:** %s\n\n" % tagline)
        f.write("**Instructions (how to play):** %s\n\n" % controls)
        f.write("**Controls:** %s\n\n" % controls)
        f.write("**Orientation:** responsive — portrait + landscape, plays at 375px width and on desktop.\n\n")
        f.write("**Tags:** %s\n\n" % tags)
        f.write("**Description:**\n<2-3 sentences. What you do, the one-more-go hook, the goal.>\n\n")
        f.write("## Compliance (baked into this build)\n")
        f.write("- [x] CrazyGames SDK v3 injected in <head>; shared/portal.js wires init + loading + gameplay + ad calls.\n")
        f.write("- [x] No external links (no portal back-link, no competitor/itch.io links, no cross-promo links).\n")
        f.write("- [x] Loading screen (#loader) paired with the SDK loading callbacks.\n")
        f.write("- [x] Mute persists; ads pause game audio.\n")
        f.write("- [ ] Verify in the CrazyGames QA tool that gameplayStart/Stop + ad requests fire.\n\n")
        f.write("## Where to upload\n")
        f.write("- CrazyGames developer portal (HTML5 zip; SDK already included for rev-share).\n")
        f.write("- itch.io (same zip — SDK no-ops off-platform; Kind: HTML, 'mobile friendly').\n")
        f.write("- GameDistribution / Playgama Bridge (one build to many portals).\n")

    # zip it
    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    zpath = os.path.join(ROOT, "dist", slug + ".zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(out):
            for fn in files:
                fp = os.path.join(base, fn)
                z.write(fp, os.path.relpath(fp, out))

    n = sum(len(files) for _, _, files in os.walk(out))
    print("Shipped %s:" % slug)
    print("  %s  (%d files)" % (os.path.relpath(out, ROOT), n))
    print("  %s  (%.1f KB)" % (os.path.relpath(zpath, ROOT), os.path.getsize(zpath) / 1024.0))
    print("  fill in %s, then upload the zip to itch.io first." % os.path.relpath(sub, ROOT))


if __name__ == "__main__":
    main()
