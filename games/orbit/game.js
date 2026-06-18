/* Orbit — a physics merge game (Suika-family). Dependency-free, mobile-first.
 * Drop orbs; two of the same tier that touch fuse into the next tier up.
 * Don't let the pile overflow the top line. Vanilla 2D circle physics.
 * Uses ../../shared/juice.js and ../../shared/retention.js.
 */
(function () {
  'use strict';

  var GAME = 'orbit';
  var clamp = Juice.clamp, ease = Juice.ease;

  // tier gradients [inner, outer]; index = tier. Bigger index = bigger + rarer.
  var TIERS = [
    ['#9fbcff', '#6f97f0'], ['#7af0d0', '#3fc6a4'], ['#8be36b', '#5ab23c'],
    ['#ffe06b', '#f0bc3f'], ['#ffb15c', '#f08a3f'], ['#ff7d6b', '#e8493f'],
    ['#ff6bb0', '#e83f8c'], ['#c98bff', '#9a4fe0'], ['#6f8cff', '#4257e0'],
    ['#aef0ff', '#5fc8ff'], ['#fff3b0', '#ffd24d']
  ];
  var RADIUS_FRAC = [0.052, 0.064, 0.079, 0.098, 0.121, 0.149, 0.184, 0.228, 0.281, 0.347, 0.429];
  var VALUE = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66];
  var MAXTIER = TIERS.length - 1;
  // SPAWN bag is now dynamic — see bagTier()
  var POP = 0.2, DROP_CD = 0.42;

  // physics tunables
  var REST = 0.05, WALL_E = 0.2, ITER = 8, H = 1 / 120;

  // ---- DOM ----
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var wrap = document.querySelector('.board-wrap');
  var nextCanvas = document.getElementById('next');
  var nctx = nextCanvas.getContext('2d');
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
  var orbs, score, over, bestBest, bestAtStart;
  var currentTier, nextTier, aimX, cooldown, overflowT;
  var particles = new Juice.Particles();
  var popups = new Juice.Popups();
  var shake = new Juice.Shake();
  var shakeOff = { x: 0, y: 0 };

  // ---- layout / geometry ----
  var cw = 0, ch = 0, DPR = 1, WALL = 0, left = 0, right = 0, innerW = 0;
  var jarTop = 0, jarBottom = 0, dropY = 0, radii = [], G = 0, MAX_V = 0;
  var AR = 0.68; // width / height

  function layout() {
    var bw = wrap.clientWidth, bh = wrap.clientHeight || wrap.clientWidth;
    if (bw / bh > AR) { ch = bh; cw = Math.round(bh * AR); }
    else { cw = bw; ch = Math.round(bw / AR); }
    cw = Math.max(240, cw); ch = Math.max(330, ch);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cw * DPR); canvas.height = Math.round(ch * DPR);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    WALL = Math.round(cw * 0.022);
    left = WALL; right = cw - WALL; innerW = right - left;
    radii = RADIUS_FRAC.map(function (f) { return f * innerW; });
    var maxSpawnR = radii[4];
    jarTop = maxSpawnR * 2.3;
    dropY = maxSpawnR * 1.05;
    jarBottom = ch - WALL;
    G = 8 * innerW;
    MAX_V = 12 * innerW;
    if (orbs) for (var i = 0; i < orbs.length; i++) clampInside(orbs[i]);
    if (typeof aimX === 'number') aimX = clamp(aimX, left, right);
  }

  function rOf(o) { return radii[o.tier]; }
  function massOf(o) { var r = radii[o.tier]; return r * r; }
  function speed(o) { return Math.hypot(o.vx, o.vy); }
  function clampInside(o) {
    var r = rOf(o);
    o.x = clamp(o.x, left + r, right - r);
    if (o.y + r > jarBottom) o.y = jarBottom - r;
  }

  function bagTier() {
    var bag;
    if (score < 50)       bag = [0,0,0,0,0,1,1,1,2,2,3,4];
    else if (score < 150) bag = [0,0,0,1,1,1,2,2,3,3,4,5];
    else if (score < 400) bag = [0,0,1,1,2,2,3,3,4,4,5,5];
    else                  bag = [1,1,2,2,3,3,4,4,5,5,6,6];
    return bag[(Math.random() * bag.length) | 0];
  }

  // ---- physics ----
  function stepPhysics(h) {
    var i, j, n = orbs.length;
    for (i = 0; i < n; i++) {
      var o = orbs[i];
      if (o.merging) continue;
      o.vy += G * h;
      o.x += o.vx * h; o.y += o.vy * h;
      o.vx *= 0.999; o.vy *= 0.999;
      var sp = Math.hypot(o.vx, o.vy);
      if (sp > MAX_V) { var k = MAX_V / sp; o.vx *= k; o.vy *= k; }
    }

    var merges = [];
    for (var it = 0; it < ITER; it++) {
      // walls + floor
      for (i = 0; i < n; i++) {
        var a = orbs[i]; if (a.merging) continue;
        var r = radii[a.tier];
        if (a.x - r < left) { a.x = left + r; if (a.vx < 0) a.vx = -a.vx * WALL_E; }
        if (a.x + r > right) { a.x = right - r; if (a.vx > 0) a.vx = -a.vx * WALL_E; }
        if (a.y + r > jarBottom) { a.y = jarBottom - r; if (a.vy > 0) a.vy = -a.vy * WALL_E; a.vx *= 0.86; }
      }
      // pairs
      for (i = 0; i < n; i++) {
        var A = orbs[i]; if (A.merging) continue;
        for (j = i + 1; j < n; j++) {
          var B = orbs[j]; if (B.merging) continue;
          var dx = B.x - A.x, dy = B.y - A.y;
          var ra = radii[A.tier], rb = radii[B.tier], min = ra + rb;
          var d2 = dx * dx + dy * dy;
          if (d2 >= min * min) continue;
          var d = Math.sqrt(d2);
          var nx, ny;
          if (d < 1e-6) { nx = 0; ny = -1; d = 0.0001; } else { nx = dx / d; ny = dy / d; }
          if (it === 0 && A.tier === B.tier && d < min * 0.985) {
            A.merging = B.merging = true;
            merges.push([A, B]); continue;
          }
          var overlap = min - d;
          var ima = 1 / massOf(A), imb = 1 / massOf(B), s = overlap / (ima + imb);
          A.x -= nx * s * ima; A.y -= ny * s * ima;
          B.x += nx * s * imb; B.y += ny * s * imb;
          var vn = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
          if (vn < 0) {
            var jn = -(1 + REST) * vn / (ima + imb);
            A.vx -= jn * nx * ima; A.vy -= jn * ny * ima;
            B.vx += jn * nx * imb; B.vy += jn * ny * imb;
          }
        }
      }
    }
    for (i = 0; i < orbs.length; i++) { var z = orbs[i]; if (Math.abs(z.vx) < 3) z.vx = 0; if (z.merging) continue; }
    for (i = 0; i < merges.length; i++) doMerge(merges[i][0], merges[i][1]);
  }

  function doMerge(a, b) {
    var ia = orbs.indexOf(a), ib = orbs.indexOf(b);
    if (ia < 0 || ib < 0) return;
    orbs.splice(Math.max(ia, ib), 1);
    orbs.splice(Math.min(ia, ib), 1);
    var ma = massOf(a), mb = massOf(b), mt = ma + mb;
    var x = (a.x * ma + b.x * mb) / mt, y = (a.y * ma + b.y * mb) / mt;
    var nt = a.tier + 1;
    var col = (TIERS[a.tier] || TIERS[0]);
    if (nt > MAXTIER) {
      // two suns -> supernova: clear both for a big bonus
      score += 200;
      particles.burst(x, y, { count: 70, colors: ['#fff3b0', '#ffd24d', '#fff'], speed: 360, life: 1.1, size: 6 });
      popups.add(x, y, '+200', { color: '#fff3b0', size: 30 });
      shake.add(14, 0.45); Juice.Audio.play('win'); Juice.vibrate([15, 30, 15]);
      renderScore();
      return;
    }
    var no = { x: x, y: y, vx: (a.vx * ma + b.vx * mb) / mt, vy: (a.vy * ma + b.vy * mb) / mt - innerW * 0.3,
               tier: nt, merging: false, pop: POP };
    orbs.push(no);
    score += VALUE[nt];
    particles.burst(x, y, { count: 12 + nt * 2, colors: [col[0], col[1], '#fff'], speed: 120 + nt * 20, life: 0.5, size: 4 });
    popups.add(x, y - radii[nt] * 0.4, '+' + VALUE[nt], { color: '#fff', size: Math.min(28, 14 + nt * 2) });
    shake.add(Math.min(8, 2 + nt), 0.2);
    Juice.Audio.play('merge', nt); Juice.vibrate(10);
    renderScore();
  }

  // ---- drop ----
  function dropOrb() {
    if (over || cooldown > 0) return;
    var r = radii[currentTier];
    var x = clamp(aimX, left + r, right - r);
    orbs.push({ x: x, y: dropY, vx: 0, vy: 0, tier: currentTier, merging: false, pop: 0 });
    currentTier = nextTier; nextTier = bagTier();
    cooldown = DROP_CD;
    Juice.Audio.play('pop'); Juice.vibrate(8);
    drawNext();
  }

  // ---- update / render ----
  function update(dt) {
    if (!over) {
      cooldown = Math.max(0, cooldown - dt);
      var steps = clamp(Math.ceil(dt / H), 1, 5);
      for (var s = 0; s < steps; s++) stepPhysics(dt / steps);

      // overflow check: a settled orb resting above the line
      var bad = false;
      for (var i = 0; i < orbs.length; i++) {
        var o = orbs[i];
        if (o.y - radii[o.tier] < jarTop && speed(o) < 45) { bad = true; break; }
      }
      overflowT = bad ? overflowT + dt : Math.max(0, overflowT - dt * 1.5);
      if (overflowT > 2.0) gameOver();
    }
    for (var k = 0; k < orbs.length; k++) if (orbs[k].pop > 0) orbs[k].pop = Math.max(0, orbs[k].pop - dt);
    particles.update(dt); popups.update(dt); shakeOff = shake.update(dt);
  }

  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
  function drawOrb(x, y, r, tier, pop) {
    var sc = pop > 0 ? 1 + 0.16 * Math.sin((pop / POP) * Math.PI) : 1;
    r *= sc;
    var col = TIERS[tier];
    ctx.save(); ctx.translate(x, y);
    if (tier >= 7) { ctx.shadowColor = col[1]; ctx.shadowBlur = r * 0.5; }
    var g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
    ctx.fillStyle = g; circle(0, 0, r); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.22; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(-r * 0.32, -r * 0.36, r * 0.34, r * 0.2, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, cw, ch);
    ctx.save(); ctx.translate(shakeOff.x, shakeOff.y);

    // danger line (reddens as overflow builds)
    var dt = clamp(overflowT / 2, 0, 1);
    ctx.strokeStyle = 'rgba(' + (90 + 150 * dt) + ',' + (110 - 80 * dt) + ',' + (160 - 110 * dt) + ',' + (0.4 + 0.4 * dt) + ')';
    ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.moveTo(left, jarTop); ctx.lineTo(right, jarTop); ctx.stroke();
    ctx.setLineDash([]);

    // jar walls
    ctx.fillStyle = getCSS('--jar-wall') || '#2b3566';
    roundRect(0, jarTop, WALL, jarBottom - jarTop + WALL, WALL * 0.5); ctx.fill();
    roundRect(right, jarTop, WALL, jarBottom - jarTop + WALL, WALL * 0.5); ctx.fill();
    roundRect(0, jarBottom, cw, WALL, WALL * 0.5); ctx.fill();

    // orbs
    for (var i = 0; i < orbs.length; i++) { var o = orbs[i]; drawOrb(o.x, o.y, radii[o.tier], o.tier, o.pop); }

    // current hovering orb + aim guide
    if (!over) {
      var r = radii[currentTier], x = clamp(aimX, left + r, right - r);
      ctx.globalAlpha = cooldown > 0 ? 0.35 : 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(x, dropY + r); ctx.lineTo(x, jarTop); ctx.stroke(); ctx.setLineDash([]);
      drawOrb(x, dropY, r, currentTier, 0);
      ctx.globalAlpha = 1;
    }

    particles.draw(ctx); popups.draw(ctx);
    ctx.restore();
  }

  function drawNext() {
    nextCanvas.width = 34; nextCanvas.height = 34;
    nctx.clearRect(0, 0, 34, 34);
    var col = TIERS[nextTier], r = 13;
    var g = nctx.createRadialGradient(17 - 4, 17 - 4, 2, 17, 17, r);
    g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
    nctx.fillStyle = g; nctx.beginPath(); nctx.arc(17, 17, r, 0, Math.PI * 2); nctx.fill();
  }

  // ---- helpers ----
  var _css = {};
  function getCSS(name) {
    if (_css[name] == null) _css[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return _css[name];
  }
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function renderScore() {
    if (score > bestBest) { bestBest = score; Retention.set(GAME, 'best', score); }
    scoreEl.textContent = score; bestEl.textContent = bestBest;
  }

  // ---- overlays / lifecycle ----
  function gameOver() {
    if (over) return;
    over = true;
    Juice.Audio.play('lose'); Juice.vibrate([20, 40, 20]); shake.add(10, 0.4);
    var isBest = score > bestAtStart;
    Retention.submitScore(GAME, score);
    ovTitle.textContent = isBest ? 'New Best! 🏆' : 'Game Over';
    ovSub.textContent = isBest ? 'You beat your record.' : 'The orbs overflowed.';
    ovScore.textContent = score; ovBest.textContent = bestBest;
    ovAgain.textContent = 'Play again';
    overlay.classList.remove('hidden');
  }
  function reset() {
    orbs = []; score = 0; over = false; overflowT = 0; cooldown = 0;
    bestAtStart = bestBest;
    currentTier = bagTier(); nextTier = bagTier();
    aimX = (left + right) / 2;
    particles.list = []; popups.list = [];
    overlay.classList.add('hidden');
    drawNext(); renderScore();
  }

  // ---- input ----
  function toX(clientX) { var b = canvas.getBoundingClientRect(); return (clientX - b.left) * (cw / b.width); }
  var aiming = false;
  canvas.addEventListener('pointerdown', function (e) { aiming = true; aimX = toX(e.clientX); });
  canvas.addEventListener('pointermove', function (e) { if (aiming || e.pointerType !== 'touch') aimX = toX(e.clientX); });
  window.addEventListener('pointerup', function (e) {
    if (!aiming && e.pointerType === 'touch') return;
    aiming = false;
    if (e.target === canvas || canvas.contains(e.target)) { aimX = toX(e.clientX); dropOrb(); }
  });
  canvas.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', function (e) {
    var r = radii[currentTier] || 20;
    if (e.key === 'ArrowLeft') { aimX = clamp(aimX - innerW * 0.06, left + r, right - r); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { aimX = clamp(aimX + innerW * 0.06, left + r, right - r); e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'ArrowDown' || e.key === 'Enter') { dropOrb(); e.preventDefault(); }
  }, { passive: false });

  document.getElementById('new').addEventListener('click', reset);
  document.getElementById('mute').addEventListener('click', function () { this.textContent = Juice.Audio.toggleMute() ? '🔇' : '🔊'; });
  ovAgain.addEventListener('click', reset);

  // ---- boot ----
  function boot() {
    layout();
    bestBest = Retention.best(GAME);
    streakEl.innerHTML = '🔥 ' + Retention.touchStreak(GAME) + '&nbsp;day streak';
    reset();
    if (window.ResizeObserver) new ResizeObserver(layout).observe(wrap);
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', function () { setTimeout(layout, 200); });
    var last = performance.now();
    function frame(now) { var dt = Math.min(0.05, (now - last) / 1000); last = now; update(dt); draw(); requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
  }

  // headless playtest hook (preview throttles rAF when backgrounded, so tick()
  // lets a test advance the simulation deterministically instead of by wall-clock)
  window.__orbit = {
    drop: function (frac) {
      if (typeof frac === 'number') aimX = left + clamp(frac, 0, 1) * (right - left);
      cooldown = 0; dropOrb();
    },
    tick: function (n, dt) { dt = dt || 1 / 60; for (var i = 0; i < (n || 1); i++) update(dt); },
    state: function () {
      var anyNaN = false, maxSpeed = 0, maxTier = 0, lowest = 0;
      for (var i = 0; i < orbs.length; i++) {
        var o = orbs[i];
        if (!isFinite(o.x) || !isFinite(o.y)) anyNaN = true;
        var sp = speed(o); if (sp > maxSpeed) maxSpeed = sp;
        if (o.tier > maxTier) maxTier = o.tier;
        var b = o.y + radii[o.tier]; if (b > lowest) lowest = b;
      }
      return { count: orbs.length, score: score, over: over, maxTier: maxTier, anyNaN: anyNaN,
               maxSpeed: Math.round(maxSpeed), lowest: Math.round(lowest), floor: Math.round(jarBottom) };
    },
    reset: reset, settled: function () { return cooldown; }
  };

  boot();
})();
