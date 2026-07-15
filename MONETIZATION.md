# Port Boss — Monetization & Go-To-Market Playbook

*Honest, concrete, and ordered by realism. The code side is being built (Phase 12);
the account/business side needs you — each step below says which is which.*

## The one thing that matters first: DISTRIBUTION
A brilliant web game with no audience earns £0. For browser games the realistic first
revenue is **web-game portals** — they bring millions of players and pay revenue share.
Everything else compounds *after* that.

---

## Path 1 — Web portals (START HERE; first revenue, weeks not months)
**Poki** (poki.com/for-developers) and **CrazyGames** (developer.crazygames.com) publish
HTML5 games, bring the traffic, and pay ad-revenue share (typically ~50%, paid monthly
once over a threshold). Idle/tycoon is a strong category on both.

- **What I build (Phase 12a/12b/12c):** their SDK integration points behind our
  `AdProvider` abstraction (loading events, commercial breaks at natural pauses,
  rewarded-ad hooks for the Captain's Bonus), a portal-compliant build (no external
  links/PWA prompts in portal mode), and the submission package (description, tags,
  cover art from our screenshots).
- **What you do:** create a developer account on each, submit the build, respond to
  their QA feedback. Poki is curated (rejection possible; feedback is useful either
  way); CrazyGames is more open.
- **Expectations:** portal idle games with good retention can earn real money
  (hundreds to thousands/month at scale), but nothing is guaranteed — the honest
  first milestone is *getting accepted and reading the retention dashboard*.

## Path 2 — Rewarded ads, done ethically (built-in, provider-agnostic)
The **Captain's Bonus** (Phase 12a): an opt-in button — e.g. "⚓ Captain's Bonus:
2× production for 10 min". On portals it plays their rewarded ad; on our own site it
starts as a free bonus (no ad account needed) and can later use AdSense for Games /
AdMob (native). Opt-in only, never gates progress, no timers punishing you for
declining — consistent with the no-dark-patterns line we've held, and genuinely the
highest-performing ad format in idle games.
- **What you'd do (later, own-site only):** an AdSense/ad-network account + site
  approval. Skip until there's traffic; portals carry ads for you meanwhile.

## Path 3 — Native apps + IAP (highest ceiling, most work)
`capacitor.config.json` already exists (`com.prismplay.arcade`) and `privacy.html`
already anticipates "Remove Ads" / "Pro" purchases. Phase 12c documents the Android
(£20 one-off) and iOS (£79/yr) build+submit flow. Monetization there: rewarded ads
(AdMob) + a single honest IAP — **"Port Boss Pro"** (~£3–4: removes ad prompts,
adds a cosmetic golden flag + supporter badge). No pay-to-win.
- **What you do:** Google Play / Apple Developer accounts, store listings, payout details.
- **Recommendation:** do this *after* portal data proves retention; stores reward
  games that already know their numbers.

## Path 4 — Low-effort extras (fine to do any time)
- **itch.io** page with a donation button (free account, ~30 min).
- **Ko-fi/BuyMeACoffee** link in the Settings "About" section (one line of code).

---

## What we will NOT do (the line we hold)
No loot boxes for real money, no expiring-FOMO pressure, no pay-to-win, no selling
player data. The game stays generous; monetization is opt-in attention (rewarded ads)
and honest one-time support (Pro). This is also *commercially* right: portals and
stores increasingly reject dark patterns, and idle-game retention — our whole engine —
dies when players feel squeezed.

## The build plan (code side, all on me)
- **12a — Captain's Bonus + AdProvider**: opt-in rewarded boost; `stub` provider live
  immediately (free bonus), `poki`/`crazygames`/`admob` adapters slot in without
  touching game logic. Tests: provider swap, boost applies/expires, decline = no penalty.
- **12b — Production hardening**: error capture (console/GL errors → local ring buffer +
  optional beacon), SEO/meta/OG polish, portal-mode flag (`?portal=poki` style),
  loading/gameplay lifecycle events, README + landing polish.
- **12c — Distribution kit**: portal submission checklist + zip build, Capacitor
  Android/iOS walkthrough, store copy, asset pack (icon/screenshots exist).

## Your 5-step launch checklist (the money steps only you can do)
1. Play the live build; decide you're proud of it. *(now)*
2. Create a **CrazyGames developer account** and submit (fastest yes/no). *(after 12c)*
3. Create a **Poki developer account** and submit the same build. *(after 12c)*
4. Read the retention/earnings dashboards for 2–4 weeks; we tune with real data.
5. If numbers are good → Google Play first (cheap, fast review), then iOS.
