# Port Boss — Kongregate resubmission pack

This doc is written specifically to clear the four issues from Kongregate's rejection whisper.
Everything below is ready to paste into the Kongregate upload form.

---

## 0. What to upload

**File:** `dist/portboss-portal.zip`  (the SDK-free "bare" build — no external portal scripts, fully
self-contained, `index.html` at the zip root). Do **not** upload the CrazyGames build to Kongregate —
it injects the CrazyGames SDK, which is what caused the stuck loading screen (see §Fixes below).

- Renders on desktop + mobile browsers, WebGL2.
- ~2 MB, loads in a second on broadband.
- No external network calls, no login, no ads.

---

## 1. Rejection reasons → how each is resolved

| # | Kongregate said | Resolution |
|---|---|---|
| 1 | Mention if AI was used, for player transparency | **Added to the description** (see §Description — the "Made with AI assistance" line). |
| 2 | Add a target age rating | **Added to the description** ("Everyone / 9+"). Set the store rating field to **Everyone**. |
| 3 | Initial screen only text, no graphics, stuck loading 3+ min | **Real bug, now fixed.** The loading screen was tied to a portal SDK's `init()`. Off its own domain (i.e. on Kongregate) that `init()` never resolved, so the "Port Boss" loader never hid and covered a game that was actually rendering behind it. Fixed two ways: the visible loader now hides on the first rendered frame regardless of any SDK, and portal `init()` now times out after 3s. Verified headlessly by simulating a hung SDK — the game shows graphics, loader gone. The bare build (above) has no SDK at all. |
| 4 | "Pinch to zoom" — how on PC? | **Controls clarified** in the in-game hint and in Settings ▸ How to play, and spelled out in §Controls below. PC zoom is the **mouse scroll wheel** (already supported); rotate is **right-drag or Shift+drag**. |

---

## 2. Title & genre
- **Title:** Port Boss
- **Genre / category:** Idle / Incremental · Simulation · Strategy · Management
- **Orientation:** Works landscape & portrait; responsive.

## 3. Description (paste into Kongregate description field)

> **Port Boss — Idle Port Tycoon**
>
> Found a harbour on a glowing coast and grow a humble fishing village into a global trade empire.
> Build fishing huts, warehouses, factories and container docks; ship cargo along trade routes;
> run expeditions, weather storms, out-trade your rival Baron Krall, and prestige for permanent
> upgrades. Chill idle progress with plenty to optimise when you want to lean in.
>
> **Features**
> - Build & upgrade a living 3D port that grows through the ages
> - Trade routes between harbours + fleet you can commission and evolve
> - Expeditions, relics, seasons, daily rewards, and a prestige/Legacy meta
> - Play at your own pace — four difficulty levels from Relaxed to Extreme
>
> **Controls**
> - **PC:** drag to pan · **scroll wheel to zoom** · right-drag (or Shift+drag) to rotate · tap/click to select
> - **Mobile:** drag to pan · pinch to zoom · two-finger twist to rotate · tap to select
>
> **Age rating:** Everyone (suitable for ages 9+). No violence, gambling, chat, or user-to-user
> content; no external links or logins.
>
> **Made with AI assistance:** some of this game's code and art were created with the help of AI
> tools. Gameplay design, testing and direction are human-led.

## 4. Suggested tags
`idle`, `incremental`, `tycoon`, `management`, `simulation`, `strategy`, `building`, `trade`,
`3d`, `casual`, `ships`, `port`

## 5. Controls (reference)
- **Pan / move along the coast:** left-mouse drag (PC) · one-finger drag (mobile)
- **Zoom:** mouse scroll wheel (PC) · pinch (mobile)
- **Rotate camera:** right-mouse drag or Shift + left-drag (PC) · two-finger twist (mobile)
- **Select / interact:** click or tap
- **Bottom bar:** Trade network, Expeditions, Registry (fleet), Legacy (prestige), Bonus, Manage port

## 6. Pre-submission QA checklist (do this in Kongregate preview before resubmitting)
- [ ] Upload `dist/portboss-portal.zip`; open the Kongregate **preview**.
- [ ] Loader disappears within a couple of seconds and the 3D port is visible (the reported bug).
- [ ] Hard-refresh 2–3 times; graphics appear every time.
- [ ] Scroll wheel zooms; right-drag rotates; drag pans (desktop).
- [ ] Description contains the AI-assistance line and the age rating.
- [ ] Store age rating field set to **Everyone**.
