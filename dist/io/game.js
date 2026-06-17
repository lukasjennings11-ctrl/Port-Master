/* Splat — single-player .io-style growth arena. Vanilla JS, mobile-first.
 * Drag to move; eat pellets and smaller blobs to grow, avoid bigger ones.
 * Bots wander, flee bigger threats, and chase smaller prey (player only —
 * bots don't hunt each other, keeping the simulation cheap). Bigger blobs
 * move slower, a classic agar.io-style tradeoff.
 * Uses ../../shared/juice.js and ../../shared/retention.js.
 */
(function () {
  'use strict';

  var GAME = 'io';
  var clamp = Juice.clamp, lerp = Juice.lerp;

  var WORLD = 2400;
  var NUM_BOTS = 12;
  var PELLET_MAX = 140;
  var PELLET_MASS = 4;
  var EAT_RATIO = 1.15;       // must be this much bigger (by radius) to eat
  var EAT_EFFICIENCY = 0.8;   // fraction of eaten blob's area gained
  var BASE_R = 22;
  var BASE_SPEED = WORLD * 0.16;

  // ---- DOM ----
  var canvas  = document.getElementById('game');
  var ctx     = canvas.getContext('2d');
  var wrap    = document.querySelector('.board-wrap');
  var scoreEl = document.getElementById('score');
  var bestEl  = document.getElementById('best');
  var rankEl  = document.getElementById('rank');
  var rankTotalEl = document.getElementById('rankTotal');
  var streakEl= document.getElementById('streak');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovSub   = document.getElementById('ov-sub');
  var ovScore = document.getElementById('ov-score');
  var ovBest  = document.getElementById('ov-best');
  var ovAgain = document.getElementById('ov-again');

  // ---- layout ----
  var CW = 0, CH = 0, DPR = 1;
  function layout() {
    var bw = wrap.clientWidth || 320, bh = wrap.clientHeight || 480;
    CW = Math.max(240, bw); CH = Math.max(340, bh);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR);
    canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  // ---- helpers ----
  function rand(a, b) { return a + Math.random() * (b - a); }
  function areaOf(r) { return r * r; }
  function rOf(area) { return Math.sqrt(Math.max(0.01, area)); }
  var BOT_COLORS = ['#ff6b8a', '#ffb347', '#6bf7a8', '#6ab4ff', '#c46af7', '#ffe066', '#ff9ed8', '#5ecfff'];

  // ---- state ----
  var player, bots, pellets, over, best, t;
  var particles = new Juice.Particles();
  var popups    = new Juice.Popups();
  var shake     = new Juice.Shake();
  var shakeOff  = { x: 0, y: 0 };
  var input     = { x: 0, y: 0 }; // desired direction, magnitude 0..1

  function spawnPellet() {
    return { x: rand(0, WORLD), y: rand(0, WORLD), r: 4 };
  }
  function spawnBot(minR, maxR) {
    return {
      x: rand(0, WORLD), y: rand(0, WORLD), r: rand(minR, maxR),
      vx: 0, vy: 0, color: BOT_COLORS[(Math.random() * BOT_COLORS.length) | 0],
      wanderT: 0, wanderDir: rand(0, Math.PI * 2), alive: true
    };
  }

  function reset() {
    player = { x: WORLD / 2, y: WORLD / 2, r: BASE_R, color: '#3ee6b8' };
    bots = [];
    for (var i = 0; i < NUM_BOTS; i++) bots.push(spawnBot(BASE_R * 0.5, BASE_R * 1.8));
    pellets = [];
    for (var p = 0; p < PELLET_MAX; p++) pellets.push(spawnPellet());
    over = false; t = 0;
    overlay.classList.add('hidden');
    renderHUD();
  }

  function speedFor(r) { return BASE_SPEED * Math.pow(BASE_R / r, 0.5); }

  // ---- bot AI ----
  var FLEE_RADIUS = 260, CHASE_RADIUS = 220;
  function updateBot(b, dt) {
    var dx = player.x - b.x, dy = player.y - b.y;
    var d = Math.hypot(dx, dy);
    var dirx, diry;
    if (d < FLEE_RADIUS && player.r > b.r * EAT_RATIO) {
      // flee directly away from player
      dirx = -dx / (d || 1); diry = -dy / (d || 1);
    } else if (d < CHASE_RADIUS && b.r > player.r * EAT_RATIO) {
      dirx = dx / (d || 1); diry = dy / (d || 1);
    } else {
      b.wanderT -= dt;
      if (b.wanderT <= 0) { b.wanderDir = rand(0, Math.PI * 2); b.wanderT = rand(1.2, 3); }
      dirx = Math.cos(b.wanderDir); diry = Math.sin(b.wanderDir);
    }
    var sp = speedFor(b.r);
    b.x += dirx * sp * dt; b.y += diry * sp * dt;
    b.x = clamp(b.x, b.r, WORLD - b.r); b.y = clamp(b.y, b.r, WORLD - b.r);
  }

  // ---- eating ----
  function tryEatPellets(entity, isPlayer) {
    for (var i = pellets.length - 1; i >= 0; i--) {
      var pel = pellets[i];
      var d = Math.hypot(entity.x - pel.x, entity.y - pel.y);
      if (d < entity.r) {
        entity.r = rOf(areaOf(entity.r) + PELLET_MASS);
        pellets.splice(i, 1, spawnPellet());
        if (isPlayer) {
          particles.burst(0, 0, { count: 0 }); // no-op placeholder kept cheap; visual handled in draw via glow
        }
      }
    }
  }

  function tryEatBots() {
    for (var i = bots.length - 1; i >= 0; i--) {
      var b = bots[i];
      var d = Math.hypot(player.x - b.x, player.y - b.y);
      if (player.r > b.r * EAT_RATIO && d < player.r * 0.85) {
        player.r = rOf(areaOf(player.r) + areaOf(b.r) * EAT_EFFICIENCY);
        Juice.Audio.play('merge', 3); Juice.vibrate(10);
        shake.add(3, 0.15);
        bots.splice(i, 1, spawnBot(BASE_R * 0.4, Math.max(BASE_R * 0.6, player.r * 0.5)));
      } else if (b.r > player.r * EAT_RATIO && d < b.r * 0.85) {
        crash();
        return;
      }
    }
  }

  function crash() {
    if (over) return;
    over = true;
    Juice.Audio.play('lose'); Juice.vibrate([20, 40, 20]); shake.add(10, 0.4);
    var score = Math.round(player.r);
    Retention.submitScore(GAME, score);
    var isBest = score >= best && score > 0;
    ovTitle.textContent = isBest ? 'New Best! 🏆' : 'Eaten!';
    ovSub.textContent = isBest ? 'You beat your record.' : 'A bigger blob got you.';
    ovScore.textContent = score; ovBest.textContent = best;
    overlay.classList.remove('hidden');
  }

  // ---- update ----
  function update(dt) {
    if (!over) {
      t += dt;
      var mag = clamp(Math.hypot(input.x, input.y), 0, 1);
      if (mag > 0.001) {
        var nx = input.x / Math.hypot(input.x, input.y), ny = input.y / Math.hypot(input.x, input.y);
        var sp = speedFor(player.r) * mag;
        player.x += nx * sp * dt; player.y += ny * sp * dt;
      }
      player.x = clamp(player.x, player.r, WORLD - player.r);
      player.y = clamp(player.y, player.r, WORLD - player.r);

      for (var i = 0; i < bots.length; i++) updateBot(bots[i], dt);

      tryEatPellets(player, true);
      for (var j = 0; j < bots.length; j++) tryEatPellets(bots[j], false);
      tryEatBots();
    }
    particles.update(dt); popups.update(dt); shakeOff = shake.update(dt);
    renderHUD();
  }

  // ---- render ----
  function worldToScreen(x, y, zoom) {
    return { sx: (x - player.x) * zoom + CW / 2, sy: (y - player.y) * zoom + CH / 2 };
  }

  function draw() {
    var zoom = clamp(BASE_R / player.r, 0.32, 1.3);
    ctx.fillStyle = '#081420';
    ctx.fillRect(0, 0, CW, CH);
    ctx.save(); ctx.translate(shakeOff.x, shakeOff.y);

    // grid for spatial feedback
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    var gridStep = 120 * zoom;
    var offX = ((CW / 2 - player.x * zoom) % gridStep + gridStep) % gridStep;
    var offY = ((CH / 2 - player.y * zoom) % gridStep + gridStep) % gridStep;
    for (var gx = offX; gx < CW; gx += gridStep) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, CH); ctx.stroke(); }
    for (var gy = offY; gy < CH; gy += gridStep) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(CW, gy); ctx.stroke(); }

    // world border
    var tl = worldToScreen(0, 0, zoom), br = worldToScreen(WORLD, WORLD, zoom);
    ctx.strokeStyle = 'rgba(62,230,184,0.25)'; ctx.lineWidth = 3;
    ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);

    // pellets
    ctx.fillStyle = '#ffd166';
    for (var p = 0; p < pellets.length; p++) {
      var pel = pellets[p];
      var s = worldToScreen(pel.x, pel.y, zoom);
      if (s.sx < -10 || s.sx > CW + 10 || s.sy < -10 || s.sy > CH + 10) continue;
      ctx.beginPath(); ctx.arc(s.sx, s.sy, Math.max(2, pel.r * zoom), 0, Math.PI * 2); ctx.fill();
    }

    // bots
    for (var b = 0; b < bots.length; b++) {
      var bot = bots[b];
      var sb = worldToScreen(bot.x, bot.y, zoom);
      var br2 = bot.r * zoom;
      if (sb.sx < -br2 || sb.sx > CW + br2 || sb.sy < -br2 || sb.sy > CH + br2) continue;
      drawBlob(sb.sx, sb.sy, br2, bot.color);
    }

    // player
    var sp2 = worldToScreen(player.x, player.y, zoom);
    drawBlob(sp2.sx, sp2.sy, player.r * zoom, player.color, true);

    particles.draw(ctx); popups.draw(ctx);
    ctx.restore();
  }

  function drawBlob(x, y, r, color, isPlayer) {
    ctx.save(); ctx.translate(x, y);
    if (isPlayer) { ctx.shadowColor = color; ctx.shadowBlur = r * 0.4; }
    var g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, lighten(color)); g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, Math.max(1, r), 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
  function lighten(hex) {
    var m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return hex;
    var r = Math.min(255, parseInt(m[1], 16) + 60), g = Math.min(255, parseInt(m[2], 16) + 60), b = Math.min(255, parseInt(m[3], 16) + 60);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // ---- HUD ----
  function renderHUD() {
    var score = Math.round(player.r);
    if (score > best) { best = score; Retention.set(GAME, 'best', score); }
    scoreEl.textContent = score; bestEl.textContent = best;
    var all = bots.concat([player]).sort(function (a, c) { return c.r - a.r; });
    rankEl.textContent = all.indexOf(player) + 1;
    rankTotalEl.textContent = all.length;
  }

  // ---- input ----
  var dragging = false, dragStart = { x: 0, y: 0 };
  function setFromDrag(clientX, clientY) {
    var b = canvas.getBoundingClientRect();
    var x = clientX - b.left, y = clientY - b.top;
    var dx = x - dragStart.x, dy = y - dragStart.y;
    var maxDrag = 70;
    input.x = clamp(dx / maxDrag, -1, 1);
    input.y = clamp(dy / maxDrag, -1, 1);
  }
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault(); Juice.Audio.unlock();
    dragging = true;
    var b = canvas.getBoundingClientRect();
    dragStart.x = e.clientX - b.left; dragStart.y = e.clientY - b.top;
  });
  canvas.addEventListener('pointermove', function (e) { if (dragging) setFromDrag(e.clientX, e.clientY); });
  window.addEventListener('pointerup', function () { dragging = false; input.x = 0; input.y = 0; });
  canvas.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });

  var keys = {};
  window.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    if (['arrowleft','arrowright','arrowup','arrowdown','w','a','s','d'].indexOf(k) !== -1) { keys[k] = true; updateKeyInput(); e.preventDefault(); }
  });
  window.addEventListener('keyup', function (e) {
    var k = e.key.toLowerCase();
    if (keys[k]) { keys[k] = false; updateKeyInput(); }
  });
  function updateKeyInput() {
    if (dragging) return;
    var x = (keys['arrowright'] || keys.d ? 1 : 0) - (keys['arrowleft'] || keys.a ? 1 : 0);
    var y = (keys['arrowdown'] || keys.s ? 1 : 0) - (keys['arrowup'] || keys.w ? 1 : 0);
    input.x = x; input.y = y;
  }

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
  window.__io = {
    aim: function (x, y) { input.x = clamp(x, -1, 1); input.y = clamp(y, -1, 1); },
    tick: function (n, dt) { dt = dt || 1 / 60; for (var i = 0; i < (n || 1); i++) update(dt); },
    state: function () {
      var all = bots.concat([player]).sort(function (a, c) { return c.r - a.r; });
      return {
        r: Math.round(player.r * 100) / 100, over: over, score: Math.round(player.r),
        rank: all.indexOf(player) + 1, total: all.length, botCount: bots.length, pelletCount: pellets.length,
        x: Math.round(player.x), y: Math.round(player.y)
      };
    },
    bots: function () { return bots.map(function (b) { return { x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.r * 100) / 100 }; }); },
    player: function () { return { x: Math.round(player.x), y: Math.round(player.y), r: Math.round(player.r * 100) / 100 }; },
    forcePlayer: function (x, y, r) { player.x = x; player.y = y; if (r != null) player.r = r; },
    forceBot: function (i, x, y, r) { bots[i].x = x; bots[i].y = y; if (r != null) bots[i].r = r; },
    reset: reset
  };

  boot();
})();
