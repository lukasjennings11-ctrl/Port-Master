/* Fuse — a merge puzzle (2048-family). Dependency-free, mobile-first.
 * Uses ../../shared/juice.js (game feel) and ../../shared/retention.js (stickiness).
 */
(function () {
  'use strict';

  var GAME = 'fuse';
  var N = 4;
  var SLIDE = 0.11;   // slide animation seconds
  var POP = 0.18;     // merge pop seconds
  var SPAWN = 0.18;   // spawn grow seconds

  var lerp = Juice.lerp, ease = Juice.ease, clamp = Juice.clamp;

  // ---- palette: value -> [gradA, gradB, textColor] ----
  var PAL = {
    2:    ['#39427a', '#2b3463', '#cfe0ff'],
    4:    ['#3f5bc0', '#3348a0', '#eaf1ff'],
    8:    ['#5a4bd6', '#4838b4', '#f1ecff'],
    16:   ['#2ea6b8', '#1f8a9c', '#eafcff'],
    32:   ['#2fae6b', '#1f9457', '#eafff3'],
    64:   ['#7bc23b', '#5fa028', '#0f1a00'],
    128:  ['#e8c34a', '#d3a526', '#3a2e00'],
    256:  ['#f0a93e', '#dc8b1f', '#3a2600'],
    512:  ['#f07c3e', '#dc5f1f', '#3a1500'],
    1024: ['#f25c9a', '#dc3f7f', '#ffffff'],
    2048: ['#b15cf2', '#8c3fdc', '#ffffff']
  };
  var PAL_BIG = ['#ffd75c', '#ffb03f', '#3b2a00'];
  function colors(v) {
    var p = PAL[v] || PAL_BIG;
    return { a: p[0], b: p[1], text: p[2], burst: [p[0], p[1], '#ffffff'] };
  }

  var BOARD_BG = '#141a30', SLOT_BG = '#232c50';

  // ---- DOM ----
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var wrap = document.querySelector('.board-wrap');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var streakEl = document.getElementById('streak');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovSub = document.getElementById('ov-sub');
  var ovScore = document.getElementById('ov-score');
  var ovBest = document.getElementById('ov-best');
  var ovAgain = document.getElementById('ov-again');

  // ---- state ----
  var cells, score, over, won, bestBest, bestAtStart;
  var anim = { active: false, t: 0 };
  var absorbing = [];
  var pendingMerges = [];
  var pendingSpawn = false;
  var overlayMode = 'over';

  var particles = new Juice.Particles();
  var popups = new Juice.Popups();
  var shake = new Juice.Shake();
  var shakeOff = { x: 0, y: 0 };

  // ---- layout ----
  var size = 0, pad = 0, cell = 0, DPR = 1;
  function layout() {
    var avail = Math.min(wrap.clientWidth, wrap.clientHeight || wrap.clientWidth);
    size = Math.max(220, Math.floor(avail));
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * DPR);
    canvas.height = Math.round(size * DPR);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    pad = Math.round(size * 0.03);
    cell = (size - pad * (N + 1)) / N;
  }
  function tileXY(fr, fc) { return { x: pad + fc * (cell + pad), y: pad + fr * (cell + pad) }; }
  function center(r, c) { var p = tileXY(r, c); return { x: p.x + cell / 2, y: p.y + cell / 2 }; }

  // ---- grid helpers ----
  function makeTile(v, r, c) { return { value: v, r: r, c: c, sr: r, sc: c, alr: r, alc: c, pop: 0, spawnT: 0, merged: false }; }
  function eachTile(fn) {
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) { if (cells[r][c]) fn(cells[r][c]); }
  }
  function emptyGrid() {
    var g = [];
    for (var r = 0; r < N; r++) { g.push([]); for (var c = 0; c < N; c++) g[r].push(null); }
    return g;
  }
  function spawn() {
    var empties = [];
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) { if (!cells[r][c]) empties.push([r, c]); }
    if (!empties.length) return;
    var pick = empties[(Math.random() * empties.length) | 0];
    var t = makeTile(Math.random() < 0.9 ? 2 : 4, pick[0], pick[1]);
    t.spawnT = SPAWN;
    cells[pick[0]][pick[1]] = t;
  }

  // ---- movement ----
  var VEC = {
    left:  { r: 0, c: -1 }, right: { r: 0, c: 1 },
    up:    { r: -1, c: 0 }, down:  { r: 1, c: 0 }
  };
  function inB(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }
  function traversals(v) {
    var rows = [], cols = [];
    for (var i = 0; i < N; i++) { rows.push(i); cols.push(i); }
    if (v.r > 0) rows.reverse();
    if (v.c > 0) cols.reverse();
    return { rows: rows, cols: cols };
  }
  function farthest(r, c, v) {
    var pr = r, pc = c, nr = r + v.r, nc = c + v.c;
    while (inB(nr, nc) && !cells[nr][nc]) { pr = nr; pc = nc; nr += v.r; nc += v.c; }
    return { far: { r: pr, c: pc }, next: inB(nr, nc) ? { r: nr, c: nc } : null };
  }

  function move(dir) {
    if (anim.active || over) return false;
    var v = VEC[dir];
    var trav = traversals(v);
    eachTile(function (t) { t.merged = false; t.sr = t.r; t.sc = t.c; });
    var moved = false, merges = [];
    absorbing = [];

    for (var i = 0; i < N; i++) {
      for (var j = 0; j < N; j++) {
        var r = trav.rows[i], c = trav.cols[j];
        var tile = cells[r][c];
        if (!tile) continue;
        var fp = farthest(r, c, v);
        var nextTile = fp.next ? cells[fp.next.r][fp.next.c] : null;
        if (nextTile && nextTile.value === tile.value && !nextTile.merged) {
          cells[r][c] = null;
          tile.sr = r; tile.sc = c; tile.r = fp.next.r; tile.c = fp.next.c;
          absorbing.push(tile);
          nextTile.merged = true;
          merges.push({ s: nextTile, value: nextTile.value * 2 });
          score += nextTile.value * 2;
          moved = true;
        } else {
          var f = fp.far;
          if (f.r !== r || f.c !== c) {
            cells[r][c] = null; cells[f.r][f.c] = tile;
            tile.sr = r; tile.sc = c; tile.r = f.r; tile.c = f.c;
            moved = true;
          }
        }
      }
    }

    if (!moved) return false;
    Juice.Audio.play('move');
    Juice.vibrate(8);
    anim.active = true; anim.t = 0;
    pendingMerges = merges; pendingSpawn = true;
    return true;
  }

  function finishSlide() {
    anim.active = false;
    absorbing = [];
    var maxVal = 0;
    for (var i = 0; i < pendingMerges.length; i++) {
      var m = pendingMerges[i], s = m.s;
      s.value = m.value; s.pop = POP; s.merged = false;
      var ctr = center(s.r, s.c);
      var col = colors(s.value);
      particles.burst(ctr.x, ctr.y, { count: 14, colors: col.burst, speed: 170, life: 0.5, size: 5 });
      popups.add(ctr.x, ctr.y - cell * 0.12, '+' + s.value,
        { color: '#fff', size: Math.min(28, 14 + Math.log2(s.value) * 2) });
      shake.add(Math.min(9, 2 + Math.log2(s.value)), 0.22);
      Juice.Audio.play('merge', Math.log2(s.value));
      Juice.vibrate(12);
      if (s.value > maxVal) maxVal = s.value;
    }
    pendingMerges = [];
    if (pendingSpawn) { spawn(); pendingSpawn = false; }
    renderScore();

    if (!won && maxVal >= 2048) { won = true; showWin(); }
    else if (isGameOver()) { over = true; gameOver(); }
  }

  function isGameOver() {
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) { if (!cells[r][c]) return false; }
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
      var v = cells[r][c].value;
      if (c + 1 < N && cells[r][c + 1].value === v) return false;
      if (r + 1 < N && cells[r + 1][c].value === v) return false;
    }
    return true;
  }

  // ---- update / render ----
  function update(dt) {
    if (anim.active) {
      anim.t += dt / SLIDE;
      var e = ease.outQuad(Math.min(anim.t, 1));
      eachTile(function (t) { t.alr = lerp(t.sr, t.r, e); t.alc = lerp(t.sc, t.c, e); });
      for (var i = 0; i < absorbing.length; i++) {
        var a = absorbing[i]; a.alr = lerp(a.sr, a.r, e); a.alc = lerp(a.sc, a.c, e);
      }
      if (anim.t >= 1) finishSlide();
    }
    eachTile(function (t) {
      if (t.pop > 0) t.pop = Math.max(0, t.pop - dt);
      if (t.spawnT > 0) t.spawnT = Math.max(0, t.spawnT - dt);
    });
    particles.update(dt); popups.update(dt);
    shakeOff = shake.update(dt);
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTile(t) {
    var p = tileXY(t.alr, t.alc);
    var sc = 1;
    if (t.spawnT > 0) sc = ease.outBack(1 - t.spawnT / SPAWN);
    else if (t.pop > 0) sc = 1 + 0.18 * Math.sin((t.pop / POP) * Math.PI);
    sc = clamp(sc, 0.01, 1.3);
    var w = cell * sc, cx = p.x + cell / 2, cy = p.y + cell / 2;
    var col = colors(t.value);
    ctx.save();
    ctx.translate(cx, cy);
    if (t.value >= 128) { ctx.shadowColor = col.b; ctx.shadowBlur = cell * 0.22; }
    roundRect(-w / 2, -w / 2, w, w, w * 0.16);
    var g = ctx.createLinearGradient(-w / 2, -w / 2, w / 2, w / 2);
    g.addColorStop(0, col.a); g.addColorStop(1, col.b);
    ctx.fillStyle = g; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = col.text;
    var digits = ('' + t.value).length;
    var fs = cell * (digits <= 2 ? 0.42 : digits === 3 ? 0.34 : 0.27);
    ctx.font = '800 ' + fs + 'px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t.value, 0, fs * 0.04);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(shakeOff.x, shakeOff.y);
    roundRect(0, 0, size, size, 16); ctx.fillStyle = BOARD_BG; ctx.fill();
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var sp = tileXY(r, c);
      roundRect(sp.x, sp.y, cell, cell, cell * 0.16);
      ctx.fillStyle = SLOT_BG; ctx.fill();
    }
    for (var i = 0; i < absorbing.length; i++) drawTile(absorbing[i]);
    eachTile(drawTile);
    particles.draw(ctx); popups.draw(ctx);
    ctx.restore();
  }

  function renderScore() {
    if (score > bestBest) { bestBest = score; Retention.set(GAME, 'best', score); }
    scoreEl.textContent = score;
    bestEl.textContent = bestBest;
  }

  // ---- overlays ----
  function showWin() {
    overlayMode = 'win';
    Juice.Audio.play('win');
    var ctr = center(1.5, 1.5);
    particles.burst(ctr.x, ctr.y, { count: 60, colors: ['#5b8cff', '#7af0d0', '#f25c9a', '#ffd75c', '#b15cf2'], speed: 280, life: 1.1, size: 6, gravity: 240 });
    shake.add(10, 0.4);
    ovTitle.textContent = '2048! 🎉';
    ovSub.textContent = 'Nice. Keep going for a higher score.';
    ovScore.textContent = score;
    ovBest.textContent = Math.max(bestBest, score);
    ovAgain.textContent = 'Keep going';
    overlay.classList.remove('hidden');
  }
  function gameOver() {
    overlayMode = 'over';
    Juice.Audio.play('lose'); Juice.vibrate([20, 40, 20]); shake.add(10, 0.4);
    var isBest = score > bestAtStart;
    Retention.submitScore(GAME, score);
    ovTitle.textContent = isBest ? 'New Best! 🏆' : 'Game Over';
    ovSub.textContent = isBest ? 'You beat your record.' : 'No moves left.';
    ovScore.textContent = score;
    ovBest.textContent = bestBest;
    ovAgain.textContent = 'Play again';
    overlay.classList.remove('hidden');
  }
  function hideOverlay() { overlay.classList.add('hidden'); }

  // ---- lifecycle ----
  function reset() {
    cells = emptyGrid();
    score = 0; over = false; won = false;
    bestAtStart = bestBest;
    absorbing = []; pendingMerges = []; pendingSpawn = false; anim.active = false;
    particles.list = []; popups.list = [];
    spawn(); spawn();
    hideOverlay();
    renderScore();
  }

  // ---- input ----
  var KEYS = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down',
    A: 'left', D: 'right', W: 'up', S: 'down'
  };
  window.addEventListener('keydown', function (e) {
    var dir = KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    if (!overlay.classList.contains('hidden') && overlayMode === 'over') return;
    move(dir);
  }, { passive: false });

  // swipe (touch + mouse pointer)
  var sx = 0, sy = 0, swiping = false;
  function startSwipe(x, y) { sx = x; sy = y; swiping = true; }
  function endSwipe(x, y) {
    if (!swiping) return;
    swiping = false;
    var dx = x - sx, dy = y - sy;
    var ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < 24) return;
    move(ax > ay ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  }
  canvas.addEventListener('touchstart', function (e) { var t = e.changedTouches[0]; startSwipe(t.clientX, t.clientY); }, { passive: true });
  canvas.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchend', function (e) { var t = e.changedTouches[0]; endSwipe(t.clientX, t.clientY); }, { passive: true });
  canvas.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'touch') startSwipe(e.clientX, e.clientY); });
  window.addEventListener('pointerup', function (e) { if (e.pointerType !== 'touch') endSwipe(e.clientX, e.clientY); });

  // buttons
  document.getElementById('new').addEventListener('click', reset);
  document.getElementById('mute').addEventListener('click', function () {
    var m = Juice.Audio.toggleMute();
    this.textContent = m ? '🔇' : '🔊';
  });
  ovAgain.addEventListener('click', function () {
    if (overlayMode === 'win') { hideOverlay(); }  // keep going on the same board
    else { reset(); }
  });

  // ---- boot ----
  function boot() {
    layout();
    bestBest = Retention.best(GAME);
    var st = Retention.touchStreak(GAME);
    streakEl.innerHTML = '🔥 ' + st + '&nbsp;day streak';
    reset();
    if (window.ResizeObserver) { new ResizeObserver(layout).observe(wrap); }
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

  // expose a tiny hook so the headless playtest harness can drive the game
  window.__fuse = {
    move: move,
    tick: function (n, dt) { dt = dt || 1 / 60; for (var i = 0; i < (n || 1); i++) update(dt); },
    state: function () {
      var grid = [];
      for (var r = 0; r < N; r++) { grid.push([]); for (var c = 0; c < N; c++) grid[r].push(cells[r][c] ? cells[r][c].value : 0); }
      return { grid: grid, score: score, over: over, won: won, animating: anim.active };
    },
    reset: reset
  };

  boot();
})();
