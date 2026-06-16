/* Stack — tap-timing tower game. Vanilla JS, mobile-first.
 * A block slides left/right at the top; tap to drop it onto the stack.
 * Misalignment trims the block. Trim to nothing = game over.
 * Perfect drop = small bonus + brief speed reset.
 * Uses ../../shared/juice.js and ../../shared/retention.js.
 */
(function () {
  'use strict';

  var GAME = 'stack';
  var clamp = Juice.clamp, lerp = Juice.lerp;

  // ---- DOM ----
  var canvas  = document.getElementById('game');
  var ctx     = canvas.getContext('2d');
  var wrap    = document.querySelector('.board-wrap');
  var scoreEl = document.getElementById('score');
  var bestEl  = document.getElementById('best');
  var floorEl = document.getElementById('floor');
  var streakEl= document.getElementById('streak');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovSub   = document.getElementById('ov-sub');
  var ovScore = document.getElementById('ov-score');
  var ovBest  = document.getElementById('ov-best');
  var ovFloor = document.getElementById('ov-floor');
  var ovAgain = document.getElementById('ov-again');

  // ---- layout ----
  var CW = 0, CH = 0, DPR = 1;
  var ROWS = 14;          // visible rows
  var BLOCK_H = 0;        // row height in px
  var INNER_W = 0;        // playfield width
  var LEFT = 0;           // playfield left edge

  function layout() {
    var bw = wrap.clientWidth, bh = wrap.clientHeight || bw * 1.6;
    CW = Math.min(bw, 400);
    CH = Math.min(bh, Math.round(CW * 1.65));
    CW = Math.max(220, CW); CH = Math.max(340, CH);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.round(CW * DPR);
    canvas.height = Math.round(CH * DPR);
    canvas.style.width  = CW + 'px';
    canvas.style.height = CH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    INNER_W = Math.round(CW * 0.82);
    LEFT    = Math.round((CW - INNER_W) / 2);
    BLOCK_H = Math.round(CH / ROWS);
  }

  // ---- palette ----
  // colours cycle through the tower as floors increase
  var PALETTE = [
    ['#7c6af7','#5ecfff'], ['#5ecfff','#7cf7c0'], ['#7cf7c0','#f7e96a'],
    ['#f7e96a','#f7a26a'], ['#f7a26a','#f76a8a'], ['#f76a8a','#c46af7'],
    ['#c46af7','#7c6af7']
  ];
  function blockColor(floor) { return PALETTE[floor % PALETTE.length]; }

  // ---- state ----
  var stack;       // [{x, w, floor}] bottom->top; index 0 = ground
  var moving;      // {x, w, dir, speed, floor, flashT}
  var score, best, over;
  var cameraY;     // world-Y of the top of the visible area (in block-row units)
  var targetCamY;
  var particles   = new Juice.Particles();
  var popups      = new Juice.Popups();
  var shake       = new Juice.Shake();
  var shakeOff    = { x: 0, y: 0 };
  var landAnim    = 0;   // flash timer on landing
  var BASE_SPEED  = 0;

  function reset() {
    score = 0; over = false;
    var startW = Math.round(INNER_W * 0.72);
    var startX = LEFT + Math.round((INNER_W - startW) / 2);
    // ground block + first floor
    stack = [
      { x: startX, w: startW, floor: 0 },
    ];
    BASE_SPEED = INNER_W * 1.1;
    cameraY = targetCamY = 0;
    spawnMoving();
    overlay.classList.add('hidden');
    renderHUD();
  }

  function spawnMoving() {
    var top  = stack[stack.length - 1];
    var flr  = top.floor + 1;
    var col  = blockColor(flr);
    var spd  = BASE_SPEED * (1 + Math.min(flr - 1, 28) * 0.035);
    moving = {
      x: LEFT - top.w,   // start off left edge
      w: top.w,
      dir: 1,
      speed: spd,
      floor: flr,
      col: col,
      flashT: 0
    };
  }

  function drop() {
    if (over) return;
    var top = stack[stack.length - 1];
    var mx = moving.x, mw = moving.w;
    var tx = top.x,    tw = top.w;

    // overlap
    var ox1 = Math.max(mx, tx);
    var ox2 = Math.min(mx + mw, tx + tw);
    var overlap = ox2 - ox1;

    if (overlap <= 0) { gameOver(); return; }

    var PERFECT_TOL = Math.round(INNER_W * 0.035);
    var isPerfect   = Math.abs(overlap - tw) <= PERFECT_TOL && Math.abs(overlap - mw) <= PERFECT_TOL;

    var nx, nw;
    if (isPerfect) {
      // snap to exactly the block below — no trim
      nx = tx; nw = tw;
      score += 10;
      particles.burst(tx + tw / 2, worldToScreen(moving.floor) + BLOCK_H / 2, {
        count: 22, colors: ['#fff', moving.col[0], moving.col[1]],
        speed: 180, life: 0.65, size: 5
      });
      popups.add(tx + tw / 2, worldToScreen(moving.floor), 'PERFECT +10',
        { color: '#fff', size: 16, life: 1.0 });
      Juice.Audio.play('win'); Juice.vibrate([10, 20, 10]);
      BASE_SPEED = Math.max(BASE_SPEED * 0.88, INNER_W * 1.1);
    } else {
      nx = ox1; nw = overlap;
      var pts = Math.max(1, Math.round((overlap / tw) * 5));
      score += pts;
      // trim debris burst
      var trimX = (mx < tx) ? mx + mw / 2 : mx + mw - mw / 4;
      particles.burst(trimX, worldToScreen(moving.floor) + BLOCK_H / 2, {
        count: 8 + Math.round((1 - overlap / mw) * 10),
        colors: [moving.col[0], moving.col[1], '#fff'],
        speed: 140, life: 0.5, size: 4, shape: 'rect'
      });
      Juice.Audio.play('tap'); Juice.vibrate(8);
      shake.add(2 + (1 - overlap / mw) * 5, 0.18);
    }

    stack.push({ x: nx, w: nw, floor: moving.floor });
    landAnim = 0.18;

    // scroll camera up so the new block is always visible near top-third
    var topFloor = stack.length - 1;
    targetCamY = Math.max(0, topFloor - Math.round(ROWS * 0.65));

    renderHUD();
    spawnMoving();
  }

  // ---- coordinate helpers ----
  // floor 0 = ground row; floor N = N rows above ground.
  // screen Y increases downward; floor Y increases upward.
  function worldToScreen(floor) {
    // bottom of visible area = cameraY; one block = BLOCK_H px
    return CH - BLOCK_H - (floor - cameraY) * BLOCK_H;
  }

  // ---- update ----
  function update(dt) {
    if (!over) {
      // move sliding block
      moving.x += moving.dir * moving.speed * dt;
      // bounce off extended walls
      var minX = LEFT - moving.w * 0.1;
      var maxX = LEFT + INNER_W - moving.w * 0.9;
      if (moving.x <= minX) { moving.x = minX; moving.dir = 1; }
      if (moving.x >= maxX) { moving.x = maxX; moving.dir = -1; }
      if (moving.flashT > 0) moving.flashT = Math.max(0, moving.flashT - dt);
      if (landAnim > 0)     landAnim      = Math.max(0, landAnim - dt);
    }
    // smooth camera
    cameraY = lerp(cameraY, targetCamY, Math.min(1, dt * 7));
    particles.update(dt); popups.update(dt); shakeOff = shake.update(dt);
  }

  // ---- draw ----
  var BLOCK_R = 5; // corner radius

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  function drawBlock(x, y, w, h, col, alpha, bounce) {
    var bh = h;
    if (bounce > 0) { var sc = 1 + 0.08 * Math.sin((1 - bounce / 0.18) * Math.PI); bh = h * sc; y -= (bh - h); }
    ctx.globalAlpha = alpha;
    var g = ctx.createLinearGradient(x, y, x, y + bh);
    g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
    ctx.fillStyle = g;
    roundRect(x, y, w, bh, BLOCK_R); ctx.fill();
    // subtle top-edge highlight
    ctx.globalAlpha = alpha * 0.35;
    ctx.fillStyle = '#fff';
    roundRect(x + 2, y + 2, w - 4, Math.min(6, bh * 0.3), 3); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    ctx.save(); ctx.translate(shakeOff.x, shakeOff.y);

    // background grid lines (subtle)
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (var r = 0; r <= ROWS; r++) {
      var gy = CH - r * BLOCK_H;
      ctx.beginPath(); ctx.moveTo(LEFT, gy); ctx.lineTo(LEFT + INNER_W, gy); ctx.stroke();
    }

    var GAP = 3; // px gap between blocks

    // draw stacked blocks
    for (var i = 0; i < stack.length; i++) {
      var bl = stack[i];
      var sy = worldToScreen(bl.floor);
      if (sy > CH + BLOCK_H || sy < -BLOCK_H * 2) continue;
      var col = blockColor(bl.floor);
      var isTop = (i === stack.length - 1);
      var bounce = isTop ? landAnim : 0;
      drawBlock(bl.x, sy + GAP, bl.w, BLOCK_H - GAP, col, isTop ? 1 : 0.82, bounce);
    }

    // draw moving block (at one floor above the top of stack)
    if (!over) {
      var msy = worldToScreen(moving.floor);
      if (msy > -BLOCK_H && msy < CH + BLOCK_H) {
        // aim guide: vertical dashed line at center
        var mx2 = moving.x + moving.w / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.moveTo(mx2, msy + BLOCK_H); ctx.lineTo(mx2, CH); ctx.stroke();
        ctx.setLineDash([]);

        drawBlock(moving.x, msy + GAP, moving.w, BLOCK_H - GAP, moving.col, 1, 0);
      }
    }

    particles.draw(ctx); popups.draw(ctx);
    ctx.restore();
  }

  // ---- HUD ----
  function renderHUD() {
    if (score > best) { best = score; Retention.set(GAME, 'best', score); }
    scoreEl.textContent = score;
    bestEl.textContent  = best;
    var flr = stack.length; // floor count includes ground
    floorEl.textContent = flr;
  }

  // ---- game over ----
  function gameOver() {
    if (over) return;
    over = true;
    Juice.Audio.play('lose'); Juice.vibrate([20, 40, 20]); shake.add(8, 0.35);
    Retention.submitScore(GAME, score);
    var isBest = score >= best && score > 0;
    ovTitle.textContent = isBest ? 'New Best! 🏆' : 'Crumbled!';
    ovSub.textContent   = isBest ? 'You beat your record.' : 'The block missed the stack.';
    ovScore.textContent = score;
    ovBest.textContent  = best;
    ovFloor.textContent = stack.length;
    overlay.classList.remove('hidden');
  }

  // ---- input ----
  function onAct() { Juice.Audio.unlock(); drop(); }
  canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); onAct(); });
  canvas.addEventListener('touchstart',  function (e) { e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); onAct(); }
  }, { passive: false });

  document.getElementById('new').addEventListener('click', function () { reset(); });
  document.getElementById('mute').addEventListener('click', function () {
    this.textContent = Juice.Audio.toggleMute() ? '🔇' : '🔊';
  });
  ovAgain.addEventListener('click', reset);

  // ---- boot ----
  function boot() {
    layout();
    best = Retention.best(GAME);
    bestEl.textContent = best;
    streakEl.innerHTML = '🔥 ' + Retention.touchStreak(GAME) + '&nbsp;day streak';
    reset();
    if (window.ResizeObserver) new ResizeObserver(layout).observe(wrap);
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', function () { setTimeout(layout, 200); });

    var last = performance.now();
    function frame(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      update(dt); draw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---- headless test hook ----
  window.__stack = {
    act:   function ()  { drop(); },
    move:  function (frac) {
      // teleport the moving block to a fractional position (0=left, 1=right)
      var top = stack[stack.length - 1];
      moving.x = LEFT + clamp(frac, 0, 1) * (INNER_W - moving.w);
      moving.dir = 1;
    },
    state: function () {
      return {
        floor:   stack.length,
        score:   score,
        over:    over,
        movingX: Math.round(moving ? moving.x : 0),
        movingW: Math.round(moving ? moving.w  : 0),
        topX:    stack[stack.length - 1].x,
        topW:    stack[stack.length - 1].w
      };
    },
    reset: reset
  };

  boot();
})();
