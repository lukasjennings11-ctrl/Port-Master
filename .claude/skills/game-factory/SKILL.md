---
name: game-factory
description: Build, playtest, polish, and ship a new HTML5 canvas game for PortMaster. Use when scouting a new game concept, scaffolding a game, implementing gameplay, polishing game feel, or preparing a portal submission package.
---

# Game Factory Skill

You are building HTML5 canvas games for the PortMaster arcade portal. Ten games already exist — fuse, stack, orbit, match3, bubble, idle, io, runner, equate, td. Every new game must fit the factory pattern: zero dependencies, mobile-first, ships as a static folder, integrates juice.js + retention.js.

Read DESIGN.md at the project root for the visual system. Read PRODUCT.md for brand principles.

---

## Factory Pattern

Every game lives at `~/games/games/<slug>/` with exactly four files:

```
<slug>/
  index.html   # markup + script tags, no inline JS
  style.css    # CSS variables + layout, no framework
  game.js      # IIFE, all gameplay logic
  meta.json    # machine-readable metadata
```

Shared libraries (never copy, always reference from root):
```html
<script src="../../shared/juice.js?v=1"></script>
<script src="../../shared/retention.js?v=1"></script>
<script src="../../shared/portal.js?v=1"></script>
<script src="game.js?v=1"></script>
```

---

## Scaffold Checklist

### index.html

Use this exact structure:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
  <meta name="theme-color" content="<--bg value>" />
  <meta name="description" content="<one-sentence description — action-first, factual>" />
  <meta property="og:title" content="<Title> — PortMaster" />
  <meta property="og:description" content="<same as description>" />
  <title><Title> — <genre> · PortMaster</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="loader"><div class="logo">GAME TITLE</div><div class="spinner" aria-label="Loading"></div></div>
  <div id="app">
    <header class="hud">
      <span class="brand">GAME TITLE</span>
      <!-- scores / HUD stats here -->
    </header>

    <div class="subbar">
      <div class="streak" id="streak">🔥 0&nbsp;day streak</div>
      <!-- context info (level, speed, next piece, etc.) -->
      <div class="controls">
        <button id="mute" class="icon-btn" aria-label="Toggle sound">🔊</button>
        <button id="new" class="text-btn">New</button>
      </div>
    </div>

    <div class="board-wrap">
      <canvas id="game" aria-label="<Game> game board"></canvas>
      <div id="overlay" class="overlay hidden" role="dialog" aria-modal="true">
        <div class="panel">
          <h1 id="ov-title">Game Over</h1>
          <p id="ov-sub"><specific game-over message></p>
          <div class="ov-scores">
            <div><span class="label">SCORE</span><b id="ov-score">0</b></div>
            <div><span class="label">BEST</span><b id="ov-best">0</b></div>
          </div>
          <button id="ov-again" class="cta">Play again</button>
        </div>
      </div>
    </div>

    <p class="hint"><controls hint — concise, action-first></p>
  </div>
  <script src="../../shared/juice.js?v=1"></script>
  <script src="../../shared/retention.js?v=1"></script>
  <script src="game.js?v=1"></script>
</body>
</html>
```

**Critical rules:**
- `.brand` is a plain `<span>` — **never a link**. CrazyGames rejects any game
  with links that leave the page (portal back-links, competitor/itch.io links,
  cross-promo to other sites). No `href="../../"`, no `href="/"`, no external
  `<a>`/`window.open`/share URLs anywhere in the game.
- Every game includes `shared/portal.js` and a `#loader` screen.
- Title copy: action verbs, no clichés ("addictive", "epic", "amazing")
- Hint: describes the primary action only, max 12 words

### style.css

Every game gets its own palette. Use these token names consistently:

```css
:root {
  --bg:      <deepest bg>;
  --bg2:     <gradient top>;
  --panel:   <surface>;
  --text:    <primary text>;
  --muted:   <secondary text, labels>;
  --accent:  <primary game color — vivid, distinct from other games>;
  --accent2: <secondary accent — harmonious with accent>;
  --shadow:  0 8px 26px rgba(0,0,0,.55);
  --radius:  14px;
}
```

**Per-game accent color — must be distinct from existing games:**
- Fuse: `#5b8cff` (blue) — TAKEN
- Stack: `#7c6af7` (violet) — TAKEN
- Orbit: `#7af0d0` (teal) — TAKEN
- Gem Drop: `#a06af7` (purple) — TAKEN
- Burst: `#ff8ed4` (pink) — TAKEN
- Coin Forge: `#ffb347` (amber) — TAKEN
- Splat: `#3ee6b8` (green-teal) — TAKEN
- Dash Lanes: `#4fd6ff` (sky) — TAKEN
- Equate: `#4fe0c8` (teal-mint) — TAKEN
- Outpost: `#5ef79b` (green) — TAKEN

Pick a fresh color. Good available territory: coral `#ff6b5b`, gold `#ffd700`, rose `#ff4d8f`, lime `#b8f542`, indigo `#5e72e4`, magenta `#e040fb`.

**Required component rules (copy from existing games, adapt accent color):**
- `.brand` — gradient text or solid accent, 900 weight
- `a.brand` — `text-decoration: none; transition: opacity .1s ease;`
- `a.brand:hover` — `opacity: .8;`
- `.hud` — flex, space-between, align-center
- `.subbar` — flex, align-center, gap
- `.score` / `.score-box` — panel bg, border-radius 12px, flex column, center
- `.label` — 10px, 1.5px letter-spacing, muted, uppercase
- `.icon-btn` / `.text-btn` — panel bg, border-radius 10px, inherit font
- `.board-wrap` — flex, center, fill available
- `.overlay` — fixed inset + backdrop-filter: blur(4px)
- `.panel` — panel bg, border-radius 20px, text-center, max-width 320px
- `.cta` — full width, accent gradient, dark text, 800 weight
- `.hint` — muted, 12–13px, text-align center
- `@keyframes pop` — `from { transform: translateY(14px) scale(.92); opacity: 0; }`

### game.js

```js
(function () {
  'use strict';

  var GAME = '<slug>';

  // ---- DOM ----
  var canvas  = document.getElementById('game');
  var ctx     = canvas.getContext('2d');
  var wrap    = document.querySelector('.board-wrap');
  var scoreEl = document.getElementById('score');
  var bestEl  = document.getElementById('best');
  var streakEl= document.getElementById('streak');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovSub   = document.getElementById('ov-sub');
  var ovScore = document.getElementById('ov-score');
  var ovBest  = document.getElementById('ov-best');
  var ovAgain = document.getElementById('ov-again');

  // ---- juice.js instances ----
  var particles = new Juice.Particles();
  var popups    = new Juice.Popups();
  var shake     = new Juice.Shake();
  var shakeOff  = { x: 0, y: 0 };

  // ---- layout ----
  var CW = 0, CH = 0, DPR = 1;
  function layout() {
    var bw = wrap.clientWidth, bh = wrap.clientHeight || bw;
    CW = Math.max(240, Math.min(bw, 480));
    CH = Math.max(340, Math.min(bh, /* aspect */));
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.round(CW * DPR);
    canvas.height = Math.round(CH * DPR);
    canvas.style.width  = CW + 'px';
    canvas.style.height = CH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  // ---- state ----
  var score, over, best;

  // ---- init ----
  function init() {
    best = Retention.getBest(GAME);
    score = 0; over = false;
    /* reset game state */
    Retention.startSession(GAME);
    updateHUD();
    loop();
  }

  // ---- HUD ----
  function updateHUD() {
    scoreEl.textContent = score;
    bestEl.textContent  = best;
    var s = Retention.getStreak(GAME);
    streakEl.textContent = '🔥 ' + s + ' day' + (s === 1 ? '' : 's');
  }

  // ---- game loop ----
  var last = 0;
  function loop(ts) {
    if (over) return;
    var dt = Math.min((ts - last) / 1000, 0.05); last = ts;
    update(dt);
    draw();
    particles.update(dt); particles.draw(ctx);
    popups.update(dt);    popups.draw(ctx);
    shakeOff = shake.update(dt);
    requestAnimationFrame(loop);
  }

  // ---- score ----
  function addScore(pts, x, y) {
    score += pts;
    if (score > best) { best = score; Retention.setBest(GAME, best); }
    popups.add('+' + pts, x - shakeOff.x, y - shakeOff.y, '#ffffff');
    Juice.tone(880, 0.06, 0.04);
    updateHUD();
  }

  // ---- game over ----
  function gameOver() {
    over = true;
    shake.trigger(6, 0.3);
    Juice.tone(220, 0.15, 0.4);
    ovTitle.textContent = 'Game Over';
    ovSub.textContent   = /* specific message */;
    ovScore.textContent = score;
    ovBest.textContent  = best;
    overlay.classList.remove('hidden');
    Retention.endSession(GAME);
  }

  // ---- mute ----
  var muted = false;
  document.getElementById('mute').addEventListener('click', function () {
    muted = !muted; Juice.setMuted(muted);
    this.textContent = muted ? '🔇' : '🔊';
  });

  // ---- new game ----
  document.getElementById('new').addEventListener('click', function () {
    overlay.classList.add('hidden'); init();
  });
  ovAgain.addEventListener('click', function () {
    overlay.classList.add('hidden'); init();
  });

  // ---- boot ----
  window.addEventListener('resize', layout);
  layout();
  Retention.showStreak(GAME, streakEl);
  init();

}());
```

### meta.json

```json
{
  "slug": "<slug>",
  "title": "<Display Title>",
  "genre": "<genre>",
  "tagline": "<Action verb first. One sentence. What you DO, not how you'll FEEL.>",
  "controls": "<Primary control — one line>",
  "tags": ["<genre>", "casual", "mobile", "highscore"],
  "created": "<YYYY-MM-DD>"
}
```

---

## juice.js Integration Checklist

| Feature | API | When to use |
|---|---|---|
| Particles | `particles.burst(x, y, color, count)` | Merge, match, score milestone, death |
| Screen shake | `shake.trigger(magnitude, duration)` | Game over, big combos, explosions |
| Float popups | `popups.add(text, x, y, color)` | Point increments, near-misses |
| Tone SFX | `Juice.tone(freq, vol, dur)` | Every meaningful action |
| Haptics | `Juice.haptic('light'/'medium'/'heavy')` | Tap actions on mobile |
| Easing | `Juice.ease.outCubic(t)`, `.outBack(t)`, `.outElastic(t)` | All movement |
| Lerp | `Juice.lerp(a, b, t)` | Smooth camera, position transitions |
| Clamp | `Juice.clamp(v, min, max)` | Bounds checks everywhere |
| Mute | `Juice.setMuted(bool)` | Mute button toggle |

**Minimum juice requirements per game:**
- [ ] Particles on every significant score event
- [ ] Screen shake on game-over
- [ ] Sound on every player action (tone synthesis, no audio files)
- [ ] Float popup on score increments

---

## retention.js Integration Checklist

| Feature | API | Notes |
|---|---|---|
| Best score | `Retention.getBest(game)` / `.setBest(game, val)` | Set whenever score > best |
| Play streak | `Retention.showStreak(game, el)` | Call once on init |
| Session tracking | `Retention.startSession(game)` / `.endSession(game)` | For play-count analytics |
| Generic storage | `Retention.get(game, key)` / `.set(game, key, val)` | Persistent state (idle progress, etc.) |
| Daily RNG | `Retention.dailyRng(game, dateStr)` | Seeded RNG for daily puzzles |
| Today string | `Retention.todayStr()` | `'YYYY-MM-DD'` of current day |

**All keys are namespaced under `gf:<game>:` — no collision risk between games.**

---

## portal.js Integration Checklist (CrazyGames SDK)

`shared/portal.js` wraps the CrazyGames SDK and **no-ops when the SDK is absent**
(itch.io / local dev), so one build runs everywhere. `ship.py` injects the SDK
`<script>` into the built `index.html`.

| Lifecycle point | Call | Where |
|---|---|---|
| Boot | `Portal.loadingStart()` then `Portal.init().then(...)` | top of boot; resolve hides `#loader` |
| Round begins | `Portal.gameStart()` | after init resolves + on every restart |
| Round ends | `Portal.gameStop()` | in game-over / when the overlay shows |
| Restart (New / Play again) | `Portal.commercialBreak(restart)` | wrap restart so an interstitial can run |
| Revive / double | `Portal.rewardedAd(onReward, onSkip)` | optional rewarded button on game over |
| Mute toggle | `Portal.mute(isMuted)` + persist via `Retention.set(GAME,'muted',...)` | mute button + restore on boot |
| Big win | `Portal.happytime()` | optional |

**Minimum portal requirements per game:**
- [ ] `Portal.init()` called once; `#loader` hidden when it resolves
- [ ] `Portal.gameStart()` / `gameStop()` bracket each round
- [ ] Restart routes through `Portal.commercialBreak()`
- [ ] Mute persists across reloads
- [ ] Zero external links (verified by `playtest.py`)

## Portal Registration

After building a game, add it to `~/games/index.html`:

1. Add a new `<a class="card">` in the `#grid` div with:
   - `data-genre="<genre>"` — matches filter chips: `puzzle`, `arcade`, `strategy`, `daily`
   - `style="--gc:<accent>; --i:<card index>;"` — the `--i` drives stagger delay
   - Correct `href="games/<slug>/"`
   - Emoji icon, genre label, title, tagline, Play button

2. Update the `section-label` count (currently "10 games").

3. If it's a daily game, add `<div class="badge-daily">Daily</div>` inside the card.

---

## Distribution Checklist (before `factory/ship.py`)

- [ ] Gameplay loop is fun on first try without reading hints
- [ ] Works on mobile (touch events, portrait orientation, safe areas)
- [ ] No JS console errors on load or during play
- [ ] Best score persists across page reloads
- [ ] Streak shows correct count
- [ ] Mute button works and persists
- [ ] New/Restart button always works
- [ ] Game over state is clear and recoverable
- [ ] `playtest.py` passes (includes: no external links, portal.js, #loader, SDK calls)
- [ ] `Portal.init` / `gameStart` / `gameStop` wired; mute persists
- [ ] No external links anywhere (brand is a `<span>`, no itch.io/portal links)
- [ ] `meta.json` is complete and accurate
- [ ] Portal card is added to `index.html`

Run: `python3 factory/ship.py <slug>` to create the submission package in `dist/<slug>/`.

---

## Quality Bar

A PortMaster game is ready to ship when:

1. **First session is self-explanatory** — the hint is enough; no tutorial needed
2. **Game feel is physical** — juice.js particles, sound, and shake are all wired
3. **Score goes somewhere** — best score persists; streak registers daily play
4. **Mobile plays as well as desktop** — tested at 375px width, portrait
5. **Copy is zero-slop** — no "addictive gameplay", no "epic combos", no exclamation marks in the UI

When in doubt, play the existing games (especially Fuse and Equate) as the bar.
