# Port Boss — Distribution Kit

*Phase 12c. Everything below is either already built (the portal package, this doc) or a
concrete, ordered checklist of the account/business steps that only you can do. Read
[`MONETIZATION.md`](MONETIZATION.md) first for the why; this doc is the how.*

Build the submission packages before doing anything else:

```bash
bash factory/build-portal.sh            # builds ALL targets (crazygames + poki + bare)
# …or one at a time:
bash factory/build-portal.sh crazygames
bash factory/build-portal.sh poki
```

`factory/build-portal.sh` is the single canonical builder (it supersedes the old
`factory/ship.py`, which injected an SDK but forgot to strip the service worker / force portal
mode — a half-built bundle). Each target is a flat, self-contained copy of the game with **no
service worker, no PWA manifest, no `../../` paths, and portal mode forced on** — everything a
portal disallows, stripped — with the correct portal SDK injected:

| Target | Output | What's baked in |
|---|---|---|
| `crazygames` | `dist/portboss-crazygames{,.zip}` | CrazyGames SDK v3 `<script>` in `<head>` |
| `poki` | `dist/portboss-poki{,.zip}` | Poki SDK `<script>` **and the `gamble` event dropped** (Poki forbids any gambling mechanic) |
| `bare` | `dist/portboss-portal{,.zip}` | no SDK — itch.io, or a CrazyGames no-SDK "basic launch" |

Each is ~0.9 MB zipped / ~2.1 MB unzipped — comfortably under both portals' size limits (see
below). When a portal's own CDN serves the injected SDK, `games/harbor/ads.js` auto-routes the
rewarded ("Captain's Bonus") + interstitial (era-ascension) + gameplay-bracket calls to it (see
`activeSDK()`); off-portal the SDK simply isn't there and everything falls back to the free stub,
so the game plays identically. Each build ends with a PASS/FAIL summary that includes a real
headless Chromium boot of the package **both top-level AND embedded in an `<iframe>`** (the way a
portal actually hosts it — the classic "broken in their iframe" rejection cause) — don't upload a
target that didn't print `BUILD[...] PASS`.

`dist/` is git-ignored — the zips are build artifacts, not something to commit. Re-run the
script any time `games/harbor/` changes and re-upload.

---

## 1. CrazyGames submission

- **Account:** [developer.crazygames.com](https://developer.crazygames.com/) — free
  developer account, no fee.
- **Upload:** `dist/portboss-crazygames.zip` (SDK baked in) via the developer portal's
  "Add game" flow. (Or `dist/portboss-portal.zip` for a no-SDK basic launch — see the SDK note.)
- **Form fields to expect:**
  - Title: `Port Boss` (see `factory/store-copy.md`)
  - Short description / tagline, full description → copy from `factory/store-copy.md`
  - Category: **Idle** (secondary: Strategy/Simulation) — see `factory/store-copy.md`
    for the full tag list
  - Controls / instructions → the "Controls description" section of the store copy
  - **3 cover images** (landscape, portrait, square) + optionally a preview video —
    CrazyGames requires all three sizes; confirm the exact current pixel dimensions on
    [docs.crazygames.com/requirements/game-covers](https://docs.crazygames.com/requirements/game-covers/)
    before exporting (typical values in wide use: landscape ~1920×1080, portrait
    ~1080×1920, square ~1200×1200 — treat these as a starting point, not gospel).
    We don't have a 16:9 landscape cover yet — see the Asset Inventory below for how
    to capture one.
  - Age rating questionnaire → answer from `factory/store-copy.md`'s age-rating table.
    CrazyGames requires PEGI 12 compliance at minimum; Port Boss (no violence, no real
    gambling, no UGC) clears that easily — just disclose the Merchant's Gamble
    in-game-currency wager honestly where asked.
- **Review timeline:** fast relative to Poki — games can go live in days once uploaded
  and passing automated checks; a human review follows for "Full Launch" promotion.
- **SDK note — the adapter is now built.** `shared/portal.js` is a unified CrazyGames + Poki
  SDK adapter (`window.Portal`), and `games/harbor/ads.js` routes rewarded/interstitial/gameplay
  calls to it whenever a real SDK is hosting the page. The `crazygames` build injects the
  CrazyGames SDK v3 `<script>` so this all wires up automatically — loading bracket
  (`sdkGameLoadingStart/Stop`), gameplay bracket (`gameplayStart` on found/resume/visibility,
  `gameplayStop` on background), interstitial at era-ascension, and rewarded video for the
  Captain's Bonus, all with audio muted for the ad's duration.
  - **Two paths remain, both valid:** upload `dist/portboss-crazygames.zip` (SDK baked in →
    eligible for Full Launch / rev-share immediately), or `dist/portboss-portal.zip` (no SDK →
    a faster "basic launch"; ads/rev-share come later by switching to the crazygames zip). Both
    clear the size caps (≤50 MB total, ≤20 MB for the mobile homepage; our builds are ~2 MB).
  - **Before uploading, confirm the SDK URL/version** on the CrazyGames dashboard and update
    `CG_SDK` in `factory/build-portal.sh` if it has changed — the adapter is written defensively
    (feature-detected, wrapped in try/catch) so a renamed method degrades to a no-op, but the
    `<script src>` must point at a real, current SDK build.

## 2. Poki submission

- **Account:** apply via [developers.poki.com](https://developers.poki.com/) — Poki is
  **hand-curated**: every game is reviewed by a human before acceptance, so expect
  feedback loops rather than an instant yes/no.
- **Upload:** `dist/portboss-poki.zip` (Poki SDK baked in, gambling event removed).
- **Form fields to expect:** same shape as CrazyGames (title, description, category,
  controls, cover art) — reuse `factory/store-copy.md`. Poki's own review stages, in
  order, each with its own turnaround: Player Fit Test (need ≥25% of 500 players to play
  3+ minutes) → Web Fit Test (~3–5 days) → Final Poki Review (~1–2 weeks) → Soft Release
  scheduling (~1–2 weeks) → Soft Release period (~2–3 weeks) before a full release
  decision. Budget **6–8 weeks** end to end, realistically.
- **Their stated requirements** (from Poki's own developer docs): web-exclusive (no
  Steam/mobile-store double-listing), works well on both mobile and desktop, instant
  play with no login wall, kid-safe with **no gambling or crypto**, no in-app purchases,
  initial download target **under 8 MB** (our build is ~1.8 MB — comfortably clears
  this), all cutscenes/intros skippable, and platform-appropriate control hints shown.
- **The Merchant's Gamble — handled: the Poki build removes it.** Poki's rule is "no gambling"
  with no carve-out for in-game-currency wagers, so the `poki` build sets `window.__POKI_BUILD__`,
  which makes `sim.js` drop the `gamble` event from its scheduler entirely (the code stays; it's
  just never rolled — see `setEventExclusions`). The verify step asserts
  `HARBOR_SIM.eventExcluded('gamble') === true` in the built Poki bundle, so it cannot regress.
  You can still mention in the submission notes that the CrazyGames build keeps it (they allow it)
  and the Poki build omits it — a point in your favour, not a risk. (The `crazygames`/`bare`
  builds keep the event.)
- **SDK note — the adapter is now written.** Poki *requires* their SDK
  (`PokiSDK.init()`/`gameplayStart`/`gameplayStop`/`commercialBreak`/`rewardedBreak`, with the SDK
  handling its own loading splash + ad audio) for the Web Fit Test and all releases. `shared/portal.js`
  is the unified adapter — it detects `window.PokiSDK` and maps every call onto it (promise-style
  ad breaks, `gameLoadingFinished` on loader hide) — and the `poki` build injects the PokiSDK
  `<script>`. `games/harbor/ads.js` routes the Captain's Bonus + era interstitial through it. So you
  can apply AND pass the Web Fit Test with `dist/portboss-poki.zip` as-is.
  - **Before uploading, confirm the PokiSDK URL** on developers.poki.com and update `POKI_SDK` in
    `factory/build-portal.sh` if it differs; the adapter is feature-detected so a missing method
    degrades to a no-op, but the `<script src>` must be a real current build.

## 3. Native (Capacitor — Android + iOS)

All commands below run from the repo root. `package.json` already lists
`@capacitor/cli`, `@capacitor/core`, `@capacitor/android`, `@capacitor/ios` and
`@capacitor/splash-screen` as dependencies but `node_modules/` isn't installed yet and no
`android/`/`ios/` platform folders exist — nothing has been scaffolded.

```bash
npm install                       # pulls the Capacitor packages already in package.json
# (if starting from a bare checkout instead: npm i @capacitor/cli @capacitor/core @capacitor/android)
npx cap add android
npx cap open android              # opens Android Studio
```

**`webDir` — change this before adding a platform.** `capacitor.config.json` currently
sets `"webDir": "."` (the entire repo root: every game, `tests/`, `factory/`, `README.md`,
etc). Point it at a clean build instead so the shipped app is just Port Boss:

```json
"webDir": "dist/portboss-portal"
```

Handily, the portal build already strips the service worker and PWA manifest — both are
unnecessary noise inside a native WebView too — so `bash factory/build-portal.sh` doubles
as the native web asset build. Run it before every `npx cap sync`.

**`appId` — change this before your FIRST store submission; it's permanent.**
`capacitor.config.json` currently has `com.prismplay.arcade`, left over from an earlier
project name. Once an app is published under an `appId`, it cannot be changed without
publishing as an entirely new app listing (losing reviews/rankings/updates path). Rename
it now, before `cap add`, e.g. to `com.portboss.arcade` or `com.portboss.app` —
pick the final name deliberately.

**Android (Google Play):**
1. `npx cap add android` (after fixing `webDir`/`appId` above), `npx cap sync android`.
2. Open in Android Studio (`npx cap open android`), build a **signed release AAB**
   (Build → Generate Signed Bundle/APK). You'll need a keystore — Android Studio can
   create one; **back it up somewhere safe**, losing it means you can never update the
   app again under the same listing.
3. Google Play Console account: **one-off $20 (~£16) registration fee**, ID verification.
4. Create the app listing (store copy from `factory/store-copy.md`, cover art from the
   Asset Inventory below), upload the AAB, fill the Play Console's content rating
   questionnaire (same honest answers as `factory/store-copy.md`'s age-rating table),
   and the Data Safety form (answer: no data collected — see `privacy.html`).
5. Submit for review. Google Play review is typically **hours to a few days** for a
   first submission (can take longer if flagged for manual review).

**iOS (Apple App Store) — needs a Mac, be honest about this:**
1. Xcode (Mac only) is required to build/sign/submit an iOS app — there is no Linux/CI
   path around this for a first submission. `npx cap add ios` works from any machine (it
   just scaffolds the Xcode project files), but `npx cap open ios` and the actual archive
   step need a real Mac with Xcode installed.
2. Apple Developer Program: **$99/year**, real-name/company verification (can take a
   few days if using a company account).
3. Same `webDir`/`appId` fix applies (`appId` becomes the iOS bundle ID — same
   permanence warning).
4. Build an archive in Xcode, upload via Xcode/Transporter to App Store Connect, fill
   the listing (same store copy + assets), submit for review.
5. Apple review is typically **24–48 hours** for a first submission, sometimes longer;
   expect at least one rejection round on a first-ever app (missing privacy nutrition
   label detail, screenshot requirements, etc. are the common first-timer snags).

**Signing/accounts summary:** Android needs a keystore (self-managed, one-off $20 Play
Console fee). iOS needs a Mac + Xcode + a $99/year Apple Developer account. Neither step
can be done by an engineering agent on this Linux environment — both need you, an actual
device/Mac, and a payment method.

---

## Store copy block

See [`factory/store-copy.md`](factory/store-copy.md) for the full ready-to-paste set:
title, short pitch, medium/long descriptions, tags, controls copy, the age-rating
questionnaire answers (including the honest Merchant's Gamble gambling-mechanic
disclosure), and the support-contact placeholder.

## Asset inventory

**Already exists:**
- `icon-192.png` (192×192), `icon-512.png` (512×512) — app icons, also bundled into
  the portal build.
- `games/harbor/screenshot.png` (414×820, portrait) — in-game screenshot.
- `screenshot-mobile.png` (390×844, portrait) — mobile screenshot.
- `factory/store-copy.md` — all text copy.

**16:9 landscape cover — a raw starting capture now exists:**
- `factory/cover-16x9.png` (1600×900) — a straight in-game capture of the floating papercraft
  port at midday, generated by the cover script. It's a usable placeholder (CrazyGames accepts
  gameplay screenshots), but **refine it before submitting**: capture a more built-up port (a few
  eras in, buildings + boats on screen), at a hero camera angle, with transient toasts/hint cards
  dismissed, and ideally add a title treatment. Re-capture the same way:

```bash
python3 -m http.server 8000   # from repo root
```
Open `http://localhost:8000/games/harbor/?nopost-probe` in a desktop browser sized to a
16:9 window (or use the browser devtools device toolbar set to a custom 1920×1080
viewport), let the scene settle (a mid-era port with a few buildings and boats reads
best), and take a full-window screenshot. `games/harbor/tests/browser.test.js` and
`factory/verify-portal-build.js` show the exact Playwright boilerplate (chromium args,
`?nopost-probe` flag, `__harbor.autoFound()`/`SIM.setEra()` to skip straight to a
built-up port) if you'd rather script it than screenshot by hand.

Square (e.g. 1200×1200) and portrait covers can be cropped from the existing
`games/harbor/screenshot.png` / `screenshot-mobile.png`, or captured the same way.
