/* Gem Drop — match-3 swap puzzle. Vanilla JS, mobile-first.
 * Tap a gem, then tap an adjacent gem to swap. If the swap creates a
 * 3+ match it clears, gems fall, new ones fill from the top — cascade
 * until stable. No valid moves left = game over (no artificial timer).
 * Uses ../../shared/juice.js and ../../shared/retention.js.
 */
(function () {
  'use strict';

  var GAME = 'match3';
  var clamp = Juice.clamp, lerp = Juice.lerp;

  var COLS = 7, ROWS = 9;
  // 6 gem colors: [fill-top, fill-bottom, glow]
  var GEMS = [
    ['#ff6b8a', '#d63060', '#ff6b8a'],  // red
    ['#ffb347', '#e07b00', '#ffb347'],  // orange
    ['#ffe066', '#c9a800', '#ffe066'],  // yellow
    ['#6bf77a', '#2cba3d', '#6bf77a'],  // green
    ['#6ab4ff', '#2470d6', '#6ab4ff'],  // blue
    ['#c46af7', '#8230c9', '#c46af7'],  // purple
  ];
  var NCOLORS = GEMS.length;

  // points per match length (index = length, capped at 7+)
  var PTS = [0, 0, 0, 10, 25, 50, 100, 150];

  // ---- DOM ----
  var canvas  = document.getElementById('game');
  var ctx     = canvas.getContext('2d');
  var wrap    = document.querySelector('.board-wrap');
  var scoreEl = document.getElementById('score');
  var bestEl  = document.getElementById('best');
  var comboEl = document.getElementById('combo');
  var streakEl= document.getElementById('streak');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovSub   = document.getElementById('ov-sub');
  var ovScore = document.getElementById('ov-score');
  var ovBest  = document.getElementById('ov-best');
  var ovAgain = document.getElementById('ov-again');

  // ---- layout ----
  var CW = 0, CH = 0, DPR = 1;
  var CELL = 0, OX = 0, OY = 0; // cell size, board origin

  function layout() {
    var bw = wrap.clientWidth  || 320;
    var bh = wrap.clientHeight || 480;
    // fit a COLS x ROWS grid; add 2px border padding
    var cellW = Math.floor((bw - 4) / COLS);
    var cellH = Math.floor((bh - 4) / ROWS);
    CELL = Math.max(28, Math.min(cellW, cellH, 56));
    CW = CELL * COLS + 4;
    CH = CELL * ROWS + 4;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.round(CW * DPR);
    canvas.height = Math.round(CH * DPR);
    canvas.style.width  = CW + 'px';
    canvas.style.height = CH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    OX = 2; OY = 2;
  }

  // ---- grid ----
  // grid[r][c] = color index 0..NCOLORS-1, or -1 (empty/falling)
  var grid;
  // per-cell animation state
  var cellAnim; // cellAnim[r][c] = {scale, alpha, vy, dy} — dy = fractional row offset for fall

  function mkGrid() {
    var g = [], a = [];
    for (var r = 0; r < ROWS; r++) { g.push([]); a.push([]); for (var c = 0; c < COLS; c++) { g[r].push(0); a[r].push({scale:1,alpha:1,dy:0,vy:0}); } }
    return { g: g, a: a };
  }

  function rand(n) { return (Math.random() * n) | 0; }

  function initGrid() {
    grid = []; cellAnim = [];
    for (var r = 0; r < ROWS; r++) { grid.push([]); cellAnim.push([]); for (var c = 0; c < COLS; c++) { grid[r].push(0); cellAnim[r].push({scale:1,alpha:1,dy:0,vy:0}); } }
    // fill without initial matches
    for (var r2 = 0; r2 < ROWS; r2++) {
      for (var c2 = 0; c2 < COLS; c2++) {
        var col;
        do { col = rand(NCOLORS); } while (wouldMatch(r2, c2, col));
        grid[r2][c2] = col;
      }
    }
  }

  function wouldMatch(r, c, col) {
    // horizontal: two to the left
    if (c >= 2 && grid[r][c-1] === col && grid[r][c-2] === col) return true;
    // vertical: two above
    if (r >= 2 && grid[r-1][c] === col && grid[r-2][c] === col) return true;
    return false;
  }

  // ---- match finding ----
  function findMatches() {
    // returns array of {r,c} sets as flat objects merged
    var marked = [];
    for (var r = 0; r < ROWS; r++) { marked.push([]); for (var c = 0; c < COLS; c++) marked[r].push(false); }
    var any = false;
    // horizontal
    for (var r2 = 0; r2 < ROWS; r2++) {
      for (var c2 = 0; c2 < COLS - 2; ) {
        var col = grid[r2][c2], len = 1;
        while (c2 + len < COLS && grid[r2][c2+len] === col) len++;
        if (len >= 3) { for (var i = 0; i < len; i++) { marked[r2][c2+i] = true; any = true; } }
        c2 += len;
      }
    }
    // vertical
    for (var c3 = 0; c3 < COLS; c3++) {
      for (var r3 = 0; r3 < ROWS - 2; ) {
        var col2 = grid[r3][c3], len2 = 1;
        while (r3 + len2 < ROWS && grid[r3+len2][c3] === col2) len2++;
        if (len2 >= 3) { for (var j = 0; j < len2; j++) { marked[r3+j][c3] = true; any = true; } }
        r3 += len2;
      }
    }
    return any ? marked : null;
  }

  // count how many cells are marked in the flat marked grid
  function countMarked(marked) {
    var n = 0; for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (marked[r][c]) n++;
    return n;
  }

  // ---- valid move check ----
  function hasValidMoves() {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        // try swap right
        if (c + 1 < COLS) { doSwap(r,c,r,c+1); var m = findMatches(); doSwap(r,c,r,c+1); if (m) return true; }
        // try swap down
        if (r + 1 < ROWS) { doSwap(r,c,r+1,c); var m2 = findMatches(); doSwap(r,c,r+1,c); if (m2) return true; }
      }
    }
    return false;
  }

  function doSwap(r1,c1,r2,c2) { var t = grid[r1][c1]; grid[r1][c1] = grid[r2][c2]; grid[r2][c2] = t; }

  // ---- state machine ----
  var STATE = { IDLE: 0, SWAPPING: 1, CLEARING: 2, FALLING: 3, FILLING: 4, CHECKING: 5, OVER: 6 };
  var state, selected, score, best, combo;
  var animT = 0;   // generic timer for current animation phase
  var swapA, swapB, swapBack; // swap animation targets

  function reset() {
    initGrid();
    state = STATE.IDLE; selected = null; score = 0; combo = 0; animT = 0;
    overlay.classList.add('hidden');
    comboEl.classList.add('hidden');
    renderHUD();
  }

  // ---- update ----
  var SWAP_DUR   = 0.14;
  var CLEAR_DUR  = 0.22;
  var FALL_SPEED = 12; // cells per second

  function update(dt) {
    if (state === STATE.SWAPPING) {
      animT += dt;
      var t = clamp(animT / SWAP_DUR, 0, 1);
      // animate both cells
      swapA.anim.dx = lerp(0, swapA.dx, t);
      swapA.anim.dy = lerp(0, swapA.dy, t);
      swapB.anim.dx = lerp(0, swapB.dx, t);
      swapB.anim.dy = lerp(0, swapB.dy, t);
      if (t >= 1) {
        swapA.anim.dx = swapA.anim.dy = swapB.anim.dx = swapB.anim.dy = 0;
        if (swapBack) {
          // no match — already swapped back in grid, just finish
          state = STATE.IDLE;
        } else {
          state = STATE.CLEARING; animT = 0;
          markAndScheduleClear();
        }
      }
    } else if (state === STATE.CLEARING) {
      animT += dt;
      var t2 = clamp(animT / CLEAR_DUR, 0, 1);
      for (var r = 0; r < ROWS; r++)
        for (var c = 0; c < COLS; c++)
          if (clearMask[r][c]) cellAnim[r][c].scale = 1 - t2;
      if (t2 >= 1) { applyClears(); state = STATE.FALLING; }
    } else if (state === STATE.FALLING) {
      // move gems down into empty (-1) slots
      var anyFalling = false;
      for (var c2 = 0; c2 < COLS; c2++) {
        // find bottom-most empty, then pull gem from above
        for (var r2 = ROWS - 1; r2 >= 0; r2--) {
          if (grid[r2][c2] === -1) {
            // find nearest gem above
            var src = r2 - 1;
            while (src >= 0 && grid[src][c2] === -1) src--;
            if (src >= 0) {
              // move gem from src to r2
              grid[r2][c2] = grid[src][c2];
              grid[src][c2] = -1;
              var a = cellAnim[r2][c2];
              a.dy = -(r2 - src); a.scale = 1; a.alpha = 1;
            }
          }
        }
        // animate fall
        for (var r3 = 0; r3 < ROWS; r3++) {
          var a2 = cellAnim[r3][c2];
          if (a2.dy < 0) {
            a2.dy = Math.min(0, a2.dy + FALL_SPEED * dt);
            anyFalling = true;
          }
        }
      }
      if (!anyFalling) { state = STATE.FILLING; }
    } else if (state === STATE.FILLING) {
      // fill remaining -1 from top with new random gems
      var filled = false;
      for (var c3 = 0; c3 < COLS; c3++) {
        for (var r4 = 0; r4 < ROWS; r4++) {
          if (grid[r4][c3] === -1) {
            grid[r4][c3] = rand(NCOLORS);
            var a3 = cellAnim[r4][c3];
            a3.dy = -1; a3.scale = 0.6; a3.alpha = 0;
            filled = true;
          }
        }
      }
      if (filled) {
        state = STATE.FALLING;
      } else {
        state = STATE.CHECKING;
      }
    } else if (state === STATE.CHECKING) {
      // fade in any newly placed gems
      var settling = false;
      for (var r5 = 0; r5 < ROWS; r5++)
        for (var c4 = 0; c4 < COLS; c4++) {
          var a4 = cellAnim[r5][c4];
          if (a4.scale < 1) { a4.scale = Math.min(1, a4.scale + dt * 5); settling = true; }
          if (a4.alpha < 1) { a4.alpha = Math.min(1, a4.alpha + dt * 5); settling = true; }
        }
      if (!settling) {
        var m = findMatches();
        if (m) { combo++; showCombo(); state = STATE.CLEARING; animT = 0; clearMask = m; scoreClears(m); }
        else {
          combo = 0; comboEl.classList.add('hidden');
          if (!hasValidMoves()) { gameOver(); }
          else { state = STATE.IDLE; }
        }
      }
    }

    particles.update(dt); popups.update(dt); shakeOff = shake.update(dt);
  }

  var clearMask = null;

  function markAndScheduleClear() {
    var m = findMatches();
    if (!m) { state = STATE.IDLE; return; } // shouldn't happen
    clearMask = m;
    combo++;
    showCombo();
    scoreClears(m);
  }

  function scoreClears(m) {
    var n = countMarked(m);
    var base = PTS[Math.min(n, PTS.length - 1)];
    var pts  = base * Math.max(1, combo);
    score += pts;
    if (score > best) { best = score; Retention.set(GAME, 'best', score); }
    // burst particles at centroid of matches
    var cx = 0, cy = 0, cnt = 0;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (m[r][c]) {
      cx += OX + c * CELL + CELL / 2; cy += OY + r * CELL + CELL / 2; cnt++;
    }
    if (cnt) {
      cx /= cnt; cy /= cnt;
      var col = grid[0][0]; // any color from first match for hue — pick first marked
      outer: for (var r2 = 0; r2 < ROWS; r2++) for (var c2 = 0; c2 < COLS; c2++) if (m[r2][c2]) { col = grid[r2][c2]; break outer; }
      var gc = GEMS[col];
      particles.burst(cx, cy, { count: 6 + n * 2, colors: [gc[0], gc[1], '#fff'], speed: 130, life: 0.55, size: 5 });
    }
    if (combo > 1) shake.add(Math.min(6, combo + 1), 0.18);
    Juice.Audio.play('merge', Math.min(combo, 8));
    Juice.vibrate(combo > 1 ? [10, 15, 10] : 8);
    scoreEl.textContent = score; bestEl.textContent = best;
    if (pts > 0) popups.add(cx || CW/2, cy || CH/2, '+' + pts, { color: '#fff', size: Math.min(26, 14 + combo * 3), life: 0.8 });
  }

  function applyClears() {
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (clearMask[r][c]) {
      grid[r][c] = -1;
      cellAnim[r][c].scale = 0;
    }
  }

  function showCombo() {
    if (combo < 2) { comboEl.classList.add('hidden'); return; }
    comboEl.textContent = 'x' + combo + ' combo!';
    comboEl.classList.remove('hidden');
  }

  // ---- input ----
  function cellAt(clientX, clientY) {
    var b = canvas.getBoundingClientRect();
    var px = (clientX - b.left) * (CW / b.width)  - OX;
    var py = (clientY - b.top)  * (CH / b.height) - OY;
    var c = Math.floor(px / CELL), r = Math.floor(py / CELL);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return { r: r, c: c };
  }

  function isAdjacent(a, b) {
    return (a.r === b.r && Math.abs(a.c - b.c) === 1) ||
           (a.c === b.c && Math.abs(a.r - b.r) === 1);
  }

  function onTap(clientX, clientY) {
    if (state !== STATE.IDLE) return;
    var cell = cellAt(clientX, clientY);
    if (!cell) return;
    Juice.Audio.unlock();

    if (!selected) {
      selected = cell;
      Juice.Audio.play('tap');
      return;
    }

    if (selected.r === cell.r && selected.c === cell.c) {
      selected = null; return;
    }

    if (!isAdjacent(selected, cell)) {
      selected = cell; Juice.Audio.play('tap'); return;
    }

    // attempt swap
    var r1 = selected.r, c1 = selected.c, r2 = cell.r, c2 = cell.c;
    selected = null;
    doSwap(r1, c1, r2, c2);
    var m = findMatches();
    var back = !m;
    if (back) doSwap(r1, c1, r2, c2); // revert in grid; anim still plays then reverses

    // cell offset in rows/cols
    var dr = r2 - r1, dc = c2 - c1;
    swapA = { r: r1, c: c1, anim: cellAnim[r1][c1], dx: dc, dy: dr };
    swapB = { r: r2, c: c2, anim: cellAnim[r2][c2], dx: -dc, dy: -dr };
    // reset anim offsets
    swapA.anim.dx = 0; swapA.anim.dy = 0;
    swapB.anim.dx = 0; swapB.anim.dy = 0;
    swapBack = back;
    state = STATE.SWAPPING; animT = 0;
    Juice.Audio.play(back ? 'lose' : 'pop'); // subtle fail vs succeed sound
    Juice.vibrate(back ? 20 : 8);
  }

  canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); onTap(e.clientX, e.clientY); });
  canvas.addEventListener('touchstart',  function (e) { e.preventDefault(); }, { passive: false });

  // ---- render ----
  var particles = new Juice.Particles();
  var popups    = new Juice.Popups();
  var shake     = new Juice.Shake();
  var shakeOff  = { x: 0, y: 0 };

  var CELL_PAD = 3;
  var CELL_R   = 8;

  function drawGem(cx, cy, size, colorIdx, alpha) {
    if (size <= 0 || alpha <= 0) return;
    var x = cx - size / 2, y = cy - size / 2;
    var w = size, h = size;
    var r = CELL_R * (size / CELL);
    var gc = GEMS[colorIdx];

    ctx.globalAlpha = alpha;
    // glow for large gems
    if (size > CELL * 0.6) {
      ctx.shadowColor = gc[2]; ctx.shadowBlur = size * 0.35;
    }
    var g = ctx.createLinearGradient(cx, y, cx, y + h);
    g.addColorStop(0, gc[0]); g.addColorStop(1, gc[1]);
    ctx.fillStyle = g;
    roundRect(x, y, w, h, r); ctx.fill();
    ctx.shadowBlur = 0;
    // highlight
    ctx.globalAlpha = alpha * 0.28; ctx.fillStyle = '#fff';
    roundRect(x + w * 0.15, y + h * 0.1, w * 0.5, h * 0.25, r * 0.6); ctx.fill();
    ctx.globalAlpha = 1;
  }

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

  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    ctx.save(); ctx.translate(shakeOff.x, shakeOff.y);

    // board background
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(OX - 1, OY - 1, COLS * CELL + 2, ROWS * CELL + 2, 10); ctx.fill();

    // grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (var r = 0; r <= ROWS; r++) {
      ctx.beginPath(); ctx.moveTo(OX, OY + r * CELL); ctx.lineTo(OX + COLS * CELL, OY + r * CELL); ctx.stroke();
    }
    for (var c = 0; c <= COLS; c++) {
      ctx.beginPath(); ctx.moveTo(OX + c * CELL, OY); ctx.lineTo(OX + c * CELL, OY + ROWS * CELL); ctx.stroke();
    }

    // gems
    for (var r2 = 0; r2 < ROWS; r2++) {
      for (var c2 = 0; c2 < COLS; c2++) {
        var col = grid[r2][c2];
        if (col < 0) continue;
        var a = cellAnim[r2][c2];
        // swap offset in cells
        var odx = (a.dx || 0), ody = (a.dy || 0);
        var cx = OX + (c2 + odx) * CELL + CELL / 2;
        var cy = OY + (r2 + ody) * CELL + CELL / 2;
        var size = (CELL - CELL_PAD * 2) * (a.scale != null ? a.scale : 1);
        drawGem(cx, cy, size, col, a.alpha != null ? a.alpha : 1);
      }
    }

    // selected highlight
    if (selected && state === STATE.IDLE) {
      var sx = OX + selected.c * CELL, sy = OY + selected.r * CELL;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.7;
      roundRect(sx + 2, sy + 2, CELL - 4, CELL - 4, CELL_R); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    particles.draw(ctx); popups.draw(ctx);
    ctx.restore();
  }

  // ---- HUD ----
  function renderHUD() {
    scoreEl.textContent = score; bestEl.textContent = best;
  }

  // ---- game over ----
  function gameOver() {
    state = STATE.OVER;
    Juice.Audio.play('lose'); Juice.vibrate([20, 40, 20]); shake.add(8, 0.35);
    Retention.submitScore(GAME, score);
    var isBest = score >= best && score > 0;
    ovTitle.textContent = isBest ? 'New Best! 🏆' : 'No Moves!';
    ovSub.textContent   = isBest ? 'You beat your record.' : 'The board ran out of valid swaps.';
    ovScore.textContent = score; ovBest.textContent = best;
    overlay.classList.remove('hidden');
  }

  // ---- lifecycle ----
  document.getElementById('new').addEventListener('click', reset);
  document.getElementById('mute').addEventListener('click', function () {
    this.textContent = Juice.Audio.toggleMute() ? '🔇' : '🔊';
  });
  ovAgain.addEventListener('click', reset);

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
  window.__match3 = {
    swap: function (r1, c1, r2, c2) {
      if (state !== STATE.IDLE) return false;
      doSwap(r1, c1, r2, c2);
      var m = findMatches();
      var back = !m;
      if (back) doSwap(r1, c1, r2, c2);
      var dr = r2 - r1, dc = c2 - c1;
      swapA = { r: r1, c: c1, anim: cellAnim[r1][c1], dx: dc, dy: dr };
      swapB = { r: r2, c: c2, anim: cellAnim[r2][c2], dx: -dc, dy: -dr };
      swapA.anim.dx = 0; swapA.anim.dy = 0;
      swapB.anim.dx = 0; swapB.anim.dy = 0;
      swapBack = back;
      state = STATE.SWAPPING; animT = 0;
      return !back;
    },
    tick: function (n, dt) {
      dt = dt || 1/60; n = n || 1;
      for (var i = 0; i < n; i++) update(dt);
    },
    state: function () {
      var empty = 0; for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (grid[r][c] < 0) empty++;
      return { phase: state, score: score, combo: combo, empty: empty, over: state === STATE.OVER };
    },
    grid: function () { return grid.map(function(r){return r.slice();}); },
    reset: reset
  };

  boot();
})();
