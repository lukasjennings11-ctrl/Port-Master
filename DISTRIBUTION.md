# PortMaster — Distribution Kit

*Phase 12c. Everything below is either already built (the portal package, this doc) or a
concrete, ordered checklist of the account/business steps that only you can do. Read
[`MONETIZATION.md`](MONETIZATION.md) first for the why; this doc is the how.*

Build the submission package before doing anything else:

```bash
bash factory/build-portal.sh
```

This produces `dist/portmaster-portal/` (a flat, self-contained copy of the game with no
service worker, no PWA manifest, and no `../../` paths — everything a portal disallows or
doesn't need, stripped) and `dist/portmaster-portal.zip` (825 KB zipped / ~1.8 MB
unzipped — comfortably under both portals' size limits, see below). The script ends with
a PASS/FAIL summary that includes a real headless Chromium boot of the built package —
don't upload if it didn't say `BUILD PASS`.

`dist/` is git-ignored — the zip is a build artifact, not something to commit. Re-run the
script any time `games/harbor/` changes and re-upload.

---

## 1. CrazyGames submission

- **Account:** [developer.crazygames.com](https://developer.crazygames.com/) — free
  developer account, no fee.
- **Upload:** `dist/portmaster-portal.zip` via the developer portal's "Add game" flow.
- **Form fields to expect:**
  - Title: `PortMaster` (see `factory/store-copy.md`)
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
    CrazyGames requires PEGI 12 compliance at minimum; PortMaster (no violence, no real
    gambling, no UGC) clears that easily — just disclose the Merchant's Gamble
    in-game-currency wager honestly where asked.
- **Review timeline:** fast relative to Poki — games can go live in days once uploaded
  and passing automated checks; a human review follows for "Full Launch" promotion.
- **SDK note — two honest paths:**
  1. **No-SDK first submission (what this build does today):** CrazyGames explicitly
     allows submitting *without* the SDK integrated, subject to a stricter file-size cap
     (≤50 MB total, ≤20 MB to be eligible for their mobile homepage — our build is
     ~1.8 MB, nowhere close). This gets PortMaster live and gathering data fastest.
  2. **Full SDK integration (needed before "Full Launch"/rev-share):** once selected for
     Full Launch, CrazyGames *requires* their SDK — analytics, ads, loading/gameplay
     events. Phase 12a/12b already built the `window.ADS` abstraction and the
     `Portal.*` lifecycle hooks (`loadingFinished`/`gameplayStart`/`gameplayStop`/
     `commercialBreak`) that a `crazygames.js` adapter would plug into with zero game
     logic changes — that adapter itself isn't written yet (it's the natural next
     phase once CrazyGames says yes to path 1).
  - **Recommendation:** submit path 1 now (fast, honest, zero extra engineering), then
    build the CrazyGames SDK adapter once you have a developer account and can read
    their exact current SDK version/init code from the dashboard.

## 2. Poki submission

- **Account:** apply via [developers.poki.com](https://developers.poki.com/) — Poki is
  **hand-curated**: every game is reviewed by a human before acceptance, so expect
  feedback loops rather than an instant yes/no.
- **Upload:** same `dist/portmaster-portal.zip`.
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
- **The Merchant's Gamble flag:** Poki's own language is "no gambling" full stop — it
  doesn't carve out in-game-currency-only wagers. PortMaster's Merchant's Gamble event
  (wager in-game £ for a chance to double it, always skippable via "Decline") is honest,
  optional, and uses no real currency — but Poki's reviewers may still flag it. Disclose
  it plainly in the submission notes rather than let them find it; be ready to discuss,
  gate it further, or drop it from the Poki build specifically if they push back.
- **SDK note:** unlike CrazyGames, Poki's docs are explicit that SDK integration
  (`commercialBreak()`/`rewardedBreak()`, audio auto-mute during ads) is **required for
  Web Fit testing and all releases** — there is no "submit without the SDK" path here.
  Phase 12a's `window.ADS` abstraction is built to make a `poki.js` adapter a drop-in
  (same five-method contract, zero game.js changes) — but that adapter doesn't exist yet.
  **Recommendation:** apply now to start the (slow) Poki review clock, but expect to need
  the `poki.js` adapter written before you can pass their Web Fit Test — plan that as
  the next engineering phase once CrazyGames data suggests it's worth the extra build.

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
etc). Point it at a clean build instead so the shipped app is just PortMaster:

```json
"webDir": "dist/portmaster-portal"
```

Handily, the portal build already strips the service worker and PWA manifest — both are
unnecessary noise inside a native WebView too — so `bash factory/build-portal.sh` doubles
as the native web asset build. Run it before every `npx cap sync`.

**`appId` — change this before your FIRST store submission; it's permanent.**
`capacitor.config.json` currently has `com.prismplay.arcade`, left over from an earlier
project name. Once an app is published under an `appId`, it cannot be changed without
publishing as an entirely new app listing (losing reviews/rankings/updates path). Rename
it now, before `cap add`, e.g. to `com.portmaster.arcade` or `com.portmaster.app` —
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

**Still needed for some portal/store forms — a 16:9 landscape cover (e.g. 1920×1080):**
None of the existing assets are landscape; CrazyGames in particular wants a landscape
cover in addition to portrait/square. Capture one from the live game:

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
