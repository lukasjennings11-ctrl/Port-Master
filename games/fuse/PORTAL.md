# Fuse — portal status

| Portal | Status | Notes |
|--------|--------|-------|
| itch.io | not submitted | First target — accepts the plain `dist/fuse.zip` as HTML game. |
| CrazyGames | not submitted | Integrate CrazyGames SDK (rewarded video) before submitting for rev-share. |
| GameDistribution / Playgama | not submitted | One build → many portals via Playgama Bridge. |

## To ship
1. `python3 factory/ship.py fuse` → `dist/fuse.zip` + `dist/fuse/SUBMISSION.md`.
2. Fill in `SUBMISSION.md` (tagline + description).
3. Upload to itch.io (Kind: HTML, mobile-friendly, viewport ~520×760).
4. Record the live URL + date here once accepted.

## Monetization & compliance (via shared/portal.js)
- [x] CrazyGames SDK adapter wired (init, loading, gameplayStart/Stop). `ship.py` injects the SDK `<script>`.
- [x] Rewarded video on the "Continue" button (clears smallest tiles to reopen moves).
- [x] Interstitial via `Portal.commercialBreak()` on restart (frequency-capped, 60s).
- [x] All external links removed (no portal back-link, no itch.io share URL, no cross-promo).
- [x] Loading screen + first-run how-to overlay; mute persists.
- [ ] Live QA in CrazyGames' tool: confirm gameplay events + ads fire.
- [ ] Playgama Bridge for multi-portal publish (~80% rev keep).
