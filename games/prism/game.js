/* PRISM — neon refraction reflex arcade. Dependency-free, mobile-first.
 *
 * A glowing prism sits at center; its faces are colored. Beams of light
 * ("shards") stream inward from every direction. Spin the prism (one input)
 * so the face that meets each shard matches the shard's color: match = absorb
 * (+score, combo), mismatch = crack. Three cracks and the prism shatters.
 * Forever-escalating waves -> pure high-score arcade loop.
 *
 * Shared: juice.js, retention.js, portal.js, progression.js, stage.js.
 */
(function () {
  'use strict';

  var GAME = 'prism';
  var clamp = Juice.clamp, TAU = Math.PI * 2, N0 = Math.PI * 5 / 6; // edge-0 normal = +150deg

  // neon face palette (index = face/shard color)
  var COL = ['#ff3b6b', '#36ff9e', '#4b8bff'];
  var COL_DIM = ['#7a1530', '#127a4a', '#1c3a85'];
  var WHITE = '#eafcff';

  var MISSIONS = [
    { id: 'm_absorb', text: 'Absorb 120 beams',  target: 120, reward: 30 },
    { id: 'm_combo',  text: 'Reach a x15 combo', target: 15,  reward: 40 },
    { id: 'm_wave',   text: 'Survive to Wave 8',  target: 8,   reward: 35 },
    { id: 'm_white',  text: 'Catch 10 white beams', target: 10, reward: 30 },
    { id: 'm_score',  text: 'Score 4000 in a run', target: 4000, reward: 35 }
  ];

  // ---- DOM ----
  var canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  var wrap = document.querySelector('.board-wrap');
  var scoreEl = document.getElementById('score'), bestEl = document.getElementById('best');
  var shieldsEl = document.getElementById('shields'), waveEl = document.getElementById('wave');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title'), ovSub = document.getElementById('ov-sub');
  var ovScore = document.getElementById('ov-score'), ovBest = document.getElementById('ov-best');
  var ovAgain = document.getElementById('ov-again'), ovContinue = document.getElementById('ov-continue');

  var particles = new Juice.Particles(), popups = new Juice.Popups(), shake = new Juice.Shake();
  var shakeOff = { x: 0, y: 0 };

  // ---- layout ----
  var CW = 0, CH = 0, DPR = 1, cx = 0, cy = 0, PR = 60, md = 0, spawnDist = 0, hitR = 0;
  function layout() {
    var bw = wrap.clientWidth || 360, bh = wrap.clientHeight || 480;
    CW = Math.max(240, bw); CH = Math.max(320, bh);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR);
    canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = CW / 2; cy = CH / 2; md = Math.min(CW, CH);
    PR = md * 0.135; hitR = PR * 1.55;
    spawnDist = Math.hypot(CW, CH) * 0.5 + PR;
  }

  // ---- state ----
  var angle, vel, faces, NF, shards, score, best, combo, maxCombo, shields, absorbed, whites;
  var elapsed, wave, spawnT, running, over, usedContinue, flashA, flashCol, slowmo, beat;
  var hardcore;

  function reset(mode) {
    hardcore = (mode === 'hardcore');
    NF = (mode === 'hex') ? 6 : 3;
    faces = []; for (var i = 0; i < NF; i++) faces.push(i % 3); // colors repeat for hex
    angle = -Math.PI / 2; vel = 0;
    shards = []; score = 0; combo = 0; maxCombo = 0; shields = 3; absorbed = 0; whites = 0;
    elapsed = 0; wave = 1; spawnT = 0.8; running = false; over = false; usedContinue = false;
    flashA = 0; flashCol = WHITE; slowmo = 0; beat = 0;
    particles.list = []; popups.list = [];
    overlay.classList.add('hidden');
    renderHUD();
  }

  function startRun() {
    running = true; over = false; overlay.classList.add('hidden');
    Juice.Audio.unlock(); Portal.gameStart();
  }

  // ---- geometry / matching ----
  function norm(a) { a %= TAU; if (a < 0) a += TAU; return a; }
  function angDist(a, b) { var d = Math.abs(norm(a) - norm(b)); return d > Math.PI ? TAU - d : d; }
  function edgeFacing(bearing) {
    var bi = 0, bd = 99, step = TAU / NF;
    for (var i = 0; i < NF; i++) {
      var nrm = angle + N0 + i * step;
      var d = angDist(nrm, bearing);
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }

  // ---- shards ----
  function spawnShard(bearing, color, dist) {
    if (bearing == null) bearing = Math.random() * TAU;
    var white = (color === 'white');
    if (color == null) {
      white = Math.random() < 0.085;
      color = white ? 'white' : (Math.random() * 3) | 0;
    } else if (white) color = 'white';
    var sp = (md * (0.17 + wave * 0.012)) * (hardcore ? 1.32 : 1);
    sp = Math.min(sp, md * 0.52);
    shards.push({ ang: bearing, dist: dist == null ? spawnDist : dist, speed: sp, color: color, white: white, dead: false });
    return shards[shards.length - 1];
  }

  function resolveShard(s) {
    s.dead = true;
    var x = cx + Math.cos(s.ang) * hitR, y = cy + Math.sin(s.ang) * hitR;
    var ei = edgeFacing(s.ang);
    var ok = s.white || faces[ei] === s.color;
    if (ok) {
      combo++; if (combo > maxCombo) maxCombo = combo;
      absorbed++;
      var gain = (s.white ? 25 : 10) * Math.max(1, combo);
      score += gain;
      if (score > best) { best = score; Retention.set(GAME, 'best', best); }
      var col = s.white ? WHITE : COL[s.color];
      particles.burst(x, y, { count: s.white ? 22 : 12, colors: [col, '#fff'], speed: 150 + combo * 4, life: 0.5, size: 4 });
      popups.add(x, y, '+' + gain + (combo > 1 ? '  x' + combo : ''), { color: col, size: clamp(13 + combo, 13, 30), life: 0.7 });
      flash(s.white ? WHITE : col, s.white ? 0.5 : 0.18);
      if (s.white) { whites++; slowmo = 0.9; Portal.happytime && Portal.happytime(); }
      shake.add(s.white ? 7 : clamp(1.5 + combo * 0.2, 1.5, 6), 0.18);
      Juice.Audio.play('merge', Math.min(combo, 12)); Juice.vibrate(combo > 1 ? [8, 8, 8] : 8);
      // missions
      toastIf(Progress.bumpMission(GAME, 'm_absorb', 1));
      toastIf(Progress.bumpMission(GAME, 'm_combo', combo, true));
      if (s.white) toastIf(Progress.bumpMission(GAME, 'm_white', 1));
    } else {
      combo = 0; shields--;
      particles.burst(x, y, { count: 16, colors: [COL[s.color], '#ff5b5b', '#fff'], speed: 220, life: 0.55, size: 4 });
      flash('#ff2b4e', 0.5); shake.add(12, 0.4);
      Juice.Audio.play('lose'); Juice.vibrate([20, 30, 20]);
      if (shields <= 0) { gameOver(); return; }
    }
    renderHUD();
  }

  function flash(col, a) { flashCol = col; flashA = Math.max(flashA, a); }

  // ---- loop ----
  function update(dt) {
    beat += dt;
    if (flashA > 0) flashA = Math.max(0, flashA - dt * 2.2);
    if (slowmo > 0) { slowmo = Math.max(0, slowmo - dt); dt *= 0.45; }

    // rotation: momentum when not actively driven
    if (!keyDir && !dragging) { angle += vel * dt; vel *= Math.pow(0.0009, dt); if (Math.abs(vel) < 0.02) vel = 0; }
    if (keyDir) { angle += keyDir * 3.6 * dt; vel = keyDir * 3.6; }
    angle = norm(angle);

    if (running && !over) {
      elapsed += dt;
      var nw = 1 + Math.floor(elapsed / (hardcore ? 11 : 15));
      if (nw > wave) { wave = nw; onWave(); }
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnShard();
        if (wave >= 5 && Math.random() < 0.35) spawnShard(); // double up later
        var interval = Math.max(hardcore ? 0.42 : 0.55, (hardcore ? 1.25 : 1.55) - wave * 0.07);
        spawnT = interval * (0.8 + Math.random() * 0.4);
      }
      for (var i = 0; i < shards.length; i++) {
        var s = shards[i]; if (s.dead) continue;
        s.dist -= s.speed * dt;
        if (s.dist <= hitR) resolveShard(s);
        if (over) break;
      }
      for (var j = shards.length - 1; j >= 0; j--) if (shards[j].dead) shards.splice(j, 1);
    }
    particles.update(dt); popups.update(dt); shakeOff = shake.update(dt);
  }

  function onWave() {
    flash(COL[2], 0.28); shake.add(4, 0.2); Juice.Audio.play('score');
    popups.add(cx, cy - PR * 2.4, 'WAVE ' + wave, { color: '#2de2ff', size: 22, life: 1.1 });
    toastIf(Progress.bumpMission(GAME, 'm_wave', wave, true));
  }

  // ---- render ----
  function vertex(i) { var a = angle + Math.PI / 2 + i * (TAU / NF); return { x: cx + Math.cos(a) * PR, y: cy + Math.sin(a) * PR }; }
  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    ctx.save(); ctx.translate(shakeOff.x, shakeOff.y);

    // center beat glow
    var pulse = 0.5 + 0.5 * Math.sin(beat * 3.2);
    var bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, md * 0.6);
    bg.addColorStop(0, 'rgba(120,80,220,' + (0.12 + 0.05 * pulse) + ')');
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, CW, CH);

    // impact ring
    ctx.strokeStyle = 'rgba(120,140,255,0.14)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, hitR, 0, TAU); ctx.stroke();

    // shards (with trail)
    for (var i = 0; i < shards.length; i++) {
      var s = shards[i]; if (s.dead) continue;
      var sx = cx + Math.cos(s.ang) * s.dist, sy = cy + Math.sin(s.ang) * s.dist;
      var tx = cx + Math.cos(s.ang) * (s.dist + PR * 1.1), ty = cy + Math.sin(s.ang) * (s.dist + PR * 1.1);
      var col = s.white ? WHITE : COL[s.color];
      ctx.strokeStyle = col; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
      ctx.shadowColor = col; ctx.shadowBlur = 12;
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, TAU); ctx.fillStyle = col; ctx.fill();
      ctx.shadowBlur = 0;
    }

    // prism
    var verts = []; for (i = 0; i < NF; i++) verts.push(vertex(i));
    // glow fill
    var pg = ctx.createRadialGradient(cx, cy, 2, cx, cy, PR);
    pg.addColorStop(0, 'rgba(255,255,255,0.16)'); pg.addColorStop(1, 'rgba(20,12,46,0.85)');
    ctx.beginPath(); ctx.moveTo(verts[0].x, verts[0].y);
    for (i = 1; i < NF; i++) ctx.lineTo(verts[i].x, verts[i].y);
    ctx.closePath(); ctx.fillStyle = pg; ctx.fill();
    // colored edges
    ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (i = 0; i < NF; i++) {
      var a = verts[i], b = verts[(i + 1) % NF];
      ctx.strokeStyle = COL[faces[i]]; ctx.shadowColor = COL[faces[i]]; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // cracks
    for (i = 0; i < 3 - shields; i++) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
      var ca = angle + i * 2.1, cl = PR * 0.9;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ca) * cl, cy + Math.sin(ca) * cl); ctx.stroke();
    }

    particles.draw(ctx); popups.draw(ctx);
    ctx.restore();

    // full-screen flash
    if (flashA > 0) {
      ctx.globalAlpha = flashA; ctx.fillStyle = flashCol; ctx.fillRect(0, 0, CW, CH); ctx.globalAlpha = 1;
    }
  }

  // ---- HUD ----
  function renderHUD() {
    scoreEl.textContent = score; bestEl.textContent = best;
    var s = ''; for (var i = 0; i < 3; i++) s += (i < shields ? '◆' : '◇') + (i < 2 ? ' ' : '');
    shieldsEl.textContent = s;
    waveEl.textContent = 'WAVE ' + wave;
  }
  function toastIf(m) { if (m) Stage.toast(wrap, '✓ ' + m.text + '  +' + m.reward, 1600); }

  // ---- game over ----
  function gameOver() {
    if (over) return; over = true; running = false;
    Portal.gameStop(); Retention.submitScore(GAME, score);
    Juice.Audio.play('lose'); Juice.vibrate([30, 50, 30]); shake.add(16, 0.5); flash('#ff2b4e', 0.6);
    if (maxCombo > 1) toastIf(Progress.bumpMission(GAME, 'm_combo', maxCombo, true));
    toastIf(Progress.bumpMission(GAME, 'm_score', score, true));
    Progress.addCoins(GAME, Math.floor(score / 200));
    var isBest = score >= best && score > 0;
    ovTitle.textContent = isBest ? 'New Best! 🏆' : 'Shattered';
    ovSub.textContent = isBest ? 'Your sharpest run yet.' : 'Max combo x' + maxCombo + ' · Wave ' + wave;
    ovScore.textContent = score; ovBest.textContent = best;
    ovContinue.style.display = (Portal.available && !usedContinue && score > 0) ? '' : 'none';
    overlay.classList.remove('hidden');
  }

  // ---- menu ----
  function showMenu() {
    var missions = Progress.dailyMissions(GAME, MISSIONS, 3);
    var body = '<div style="font-size:13px;color:var(--muted);margin:-4px 0 10px">🪙 ' + Progress.coins(GAME) + ' coins</div>'
      + '<div style="font-size:11px;letter-spacing:.14em;color:var(--muted);text-align:left;margin-bottom:4px">DAILY MISSIONS</div>'
      + Stage.missionsHTML(missions);
    var actions = [];
    if (!Progress.unlocked(GAME, 'hex')) actions.push({ label: 'Unlock HEX mode — 150🪙', ghost: true, onClick: function () { if (Progress.spend(GAME, 150)) { Progress.unlock(GAME, 'hex'); } showMenu(); } });
    else actions.push({ label: 'Play HEX mode', ghost: true, onClick: function () { Portal.commercialBreak(function () { reset('hex'); startRun(); }); } });
    if (!Progress.unlocked(GAME, 'hardcore')) actions.push({ label: 'Unlock HARDCORE — 250🪙', ghost: true, onClick: function () { if (Progress.spend(GAME, 250)) { Progress.unlock(GAME, 'hardcore'); } showMenu(); } });
    else actions.push({ label: 'Play HARDCORE', ghost: true, onClick: function () { Portal.commercialBreak(function () { reset('hardcore'); startRun(); }); } });
    actions.push({ label: 'Back', onClick: function () {} });
    Stage.card({ kicker: 'PRISM', title: 'Missions & Modes', body: body, actions: actions });
  }

  // ---- input ----
  var dragging = false, lastX = 0, keyDir = 0, velSamp = 0;
  function px(clientX) { var b = canvas.getBoundingClientRect(); return (clientX - b.left) * (CW / b.width); }
  canvas.addEventListener('pointerdown', function (e) { dragging = true; lastX = px(e.clientX); velSamp = 0; Juice.Audio.unlock(); });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var x = px(e.clientX), dx = x - lastX; lastX = x;
    var d = dx * 0.011; angle += d; velSamp = d;
  });
  window.addEventListener('pointerup', function () { if (dragging) { dragging = false; vel = velSamp * 60; } });
  canvas.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft' || e.key === 'a') { keyDir = -1; e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'd') { keyDir = 1; e.preventDefault(); }
  });
  window.addEventListener('keyup', function (e) {
    if ((e.key === 'ArrowLeft' || e.key === 'a') && keyDir < 0) keyDir = 0;
    if ((e.key === 'ArrowRight' || e.key === 'd') && keyDir > 0) keyDir = 0;
  });

  document.getElementById('new').addEventListener('click', function () { Portal.commercialBreak(function () { reset(hardcore ? 'hardcore' : (NF === 6 ? 'hex' : 'classic')); startRun(); }); });
  document.getElementById('menu').addEventListener('click', showMenu);
  var muteBtn = document.getElementById('mute');
  muteBtn.addEventListener('click', function () { var m = Juice.Audio.toggleMute(); Retention.set(GAME, 'muted', m); Portal.mute(m); this.textContent = m ? '🔇' : '🔊'; });
  ovAgain.addEventListener('click', function () { Portal.commercialBreak(function () { reset(hardcore ? 'hardcore' : (NF === 6 ? 'hex' : 'classic')); startRun(); }); });
  ovContinue.addEventListener('click', function () {
    Portal.rewardedAd(function () { usedContinue = true; over = false; shields = 3; shards = []; overlay.classList.add('hidden'); renderHUD(); startRun(); }, function () {});
  });

  // ---- boot ----
  function boot() {
    Portal.loadingStart(); layout();
    best = Retention.best(GAME); Retention.touchStreak(GAME);
    Progress.dailyMissions(GAME, MISSIONS, 3); // initialise so missions track from the first run
    if (Retention.get(GAME, 'muted', false)) { Juice.Audio.setMuted(true); muteBtn.textContent = '🔇'; }
    reset('classic');
    if (window.ResizeObserver) new ResizeObserver(layout).observe(wrap);
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', function () { setTimeout(layout, 200); });
    var last = performance.now();
    (function frame(now) { var dt = Math.min(0.05, (now - last) / 1000); last = now; update(dt); draw(); requestAnimationFrame(frame); })(performance.now());
    Portal.init().then(function () {
      Portal.loadingStop(); Portal.mute(Juice.Audio.isMuted());
      var L = document.getElementById('loader'); if (L) L.classList.add('hidden');
      var first = !Retention.get(GAME, 'taught', false);
      if (first) Retention.set(GAME, 'taught', true);
      Stage.card({
        kicker: first ? 'How to play' : 'PRISM',
        title: first ? 'Match the light' : 'Ready?',
        body: first
          ? 'Beams of light fly in from all sides. <b>Spin the prism</b> (drag left/right, or ← →) so the face that meets each beam is the <b>same color</b>. Wrong color cracks the prism — three cracks and it shatters.'
          : 'Spin the prism so each beam meets its matching color.',
        actions: [{ label: 'Play ▶', onClick: startRun }]
      });
    });
  }

  // ---- headless test hook ----
  window.__prism = {
    spawn: function (bearingDeg, color, distFrac) {
      var b = bearingDeg == null ? null : bearingDeg * Math.PI / 180;
      var d = distFrac == null ? hitR + 4 : hitR + distFrac * (spawnDist - hitR);
      return spawnShard(b, color, d);
    },
    setAngleDeg: function (deg) { angle = norm(deg * Math.PI / 180); vel = 0; },
    edgeColorAt: function (bearingDeg) { return faces[edgeFacing(bearingDeg * Math.PI / 180)]; },
    tick: function (n, dt) { dt = dt || 1 / 60; for (var i = 0; i < (n || 1); i++) update(dt); },
    start: function (mode) { reset(mode || 'classic'); running = true; over = false; },
    reset: reset,
    state: function () {
      return { score: score, best: best, combo: combo, maxCombo: maxCombo, shields: shields,
        wave: wave, absorbed: absorbed, whites: whites, shards: shards.length, over: over,
        running: running, NF: NF, coins: (window.Progress ? Progress.coins(GAME) : 0) };
    }
  };

  (function () { if (overlay && window.MutationObserver) new MutationObserver(function () { if (!overlay.classList.contains('hidden')) Portal.gameStop(); }).observe(overlay, { attributes: true, attributeFilter: ['class'] }); })();

  boot();
})();
