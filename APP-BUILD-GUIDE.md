# Port Boss — build & submit the iOS + Android app

Port Boss is wrapped as a native app with **Capacitor** — it runs your existing web game inside a
native shell, so there's no separate codebase. This guide takes you from a fresh clone to a submitted
app on **both stores**. You already have an **Apple Developer** account and **Android Studio** — good,
that's the hard part done.

> **What I (Claude) prepared for you:** the Capacitor config (`appId`, web directory), the native
> web-build step, the app icon + splash, and this guide. **What only you can do** (needs your Mac /
> Android Studio / store accounts): the final signed builds and the store uploads. Those steps are
> below, spelled out.

---

## 0. One-time setup (do this once, on your Mac)

You need: **Node.js** (v18+), **Xcode** (Mac, for iOS), **Android Studio** (for Android), and a
**CocoaPods** install (`sudo gem install cocoapods`) for iOS.

```bash
# from the repo root, on your Mac:
npm install                        # installs Capacitor + tooling from package.json
bash factory/build-portal.sh bare  # builds the native web assets into dist/portboss-portal/
npx cap add ios                    # creates the ios/ Xcode project (first time only)
npx cap add android                # creates the android/ Studio project (first time only)
npx cap sync                       # copies the web build + plugins into both native projects

# app icon + splash (I already made the source art in assets/):
npm i -D @capacitor/assets
npx @capacitor/assets generate --ios --android --assetPath assets   # reads assets/icon.png +
                                   # assets/splash.png and writes every iOS + Android icon/splash size
                                   # into the native projects. The --ios --android limits it to those
                                   # two — omit them and it also tries a PWA target and errors on a
                                   # missing www/manifest.json (we have no PWA target here).
```

The `assets/` folder already contains the branded **`icon.png`** (1024²) and **`splash.png`** /
**`splash-dark.png`** (2732²) — the generate step above turns them into every required size for
both platforms automatically. (Optional polish for Android's adaptive icon: add
`assets/icon-foreground.png` + `assets/icon-background.png` and re-run — not required to ship.)

**Native niceties are already built in** (they activate only inside the app, never on the web build):
- **Android hardware Back button** closes whatever panel is open (Manage, Expeditions, Registry,
  Settings, Trade, Legacy, Timeline) or an event card; when nothing's open it **minimises** the app
  rather than hard-quitting mid-game — the behaviour Google reviewers expect.
- The **splash screen** hides as soon as the game's first frame renders, and the **status bar** is
  styled to the brand navy.
- These use the `@capacitor/app` + `@capacitor/status-bar` + `@capacitor/splash-screen` plugins, which
  `npm install` (step above) pulls in automatically from `package.json` — no extra step.

- **`appId`** is set to `com.lukasjennings.portboss` in `capacitor.config.json`. This is your app's
  permanent identity on both stores — **if you want a different one, change it now, before your first
  submission** (it can't change afterwards). It must match the App ID / bundle ID you register in
  Apple Developer and the package name in Play Console.
- Re-run `bash factory/build-portal.sh bare && npx cap sync` **every time the game changes** — that's
  how updates flow into the app.

---

## PART A — Android (Google Play)

1. **Open the project:** `npx cap open android` (launches Android Studio). Let Gradle finish syncing.
2. **Test it:** press ▶ Run on an emulator or a plugged-in phone — confirm the game loads and plays.
3. **Create a signing key** (first time only): **Build → Generate Signed Bundle / APK → Android App
   Bundle → Create new…** keystore. **Save the keystore file + passwords somewhere safe and backed
   up** — lose it and you can never update the app again.
4. **Build the release AAB:** Build → Generate Signed Bundle/APK → **Android App Bundle** → choose your
   keystore → **release** → Finish. The `.aab` lands in `android/app/release/`.
5. **Play Console:** create the app → upload the `.aab` under **Production** (or start with
   **Internal testing** to trial it). Fill in: content rating questionnaire, data-safety form, target
   audience, and the store listing (assets in Part C). Submit for review.

## PART B — iOS (Apple App Store)

1. **Open the project:** `npx cap open ios` (launches Xcode).
2. **Signing:** select the **App** target → **Signing & Capabilities** → check *Automatically manage
   signing* → pick your **Apple Developer Team**. Set the **Bundle Identifier** to match your `appId`.
3. **Test it:** run on a Simulator or a connected iPhone — confirm it loads and plays.
4. **Archive:** set the device target to **Any iOS Device (arm64)** → **Product → Archive**.
5. **Upload:** in the Organizer window that opens → **Distribute App → App Store Connect → Upload**.
   (Or export the `.ipa` and use the **Transporter** app.)
6. **App Store Connect:** create the app record (same bundle ID) → attach the uploaded build → fill in
   the listing (Part C), age rating, and privacy details → submit for review.

## PART C — Store listing assets (both stores)

I can generate all of these from the game — just ask:
- **App icon** — 1024×1024 (provided: `submit/app/icon-1024.png` once generated).
- **Screenshots** — provided: `submit/app/store-screenshots/store-*.png` — four portrait 1290×2796
  gameplay shots (iOS 6.7", also valid for Google Play). Upload these directly. (Apple also lists a
  6.5" size — the same 1290×2796 images are accepted; ask me if you want exact 6.5" crops.)
- **Short + full description** — reuse `submit/SUBMIT-DETAILS.md` copy (Title, tagline, long description).
- **Category:** Games → Simulation (or Strategy). **Content rating:** Everyone / 4+.
- **Privacy policy URL** — ⚠️ **both stores require one.** It's already written: **`PRIVACY.md`** in the
  repo root (Port Boss stores progress only on-device, no accounts/tracking/ads — a short, honest
  policy). You just need it at a public **URL**. Easiest free options:
  - **GitHub Pages:** repo **Settings → Pages → Deploy from branch** → pick `main` / `/root` (or
    `docs/`). Your policy is then at `https://<you>.github.io/<repo>/PRIVACY` (rename to `PRIVACY.md`
    or drop a copy in `/docs`). Paste that URL into both store forms.
  - **Or a GitHub Gist** (paste the `PRIVACY.md` text, "Create public gist", use its URL), **or** a
    page on your itch.io project. Any always-on public URL is accepted.

## PART D — App privacy questionnaire (the "nutrition label")

Both stores ask you to declare what data the app collects. For the **first (ad-free) release**
Port Boss collects **nothing that leaves the device** — progress is stored only in on-device local
storage, there are no accounts/logins, no analytics, no tracking, and the web-portal ad SDKs are
**not** in the native build. So both forms get the simplest, most trustworthy answer:

- **Apple — App Store Connect → your app → App Privacy → Get Started:**
  - *"Do you or your third-party partners collect data from this app?"* → **No**.
  - Result: a clean **"Data Not Collected"** label. Save/Publish.
- **Google — Play Console → your app → Policy → App content → Data safety:**
  - *Does your app collect or share any of the required user data types?* → **No**.
  - *Is all user data encrypted in transit?* / *Do you provide a way to request data deletion?* →
    not applicable (no data collected); complete the short form accordingly.
- Both still require the **privacy-policy URL** above, even with no data collected.

> ⚠️ **If you later add ads or analytics** (e.g. AdMob rewarded ads, or any analytics SDK), you
> **must** come back and update these answers — ad/analytics SDKs collect device identifiers and
> usage data, so the honest label changes from "Data Not Collected." Do this in the same release that
> adds the SDK. The same applies if you add an **online leaderboard** (it would collect a name +
> score + device identifier — see the monetization/leaderboard notes).

---

## Notes & honest caveats
- **No ads in the app.** The web portal ad SDKs (CrazyGames/Poki) don't work in a native app, so the
  first release ships **ad-free** — simplest and fastest to approve. AdMob rewarded ads can be added
  later via a Capacitor plugin if you want in-app revenue; ask me and I'll wire it.
- **Updates:** change the game → `build-portal.sh bare` → `npx cap sync` → bump the version in Android
  Studio / Xcode → rebuild → upload. Same as the first time, minus the account setup.
- **Review times:** Apple is usually 1–3 days; Google a few hours to a couple of days for a new app.
- **Keep your keystore (Android) and Apple signing safe** — they're your identity for all future updates.
