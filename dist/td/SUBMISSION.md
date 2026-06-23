# Outpost — CrazyGames submission

**Title:** Outpost

**Tagline / short description:** Build and upgrade turrets, hold the line against endless waves.

**Instructions (how to play):** Tap empty cells to build, tap turrets to upgrade

**Controls:** Tap empty cells to build, tap turrets to upgrade

**Orientation:** responsive — portrait + landscape, plays at 375px width and on desktop.

**Tags:** strategy, tower-defense, arcade, casual, mobile, highscore

**Description:**
<2-3 sentences. What you do, the one-more-go hook, the goal.>

## Compliance (baked into this build)
- [x] CrazyGames SDK v3 injected in <head>; shared/portal.js wires init + loading + gameplay + ad calls.
- [x] No external links (no portal back-link, no competitor/itch.io links, no cross-promo links).
- [x] Loading screen (#loader) paired with the SDK loading callbacks.
- [x] Mute persists; ads pause game audio.
- [ ] Verify in the CrazyGames QA tool that gameplayStart/Stop + ad requests fire.

## Where to upload
- CrazyGames developer portal (HTML5 zip; SDK already included for rev-share).
- itch.io (same zip — SDK no-ops off-platform; Kind: HTML, 'mobile friendly').
- GameDistribution / Playgama Bridge (one build to many portals).
