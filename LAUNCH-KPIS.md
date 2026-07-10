# PortMaster — Launch KPI Scorecard

*Phase 13d. Thresholds below are written now, before CrazyGames/Poki submission — see
[`DISTRIBUTION.md`](DISTRIBUTION.md) for the submission steps and
[`MONETIZATION.md`](MONETIZATION.md) for the revenue path they feed into.*

## Why pre-committed

It's easy to look at whatever numbers show up after launch and decide they were "always
what we expected." That's not a scorecard, that's a story we tell ourselves after the
fact. The thresholds below are written down **before** a single real player has touched
the CrazyGames build, so reading them post-launch is an honest yes/no against a bar we
picked in advance — not a bar we quietly move to match the result. If a number comes in
below threshold, that's a real finding, not something to explain away.

## Thresholds

Idle/tycoon is one of the stronger-retaining categories on web portals, so the bar is set
accordingly — these are realistic-good numbers for the genre, not vanity targets.

| Metric | Threshold | Great |
|---|---|---|
| D1 retention | ≥ 25% | ≥ 35% |
| D7 retention | ≥ 8% | ≥ 12% |
| Median session length | ≥ 8 min | — |
| CrazyGames rating | ≥ 70% positive | — |
| Ad engagement (Captain's Bonus opt-in rate, once portal ads live) | ≥ 15% of DAU | — |

## Where each number comes from

Two different sources, and they don't mix:

- **D1/D7 retention, CrazyGames rating** — the CrazyGames developer dashboard, once the
  build is live. This is real, aggregated, cross-player data; it's the only place these
  three numbers can come from, because we run no backend and see no other players'
  devices.
- **Session length, the funnel timestamps below** — our own local `metrics` module
  (`games/harbor/game.js`, backed by `Retention.get/set('harbor', 'metrics', …)`,
  surfaced via `window.__harbor.metrics()` and the one muted line in Settings → About).
  **This is per-device, not aggregated** — by design. There's no backend, no analytics
  beacon, nothing leaves the browser; each player's own `localStorage` is the only copy
  of their numbers. That means we can't compute a real median session length across the
  whole player base from this alone — what we *can* do is spot-check it on our own
  devices during QA, sanity-check it against whatever session-length figure CrazyGames'
  dashboard reports (portals typically surface their own aggregate session-time stat),
  and use it as the debug view for the funnel timestamps below, which have no portal
  dashboard equivalent at all.

## The funnel targets

Each is "ms since this device's first-ever session," latched once, read via
`__harbor.metrics()`. Targets are all measured against *active playtime*
(`totalPlayMs`), not wall-clock time — a player who opens the tab and walks away isn't
penalized.

| Milestone | Target | If missed → which lever |
|---|---|---|
| `firstBuild` | < 60s | Founding flow — the tap-glowing-site → "Found village" path is taking too long to get a player into their first build; look at the welcome card and the found-here prompt. |
| `firstEra` | < 8 min | Early economy pacing — era-1 requirements (cash + building gate) are too steep for how fast a new player earns; check `SIM.ERA_REQ` against actual early-game income. |
| `firstVoyage` | < 15 min | Expeditions discoverability — the ⛵ button and its onboarding announce may not be surfacing early enough, or the first voyage's cost/slot gate is too far out; check the onboarding goal ladder and the `announceFeature('exp', …)` timing in `updateHUD()`. |
| `firstPrestige` | < 90 min of playtime | Mid-game curve — the run-length before `SIM.canPrestige()` flips true is too long; look at endless-scaling pacing past the last authored era. |

## Decision tree

Read the two data sources together, not in isolation:

1. **Low D1** → onboarding funnel. Look at `firstBuild`/`firstEra` on our own QA
   devices first (they're the fastest signal we control), then the welcome card, the
   found-village flow, and early economy pacing.
2. **OK D1, low D7** → mid-game depth pacing + daily hooks. The first session is landing
   fine but nothing's pulling players back tomorrow — look at `firstVoyage`/
   `firstPrestige`, the daily missions list, the streak, and the Harbour Pass cadence.
3. **Good retention, low rating** → polish/bugs, not systems. Pull the in-game error log
   first (`window.__harbor.errors()` / Settings → About → "⚠ N issues logged", Phase 12b's
   ring buffer) before touching balance — a retained-but-annoyed player is usually
   hitting something broken, not something boring.
4. **All good** → scale. Move to Poki next (see `DISTRIBUTION.md` §2 — budget 6–8 weeks
   for their review pipeline and note the Poki SDK adapter isn't written yet), then
   native per `MONETIZATION.md` Path 3, in that order — don't skip ahead to native before
   portal data has actually proven retention.

## Protocol

CrazyGames soft launch (no-SDK submission per `DISTRIBUTION.md` §1, path 1) → let it run
**2–4 weeks** to accumulate enough D7 data to be meaningful → **one** tuning patch,
informed by the decision tree above rather than a grab-bag of guesses → then Poki
submission. Resist tuning more than once per read of the dashboard — that's how you end
up chasing noise instead of signal.
