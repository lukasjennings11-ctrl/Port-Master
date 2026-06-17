/* Burst — bubble-shooter (hex-grid match-3-by-shooting). Vanilla JS, mobile-first.
 * Aim and fire a bubble upward; it snaps into the hex grid on contact. Any
 * connected group of 3+ same-color bubbles pops, and anything left
 * disconnected from the ceiling falls too (bonus). Every few shots a new
 * row drops in from the top, pushing the stack down — overrun the danger
 * line and it's game over.
 * Uses ../../shared/juice.js and ../../shared/retention.js.
 */
(function () {
  'use strict';

  var GAME = 'bubble';
  var clamp = Juice.clamp;

  var COLS = 8;                 // columns on even rows (odd rows have COLS-1)
  var COLORS = ['#ff6b8a', '#ffb347', '#ffe066', '#6bf7a8', '#6ab4ff', '#c46af7'];
  var SHOTS_PER_ROW = 6;
  var DANGER_ROWS = 13;          // game over if grid grows past this many rows
  var MIN_POP = 3;

  // ---- DOM ----
  var canvas  = document.getElementById('game');
  var ctx     = canvas.getContext('2d');
  var wrap    = document.querySelector('.board-wrap');
  var scoreEl = document.getElementById('score');
  var bestEl  = document.getElementById('best');
  var shotsLeftEl = document.getElementById('shotsLeft');
  var streakEl= document.getElementById('streak');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovSub   = document.getElementById('ov-sub');
  var ovScore = document.getElementById('ov-score');
  var ovBest  = document.getElementById('ov-best');
  var ovAgain = document.getElementById('ov-again');

  // ---- layout ----
  var CW = 0, CH = 0, DPR = 1, R = 0, LEFT = 0, TOP = 0, innerW = 0, rowH = 0;
  var shooterY = 0, shooterX = 0;

  function layout() {
    var bw = wrap.clientWidth || 320, bh = wrap.clientHeight || 480;
    CW = Math.max(240, Math.min(bw, 420));
    CH = Math.max(360, Math.min(bh, Math.round(CW * 1.5)));
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR);
    canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    R = Math.floor(CW / (COLS * 2 + 1));
    innerW = R * 2 * COLS;
    LEFT = Math.round((CW - innerW) / 2);
    TOP = R + 6;
    rowH = R * Math.sqrt(3);
    shooterY = CH - R - 14;
    shooterX = CW / 2;
  }

  // ---- grid geometry ----
  function colsInRow(r) { return (r % 2 === 0) ? COLS : COLS - 1; }
  function cellX(r, c) { return LEFT + R + c * 2 * R + (r % 2 ? R : 0); }
  function cellY(r) { return TOP + R + r * rowH; }
  function neighbors(r, c) {
    if (r % 2 === 0) return [[r,c-1],[r,c+1],[r-1,c-1],[r-1,c],[r+1,c-1],[r+1,c]];
    return [[r,c-1],[r,c+1],[r-1,c],[r-1,c+1],[r+1,c],[r+1,c+1]];
  }
  function inBounds(r, c) { return r >= 0 && r < grid.length && c >= 0 && c < colsInRow(r); }
  function getCell(r, c) { return inBounds(r, c) ? grid[r][c] : null; }

  // ---- state ----
  var grid;          // grid[r][c] = colorIndex or null
  var score, best, over, shotsLeft;
  var proj;          // active projectile {x,y,vx,vy,color} or null
  var currentColor, nextColor;
  var aimAngle = -Math.PI / 2; // pointing straight up
  var particles = new Juice.Particles();
  var popups    = new Juice.Popups();
  var shake     = new Juice.Shake();
  var shakeOff  = { x: 0, y: 0 };
  var PROJ_SPEED;

  function colorsInGrid() {
    var set = {};
    for (var r = 0; r < grid.length; r++) for (var c = 0; c < colsInRow(r); c++) {
      if (grid[r][c] != null) set[grid[r][c]] = true;
    }
    var arr = Object.keys(set).map(Number);
    return arr.length ? arr : COLORS.map(function (_, i) { return i; });
  }
  function pickColor() {
    var avail = colorsInGrid();
    return avail[(Math.random() * avail.length) | 0];
  }

  function makeRow() {
    var row = [];
    for (var c = 0; c < COLS; c++) row.push((Math.random() * COLORS.length) | 0);
    return row;
  }

  function reset() {
    grid = [];
    for (var r = 0; r < 5; r++) grid.push(makeRow());
    cleanupInitial();
    score = 0; over = false; shotsLeft = SHOTS_PER_ROW; proj = null;
    PROJ_SPEED = CH * 1.6;
    currentColor = pickColor(); nextColor = pickColor();
    overlay.classList.add('hidden');
    renderHUD();
  }

  // remove any accidental 3+ same-color runs from the initial random grid
  function cleanupInitial() {
    var changed = true;
    while (changed) {
      changed = false;
      for (var r = 0; r < grid.length; r++) {
        for (var c = 0; c < colsInRow(r); c++) {
          if (grid[r][c] == null) continue;
          var group = floodFill(r, c, grid[r][c]);
          if (group.length >= MIN_POP) {
            // recolor one bubble in the group to break it up (cheap fix, no scoring)
            var pick = group[0];
            grid[pick[0]][pick[1]] = ((grid[pick[0]][pick[1]] || 0) + 1) % COLORS.length;
            changed = true;
          }
        }
      }
    }
  }

  function floodFill(r, c, color) {
    var startColor = color != null ? color : getCell(r, c);
    if (startColor == null) return [];
    var seen = {}; var stack = [[r, c]]; var out = [];
    while (stack.length) {
      var cur = stack.pop(); var rr = cur[0], cc = cur[1];
      var key = rr + ',' + cc;
      if (seen[key]) continue; seen[key] = true;
      if (getCell(rr, cc) !== startColor) continue;
      out.push([rr, cc]);
      var ns = neighbors(rr, cc);
      for (var i = 0; i < ns.length; i++) stack.push(ns[i]);
    }
    return out;
  }

  // connectivity to ceiling (row 0) for floating-bubble detection
  function connectedToCeiling() {
    var seen = {}; var stack = [];
    for (var c = 0; c < colsInRow(0); c++) if (getCell(0, c) != null) stack.push([0, c]);
    while (stack.length) {
      var cur = stack.pop(); var key = cur[0] + ',' + cur[1];
      if (seen[key]) continue; seen[key] = true;
      var ns = neighbors(cur[0], cur[1]);
      for (var i = 0; i < ns.length; i++) {
        var nr = ns[i][0], nc = ns[i][1];
        if (getCell(nr, nc) != null && !seen[nr + ',' + nc]) stack.push([nr, nc]);
      }
    }
    return seen;
  }

  // ---- shooting ----
  function fire() {
    if (over || proj) return;
    var vx = Math.cos(aimAngle) * PROJ_SPEED, vy = Math.sin(aimAngle) * PROJ_SPEED;
    proj = { x: shooterX, y: shooterY, vx: vx, vy: vy, color: currentColor };
    Juice.Audio.play('tap');
  }

  function settleProjectile() {
    var px = proj.x, py = proj.y;
    // find nearest existing bubble within collision range
    var best_ = null, bestD = Infinity;
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < colsInRow(r); c++) {
        if (grid[r][c] == null) continue;
        var d = Math.hypot(px - cellX(r, c), py - cellY(r));
        if (d < R * 1.98 && d < bestD) { bestD = d; best_ = [r, c]; }
      }
    }
    var targetR, targetC;
    if (best_) {
      var hr = best_[0], hc = best_[1];
      var candidates = neighbors(hr, hc).filter(function (n) { return inBounds(n[0], n[1]) ? grid[n[0]][n[1]] == null : (n[0] >= 0 && n[0] < DANGER_ROWS + 2 && n[1] >= 0 && n[1] < colsInRow(n[0] >= 0 ? n[0] : 0)); });
      // ensure row exists in grid (extend if needed)
      var best2 = null, bestD2 = Infinity;
      for (var i = 0; i < candidates.length; i++) {
        var nr = candidates[i][0], nc = candidates[i][1];
        ensureRow(nr);
        if (nc < 0 || nc >= colsInRow(nr) || grid[nr][nc] != null) continue;
        var dd = Math.hypot(px - cellX(nr, nc), py - cellY(nr));
        if (dd < bestD2) { bestD2 = dd; best2 = [nr, nc]; }
      }
      if (best2) { targetR = best2[0]; targetC = best2[1]; }
      else { targetR = hr; targetC = hc; } // fallback (shouldn't normally happen)
    } else {
      // reached ceiling without collision
      ensureRow(0);
      var col = Math.round((px - LEFT - R) / (2 * R));
      col = clamp(col, 0, colsInRow(0) - 1);
      targetR = 0; targetC = col;
      if (grid[0][targetC] != null) {
        for (var off = 1; off < colsInRow(0); off++) {
          if (grid[0][clamp(col - off, 0, colsInRow(0) - 1)] == null) { targetC = clamp(col - off, 0, colsInRow(0) - 1); break; }
          if (grid[0][clamp(col + off, 0, colsInRow(0) - 1)] == null) { targetC = clamp(col + off, 0, colsInRow(0) - 1); break; }
        }
      }
    }
    grid[targetR][targetC] = proj.color;
    var placedColor = proj.color;
    proj = null;

    var group = floodFill(targetR, targetC, placedColor);
    if (group.length >= MIN_POP) {
      popGroup(group);
      dropFloaters();
    }

    currentColor = nextColor; nextColor = pickColor();
    shotsLeft--;
    if (shotsLeft <= 0) { addRow(); shotsLeft = SHOTS_PER_ROW; }
    checkGameOver();
    renderHUD();
  }

  function ensureRow(r) { while (grid.length <= r) grid.push(new Array(colsInRow(grid.length)).fill(null)); }

  function popGroup(group) {
    var cx = 0, cy = 0;
    for (var i = 0; i < group.length; i++) {
      var r = group[i][0], c = group[i][1];
      var col = grid[r][c];
      cx += cellX(r, c); cy += cellY(r);
      particles.burst(cellX(r, c), cellY(r), { count: 8, colors: [COLORS[col], '#fff'], speed: 140, life: 0.45, size: 4 });
      grid[r][c] = null;
    }
    cx /= group.length; cy /= group.length;
    var pts = group.length * 10;
    score += pts;
    popups.add(cx, cy, '+' + pts, { color: '#fff', size: 18, life: 0.7 });
    Juice.Audio.play('merge', Math.min(group.length, 8)); Juice.vibrate(10);
    if (group.length >= 5) shake.add(5, 0.2);
  }

  function dropFloaters() {
    var connected = connectedToCeiling();
    var floaters = [];
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < colsInRow(r); c++) {
        if (grid[r][c] != null && !connected[r + ',' + c]) floaters.push([r, c]);
      }
    }
    if (!floaters.length) return;
    for (var i = 0; i < floaters.length; i++) {
      var r2 = floaters[i][0], c2 = floaters[i][1];
      var col2 = grid[r2][c2];
      particles.burst(cellX(r2, c2), cellY(r2), { count: 10, colors: [COLORS[col2], '#fff'], speed: 220, life: 0.6, size: 4, gravity: 600 });
      grid[r2][c2] = null;
    }
    var pts = floaters.length * 20;
    score += pts;
    popups.add(shooterX, shooterY - R * 3, '+' + pts + ' drop!', { color: '#6ad7ff', size: 18, life: 0.8 });
    Juice.Audio.play('win'); Juice.vibrate([10, 10, 10]);
  }

  function addRow() {
    grid.unshift(makeRow());
  }

  function checkGameOver() {
    if (grid.length > DANGER_ROWS) crash();
  }

  function crash() {
    if (over) return;
    over = true;
    Juice.Audio.play('lose'); Juice.vibrate([20, 40, 20]); shake.add(8, 0.35);
    Retention.submitScore(GAME, score);
    var isBest = score >= best && score > 0;
    ovTitle.textContent = isBest ? 'New Best! 🏆' : 'Overrun!';
    ovSub.textContent = isBest ? 'You beat your record.' : 'The bubbles reached the bottom.';
    ovScore.textContent = score; ovBest.textContent = best;
    overlay.classList.remove('hidden');
  }

  // ---- update ----
  function update(dt) {
    if (proj) {
      proj.x += proj.vx * dt; proj.y += proj.vy * dt;
      if (proj.x - R < LEFT) { proj.x = LEFT + R; proj.vx = -proj.vx; }
      if (proj.x + R > LEFT + innerW) { proj.x = LEFT + innerW - R; proj.vx = -proj.vx; }
      if (proj.y - R <= TOP - R) { settleProjectile(); }
      else {
        // check collision against placed bubbles each frame
        outer: for (var r = 0; r < grid.length; r++) {
          for (var c = 0; c < colsInRow(r); c++) {
            if (grid[r][c] == null) continue;
            var d = Math.hypot(proj.x - cellX(r, c), proj.y - cellY(r));
            if (d < R * 1.9) { settleProjectile(); break outer; }
          }
        }
      }
    }
    particles.update(dt); popups.update(dt); shakeOff = shake.update(dt);
  }

  // ---- render ----
  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    ctx.save(); ctx.translate(shakeOff.x, shakeOff.y);

    // danger line
    var dangerY = TOP + R + DANGER_ROWS * rowH;
    ctx.strokeStyle = 'rgba(255,107,138,0.3)'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.moveTo(LEFT, Math.min(dangerY, shooterY - R * 2)); ctx.lineTo(LEFT + innerW, Math.min(dangerY, shooterY - R * 2)); ctx.stroke();
    ctx.setLineDash([]);

    // grid bubbles
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < colsInRow(r); c++) {
        if (grid[r][c] == null) continue;
        drawBubble(cellX(r, c), cellY(r), R, COLORS[grid[r][c]]);
      }
    }

    // aim guide
    if (!over) {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 2; ctx.setLineDash([5, 7]);
      ctx.beginPath(); ctx.moveTo(shooterX, shooterY);
      ctx.lineTo(shooterX + Math.cos(aimAngle) * 140, shooterY + Math.sin(aimAngle) * 140);
      ctx.stroke(); ctx.setLineDash([]);

      drawBubble(shooterX, shooterY, R, COLORS[currentColor]);
      drawBubble(shooterX + R * 2.4, shooterY, R * 0.6, COLORS[nextColor]);
    }

    // projectile
    if (proj) drawBubble(proj.x, proj.y, R, COLORS[proj.color]);

    particles.draw(ctx); popups.draw(ctx);
    ctx.restore();
  }

  function drawBubble(x, y, r, color) {
    ctx.save(); ctx.translate(x, y);
    var g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#fff'); g.addColorStop(0.18, color); g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, Math.max(1, r * 0.94), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---- HUD ----
  function renderHUD() {
    if (score > best) { best = score; Retention.set(GAME, 'best', score); }
    scoreEl.textContent = score; bestEl.textContent = best;
    shotsLeftEl.textContent = shotsLeft;
  }

  // ---- input ----
  function setAimFromPoint(clientX, clientY) {
    var b = canvas.getBoundingClientRect();
    var x = clientX - b.left, y = clientY - b.top;
    var dx = x - shooterX, dy = y - shooterY;
    var ang = Math.atan2(dy, dx);
    // clamp to upward arc only (-170deg..-10deg)
    var minA = -Math.PI + 0.17, maxA = -0.17;
    ang = clamp(ang, minA, maxA);
    aimAngle = ang;
  }
  var dragging = false;
  canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); Juice.Audio.unlock(); dragging = true; setAimFromPoint(e.clientX, e.clientY); });
  canvas.addEventListener('pointermove', function (e) { if (dragging) setAimFromPoint(e.clientX, e.clientY); });
  window.addEventListener('pointerup', function () { if (dragging) { dragging = false; fire(); } });
  canvas.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { aimAngle = clamp(aimAngle - 0.08, -Math.PI + 0.17, -0.17); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { aimAngle = clamp(aimAngle + 0.08, -Math.PI + 0.17, -0.17); e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') { Juice.Audio.unlock(); fire(); e.preventDefault(); }
  }, { passive: false });

  document.getElementById('new').addEventListener('click', reset);
  document.getElementById('mute').addEventListener('click', function () { this.textContent = Juice.Audio.toggleMute() ? '🔇' : '🔊'; });
  ovAgain.addEventListener('click', reset);

  // ---- boot ----
  function boot() {
    layout();
    best = Retention.best(GAME);
    streakEl.innerHTML = '🔥 ' + Retention.touchStreak(GAME) + '&nbsp;day streak';
    reset();
    if (window.ResizeObserver) new ResizeObserver(layout).observe(wrap);
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', function () { setTimeout(layout, 200); });
    var last = performance.now();
    function frame(now) { var dt = Math.min(0.05, (now - last) / 1000); last = now; update(dt); draw(); requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
  }

  // ---- headless test hook ----
  window.__bubble = {
    aim: function (angle) { aimAngle = clamp(angle, -Math.PI + 0.17, -0.17); },
    fire: fire,
    tick: function (n, dt) { dt = dt || 1 / 60; for (var i = 0; i < (n || 1); i++) update(dt); },
    state: function () {
      var count = 0;
      for (var r = 0; r < grid.length; r++) for (var c = 0; c < colsInRow(r); c++) if (grid[r][c] != null) count++;
      return { score: score, over: over, rows: grid.length, bubbleCount: count, shotsLeft: shotsLeft, hasProjectile: !!proj, currentColor: currentColor };
    },
    grid: function () { return grid.map(function (row) { return row.slice(); }); },
    setColor: function (c) { currentColor = c; },
    setCell: function (r, c, color) { ensureRow(r); grid[r][c] = color; },
    clearGrid: function () { grid = [[]]; for (var c = 0; c < colsInRow(0); c++) grid[0].push(null); },
    cellPos: function (r, c) { return { x: cellX(r, c), y: cellY(r) }; },
    shooterPos: function () { return { x: shooterX, y: shooterY }; },
    reset: reset
  };

  boot();
})();
