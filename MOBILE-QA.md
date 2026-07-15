# Port Boss — Real-Device Smoke Test (10 minutes)

**Why this exists:** every automated test ran on headless desktop Chromium. **iOS Safari has
never executed this game** — different WebGL2 driver, different audio-unlock rules, different
PWA behaviour. This checklist is the one release gate that needs human hands on real phones.
Run it once on each device column. Any ✗ → note what happened and report it back for a fix.

**URL:** https://lukasjennings11-ctrl.github.io/Port-Master/games/harbor/

| # | Check (do this, expect that) | iPhone / Safari | Android / Chrome |
|---|------------------------------|:---:|:---:|
| 1 | Cold load on mobile data: playable in **< 8s**, no blank/black screen | ☐ | ☐ |
| 2 | Loader → coast appears; **drag to pan** feels smooth (no stutter) | ☐ | ☐ |
| 3 | **Pinch to zoom** + **twist to rotate**: controlled, no page-scroll/bounce hijack | ☐ | ☐ |
| 4 | Tap a glowing site → **Found village** → port appears with celebration | ☐ | ☐ |
| 5 | Manage port → build Fishing Hut + Cottage → money deducts, buildings appear in 3D | ☐ | ☐ |
| 6 | First tap anywhere: **sound unlocks** (waves audible); music bed fades in ≤ 15s | ☐ | ☐ |
| 7 | Settings ⚙ → toggle Music OFF → bed stops, waves/SFX continue; toggle survives reload | ☐ | ☐ |
| 8 | **⚓ Bonus** button → card opens → Claim → "⚓2×" chip counts down; production visibly faster | ☐ | ☐ |
| 9 | Expeditions ⛵ → send Smuggler's Cove → ship visibly sails out on the water | ☐ | ☐ |
| 10 | Wait for a storm warning (or play ~3 min) → wind audio + banner; strike shakes screen; repair works | ☐ | ☐ |
| 11 | Day/night: visuals shift (dusk colours / night stars+windows) as clock passes 18:00–00:00 (or just note current time-of-day looks right) | ☐ | ☐ |
| 12 | Kill the app/tab completely → reopen → **save intact** (money/buildings/era), welcome-back earnings if away >1 min | ☐ | ☐ |
| 13 | **Add to Home Screen** → opens standalone (no browser chrome), anchor icon correct | ☐ | ☐ |
| 14 | Airplane mode + reopen installed app → **loads and plays offline** | ☐ | ☐ |
| 15 | 5-minute free play: no crash, no heat/battery alarm, no UI element unreachable by thumb | ☐ | ☐ |

**Perf feel (subjective but note it):** smooth / occasional stutter / choppy — on which screen?

**Known acceptable quirks:** the "✨ Miniature look" may auto-disable on older phones with a
toast (that's the quality gate working, not a bug — it can be re-enabled in Settings).

**Where results go:** reply in the session with the two columns (or a photo of this list).
Fixes for any ✗ get priority over all other work.
