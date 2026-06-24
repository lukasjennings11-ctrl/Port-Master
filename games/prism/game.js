/* PRISM — one-thumb neon arena survivor (roguelite). Dependency-free, mobile-first.
 *
 * Drag to move your prism; it AUTO-FIRES beams of light at the nearest enemy.
 * Neon shapes swarm in from the edges — touching you costs HP. Killing them
 * drops light motes; collect them to level up and pick an upgrade. The signature
 * "Refract" upgrade splits your beam into R/G/B. Survive as long as you can; it
 * escalates forever, with a boss every minute. Time + kills = score.
 *
 * Shared: juice.js, retention.js, portal.js, progression.js, stage.js.
 */
(function () {
  'use strict';

  var GAME = 'prism';
  var clamp = Juice.clamp, TAU = Math.PI * 2;

  var NEON = { cyan: '#2de2ff', mag: '#ff2d9b', white: '#eafcff', gold: '#ffd166' };
  var RGB = ['#ff3b6b', '#36ff9e', '#4b8bff'];

  var ETYPE = {
    grunt: { hp: 10, spd: 46, r: 13, dmg: 8,  xp: 1,  col: '#ff6b8a', shape: 0 },
    fast:  { hp: 7,  spd: 84, r: 10, dmg: 7,  xp: 1,  col: '#ffd166', shape: 1 },
    tank:  { hp: 46, spd: 30, r: 21, dmg: 14, xp: 3,  col: '#c46af7', shape: 2 },
    boss:  { hp: 650, spd: 27, r: 40, dmg: 26, xp: 45, col: '#ff2d9b', shape: 2 }
  };

  var UPGRADES = [
    { id: 'dmg',    name: 'Amplify',    desc: '+25% beam damage',     max: 8 },
    { id: 'rate',   name: 'Overclock',  desc: '+18% fire rate',       max: 8 },
    { id: 'multi',  name: 'Split Beam', desc: '+1 projectile',        max: 6 },
    { id: 'prism',  name: 'Refract',    desc: 'Beams split into R/G/B', max: 4 },
    { id: 'orb',    name: 'Halo',       desc: '+1 orbiting shard',    max: 6 },
    { id: 'nova',   name: 'Pulse',      desc: 'Periodic shockwave',   max: 5 },
    { id: 'speed',  name: 'Swift',      desc: '+12% move speed',      max: 6 },
    { id: 'hp',     name: 'Fortify',    desc: '+25 max HP & heal',    max: 8 },
    { id: 'magnet', name: 'Magnet',     desc: '+40% pickup range',    max: 4 },
    { id: 'regen',  name: 'Mend',       desc: 'Regenerate HP',        max: 4 }
  ];

  var MISSIONS = [
    { id: 'm_time',  text: 'Survive 3 minutes',  target: 180, reward: 40 },
    { id: 'm_level', text: 'Reach level 12',      target: 12,  reward: 40 },
    { id: 'm_kills', text: 'Defeat 250 enemies',  target: 250, reward: 35 },
    { id: 'm_boss',  text: 'Defeat a boss',       target: 1,   reward: 50 },
    { id: 'm_run',   text: 'Score 5000 in a run', target: 5000, reward: 35 }
  ];

  // ---- DOM ----
  var canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  var wrap = document.querySelector('.board-wrap');
  var scoreEl = document.getElementById('score'), bestEl = document.getElementById('best');
  var lvlEl = document.getElementById('lvl'), timeEl = document.getElementById('time');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title'), ovSub = document.getElementById('ov-sub');
  var ovScore = document.getElementById('ov-score'), ovBest = document.getElementById('ov-best');
  var ovAgain = document.getElementById('ov-again'), ovContinue = document.getElementById('ov-continue');

  var particles = new Juice.Particles(), popups = new Juice.Popups(), shake = new Juice.Shake();
  var shakeOff = { x: 0, y: 0 };

  // ---- layout ----
  var CW = 0, CH = 0, DPR = 1;
  function layout() {
    var bw = wrap.clientWidth || 360, bh = wrap.clientHeight || 520;
    CW = Math.max(240, bw); CH = Math.max(320, bh);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR);
    canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (player && !running && !over) { player.x = CW / 2; player.y = CH / 2; }
  }

  // ---- state ----
  var player, enemies, projs, motes, novas, up;
  var time, kills, level, xp, xpNext, best, over, running, hardcore;
  var spawnCd, nextBoss, hudT, choosing, pendingLevels, usedContinue, prismSpin;

  function freshPlayer() {
    return { x: CW / 2, y: CH / 2, r: 14, hp: 100, maxHp: 100, hitCd: 0, beamCd: 0, novaCd: 2.6, orbAng: 0, flash: 0 };
  }
  function reset(mode) {
    hardcore = (mode === 'hardcore');
    player = freshPlayer();
    enemies = []; projs = []; motes = []; novas = [];
    up = { dmg: 0, rate: 0, multi: 0, prism: 0, orb: 0, nova: 0, speed: 0, hp: 0, magnet: 0, regen: 0 };
    time = 0; kills = 0; level = 1; xp = 0; xpNext = 4; over = false; running = false;
    spawnCd = 1.0; nextBoss = 60; hudT = 0; choosing = false; pendingLevels = 0; usedContinue = false; prismSpin = 0;
    overlay.classList.add('hidden');
    renderHUD();
  }
  function startRun() { running = true; over = false; overlay.classList.add('hidden'); Juice.Audio.unlock(); Portal.gameStart(); }

  // ---- derived stats ----
  function dmgMul() { return 1 + 0.25 * up.dmg; }
  function fireInterval() { return (hardcore ? 0.78 : 0.7) / (1 + 0.18 * up.rate); }
  function moveSpeed() { return (hardcore ? 138 : 150) * (1 + 0.12 * up.speed); }
  function pickRadius() { return 48 * (1 + 0.4 * up.magnet); }

  // ---- spawning ----
  function spawnAt(type, x, y) {
    var t = ETYPE[type], scale = 1 + time * (hardcore ? 0.03 : 0.022);
    enemies.push({ x: x, y: y, r: t.r, spd: t.spd * (type === 'boss' ? 1 : (1 + time * 0.004)),
      hp: t.hp * (type === 'boss' ? (1 + time * 0.02) : scale), maxHp: t.hp * (type === 'boss' ? (1 + time * 0.02) : scale),
      dmg: t.dmg, xp: t.xp, col: t.col, shape: t.shape, type: type, hitCd: 0, kb: { x: 0, y: 0 } });
    return enemies[enemies.length - 1];
  }
  function spawnEdge(type) {
    var m = 24, x, y, side = (Math.random() * 4) | 0;
    if (side === 0) { x = Math.random() * CW; y = -m; }
    else if (side === 1) { x = CW + m; y = Math.random() * CH; }
    else if (side === 2) { x = Math.random() * CW; y = CH + m; }
    else { x = -m; y = Math.random() * CH; }
    return spawnAt(type, x, y);
  }
  function pickType() {
    var r = Math.random();
    if (time > 45 && r < 0.18) return 'tank';
    if (time > 20 && r < 0.45) return 'fast';
    return 'grunt';
  }

  // ---- weapons ----
  function nearest() {
    var b = null, bd = 1e9;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i], dx = e.x - player.x, dy = e.y - player.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; b = e; }
    }
    return b;
  }
  function fireBeam(ang, col, dmg, pierce) {
    var sp = 440;
    projs.push({ x: player.x, y: player.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: 5, dmg: dmg, col: col, life: 1.3, pierce: pierce });
  }
  function fireWeapons(dt) {
    player.beamCd -= dt;
    if (player.beamCd <= 0) {
      var tgt = nearest();
      if (tgt) {
        player.beamCd = fireInterval();
        var base = 6 * dmgMul(), n = 1 + up.multi, a0 = Math.atan2(tgt.y - player.y, tgt.x - player.x);
        for (var i = 0; i < n; i++) fireBeam(a0 + (i - (n - 1) / 2) * 0.12, NEON.cyan, base, up.prism ? 1 : 0);
        if (up.prism) for (var k = 0; k < 3; k++) fireBeam(a0 + (k - 1) * 0.34, RGB[k], base * 0.6 * up.prism, up.prism);
        Juice.Audio.play('tap');
      }
    }
    // orbiting shards
    if (up.orb) {
      player.orbAng += dt * 2.6;
      var orbR = player.r + 36, sd = 5 * dmgMul();
      for (var o = 0; o < up.orb; o++) {
        var oa = player.orbAng + o * TAU / up.orb, ox = player.x + Math.cos(oa) * orbR, oy = player.y + Math.sin(oa) * orbR;
        for (var e = 0; e < enemies.length; e++) {
          var en = enemies[e]; if (en.hitCd > 0) continue;
          var dx = en.x - ox, dy = en.y - oy;
          if (dx * dx + dy * dy < (en.r + 9) * (en.r + 9)) { damage(en, sd, ox, oy); en.hitCd = 0.22; }
        }
      }
    }
    // nova pulse
    if (up.nova) {
      player.novaCd -= dt;
      if (player.novaCd <= 0) {
        player.novaCd = 2.6;
        var nr = 80 + 22 * up.nova, nd = 12 * up.nova * dmgMul();
        novas.push({ x: player.x, y: player.y, r: 0, max: nr, life: 0.5 });
        for (var z = 0; z < enemies.length; z++) {
          var ez = enemies[z], ddx = ez.x - player.x, ddy = ez.y - player.y;
          if (ddx * ddx + ddy * ddy < nr * nr) { damage(ez, nd, ez.x, ez.y); ez.kb.x += ddx * 0.04; ez.kb.y += ddy * 0.04; }
        }
        shake.add(4, 0.18); Juice.Audio.play('merge', 4);
      }
    }
  }

  function damage(e, dmg, hx, hy) {
    e.hp -= dmg;
    popups.add(hx, hy - e.r, '' + Math.round(dmg), { color: '#fff', size: 12, life: 0.5 });
    particles.burst(hx, hy, { count: 4, colors: [e.col, '#fff'], speed: 90, life: 0.3, size: 3 });
    if (e.hp <= 0) killEnemy(e);
  }
  function killEnemy(e) {
    var i = enemies.indexOf(e); if (i < 0) return;
    enemies.splice(i, 1); kills++;
    particles.burst(e.x, e.y, { count: e.type === 'boss' ? 40 : 10, colors: [e.col, '#fff'], speed: 170, life: 0.55, size: 4 });
    if (e.type === 'boss') { shake.add(12, 0.4); flashScreen(); toastIf(Progress.bumpMission(GAME, 'm_boss', 1)); }
    // drop motes
    var drops = e.type === 'boss' ? 8 : (e.type === 'tank' ? 3 : 1);
    for (var d = 0; d < drops; d++) motes.push({ x: e.x + (Math.random() - 0.5) * 14, y: e.y + (Math.random() - 0.5) * 14, val: e.xp, vx: 0, vy: 0 });
    toastIf(Progress.bumpMission(GAME, 'm_kills', 1));
  }

  function flashScreen() { player.flash = Math.max(player.flash, 0.4); }

  // ---- leveling ----
  function gainXp(v) {
    xp += v;
    while (xp >= xpNext) { xp -= xpNext; level++; xpNext = Math.floor(xpNext * 1.35 + 4); pendingLevels++; }
    toastIf(Progress.bumpMission(GAME, 'm_level', level, true));
  }
  function rollChoices() {
    var pool = UPGRADES.filter(function (u) { return up[u.id] < u.max; });
    for (var i = pool.length - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0; var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    return pool.slice(0, 3);
  }
  var _choices = [];
  function openChoice() {
    choosing = true; Portal.gameStop();
    _choices = rollChoices();
    if (!_choices.length) { applyChoice(-1); return; }
    Stage.card({
      kicker: 'Level ' + level, title: 'Refract your power',
      body: '<div style="font-size:13px;color:var(--muted);margin:-4px 0 2px">Pick an upgrade</div>',
      actions: _choices.map(function (c) {
        return { label: c.name + ' — ' + c.desc + (up[c.id] ? '  (Lv' + (up[c.id] + 1) + ')' : ''), ghost: true, onClick: function () { applyChoice2(c.id); } };
      })
    });
  }
  function applyChoice2(id) {
    if (id) { up[id]++; if (id === 'hp') { player.maxHp += 25; player.hp = Math.min(player.maxHp, player.hp + 25); } }
    pendingLevels--; choosing = false;
    Juice.Audio.play('score');
    if (pendingLevels > 0) openChoice(); else { renderHUD(); if (!over) Portal.gameStart(); }
  }
  function applyChoice(i) { applyChoice2(i >= 0 && _choices[i] ? _choices[i].id : null); } // headless

  // ---- loop ----
  function update(dt) {
    prismSpin += dt * 1.5;
    if (player) { if (player.flash > 0) player.flash = Math.max(0, player.flash - dt * 2); if (player.hitCd > 0) player.hitCd -= dt; }
    if (running && !over && !choosing) {
      time += dt;
      // movement
      var sp = moveSpeed(), mvx = 0, mvy = 0;
      if (joyActive) { mvx = joyVX; mvy = joyVY; } else { mvx = keyX; mvy = keyY; }
      var ml = Math.hypot(mvx, mvy);
      if (ml > 0.01) { player.x += (mvx / ml) * sp * dt; player.y += (mvy / ml) * sp * dt; }
      player.x = clamp(player.x, player.r, CW - player.r); player.y = clamp(player.y, player.r, CH - player.r);
      // regen
      if (up.regen && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + up.regen * 1.5 * dt);

      fireWeapons(dt);

      // spawn director
      spawnCd -= dt;
      if (spawnCd <= 0 && enemies.length < 170) {
        spawnCd = Math.max(hardcore ? 0.22 : 0.3, (hardcore ? 0.9 : 1.1) - time * 0.006);
        var batch = 1 + Math.floor(time / 22);
        for (var b = 0; b < batch; b++) spawnEdge(pickType());
      }
      if (time >= nextBoss) { spawnEdge('boss'); nextBoss += 60; flashScreen(); shake.add(6, 0.3); }

      // enemies move + contact
      for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i], dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy) || 1;
        e.x += (dx / d) * e.spd * dt + e.kb.x; e.y += (dy / d) * e.spd * dt + e.kb.y;
        e.kb.x *= 0.86; e.kb.y *= 0.86;
        if (e.hitCd > 0) e.hitCd -= dt;
        if (d < e.r + player.r && player.hitCd <= 0) {
          player.hp -= e.dmg; player.hitCd = 0.55; flashScreen(); shake.add(7, 0.25);
          Juice.Audio.play('lose'); Juice.vibrate(20);
          e.kb.x -= (dx / d) * 6; e.kb.y -= (dy / d) * 6;
          if (player.hp <= 0) { player.hp = 0; gameOver(); }
        }
      }
      // separate overlapping enemies a touch (avoid full stacking)
      // (cheap: skip for perf at high counts)

      // projectiles
      for (var p = projs.length - 1; p >= 0; p--) {
        var pr = projs[p]; pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
        if (pr.life <= 0 || pr.x < -20 || pr.x > CW + 20 || pr.y < -20 || pr.y > CH + 20) { projs.splice(p, 1); continue; }
        for (var q = 0; q < enemies.length; q++) {
          var eq = enemies[q], ex = eq.x - pr.x, ey = eq.y - pr.y;
          if (ex * ex + ey * ey < (eq.r + pr.r) * (eq.r + pr.r)) {
            damage(eq, pr.dmg, pr.x, pr.y);
            if (pr.pierce > 0) { pr.pierce--; } else { projs.splice(p, 1); }
            break;
          }
        }
      }

      // motes attract + collect
      var pr2 = pickRadius();
      for (var m = motes.length - 1; m >= 0; m--) {
        var mo = motes[m], mdx = player.x - mo.x, mdy = player.y - mo.y, md = Math.hypot(mdx, mdy) || 1;
        if (md < pr2) { mo.x += (mdx / md) * 260 * dt; mo.y += (mdy / md) * 260 * dt; }
        if (md < player.r + 4) { gainXp(mo.val); motes.splice(m, 1); }
      }

      // novas
      for (var n = novas.length - 1; n >= 0; n--) { var nv = novas[n]; nv.life -= dt; nv.r = nv.max * (1 - nv.life / 0.5); if (nv.life <= 0) novas.splice(n, 1); }

      hudT -= dt; if (hudT <= 0) { hudT = 0.15; renderHUD(); }
      if (pendingLevels > 0 && !choosing) openChoice();
    }
    particles.update(dt); popups.update(dt); shakeOff = shake.update(dt);
  }

  // ---- render ----
  function shapePath(x, y, r, shape, rot) {
    if (shape === 0) { ctx.arc(x, y, r, 0, TAU); return; }
    var sides = shape === 1 ? 3 : 4;
    for (var i = 0; i < sides; i++) { var a = rot + i * TAU / sides; var px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath();
  }
  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    ctx.save(); ctx.translate(shakeOff.x, shakeOff.y);
    // bg pulse
    var bg = ctx.createRadialGradient(CW / 2, CH / 2, 0, CW / 2, CH / 2, Math.max(CW, CH) * 0.7);
    bg.addColorStop(0, 'rgba(90,60,180,0.12)'); bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, CW, CH);

    if (player) {
      // motes
      ctx.shadowBlur = 8;
      for (var m = 0; m < motes.length; m++) { var mo = motes[m]; ctx.shadowColor = NEON.cyan; ctx.fillStyle = NEON.cyan; ctx.beginPath(); ctx.arc(mo.x, mo.y, 3.2, 0, TAU); ctx.fill(); }
      // novas
      ctx.shadowBlur = 0;
      for (var n = 0; n < novas.length; n++) { var nv = novas[n]; ctx.globalAlpha = clamp(nv.life / 0.5, 0, 1) * 0.6; ctx.strokeStyle = NEON.cyan; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(nv.x, nv.y, nv.r, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
      // enemies
      for (var e = 0; e < enemies.length; e++) {
        var en = enemies[e];
        ctx.shadowColor = en.col; ctx.shadowBlur = 12; ctx.fillStyle = en.col;
        ctx.beginPath(); shapePath(en.x, en.y, en.r, en.shape, prismSpin * 0.6); ctx.fill();
        if (en.type === 'boss' || en.type === 'tank') { ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(en.x - en.r, en.y - en.r - 6, en.r * 2, 3); ctx.fillStyle = '#fff'; ctx.fillRect(en.x - en.r, en.y - en.r - 6, en.r * 2 * clamp(en.hp / en.maxHp, 0, 1), 3); }
      }
      ctx.shadowBlur = 0;
      // orbiting shards
      if (up.orb) { var orbR = player.r + 36; for (var o = 0; o < up.orb; o++) { var oa = player.orbAng + o * TAU / up.orb; var ox = player.x + Math.cos(oa) * orbR, oy = player.y + Math.sin(oa) * orbR; ctx.shadowColor = NEON.white; ctx.shadowBlur = 10; ctx.fillStyle = NEON.white; ctx.beginPath(); ctx.arc(ox, oy, 5, 0, TAU); ctx.fill(); } ctx.shadowBlur = 0; }
      // projectiles
      for (var p = 0; p < projs.length; p++) { var pr = projs[p]; ctx.strokeStyle = pr.col; ctx.shadowColor = pr.col; ctx.shadowBlur = 10; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(pr.x - pr.vx * 0.02, pr.y - pr.vy * 0.02); ctx.stroke(); }
      ctx.shadowBlur = 0;
      // player prism (rotating triangle)
      var blink = (player.hitCd > 0 && ((player.hitCd * 12) | 0) % 2 === 0);
      ctx.save(); ctx.translate(player.x, player.y); ctx.rotate(prismSpin);
      ctx.shadowColor = NEON.cyan; ctx.shadowBlur = 16; ctx.globalAlpha = blink ? 0.4 : 1;
      ctx.beginPath(); for (var v = 0; v < 3; v++) { var va = v * TAU / 3 - Math.PI / 2; var vx = Math.cos(va) * player.r, vy = Math.sin(va) * player.r; if (v) ctx.lineTo(vx, vy); else ctx.moveTo(vx, vy); } ctx.closePath();
      var pgr = ctx.createLinearGradient(-player.r, -player.r, player.r, player.r); pgr.addColorStop(0, NEON.mag); pgr.addColorStop(1, NEON.cyan);
      ctx.fillStyle = pgr; ctx.fill(); ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.restore();
      // joystick
      if (joyActive) { ctx.globalAlpha = 0.18; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(joyOX, joyOY, 36, 0, TAU); ctx.fill(); ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.arc(joyOX + clamp(joyRX, -36, 36), joyOY + clamp(joyRY, -36, 36), 16, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    }
    particles.draw(ctx); popups.draw(ctx);

    // HP + XP bars (canvas, top)
    if (player) {
      var bw = Math.min(CW - 24, 280), bx = (CW - bw) / 2;
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(bx, 10, bw, 7);
      ctx.fillStyle = player.hp / player.maxHp > 0.3 ? NEON.mag : '#ff5b5b'; ctx.fillRect(bx, 10, bw * clamp(player.hp / player.maxHp, 0, 1), 7);
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(bx, 20, bw, 4);
      ctx.fillStyle = NEON.cyan; ctx.fillRect(bx, 20, bw * clamp(xp / xpNext, 0, 1), 4);
    }
    ctx.restore();

    if (player && player.flash > 0) { ctx.globalAlpha = player.flash * 0.5; ctx.fillStyle = '#ff2b4e'; ctx.fillRect(0, 0, CW, CH); ctx.globalAlpha = 1; }
  }

  // ---- HUD ----
  function score() { return Math.floor(time * 10) + kills * 5; }
  function renderHUD() {
    var sc = score(); if (sc > best) { best = sc; Retention.set(GAME, 'best', best); }
    scoreEl.textContent = sc; bestEl.textContent = best;
    lvlEl.textContent = 'LV ' + level;
    var t = Math.floor(time); timeEl.textContent = Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2);
  }
  function toastIf(m) { if (m) Stage.toast(wrap, '✓ ' + m.text + '  +' + m.reward, 1600); }

  // ---- game over ----
  function gameOver() {
    if (over) return; over = true; running = false;
    Portal.gameStop(); var sc = score(); Retention.submitScore(GAME, sc);
    Juice.Audio.play('lose'); Juice.vibrate([30, 50, 30]); shake.add(16, 0.5); flashScreen();
    toastIf(Progress.bumpMission(GAME, 'm_run', sc, true));
    Progress.addCoins(GAME, Math.floor(sc / 150));
    var isBest = sc >= best && sc > 0;
    ovTitle.textContent = isBest ? 'New Best! 🏆' : 'Overwhelmed';
    ovSub.textContent = 'Lv ' + level + ' · ' + kills + ' kills · ' + timeEl.textContent;
    ovScore.textContent = sc; ovBest.textContent = best;
    ovContinue.style.display = (Portal.available && !usedContinue && sc > 0) ? '' : 'none';
    overlay.classList.remove('hidden');
  }

  // ---- menu ----
  function showMenu() {
    var missions = Progress.dailyMissions(GAME, MISSIONS, 3);
    var body = '<div style="font-size:13px;color:var(--muted);margin:-4px 0 10px">🪙 ' + Progress.coins(GAME) + ' coins</div>'
      + '<div style="font-size:11px;letter-spacing:.14em;color:var(--muted);text-align:left;margin-bottom:4px">DAILY MISSIONS</div>'
      + Stage.missionsHTML(missions);
    var actions = [];
    if (!Progress.unlocked(GAME, 'hardcore')) actions.push({ label: 'Unlock HARDCORE — 200🪙', ghost: true, onClick: function () { if (Progress.spend(GAME, 200)) Progress.unlock(GAME, 'hardcore'); showMenu(); } });
    else actions.push({ label: 'Play HARDCORE', ghost: true, onClick: function () { Portal.commercialBreak(function () { reset('hardcore'); startRun(); }); } });
    actions.push({ label: 'Back', onClick: function () {} });
    Stage.card({ kicker: 'PRISM', title: 'Missions & Modes', body: body, actions: actions });
  }

  // ---- input: floating joystick + keys ----
  var joyActive = false, joyOX = 0, joyOY = 0, joyRX = 0, joyRY = 0, joyVX = 0, joyVY = 0;
  var keyX = 0, keyY = 0, keyL = 0, keyR = 0, keyU = 0, keyD = 0;
  function cpt(clientX, clientY) { var b = canvas.getBoundingClientRect(); return { x: (clientX - b.left) * (CW / b.width), y: (clientY - b.top) * (CH / b.height) }; }
  canvas.addEventListener('pointerdown', function (e) { var p = cpt(e.clientX, e.clientY); joyActive = true; joyOX = p.x; joyOY = p.y; joyRX = joyRY = joyVX = joyVY = 0; Juice.Audio.unlock(); });
  canvas.addEventListener('pointermove', function (e) { if (!joyActive) return; var p = cpt(e.clientX, e.clientY); joyRX = p.x - joyOX; joyRY = p.y - joyOY; var l = Math.hypot(joyRX, joyRY); if (l > 1) { joyVX = joyRX / l; joyVY = joyRY / l; } });
  window.addEventListener('pointerup', function () { joyActive = false; joyVX = joyVY = 0; });
  canvas.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  function syncKeys() { keyX = keyR - keyL; keyY = keyD - keyU; }
  window.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') { keyL = 1; e.preventDefault(); }
    else if (k === 'arrowright' || k === 'd') { keyR = 1; e.preventDefault(); }
    else if (k === 'arrowup' || k === 'w') { keyU = 1; e.preventDefault(); }
    else if (k === 'arrowdown' || k === 's') { keyD = 1; e.preventDefault(); }
    syncKeys();
  });
  window.addEventListener('keyup', function (e) {
    var k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') keyL = 0; else if (k === 'arrowright' || k === 'd') keyR = 0;
    else if (k === 'arrowup' || k === 'w') keyU = 0; else if (k === 'arrowdown' || k === 's') keyD = 0;
    syncKeys();
  });

  document.getElementById('new').addEventListener('click', function () { Portal.commercialBreak(function () { reset(hardcore ? 'hardcore' : 'classic'); startRun(); }); });
  document.getElementById('menu').addEventListener('click', showMenu);
  var muteBtn = document.getElementById('mute');
  muteBtn.addEventListener('click', function () { var m = Juice.Audio.toggleMute(); Retention.set(GAME, 'muted', m); Portal.mute(m); this.textContent = m ? '🔇' : '🔊'; });
  ovAgain.addEventListener('click', function () { Portal.commercialBreak(function () { reset(hardcore ? 'hardcore' : 'classic'); startRun(); }); });
  ovContinue.addEventListener('click', function () { Portal.rewardedAd(function () { usedContinue = true; over = false; player.hp = player.maxHp; enemies = []; overlay.classList.add('hidden'); renderHUD(); startRun(); }, function () {}); });

  // ---- boot ----
  function boot() {
    Portal.loadingStart(); layout();
    best = Retention.best(GAME); Retention.touchStreak(GAME);
    Progress.dailyMissions(GAME, MISSIONS, 3);
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
        title: first ? 'Survive the swarm' : 'Ready?',
        body: first
          ? '<b>Drag anywhere to move</b> (or WASD / arrows). Your prism <b>fires automatically</b> at the nearest enemy. Grab the light they drop to <b>level up</b> and choose upgrades — stack <b>Refract</b> to split your beam into three. Don\'t get touched.'
          : 'Drag to move. Survive as long as you can.',
        actions: [{ label: 'Play ▶', onClick: startRun }]
      });
    });
  }

  // ---- headless test hook ----
  window.__prism = {
    start: function (mode) { reset(mode || 'classic'); running = true; over = false; },
    reset: reset,
    tick: function (n, dt) { dt = dt || 1 / 60; for (var i = 0; i < (n || 1); i++) update(dt); },
    move: function (dx, dy) { joyActive = (dx || dy) ? true : false; var l = Math.hypot(dx, dy) || 1; joyVX = dx / l; joyVY = dy / l; },
    spawn: function (type, x, y) { return spawnAt(type || 'grunt', x == null ? CW * 0.5 : x, y == null ? 40 : y); },
    pickUpgrade: function (i) { if (choosing) applyChoice(i || 0); },
    addXp: function (v) { gainXp(v || xpNext); },
    state: function () {
      return { time: Math.round(time * 10) / 10, score: score(), best: best, hp: Math.round(player ? player.hp : 0), maxHp: player ? player.maxHp : 0,
        level: level, xp: xp, xpNext: xpNext, kills: kills, enemies: enemies.length, projs: projs.length, motes: motes.length,
        over: over, running: running, choosing: choosing, up: JSON.parse(JSON.stringify(up)),
        coins: (window.Progress ? Progress.coins(GAME) : 0) };
    },
    choices: function () { return _choices.map(function (c) { return c.id; }); }
  };

  (function () { if (overlay && window.MutationObserver) new MutationObserver(function () { if (!overlay.classList.contains('hidden')) Portal.gameStop(); }).observe(overlay, { attributes: true, attributeFilter: ['class'] }); })();

  boot();
})();
