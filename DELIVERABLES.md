# Port Boss — deliverables index

Everything produced for launching Port Boss (web portals + mobile app), and where it lives in this
repo. All current as of build **v83** (difficulty levels + prestige-confirm fix).

> One-download copies of all this are handed over in chat as **`Port Boss — Kit (1 of 2)`** and
> **`(2 of 2)`** zips (they merge into one tidy `Port Boss/` folder).

## Guides (repo root)
- **`SUBMIT-GUIDE.md`** — plain-English walkthrough for the web portals.
- **`SUBMIT-DETAILS.md`** — exact answer for every field on the portal forms.
- **`APP-BUILD-GUIDE.md`** — step-by-step to build + submit the iOS + Android apps.
- **`PRIVACY.md`** — privacy policy (host at a URL; both app stores require the link).

## Web portals — `submit/`
- **`submit/crazygames/`** — `portboss-crazygames.zip` · 3 covers · 2 preview videos.
- **`submit/poki/`** — `portboss-poki.zip` (gambling-free) · 1080² thumbnail.
- **`submit/itch/`** — `portboss-itch.zip` · cover (1260×1000) · banner · `screenshots/` (5).
- **`submit/README.md`** — which file goes in which portal form box.

## Mobile app — `submit/app/` + `assets/`
- **`submit/app/icon-1024.png`** — app icon. **`assets/splash.png`** — splash (2732²).
- **`assets/icon.png` + `assets/splash.png` + `splash-dark.png`** — source art for
  `npx @capacitor/assets generate` (produces every iOS/Android icon+splash size).
- **`submit/app/store-screenshots/`** — 4 portrait store screenshots (1290×2796).
- Native config: **`capacitor.config.json`** (appId `com.lukasjennings.portboss`).

## Launch posts — `launch/`
- **`reddit-incremental-games.md`** · **`coolmath-pitch.md`** · **`armorgames-pitch.md`**.

## The game itself
`games/harbor/` (WebGL2 engine `gl.js`, sim `sim.js`, renderer/UI `game.js`, …). Portal/native
bundles are built by `factory/build-portal.sh` (targets: crazygames · poki · bare/native).
