/* Outpost — tower defense. Vanilla JS, mobile-first.
 * Enemies march along a fixed serpentine path; tap empty cells beside the
 * path to build turrets, tap a turret to upgrade it. Turrets auto-fire
 * (hitscan) at the nearest enemy in range. Waves escalate forever — last
 * as many waves as you can before your lives run out.
 * Uses ../../shared/juice.js and ../../shared/retention.js.
 */
(function () {
  'use strict';

  var GAME = 'td';
  var clamp = Juice.clamp, lerp = Juice.lerp;

  var ROWS = 9, COLS = 7;
  var START_COINS = 50, START_LIVES = 10;
  var BUILD_COST = 20;
  var BASE_DAMAGE = 8, BASE_FIRE_RATE = 1.6;
  var MAX_LEVEL = 6;

  // ---- DOM ----
  var canvas  = document.getElementById('game');
  var ctx     = canvas.getContext('2d');
  var wrap    = document.querySelector('.board-wrap');
  var waveEl  = document.getElementById('wave');
  var coinsEl = document.getElementById('coins');
  var livesEl = document.getElementById('lives');
  var streakEl= document.getElementById('streak');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovSub   = document.getElementById('ov-sub');
  var ovWave  = document.getElementById('ov-wave');
  var ovScore = document.getElementById('ov-score');
  var ovBest  = document.getElementById('ov-best');
  var ovAgain = document.getElementById('ov-again');

  // ---- layout ----
  var CW = 0, CH = 0, DPR = 1, CELL = 0, OX = 0, OY = 0;
  function layout() {
    var bw = wrap.clientWidth || 320, bh = wrap.clientHeight || 460;
    CW = Math.max(240, Math.min(bw, 460));
    CH = Math.max(340, Math.min(bh, Math.round(CW * (ROWS / COLS))));
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR);
    canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CELL = Math.min(CW / COLS, CH / ROWS);
    OX = (CW - CELL * COLS) / 2; OY = (CH - CELL * ROWS) / 2;
  }

  // ---- path ----
  var path, pathSet;
  function buildPath() {
    var p = [];
    var rows = [0, 2, 4, 6, 8];
    var connectors = [[1, 6], [3, 0], [5, 6], [7, 0]];
    var dir = 1;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (dir === 1) for (var c = 0; c < COLS; c++) p.push([r, c]);
      else for (var c2 = COLS - 1; c2 >= 0; c2--) p.push([r, c2]);
      if (i < connectors.length) p.push(connectors[i]);
      dir *= -1;
    }
    return p;
  }
  function cellPx(r, c) { return { x: OX + c * CELL + CELL / 2, y: OY + r * CELL + CELL / 2 }; }
  function posOnPath(s) {
    var i = Math.floor(s), frac = s - i;
    if (i >= path.length - 1) return cellPx(path[path.length - 1][0], path[path.length - 1][1]);
    var a = cellPx(path[i][0], path[i][1]), b = cellPx(path[i + 1][0], path[i + 1][1]);
    return { x: lerp(a.x, b.x, frac), y: lerp(a.y, b.y, frac) };
  }

  // ---- state ----
  var coins, lives, wave, kills, score, best, over;
  var enemies, towers, beams;
  var spawnQueue, spawnTimer, intermission, intermissionTimer;
  var particles = new Juice.Particles();
  var popups    = new Juice.Popups();
  var shake     = new Juice.Shake();
  var shakeOff  = { x: 0, y: 0 };

  function reset() {
    path = buildPath();
    pathSet = {};
    for (var i = 0; i < path.length; i++) pathSet[path[i][0] + ',' + path[i][1]] = true;
    coins = START_COINS; lives = START_LIVES; wave = 1; kills = 0; score = 0; over = false;
    enemies = []; towers = []; beams = [];
    spawnQueue = enemiesForWave(wave); spawnTimer = 0.4;
    intermission = false; intermissionTimer = 0;
    overlay.classList.add('hidden');
    renderHUD();
  }

  function enemiesForWave(w) { return 5 + w * 2; }
  function enemyHpForWave(w) { return Math.round(18 * (1 + (w - 1) * 0.32)); }
  function enemySpeedForWave(w) { return Math.min(2.6, 1.15 + (w - 1) * 0.035); }

  function isPath(r, c) { return !!pathSet[r + ',' + c]; }
  function towerAt(r, c) { for (var i = 0; i < towers.length; i++) if (towers[i].r === r && towers[i].c === c) return towers[i]; return null; }

  function upgradeCost(level) { return Math.round(18 * level); }
  function statsForLevel(level) {
    return {
      damage: BASE_DAMAGE * Math.pow(1.45, level - 1),
      range: CELL * (1.7 + (level - 1) * 0.18),
      fireRate: BASE_FIRE_RATE * Math.pow(1.08, level - 1)
    };
  }

  // ---- build / upgrade ----
  function build(r, c) {
    if (over || isPath(r, c) || towerAt(r, c)) return false;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
    if (coins < BUILD_COST) return false;
    coins -= BUILD_COST;
    var st = statsForLevel(1);
    towers.push({ r: r, c: c, level: 1, damage: st.damage, range: st.range, fireRate: st.fireRate, cooldown: 0 });
    Juice.Audio.play('pop'); Juice.vibrate(8);
    renderHUD();
    return true;
  }
  function upgrade(r, c) {
    var t = towerAt(r, c);
    if (over || !t || t.level >= MAX_LEVEL) return false;
    var cost = upgradeCost(t.level);
    if (coins < cost) return false;
    coins -= cost; t.level++;
    var st = statsForLevel(t.level);
    t.damage = st.damage; t.range = st.range; t.fireRate = st.fireRate;
    Juice.Audio.play('score'); Juice.vibrate(10);
    renderHUD();
    return true;
  }

  // ---- combat ----
  function spawnEnemy() {
    enemies.push({ s: 0, hp: enemyHpForWave(wave), maxHp: enemyHpForWave(wave), speed: enemySpeedForWave(wave), alive: true });
  }

  function killEnemy(e, idx) {
    e.alive = false;
    kills++;
    var reward = 4 + wave;
    coins += reward;
    score += 10;
    var pos = posOnPath(e.s);
    particles.burst(pos.x, pos.y, { count: 10, colors: ['#ff6b6b', '#ffd166', '#fff'], speed: 130, life: 0.4, size: 4 });
    popups.add(pos.x, pos.y - 10, '+' + reward, { color: '#ffd166', size: 13, life: 0.6 });
  }

  function checkWaveProgress() {
    if (intermission) return;
    if (spawnQueue <= 0 && enemies.length === 0) {
      intermission = true; intermissionTimer = 2.2;
      var bonus = 15 + wave * 3;
      coins += bonus; score += wave * 60;
      popups.add(CW / 2, OY + 8, 'Wave ' + wave + ' clear! +' + bonus, { color: '#5ef79b', size: 14, life: 1.0 });
    }
  }

  function startNextWave() {
    wave++;
    spawnQueue = enemiesForWave(wave); spawnTimer = 0.3;
    intermission = false;
  }

  // ---- update ----
  function update(dt) {
    if (!over) {
      if (intermission) {
        intermissionTimer -= dt;
        if (intermissionTimer <= 0) startNextWave();
      } else if (spawnQueue > 0) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) { spawnEnemy(); spawnQueue--; spawnTimer = 0.55; }
      }

      for (var i = enemies.length - 1; i >= 0; i--) {
        var e = enemies[i];
        e.s += e.speed * dt;
        if (e.s >= path.length - 1) {
          enemies.splice(i, 1); lives--;
          shake.add(3, 0.15); Juice.Audio.play('lose'); Juice.vibrate(12);
          if (lives <= 0) { crash(); return; }
        }
      }

      for (var ti = 0; ti < towers.length; ti++) {
        var t = towers[ti];
        t.cooldown -= dt;
        if (t.cooldown > 0) continue;
        var tp = cellPx(t.r, t.c);
        var target = null, bestD = Infinity;
        for (var ei = 0; ei < enemies.length; ei++) {
          var en = enemies[ei];
          var ep = posOnPath(en.s);
          var d = Math.hypot(tp.x - ep.x, tp.y - ep.y);
          if (d <= t.range && d < bestD) { bestD = d; target = en; }
        }
        if (target) {
          target.hp -= t.damage;
          t.cooldown = 1 / t.fireRate;
          var tep = posOnPath(target.s);
          beams.push({ x1: tp.x, y1: tp.y, x2: tep.x, y2: tep.y, t: 0.12 });
          if (target.hp <= 0) {
            var idx = enemies.indexOf(target);
            if (idx !== -1) { killEnemy(target, idx); enemies.splice(idx, 1); }
          }
        }
      }

      checkWaveProgress();
    }

    for (var bi = beams.length - 1; bi >= 0; bi--) { beams[bi].t -= dt; if (beams[bi].t <= 0) beams.splice(bi, 1); }
    particles.update(dt); popups.update(dt); shakeOff = shake.update(dt);
    renderHUD();
  }

  function crash() {
    if (over) return;
    over = true;
    Juice.Audio.play('lose'); Juice.vibrate([20, 40, 20]); shake.add(10, 0.4);
    Retention.submitScore(GAME, score);
    var isBest = score >= best && score > 0;
    ovTitle.textContent = isBest ? 'New Best! 🏆' : 'Overrun!';
    ovSub.textContent = isBest ? 'You beat your record.' : 'Your outpost has fallen.';
    ovWave.textContent = wave; ovScore.textContent = score; ovBest.textContent = best;
    overlay.classList.remove('hidden');
  }

  // ---- render ----
  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    ctx.save(); ctx.translate(shakeOff.x, shakeOff.y);

    // grid background
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var x = OX + c * CELL, y = OY + r * CELL;
        ctx.fillStyle = isPath(r, c) ? '#1c2c22' : 'rgba(255,255,255,0.025)';
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      }
    }
    // path highlight border
    ctx.strokeStyle = 'rgba(94,247,155,0.18)'; ctx.lineWidth = 1;
    for (var r2 = 0; r2 < ROWS; r2++) for (var c2 = 0; c2 < COLS; c2++) if (isPath(r2, c2)) {
      ctx.strokeRect(OX + c2 * CELL + 1, OY + r2 * CELL + 1, CELL - 2, CELL - 2);
    }

    // towers
    for (var ti = 0; ti < towers.length; ti++) {
      var t = towers[ti];
      var tp = cellPx(t.r, t.c);
      ctx.globalAlpha = 0.12; ctx.fillStyle = '#5ef79b';
      ctx.beginPath(); ctx.arc(tp.x, tp.y, t.range, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      var g = ctx.createRadialGradient(tp.x - CELL*0.1, tp.y - CELL*0.1, 2, tp.x, tp.y, CELL * 0.38);
      g.addColorStop(0, '#bdffd8'); g.addColorStop(1, '#2c9e63');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(tp.x, tp.y, CELL * 0.36, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#04140a'; ctx.font = '700 ' + Math.round(CELL * 0.32) + 'px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t.level, tp.x, tp.y + 1);
    }

    // beams
    for (var bi = 0; bi < beams.length; bi++) {
      var b = beams[bi];
      ctx.globalAlpha = clamp(b.t / 0.12, 0, 1);
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // enemies
    for (var ei = 0; ei < enemies.length; ei++) {
      var en = enemies[ei];
      var ep = posOnPath(en.s);
      var r2_ = CELL * 0.3;
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath(); ctx.arc(ep.x, ep.y, r2_, 0, Math.PI * 2); ctx.fill();
      // hp bar
      var hpFrac = clamp(en.hp / en.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(ep.x - r2_, ep.y - r2_ - 7, r2_ * 2, 4);
      ctx.fillStyle = hpFrac > 0.5 ? '#5ef79b' : hpFrac > 0.25 ? '#ffd166' : '#ff6b6b';
      ctx.fillRect(ep.x - r2_, ep.y - r2_ - 7, r2_ * 2 * hpFrac, 4);
    }

    particles.draw(ctx); popups.draw(ctx);
    ctx.restore();
  }

  // ---- HUD ----
  function renderHUD() {
    if (score > best) { best = score; Retention.set(GAME, 'best', score); }
    waveEl.textContent = wave; coinsEl.textContent = coins; livesEl.textContent = lives;
  }

  // ---- input ----
  function cellAt(clientX, clientY) {
    var b = canvas.getBoundingClientRect();
    var x = (clientX - b.left) * (CW / b.width) - OX;
    var y = (clientY - b.top) * (CH / b.height) - OY;
    var c = Math.floor(x / CELL), r = Math.floor(y / CELL);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return { r: r, c: c };
  }
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault(); Juice.Audio.unlock();
    var cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    if (towerAt(cell.r, cell.c)) upgrade(cell.r, cell.c);
    else build(cell.r, cell.c);
  });
  canvas.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });

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
  window.__td = {
    build: build,
    upgrade: upgrade,
    tick: function (n, dt) { dt = dt || 1 / 60; for (var i = 0; i < (n || 1); i++) update(dt); },
    state: function () {
      return {
        wave: wave, coins: coins, lives: lives, kills: kills, score: score, over: over,
        enemiesAlive: enemies.length, towerCount: towers.length, spawnQueue: spawnQueue, intermission: intermission
      };
    },
    buildableCells: function () {
      var out = [];
      for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (!isPath(r, c)) out.push([r, c]);
      return out;
    },
    towers: function () { return towers.map(function (t) { return { r: t.r, c: t.c, level: t.level, damage: Math.round(t.damage * 10) / 10, range: Math.round(t.range) }; }); },
    reset: reset
  };

  boot();
})();
