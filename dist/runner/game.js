/* Dash Lanes — one-tap endless lane-dodge runner. Vanilla JS, mobile-first.
 * Player sits near the bottom in one of 3 lanes; obstacles scroll down from
 * the top. Tap left/right (or arrow keys) to switch lanes instantly. Speed
 * ramps up over time. Surviving an obstacle that passes in an adjacent lane
 * grants a "near miss" bonus. Hitting an obstacle in your lane ends the run.
 * Uses ../../shared/juice.js and ../../shared/retention.js.
 */
(function () {
  'use strict';

  var GAME = 'runner';
  var clamp = Juice.clamp, lerp = Juice.lerp;

  var LANES = 3;

  // ---- DOM ----
  var canvas  = document.getElementById('game');
  var ctx     = canvas.getContext('2d');
  var wrap    = document.querySelector('.board-wrap');
  var scoreEl = document.getElementById('score');
  var bestEl  = document.getElementById('best');
  var speedEl = document.getElementById('speedmult');
  var streakEl= document.getElementById('streak');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovSub   = document.getElementById('ov-sub');
  var ovScore = document.getElementById('ov-score');
  var ovBest  = document.getElementById('ov-best');
  var ovAgain = document.getElementById('ov-again');

  // ---- layout ----
  var CW = 0, CH = 0, DPR = 1;
  var LANE_W = 0, LEFT = 0;
  var PLAYER_Y_FRAC = 0.78;

  function layout() {
    var bw = wrap.clientWidth  || 320;
    var bh = wrap.clientHeight || bw * 1.5;
    CW = Math.min(bw, 420);
    CH = Math.min(bh, Math.round(CW * 1.6));
    CW = Math.max(240, CW); CH = Math.max(360, CH);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.round(CW * DPR);
    canvas.height = Math.round(CH * DPR);
    canvas.style.width  = CW + 'px';
    canvas.style.height = CH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    LANE_W = CW / LANES;
    LEFT = 0;
  }

  function laneX(lane) { return LEFT + lane * LANE_W + LANE_W / 2; }

  // ---- state ----
  var lane, laneVisualX, score, over, best;
  var obstacles;     // {lane, y, w, h, passed, nearMissChecked}
  var spawnTimer, spawnGap;
  var baseSpeed, speed, speedMult, t;
  var PLAYER_R = 0;
  var particles = new Juice.Particles();
  var popups    = new Juice.Popups();
  var shake     = new Juice.Shake();
  var shakeOff  = { x: 0, y: 0 };

  var BASE_SPEED = 0;     // px/sec, set on layout/reset
  var MAX_MULT   = 2.6;
  var RAMP_TIME  = 60;    // seconds to reach MAX_MULT

  function reset() {
    lane = 1; laneVisualX = laneX(lane);
    score = 0; over = false; t = 0;
    obstacles = [];
    BASE_SPEED = CH * 0.42;
    speed = BASE_SPEED; speedMult = 1;
    spawnGap = 1.05;
    spawnTimer = 0.6;
    PLAYER_R = Math.min(LANE_W * 0.28, CH * 0.045);
    overlay.classList.add('hidden');
    renderHUD();
  }

  function setLane(n) {
    if (over) return;
    lane = clamp(n, 0, LANES - 1);
  }

  function switchDir(dir) { setLane(lane + dir); }

  // ---- spawn ----
  function spawnWave() {
    // block 1 or 2 lanes, leave at least one open
    var blockCount = Math.random() < 0.62 ? 1 : 2;
    var lanesArr = [0, 1, 2];
    // shuffle
    for (var i = lanesArr.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var tmp = lanesArr[i]; lanesArr[i] = lanesArr[j]; lanesArr[j] = tmp;
    }
    var blocked = lanesArr.slice(0, blockCount);
    var h = Math.min(LANE_W * 0.7, CH * 0.07);
    for (var k = 0; k < blocked.length; k++) {
      obstacles.push({ lane: blocked[k], y: -h, w: LANE_W * 0.74, h: h, passed: false, nearMiss: false });
    }
  }

  // ---- update ----
  var PLAYER_LERP = 16;

  function update(dt) {
    if (!over) {
      t += dt;
      speedMult = Math.min(MAX_MULT, 1 + (t / RAMP_TIME) * (MAX_MULT - 1));
      speed = BASE_SPEED * speedMult;

      score += dt * 10 * speedMult;

      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnWave();
        spawnGap = Math.max(0.52, 1.05 - speedMult * 0.18);
        spawnTimer = spawnGap;
      }

      var playerY = CH * PLAYER_Y_FRAC;
      for (var i = obstacles.length - 1; i >= 0; i--) {
        var o = obstacles[i];
        o.y += speed * dt;

        // collision check: obstacle row overlaps player row & same lane
        if (!o.passed && o.y + o.h >= playerY - PLAYER_R && o.y <= playerY + PLAYER_R) {
          if (o.lane === lane) {
            crash();
            break;
          }
        }
        // passed player row
        if (!o.passed && o.y > playerY + PLAYER_R) {
          o.passed = true;
          if (Math.abs(o.lane - lane) === 1) {
            score += 15;
            particles.burst(laneX(o.lane), playerY, { count: 10, colors: ['#4fd6ff', '#6bf7a8', '#fff'], speed: 110, life: 0.45, size: 4 });
            popups.add(laneX(o.lane), playerY - 20, 'Near miss +15', { color: '#6bf7a8', size: 14, life: 0.7 });
            Juice.Audio.play('score'); Juice.vibrate(6);
          }
        }
        if (o.y > CH + 40) obstacles.splice(i, 1);
      }
    }

    laneVisualX = lerp(laneVisualX, laneX(lane), Math.min(1, dt * PLAYER_LERP));
    particles.update(dt); popups.update(dt); shakeOff = shake.update(dt);
  }

  function crash() {
    if (over) return;
    over = true;
    Juice.Audio.play('lose'); Juice.vibrate([20, 40, 20]); shake.add(10, 0.4);
    Retention.submitScore(GAME, Math.floor(score));
    var isBest = Math.floor(score) >= best && score > 0;
    ovTitle.textContent = isBest ? 'New Best! 🏆' : 'Crashed!';
    ovSub.textContent   = isBest ? 'You beat your record.' : 'You hit an obstacle.';
    ovScore.textContent = Math.floor(score);
    ovBest.textContent  = best;
    overlay.classList.remove('hidden');
  }

  // ---- render ----
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

    // lane dividers
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 2; ctx.setLineDash([10, 12]);
    for (var l = 1; l < LANES; l++) {
      ctx.beginPath(); ctx.moveTo(LEFT + l * LANE_W, 0); ctx.lineTo(LEFT + l * LANE_W, CH); ctx.stroke();
    }
    ctx.setLineDash([]);

    // player row marker
    var playerY = CH * PLAYER_Y_FRAC;
    ctx.strokeStyle = 'rgba(79,214,255,0.18)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, playerY); ctx.lineTo(CW, playerY); ctx.stroke();

    // obstacles
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      var cx = laneX(o.lane);
      var g = ctx.createLinearGradient(cx, o.y, cx, o.y + o.h);
      g.addColorStop(0, '#ff6b8a'); g.addColorStop(1, '#d6305f');
      ctx.fillStyle = g;
      roundRect(cx - o.w / 2, o.y, o.w, o.h, 8); ctx.fill();
    }

    // player
    ctx.save();
    ctx.translate(laneVisualX, playerY);
    if (!over) { ctx.shadowColor = '#4fd6ff'; ctx.shadowBlur = PLAYER_R * 0.9; }
    var pg = ctx.createRadialGradient(-PLAYER_R*0.3, -PLAYER_R*0.3, 1, 0, 0, PLAYER_R);
    pg.addColorStop(0, '#bdf3ff'); pg.addColorStop(1, '#4fd6ff');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    particles.draw(ctx); popups.draw(ctx);
    ctx.restore();
  }

  // ---- HUD ----
  function renderHUD() {
    if (Math.floor(score) > best) { best = Math.floor(score); Retention.set(GAME, 'best', best); }
    scoreEl.textContent = Math.floor(score);
    bestEl.textContent  = best;
    speedEl.textContent = speedMult.toFixed(1);
  }

  // ---- input ----
  function onPointer(clientX) {
    if (over) return;
    Juice.Audio.unlock();
    var b = canvas.getBoundingClientRect();
    var frac = (clientX - b.left) / b.width;
    switchDir(frac < 0.5 ? -1 : 1);
    Juice.Audio.play('tap'); Juice.vibrate(6);
  }
  canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); onPointer(e.clientX); });
  canvas.addEventListener('touchstart',  function (e) { e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); Juice.Audio.unlock(); switchDir(-1); Juice.Audio.play('tap'); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); Juice.Audio.unlock(); switchDir(1); Juice.Audio.play('tap'); }
  }, { passive: false });

  document.getElementById('new').addEventListener('click', reset);
  document.getElementById('mute').addEventListener('click', function () {
    this.textContent = Juice.Audio.toggleMute() ? '🔇' : '🔊';
  });
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
    function frame(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      update(dt); draw(); renderHUD();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---- headless test hook ----
  window.__runner = {
    move: function (laneOrDir) { setLane(typeof laneOrDir === 'number' && Math.abs(laneOrDir) <= 1 ? lane + laneOrDir : laneOrDir); },
    setLane: setLane,
    tick: function (n, dt) { dt = dt || 1/60; for (var i = 0; i < (n || 1); i++) { update(dt); renderHUD(); } },
    state: function () {
      return { lane: lane, score: Math.floor(score), over: over, speedMult: Math.round(speedMult * 100) / 100, obstacles: obstacles.length };
    },
    obstacles: function () { return obstacles.map(function (o) { return { lane: o.lane, y: Math.round(o.y) }; }); },
    playerY: function () { return CH * PLAYER_Y_FRAC; },
    reset: reset
  };

  boot();
})();
