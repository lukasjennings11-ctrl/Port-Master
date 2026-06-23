# Equate — CrazyGames submission

**Title:** Equate

**Tagline / short description:** Guess the hidden 8-character equation in 6 tries.

**Instructions (how to play):** Type digits/operators · Enter to submit · Backspace to delete

**Controls:** Type digits/operators · Enter to submit · Backspace to delete

**Orientation:** responsive — portrait + landscape, plays at 375px width and on desktop.

**Tags:** math, puzzle, daily, logic, casual, mobile, highscore

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
