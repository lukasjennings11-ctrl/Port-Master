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
npx @capacitor/assets generate     # reads assets/icon.png + assets/splash.png and writes every
                                   # iOS + Android icon/splash size into the native projects
```

The `assets/` folder already contains the branded **`icon.png`** (1024²) and **`splash.png`** /
**`splash-dark.png`** (2732²) — the generate step above turns them into every required size for
both platforms automatically. (Optional polish for Android's adaptive icon: add
`assets/icon-foreground.png` + `assets/icon-background.png` and re-run — not required to ship.)

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
- **Screenshots** — phone-sized. Play wants a few 1080×1920-ish; Apple wants 6.7" (1290×2796) and
  6.5" sizes. I'll render these from the game (like your itch shots).
- **Short + full description** — reuse `submit/SUBMIT-DETAILS.md` copy (Title, tagline, long description).
- **Category:** Games → Simulation (or Strategy). **Content rating:** Everyone / 4+.
- **Privacy policy URL** — ⚠️ **both stores require one.** Port Boss stores progress only on-device and
  has no accounts/tracking, so it's a short policy. I can draft it and you host it (a page on your itch
  or a free GitHub Pages URL works). Tell me and I'll write it.

---

## Notes & honest caveats
- **No ads in the app.** The web portal ad SDKs (CrazyGames/Poki) don't work in a native app, so the
  first release ships **ad-free** — simplest and fastest to approve. AdMob rewarded ads can be added
  later via a Capacitor plugin if you want in-app revenue; ask me and I'll wire it.
- **Updates:** change the game → `build-portal.sh bare` → `npx cap sync` → bump the version in Android
  Studio / Xcode → rebuild → upload. Same as the first time, minus the account setup.
- **Review times:** Apple is usually 1–3 days; Google a few hours to a couple of days for a new app.
- **Keep your keystore (Android) and Apple signing safe** — they're your identity for all future updates.
