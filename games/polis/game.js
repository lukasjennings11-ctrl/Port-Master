/* POLIS — a one-screen settlement that grows into a Roman city across the ages.
 *
 * Phase 1: deterministic island generation + warm-daylight isometric renderer
 * (auto-fit, no scrolling), tile picking, selection, save/load skeleton, Portal
 * lifecycle, and the window.__polis headless hook. Economy/buildings/ages land in
 * later phases — the data structures and render hooks are stubbed for them here.
 *
 * Shared (no build step): juice.js, retention.js, portal.js, progression.js, stage.js.
 */
(function () {
  'use strict';

  var GAME = 'polis';
  var clamp = Juice.clamp;

  // ---- world constants ----
  var GRID = 9;                 // GRID x GRID logical tiles (one screen, no scroll)
  var CENTER = (GRID - 1) / 2;
  var AGE_UNLOCK_R = [2, 3, 4]; // chebyshev radius of buildable tiles per age (I, II, III)

  // terrain palette (warm daylight)
  var TER = {
    water: { top: '#6fb6d6', name: 'Water' },
    sand:  { top: '#e9d8a6', name: 'Sand'  },
    grass: { top: '#7cc28a', name: 'Grass' },
    rock:  { top: '#9aa3ad', name: 'Hills' }
  };

  // ---- building catalog (data-driven; tuned across phases) ----
  // prod: produces `base` units of res every `interval`s (rate = base/interval), scaled
  //       by adjacency and (for popCost>0 buildings) by labour efficiency.
  // adj:  per matching neighbour within radius -> mult adds to a multiplier, flat adds units.
  // pop:  population provided (housing). popCost: labour required to operate.
  // cap:  adds to storage caps. landmark: gates/symbolises an age.
  var CATALOG = [
    // --- Age I — Founding ---
    { id: 'hut', name: 'Hut', glyph: '🛖', color: '#c98b5a', age: 0, cost: { gold: 10 },
      place: { on: ['grass', 'sand'] }, pop: 3, prod: { res: 'gold', base: 1, interval: 6 },
      adj: [{ target: 'hut', kind: 'building', mult: 0.10, radius: 1 }] },
    { id: 'farm', name: 'Farm', glyph: '🌾', color: '#d9b24a', age: 0, cost: { gold: 12, wood: 5 },
      place: { on: ['grass'] }, popCost: 1, prod: { res: 'food', base: 2, interval: 4 },
      adj: [{ target: 'water', kind: 'terrain', flat: 1, radius: 1 },
            { target: 'farm', kind: 'building', mult: 0.25, radius: 1 }] },
    { id: 'lumber', name: 'Lumber Camp', glyph: '🪵', color: '#8a6b3a', age: 0, cost: { gold: 14 },
      place: { on: ['grass'] }, popCost: 1, prod: { res: 'wood', base: 1.5, interval: 5 },
      adj: [{ target: 'forest', kind: 'terrain', mult: 0.6, radius: 1 }] },

    // --- Age II — Village ---
    { id: 'house', name: 'House', glyph: '🏠', color: '#d98a4f', age: 1, cost: { wood: 25, gold: 10 },
      place: { on: ['grass', 'sand'] }, pop: 6, prod: { res: 'gold', base: 2, interval: 6 },
      adj: [{ target: 'house', kind: 'building', mult: 0.12, radius: 1 }] },
    { id: 'quarry', name: 'Quarry', glyph: '⛏️', color: '#8b94a0', age: 1, cost: { wood: 20, gold: 15 },
      place: { on: ['grass', 'rock'], near: ['rock'] }, popCost: 2, prod: { res: 'stone', base: 1.5, interval: 6 },
      adj: [{ target: 'rock', kind: 'terrain', mult: 0.5, radius: 1 }] },
    { id: 'market', name: 'Market', glyph: '🪙', color: '#e0b15a', age: 1, cost: { wood: 30, stone: 10 },
      place: { on: ['grass'] }, popCost: 1, prod: { res: 'gold', base: 3, interval: 5 },
      adj: [{ target: 'house', kind: 'building', mult: 0.20, radius: 2 }] },
    { id: 'library', name: 'Library', glyph: '📜', color: '#b06fae', age: 1, cost: { wood: 30, stone: 15 },
      place: { on: ['grass'] }, popCost: 1, prod: { res: 'know', base: 1, interval: 7 },
      adj: [{ target: 'house', kind: 'building', mult: 0.15, radius: 2 }] },
    { id: 'granary', name: 'Granary', glyph: '🏚️', color: '#bfa46a', age: 1, cost: { wood: 25, stone: 10 },
      place: { on: ['grass'] }, cap: { food: 300, wood: 200 } },

    // --- Age III — Roman City ---
    { id: 'insula', name: 'Insula', glyph: '🏘️', color: '#cf7f44', age: 2, cost: { stone: 40, gold: 20 },
      place: { on: ['grass', 'sand'] }, pop: 12, prod: { res: 'gold', base: 4, interval: 6 },
      adj: [{ target: 'insula', kind: 'building', mult: 0.10, radius: 1 }] },
    { id: 'aqueduct', name: 'Aqueduct', glyph: '💧', color: '#9fc7d8', age: 2, cost: { stone: 60, gold: 30 },
      place: { on: ['grass'] }, cap: { food: 400, know: 200 } },
    { id: 'forum', name: 'Forum', glyph: '🏛️', color: '#e8d6a0', age: 2, cost: { stone: 80, wood: 40, gold: 50 },
      place: { on: ['grass'] }, landmark: true, prod: { res: 'know', base: 3, interval: 6 },
      adj: [{ target: 'house', kind: 'building', mult: 0.10, radius: 2 },
            { target: 'insula', kind: 'building', mult: 0.10, radius: 2 }] },
    { id: 'colosseum', name: 'Colosseum', glyph: '🏟️', color: '#d8c08a', age: 2, cost: { stone: 120, gold: 80 },
      place: { on: ['grass'] }, landmark: true, prod: { res: 'gold', base: 6, interval: 5 },
      adj: [{ target: 'house', kind: 'building', mult: 0.08, radius: 3 },
            { target: 'insula', kind: 'building', mult: 0.08, radius: 3 }] }
  ];
  var DEF = {};
  for (var _i = 0; _i < CATALOG.length; _i++) DEF[CATALOG[_i].id] = CATALOG[_i];
  function defOf(id) { return DEF[id]; }

  var RES_KEYS = ['food', 'wood', 'stone', 'gold', 'know'];
  var CAP_BASE = { food: 200, wood: 200, stone: 200, gold: 500, know: 100 };
  var AGE_NAMES = ['Age I · Founding', 'Age II · Village', 'Age III · Roman City'];

  // requirement to advance FROM the given age (knowledge is spent on advancing)
  var ADV_REQ = [
    { know: 40,  pop: 9,  prod: 3 },   // Age I  -> II
    { know: 120, pop: 24, prod: 6 },   // Age II -> III
    null                                // Age III is the summit (for now)
  ];

  var MISSIONS = [
    { id: 'm_build',   text: 'Build 5 buildings',      target: 5,   reward: 30 },
    { id: 'm_pop',     text: 'Reach 15 population',     target: 15,  reward: 35 },
    { id: 'm_food',    text: 'Stockpile 150 food',      target: 150, reward: 30 },
    { id: 'm_know',    text: 'Gather 60 knowledge',     target: 60,  reward: 35 },
    { id: 'm_advance', text: 'Advance to a new age',    target: 1,   reward: 50 },
    { id: 'm_upgrade', text: 'Upgrade 3 buildings',     target: 3,   reward: 30 }
  ];

  // ---- DOM ----
  var canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  var wrap = document.querySelector('.board-wrap');
  var loader = document.getElementById('loader');
  var agePill = document.getElementById('age-pill');
  var questText = document.getElementById('quest-text');
  var panel = document.getElementById('panel');
  var panelTitle = document.getElementById('panel-title');
  var panelBody = document.getElementById('panel-body');
  var menuBtn = document.getElementById('menu');

  var particles = new Juice.Particles(), popups = new Juice.Popups();

  // ---- state ----
  var S = null;        // full game state (serialisable)
  var sel = null;      // selected {gx,gy}
  var seed = 0;

  // layout (screen mapping), recomputed on resize
  var CW = 0, CH = 0, DPR = 1, TW = 64, originX = 0, originY = 0;

  function defaultState(sd) {
    return {
      seed: sd,
      age: 0,                       // 0-indexed age (Age I = 0)
      tiles: genTiles(sd),
      res: { food: 20, wood: 20, stone: 0, gold: 50, know: 0 },
      cap: { food: 200, wood: 200, stone: 200, gold: 500, know: 100 },
      lastSeen: Date.now(),
      quests: [], questIdx: 0,
      created: Date.now()
    };
  }

  // ---------- terrain generation (deterministic) ----------
  function genTiles(sd) {
    var rnd = Retention.mulberry32(sd >>> 0);
    var rnd2 = Retention.mulberry32((sd ^ 0x9e3779b9) >>> 0);
    var raw = [], i, j;
    for (i = 0; i < GRID; i++) { raw[i] = []; for (j = 0; j < GRID; j++) raw[i][j] = rnd(); }
    // box-blur twice for smooth blobs
    function blur(src) {
      var out = [];
      for (i = 0; i < GRID; i++) {
        out[i] = [];
        for (j = 0; j < GRID; j++) {
          var s = 0, n = 0;
          for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) {
            var x = i + a, y = j + b;
            if (x >= 0 && x < GRID && y >= 0 && y < GRID) { s += src[x][y]; n++; }
          }
          out[i][j] = s / n;
        }
      }
      return out;
    }
    var h = blur(blur(raw));
    // radial island falloff + normalise
    var min = 1e9, max = -1e9, H = [];
    for (i = 0; i < GRID; i++) {
      H[i] = [];
      for (j = 0; j < GRID; j++) {
        var dx = (i - CENTER) / (CENTER + 0.5), dy = (j - CENTER) / (CENTER + 0.5);
        var d = Math.sqrt(dx * dx + dy * dy);
        var v = h[i][j] * 0.55 + (1 - d * d * 0.95) * 0.7;
        H[i][j] = v; if (v < min) min = v; if (v > max) max = v;
      }
    }
    var tiles = [];
    for (i = 0; i < GRID; i++) {
      tiles[i] = [];
      for (j = 0; j < GRID; j++) {
        var nv = (H[i][j] - min) / (max - min || 1);  // 0..1
        var type, level, forest = false;
        if (nv < 0.34) { type = 'water'; level = 0; }
        else if (nv < 0.42) { type = 'sand'; level = 1; }
        else if (nv > 0.78) { type = 'rock'; level = 3; }
        else { type = 'grass'; level = nv > 0.6 ? 2 : 1; forest = rnd2() > 0.62; }
        tiles[i][j] = { gx: i, gy: j, type: type, level: level, forest: forest, b: null };
      }
    }
    // The Age-I core (chebyshev radius <= 2) is a friendly grassy plateau; hills,
    // forest and coast are saved for the outer rings that the later ages reveal.
    for (i = 0; i < GRID; i++) for (j = 0; j < GRID; j++) {
      var t = tiles[i][j];
      var ring = Math.max(Math.abs(i - CENTER), Math.abs(j - CENTER));
      if (ring <= AGE_UNLOCK_R[0]) {
        t.type = 'grass';
        t.level = (rnd() < 0.7) ? 1 : 0;
        t.forest = (ring >= 2 && rnd2() > 0.72); // a few trees only at the rim of the core
      }
    }
    // keep the very center clear (the founding plaza)
    var c = tiles[CENTER][CENTER]; c.type = 'grass'; c.level = 1; c.forest = false;
    return tiles;
  }

  function tileAt(gx, gy) { return (S.tiles[gx] && S.tiles[gx][gy]) || null; }
  function unlockR() { return AGE_UNLOCK_R[Math.min(S.age, AGE_UNLOCK_R.length - 1)]; }
  function isUnlocked(t) {
    return Math.max(Math.abs(t.gx - CENTER), Math.abs(t.gy - CENTER)) <= unlockR();
  }
  function isBuildable(t) {
    return t && isUnlocked(t) && t.type !== 'water' && !t.b;
  }

  // ---------- economy engine ----------
  var pop = 0, popUsed = 0, eff = 1;   // derived (recomputed; not serialised)

  // count neighbours of a tile matching a target terrain/building within chebyshev radius
  function countNbr(t, target, kind, radius) {
    var n = 0;
    for (var di = -radius; di <= radius; di++) for (var dj = -radius; dj <= radius; dj++) {
      if (di === 0 && dj === 0) continue;
      var o = tileAt(t.gx + di, t.gy + dj);
      if (!o) continue;
      if (kind === 'terrain') {
        if (target === 'forest') { if (o.forest) n++; }
        else if (o.type === target) n++;
      } else { // building
        if (o.b && o.b.id === target) n++;
      }
    }
    return n;
  }

  // adjacency -> { mult, flat } for a building on tile t
  function adjStats(t, def) {
    var mult = 1, flat = 0, rules = def.adj || [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i], c = countNbr(t, r.target, r.kind, r.radius || 1);
      if (!c) continue;
      if (r.mult) mult += r.mult * c;
      if (r.flat) flat += r.flat * c;
    }
    return { mult: mult, flat: flat };
  }

  // production rate (units/sec) of the building on tile t for its resource
  function rateOf(t) {
    var def = t.b && defOf(t.b.id);
    if (!def || !def.prod) return 0;
    var lvl = t.b.level || 1;
    var a = adjStats(t, def);
    var perInterval = (def.prod.base * a.mult + a.flat) * lvl;   // level scales output
    var rate = perInterval / def.prod.interval;
    if (def.popCost > 0) rate *= eff;                            // labour-limited
    return rate;
  }

  function eachBuilding(fn) {
    for (var i = 0; i < GRID; i++) for (var j = 0; j < GRID; j++) {
      var t = S.tiles[i][j]; if (t.b) fn(t, defOf(t.b.id));
    }
  }

  // recompute population, labour efficiency, and storage caps from placed buildings
  function recompute() {
    pop = 0; popUsed = 0;
    var capMul = 1 + S.age * 0.6;   // caps grow each age
    var cap = {};
    for (var ci = 0; ci < RES_KEYS.length; ci++) cap[RES_KEYS[ci]] = Math.round(CAP_BASE[RES_KEYS[ci]] * capMul);
    eachBuilding(function (t, def) {
      var lvl = t.b.level || 1;
      if (def.pop) pop += def.pop * lvl;
      if (def.popCost) popUsed += def.popCost;
      if (def.cap) for (var k in def.cap) if (cap[k] != null) cap[k] += def.cap[k] * lvl;
    });
    eff = popUsed > 0 ? clamp(pop / popUsed, 0, 1) : 1;
    S.cap = cap;
    // clamp stored resources to (possibly lowered) caps
    for (var r = 0; r < RES_KEYS.length; r++) {
      var key = RES_KEYS[r];
      if (S.res[key] > cap[key]) S.res[key] = cap[key];
    }
  }

  function affordable(def) {
    var c = def.cost || {};
    for (var k in c) if ((S.res[k] || 0) < c[k]) return false;
    return true;
  }
  function nearOk(t, def) {
    if (!def.place || !def.place.near) return true;
    for (var i = 0; i < def.place.near.length; i++) {
      if (countNbr(t, def.place.near[i], 'terrain', 1) > 0) return true;
    }
    return false;
  }
  function placeOk(t, def) {
    return def.place && def.place.on && def.place.on.indexOf(t.type) >= 0;
  }
  // why a building can't be placed here (null === ok)
  function buildBlock(t, id) {
    var def = defOf(id);
    if (!def) return 'unknown';
    if (!t) return 'no tile';
    if (def.age > S.age) return 'locked age';
    if (!isUnlocked(t)) return 'locked tile';
    if (t.b) return 'occupied';
    if (t.type === 'water') return 'water';
    if (!placeOk(t, def)) return 'terrain';
    if (!nearOk(t, def)) return 'needs ' + def.place.near.join('/');
    if (!affordable(def)) return 'cost';
    return null;
  }
  function canBuild(gx, gy, id) { return buildBlock(tileAt(gx, gy), id) === null; }

  function build(gx, gy, id) {
    var t = tileAt(gx, gy), def = defOf(id);
    if (buildBlock(t, id) !== null) return false;
    var c = def.cost || {};
    for (var k in c) S.res[k] -= c[k];
    t.b = { id: id, level: 1 };
    recompute(); mission('m_build', 1); save();
    return true;
  }

  // accrue production for `sec` seconds into the store, clamped to caps. Returns gains.
  function accrue(sec) {
    if (!(sec > 0)) return {};
    var gained = {};
    eachBuilding(function (t, def) {
      if (!def.prod) return;
      var r = rateOf(t); if (r <= 0) return;
      gained[def.prod.res] = (gained[def.prod.res] || 0) + r * sec;
    });
    for (var k in gained) S.res[k] = clamp((S.res[k] || 0) + gained[k], 0, S.cap[k]);
    return gained;
  }

  // total production rate per resource (units/sec) — for HUD/preview
  function ratesPerSec() {
    var out = { food: 0, wood: 0, stone: 0, gold: 0, know: 0 };
    eachBuilding(function (t, def) { if (def.prod) out[def.prod.res] += rateOf(t); });
    return out;
  }

  // preview for the build menu / ghost: cost, resulting rate, blocker
  function buildPreview(gx, gy, id) {
    var t = tileAt(gx, gy), def = defOf(id);
    if (!def) return null;
    var block = buildBlock(t, id);
    var rate = 0;
    if (def.prod && t && t.type !== 'water') {
      var a = adjStats(t, def);
      var perInterval = def.prod.base * a.mult + a.flat;
      rate = perInterval / def.prod.interval;  // unscaled by eff (preview shows potential)
    }
    return { ok: block === null, block: block, cost: def.cost || {}, prod: def.prod || null,
             rate: rate, pop: def.pop || 0, popCost: def.popCost || 0 };
  }

  // ---------- layout / iso projection ----------
  function bbox(tw, fitRing) {
    var half = tw / 2, quart = tw * 0.25, zs = tw * 0.30, base = tw * 0.16;
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (var i = 0; i < GRID; i++) for (var j = 0; j < GRID; j++) {
      if (Math.max(Math.abs(i - CENTER), Math.abs(j - CENTER)) > fitRing) continue;
      var t = S.tiles[i][j];
      var isoX = (i - j) * half, isoY = (i + j) * quart;
      var cy = isoY - t.level * zs, faceH = t.level * zs + base;
      if (isoX - half < minX) minX = isoX - half;
      if (isoX + half > maxX) maxX = isoX + half;
      if (cy - quart < minY) minY = cy - quart;
      if (cy + quart + faceH > maxY) maxY = cy + quart + faceH;
    }
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function layout() {
    var bw = wrap.clientWidth || 360, bh = wrap.clientHeight || 520;
    CW = Math.max(240, bw); CH = Math.max(320, bh);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR);
    canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!S) return;
    // fit the camera to the unlocked area + one ring of sea; zooms out as ages expand
    var fr = Math.min(GRID - 1, unlockR() + 1);
    var b0 = bbox(100, fr);
    var availW = CW * 0.94, availH = CH * 0.78;
    var scale = Math.min(availW / (b0.maxX - b0.minX), availH / (b0.maxY - b0.minY));
    TW = 100 * scale;
    var b = bbox(TW, fr);
    originX = CW / 2 - (b.minX + b.maxX) / 2;
    originY = CH / 2 - (b.minY + b.maxY) / 2;
  }

  function isoOf(t) {
    var half = TW / 2, quart = TW * 0.25, zs = TW * 0.30;
    return {
      x: originX + (t.gx - t.gy) * half,
      y: originY + (t.gx + t.gy) * quart - t.level * zs
    };
  }

  // ---------- rendering ----------
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
    return 'rgb(' + clamp(r, 0, 255) + ',' + clamp(g, 0, 255) + ',' + clamp(b, 0, 255) + ')';
  }

  function drawTile(t) {
    var p = isoOf(t), half = TW / 2, quart = TW * 0.25, zs = TW * 0.30, base = TW * 0.16;
    var locked = !isUnlocked(t);
    var type = locked ? 'water' : t.type;
    var topCol = TER[type].top;
    var faceH = (locked ? 0 : t.level) * zs + base;
    var cx = p.x, cy = locked ? originY + (t.gx + t.gy) * quart : p.y;

    // side faces (front-left + front-right)
    ctx.beginPath();
    ctx.moveTo(cx - half, cy);          // L
    ctx.lineTo(cx, cy + quart);         // B
    ctx.lineTo(cx, cy + quart + faceH);
    ctx.lineTo(cx - half, cy + faceH);
    ctx.closePath();
    ctx.fillStyle = shade(topCol, 0.62); ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx, cy + quart);         // B
    ctx.lineTo(cx + half, cy);          // R
    ctx.lineTo(cx + half, cy + faceH);
    ctx.lineTo(cx, cy + quart + faceH);
    ctx.closePath();
    ctx.fillStyle = shade(topCol, 0.80); ctx.fill();

    // top diamond
    ctx.beginPath();
    ctx.moveTo(cx, cy - quart);         // T
    ctx.lineTo(cx + half, cy);          // R
    ctx.lineTo(cx, cy + quart);         // B
    ctx.lineTo(cx - half, cy);          // L
    ctx.closePath();
    if (type === 'water') {
      var sh = REDUCED ? 0 : (Math.sin(clock * 1.5 + (t.gx + t.gy) * 0.7) * 0.5 + 0.5);
      var g = ctx.createLinearGradient(cx, cy - quart, cx, cy + quart);
      g.addColorStop(0, shade('#8fd0e6', 0.95 + sh * 0.10)); g.addColorStop(1, '#5aa6c8');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = topCol;
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.10)'; ctx.lineWidth = 1; ctx.stroke();

    if (locked) {
      // faint "fog" over land-to-be
      ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fill();
      return;
    }

    // decorations
    if (t.forest) drawTrees(cx, cy, half, quart);
    if (t.type === 'rock') drawRocks(cx, cy, half, quart);

    // building (later phases)
    if (t.b) drawBuilding(t, cx, cy, half, quart);

    // selection highlight
    if (sel && sel.gx === t.gx && sel.gy === t.gy) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - quart); ctx.lineTo(cx + half, cy);
      ctx.lineTo(cx, cy + quart); ctx.lineTo(cx - half, cy); ctx.closePath();
      ctx.strokeStyle = '#fff7ea'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.strokeStyle = 'rgba(224,177,90,.9)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  function drawTrees(cx, cy, half, quart) {
    var spots = [[-0.22, -0.04], [0.18, 0.02], [-0.02, 0.16]];
    for (var i = 0; i < spots.length; i++) {
      var tx = cx + spots[i][0] * TW, ty = cy + spots[i][1] * quart * 2;
      var r = TW * 0.10;
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      ctx.beginPath(); ctx.ellipse(tx, ty + r * 0.5, r * 0.7, r * 0.3, 0, 0, 6.28); ctx.fill();
      ctx.fillStyle = '#5a3a22';
      ctx.fillRect(tx - r * 0.12, ty - r * 0.2, r * 0.24, r * 0.7);
      ctx.fillStyle = '#3f8f57';
      ctx.beginPath(); ctx.moveTo(tx, ty - r * 1.5); ctx.lineTo(tx + r * 0.8, ty); ctx.lineTo(tx - r * 0.8, ty); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4fa869';
      ctx.beginPath(); ctx.moveTo(tx, ty - r * 1.9); ctx.lineTo(tx + r * 0.6, ty - r * 0.6); ctx.lineTo(tx - r * 0.6, ty - r * 0.6); ctx.closePath(); ctx.fill();
    }
  }

  function drawRocks(cx, cy, half, quart) {
    ctx.fillStyle = '#7f8893';
    ctx.beginPath(); ctx.ellipse(cx, cy, TW * 0.16, TW * 0.09, 0, 0, 6.28); ctx.fill();
    ctx.fillStyle = '#b6bdc6';
    ctx.beginPath(); ctx.ellipse(cx - TW * 0.04, cy - TW * 0.03, TW * 0.09, TW * 0.05, 0, 0, 6.28); ctx.fill();
  }

  // a small extruded iso block per building, topped with its glyph
  function drawBuilding(t, cx, cy, half, quart) {
    var b = t.b, d = defOf(b.id), lvl = b.level || 1;
    var col = (d && d.color) || '#c9772f';
    var hw = half * 0.52, q2 = quart * 0.52;
    var h = TW * (0.40 + 0.10 * (lvl - 1)) + (d && d.landmark ? TW * 0.18 : 0);

    // contact shadow
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath(); ctx.ellipse(cx, cy + q2 * 0.5, hw * 1.05, q2 * 1.05, 0, 0, 6.28); ctx.fill();

    // left face
    ctx.fillStyle = shade(col, 0.66);
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy); ctx.lineTo(cx, cy + q2);
    ctx.lineTo(cx, cy + q2 - h); ctx.lineTo(cx - hw, cy - h); ctx.closePath(); ctx.fill();
    // right face
    ctx.fillStyle = shade(col, 0.82);
    ctx.beginPath();
    ctx.moveTo(cx, cy + q2); ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx + hw, cy - h); ctx.lineTo(cx, cy + q2 - h); ctx.closePath(); ctx.fill();
    // roof (top diamond)
    ctx.fillStyle = shade(col, 1.08 > 1 ? 1 : 1.08);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(cx, cy - q2 - h); ctx.lineTo(cx + hw, cy - h);
    ctx.lineTo(cx, cy + q2 - h); ctx.lineTo(cx - hw, cy - h); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = 1; ctx.stroke();

    // glyph on the front
    ctx.font = (TW * 0.30) + 'px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d ? d.glyph : '🏠', cx, cy - h * 0.42);

    // level pips
    if (lvl > 1) {
      for (var i = 0; i < lvl; i++) {
        ctx.fillStyle = '#fff7ea';
        ctx.beginPath(); ctx.arc(cx - hw * 0.5 + i * (TW * 0.10), cy + q2 - h - TW * 0.06, TW * 0.028, 0, 6.28); ctx.fill();
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    if (!S) return;
    // soft ground shadow under the island
    // painter's order: increasing gx+gy
    for (var s = 0; s <= 2 * (GRID - 1); s++) {
      for (var i = 0; i < GRID; i++) {
        var j = s - i;
        if (j < 0 || j >= GRID) continue;
        drawTile(S.tiles[i][j]);
      }
    }
    particles.draw(ctx); popups.draw(ctx);

    if (sweep > 0) {
      var x = CW * (1.4 * (1 - sweep) - 0.2);
      var g = ctx.createLinearGradient(x - CW * 0.35, 0, x + CW * 0.35, 0);
      g.addColorStop(0, 'rgba(224,177,90,0)');
      g.addColorStop(0.5, 'rgba(255,242,205,' + (0.55 * sweep) + ')');
      g.addColorStop(1, 'rgba(224,177,90,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
    }
  }

  // ---------- picking ----------
  function pickTile(px, py) {
    // reverse painter order: front-most (largest gx+gy) first
    for (var s = 2 * (GRID - 1); s >= 0; s--) {
      for (var i = GRID - 1; i >= 0; i--) {
        var j = s - i;
        if (j < 0 || j >= GRID) continue;
        var t = S.tiles[i][j], p = isoOf(t), half = TW / 2, quart = TW * 0.25;
        var dx = Math.abs(px - p.x) / half, dy = Math.abs(py - p.y) / quart;
        if (dx + dy <= 1) return t;
      }
    }
    return null;
  }

  // ---------- panel: build menu / inspector / tile info ----------
  var MAXLVL = 3;
  var RES_ICON = { food: '🌾', wood: '🪵', stone: '⛏️', gold: '🪙', know: '📜' };

  function fmtCost(cost) {
    var parts = []; for (var k in cost) parts.push(RES_ICON[k] + cost[k]);
    return parts.join('  ') || 'free';
  }
  function perMin(rate) { return Math.round(rate * 60 * 10) / 10; }
  function blockLabel(b) {
    return ({ cost: 'Need resources', terrain: 'Wrong ground', occupied: 'Occupied', water: 'On water',
      'locked age': 'Later age', 'locked tile': 'Locked' })[b] || (b && b.indexOf('needs') === 0 ? 'Needs hills' : b);
  }

  function openPanel(t) {
    sel = { gx: t.gx, gy: t.gy };
    if (t.b) renderInspector(t);
    else if (isUnlocked(t) && t.type !== 'water') renderBuildMenu(t);
    else renderTileInfo(t);
    panel.classList.remove('hidden');
  }
  function refreshPanel() { if (sel) { var t = tileAt(sel.gx, sel.gy); if (t) openPanel(t); } }
  function closePanel() { panel.classList.add('hidden'); sel = null; }

  function renderTileInfo(t) {
    panelTitle.textContent = TER[t.type].name + (t.forest ? ' · Forest' : '');
    var msg = !isUnlocked(t) ? 'Locked land — a later age will reveal and settle it.'
      : (t.type === 'water' ? 'Open water. Docks and fishing come later.' : 'Nothing can be built here.');
    panelBody.innerHTML = '<div class="panel-note">' + msg + '</div>';
  }

  function renderBuildMenu(t) {
    panelTitle.textContent = 'Build';
    var html = '';
    for (var i = 0; i < CATALOG.length; i++) {
      var d = CATALOG[i];
      if (d.age > S.age) continue;
      var pv = buildPreview(t.gx, t.gy, d.id), dis = !pv.ok;
      var out;
      if (d.prod) out = RES_ICON[d.prod.res] + ' ' + perMin(pv.rate) + '/min';
      else if (d.pop) out = '👥 +' + d.pop;
      else if (d.cap) { var ck = Object.keys(d.cap)[0]; out = '📦 +' + d.cap[ck] + ' ' + RES_ICON[ck]; }
      else out = '';
      var note = dis ? blockLabel(pv.block) : out;
      html += '<div class="bcard' + (dis ? ' disabled' : '') + '" data-id="' + d.id + '">'
        + '<div class="bg-ico">' + d.glyph + '</div>'
        + '<div class="bg-name">' + d.name + '</div>'
        + '<div class="bg-cost">' + fmtCost(d.cost) + '</div>'
        + '<div class="bg-out" style="' + (dis ? 'color:var(--bad)' : '') + '">' + note + '</div>'
        + '</div>';
    }
    panelBody.innerHTML = html;
    var cards = panelBody.querySelectorAll('.bcard');
    for (var c = 0; c < cards.length; c++) (function (card) {
      card.addEventListener('click', function () {
        var id = card.getAttribute('data-id');
        if (build(t.gx, t.gy, id)) {
          Juice.Audio.play('pop'); Juice.vibrate(12); buildFx(t);
          renderHUD(); checkQuests(); refreshPanel();
        }
      });
    })(cards[c]);
  }

  function upgradeCost(t) {
    var d = defOf(t.b.id), lvl = t.b.level || 1;
    if (lvl >= MAXLVL) return null;
    var c = {}, base = d.cost || {};
    for (var k in base) c[k] = Math.ceil(base[k] * lvl * 1.2);
    return c;
  }
  function affordableCost(c) { for (var k in c) if ((S.res[k] || 0) < c[k]) return false; return true; }

  function renderInspector(t) {
    var d = defOf(t.b.id), lvl = t.b.level || 1;
    panelTitle.textContent = d.name + (lvl > 1 ? ' · Lv ' + lvl : '');
    var rows = [];
    if (d.prod) rows.push(RES_ICON[d.prod.res] + ' <b>' + perMin(rateOf(t)) + '/min</b>' + (d.popCost && eff < 1 ? ' <span style="color:var(--bad)">(short on workers)</span>' : ''));
    if (d.pop) rows.push('👥 +' + (d.pop * lvl) + ' population');
    if (d.popCost) rows.push('👷 needs ' + d.popCost + ' workers');
    if (d.cap) { var ck = Object.keys(d.cap)[0]; rows.push('📦 +' + (d.cap[ck] * lvl) + ' ' + RES_ICON[ck] + ' storage'); }
    var up = upgradeCost(t);
    var html = '<div class="panel-note">' + rows.join('<br>') + '</div><div class="panel-actions">';
    if (up) html += '<button class="pbtn" id="pb-up"' + (affordableCost(up) ? '' : ' disabled') + '>Upgrade → Lv ' + (lvl + 1) + ' &nbsp;·&nbsp; ' + fmtCost(up) + '</button>';
    else html += '<div class="panel-note" style="text-align:center">Max level reached</div>';
    html += '<button class="pbtn ghost" id="pb-demo">Demolish</button></div>';
    panelBody.innerHTML = html;
    var ub = document.getElementById('pb-up');
    if (ub) ub.addEventListener('click', function () {
      if (upgrade(t)) { Juice.Audio.play('score'); buildFx(t); renderHUD(); checkQuests(); refreshPanel(); }
    });
    var db = document.getElementById('pb-demo');
    if (db) db.addEventListener('click', function () { demolish(t); Juice.Audio.play('tap'); renderHUD(); closePanel(); });
  }

  function upgrade(t) {
    var c = upgradeCost(t); if (!c || !affordableCost(c)) return false;
    for (var k in c) S.res[k] -= c[k];
    t.b.level = (t.b.level || 1) + 1;
    recompute(); mission('m_upgrade', 1); save(); return true;
  }
  function demolish(t) {
    var d = defOf(t.b.id), base = d.cost || {};
    for (var k in base) if (k === 'wood' || k === 'stone' || k === 'gold') S.res[k] = clamp((S.res[k] || 0) + Math.floor(base[k] * 0.5), 0, S.cap[k]);
    t.b = null; recompute(); save();
  }

  function buildFx(t) {
    var p = isoOf(t);
    particles.burst(p.x, p.y - TW * 0.2, { count: 16, colors: ['#e0b15a', '#fff7ea', '#7cc28a'], speed: 150, life: 0.55, size: 4 });
  }

  // ---------- advisor quest chain (onboarding spine) ----------
  function countId(id) { var n = 0; eachBuilding(function (t, d) { if (d.id === id) n++; }); return n; }
  function countProducing() { var n = 0; eachBuilding(function (t, d) { if (d.prod && rateOf(t) > 0) n++; }); return n; }
  var QUESTS = [
    { id: 'hut', text: 'Tap the green plaza and build a Hut 🛖', short: 'First home', check: function () { return countId('hut') >= 1; }, reward: { wood: 15, gold: 10 } },
    { id: 'farm', text: 'Build a Farm 🌾 for food', short: 'Farming', check: function () { return countId('farm') >= 1; }, reward: { gold: 15 } },
    { id: 'food', text: 'Stockpile 50 🌾 food', short: 'Stockpile', check: function () { return S.res.food >= 50; }, reward: { wood: 20 } },
    { id: 'lumber', text: 'Build a Lumber Camp 🪵', short: 'Timber', check: function () { return countId('lumber') >= 1; }, reward: { gold: 20 } },
    { id: 'pop', text: 'Grow to 9 population 👥', short: 'A village', check: function () { return pop >= 9; }, reward: { gold: 30 } },
    { id: 'prod', text: 'Run 3 producing buildings', short: 'Industry', check: function () { return countProducing() >= 3; }, reward: { know: 10, gold: 20 } }
  ];
  function currentQuest() { return (S.questIdx < QUESTS.length) ? QUESTS[S.questIdx] : null; }
  function grantReward(rw) { if (!rw) return; for (var k in rw) S.res[k] = clamp((S.res[k] || 0) + rw[k], 0, S.cap[k]); recompute(); }
  function rewardLabel(rw) { var p = []; for (var k in rw) p.push(RES_ICON[k] + rw[k]); return p.join(' '); }
  function renderAdvisor() {
    if (canAdvance()) {
      questText.innerHTML = '⭐ Ready to advance to <b>' + nextAgeName() + '</b> — tap ☰';
      menuBtn.classList.add('ready');
      return;
    }
    menuBtn.classList.remove('ready');
    var q = currentQuest();
    questText.innerHTML = q ? q.text : 'Your city prospers — gather 📜 knowledge to advance the age (☰).';
  }
  function checkQuests() {
    var guard = 0, q;
    while ((q = currentQuest()) && q.check() && guard++ < 12) {
      grantReward(q.reward); S.questIdx++;
      Juice.Audio.play('score');
      Stage.toast(wrap, '✓ ' + q.short + '  +' + rewardLabel(q.reward), 1900);
      save();
    }
    renderAdvisor();
  }

  // ---------- ages / advancement ----------
  function sumLevels() { var n = 0; eachBuilding(function (t) { n += t.b.level || 1; }); return n; }
  function cityRating() { return S.age * 200 + pop * 4 + sumLevels() * 8 + countBuildings() * 6; }

  function advanceReq() { return ADV_REQ[Math.min(S.age, ADV_REQ.length - 1)]; }
  function canAdvance() {
    var r = advanceReq(); if (!r) return false;
    return S.res.know >= r.know && pop >= r.pop && countProducing() >= (r.prod || 0);
  }
  function advanceAge() {
    if (!canAdvance()) return false;
    var r = advanceReq();
    S.res.know -= r.know;
    S.age++;
    var stars = 1 + (pop >= r.pop * 1.5 ? 1 : 0) + (pop >= r.pop * 2.2 ? 1 : 0);
    recompute(); layout();                       // bigger caps + zoom out to reveal new land
    Progress.completeLevel(GAME, S.age, stars);
    Progress.addCoins(GAME, 30 * S.age);
    Retention.submitScore(GAME, cityRating());
    mission('m_advance', 1);
    Juice.Audio.play('win'); Juice.vibrate([20, 40, 20]); ageSweep();
    Stage.card({
      kicker: 'The city grows', title: AGE_NAMES[Math.min(S.age, AGE_NAMES.length - 1)],
      body: 'New land is settled and new buildings are available. Storage expands. +' + (30 * S.age) + ' 🪙',
      actions: [{ label: 'Continue', onClick: function () {} }]
    });
    renderHUD(); renderAdvisor(); save();
    return true;
  }
  function nextAgeName() { return AGE_NAMES[Math.min(S.age + 1, AGE_NAMES.length - 1)]; }

  // golden sweep across the board when an age advances
  var sweep = 0;
  function ageSweep() { sweep = REDUCED ? 0 : 1; }

  // ---------- daily missions / coins ----------
  function mission(id, amt, abs) {
    var m = Progress.bumpMission(GAME, id, amt, abs);
    if (m) Stage.toast(wrap, '★ ' + m.text + '  +' + m.reward + ' 🪙', 1900);
  }
  function bumpAbsMissions() {
    mission('m_pop', pop, true);
    mission('m_food', Math.floor(S.res.food), true);
    mission('m_know', Math.floor(S.res.know), true);
  }

  // ---------- City Hall menu ----------
  function showMenu() {
    var missions = Progress.dailyMissions(GAME, MISSIONS, 3);
    var r = advanceReq();
    var advHtml;
    if (!r) advHtml = '<div class="panel-note" style="text-align:center">You\'ve reached the height of the age. 🏛️</div>';
    else {
      var rows = [
        reqRow('📜 Knowledge', S.res.know, r.know),
        reqRow('👥 Population', pop, r.pop),
        reqRow('🏭 Producers', countProducing(), r.prod)
      ].join('');
      advHtml = '<div style="text-align:left;font-size:13px;margin:2px 0 4px;color:var(--muted)">Advance to <b style="color:var(--accent)">' + nextAgeName() + '</b> (spends 📜' + r.know + ')</div>' + rows;
    }
    var body =
      '<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted);margin:-4px 0 8px">'
      + '<span>🏅 Rating <b style="color:var(--text)">' + cityRating() + '</b></span>'
      + '<span>🪙 ' + Progress.coins(GAME) + '</span>'
      + '<span>🔥 ' + Retention.streak(GAME) + 'd</span></div>'
      + advHtml
      + '<div style="font-size:11px;letter-spacing:.12em;color:var(--muted);text-align:left;margin:12px 0 2px">DAILY MISSIONS</div>'
      + Stage.missionsHTML(missions);
    var actions = [];
    if (canAdvance()) actions.push({ label: 'Advance the Age ▲', onClick: advanceAge });
    actions.push({ label: 'New city', ghost: true, onClick: confirmReset });
    actions.push({ label: 'Close', ghost: true, onClick: function () {} });
    Stage.card({ kicker: 'City Hall', title: AGE_NAMES[Math.min(S.age, AGE_NAMES.length - 1)], body: body, actions: actions });
  }
  function reqRow(label, have, need) {
    var ok = have >= need;
    return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0">'
      + '<span>' + label + '</span><span style="color:' + (ok ? 'var(--good)' : 'var(--muted)') + '">'
      + Math.floor(have) + ' / ' + need + (ok ? ' ✓' : '') + '</span></div>';
  }
  function confirmReset() {
    Stage.card({
      kicker: 'Start over', title: 'Found a new city?',
      body: 'Your current city will be lost.',
      actions: [
        { label: 'Yes, start fresh', onClick: function () { Retention.set(GAME, 'save', null); newGame(); renderHUD(); renderAdvisor(); S.questIdx = 0; } },
        { label: 'Keep my city', ghost: true, onClick: showMenu }
      ]
    });
  }

  // ---------- offline ("while you were away") ----------
  function offlineWelcome() {
    var now = Date.now(), dt = clamp((now - (S.lastSeen || now)) / 1000, 0, 8 * 3600);
    if (dt < 30) return;
    var gains = accrue(dt); recompute();
    var parts = [];
    for (var k in gains) { var g = Math.floor(gains[k]); if (g > 0) parts.push(RES_ICON[k] + ' +' + g); }
    if (!parts.length) return;
    var mins = Math.round(dt / 60);
    Stage.card({
      kicker: 'Welcome back', title: 'While you were away',
      body: 'Over ' + (mins >= 60 ? Math.round(mins / 60) + 'h' : mins + ' min') + ' your city produced<br><b style="font-size:17px;color:var(--text)">' + parts.join('&nbsp; ') + '</b>',
      actions: [{ label: 'Collect', onClick: function () {} }]
    });
  }

  // ---------- save / load ----------
  function save() { if (S) { S.lastSeen = Date.now(); Retention.set(GAME, 'save', S); } }
  function load() {
    var raw = Retention.get(GAME, 'save', null);
    if (raw && raw.tiles && raw.tiles.length === GRID) { S = raw; seed = raw.seed; recompute(); return true; }
    return false;
  }

  function urlSeed() {
    try { var m = /[?&]seed=(\d+)/.exec(window.location.search); return m ? (+m[1] >>> 0) : null; }
    catch (e) { return null; }
  }
  function urlHas(name) { try { return new RegExp('[?&]' + name + '\\b').test(window.location.search); } catch (e) { return false; } }
  // dev showcase: populate a city (for screenshots only; behind ?demo[&age=N][&hall])
  function demoSetup() {
    var ap = /[?&]age=(\d)/.exec(window.location.search);
    if (ap) { S.age = +ap[1]; recompute(); layout(); }
    S.res = { food: 150, wood: 320, stone: 160, gold: 420, know: 70 }; recompute();
    var ur = unlockR(), spots = [];
    for (var i = 0; i < GRID; i++) for (var j = 0; j < GRID; j++) {
      var t = S.tiles[i][j];
      if (Math.max(Math.abs(i - CENTER), Math.abs(j - CENTER)) <= ur && t.type === 'grass' && !t.b) spots.push(t);
    }
    var plan = S.age >= 2 ? ['hut', 'farm', 'house', 'market', 'library', 'house', 'farm', 'insula', 'forum', 'hut', 'house', 'colosseum']
      : S.age >= 1 ? ['hut', 'farm', 'house', 'market', 'lumber', 'house', 'farm', 'library', 'hut']
      : ['hut', 'farm', 'hut', 'lumber', 'farm', 'hut'];
    var k = 0;
    for (var p = 0; p < plan.length && k < spots.length; p++) {
      while (k < spots.length && !build(spots[k].gx, spots[k].gy, plan[p])) k++;
      k++;
    }
    accrue(30); recompute(); renderHUD(); checkQuests(); renderAdvisor();
    if (urlHas('hall')) showMenu();
    else for (var m = 0; m < spots.length; m++) if (isBuildable(spots[m])) { openPanel(spots[m]); break; }
  }
  function newGame(sd) {
    seed = (sd == null) ? (Date.now() >>> 0) : (sd >>> 0);
    S = defaultState(seed);
    sel = null;
    recompute();
    layout();
    save();
  }

  // ---------- HUD ----------
  function renderHUD() {
    if (!S) return;
    var rt = ratesPerSec();
    for (var i = 0; i < RES_KEYS.length; i++) { var k = RES_KEYS[i]; setRes(k, S.res[k], S.cap[k], rt[k]); }
    setPopChip();
    var ageNames = ['Age I · Founding', 'Age II · Village', 'Age III · Roman City'];
    agePill.textContent = ageNames[Math.min(S.age, ageNames.length - 1)];
  }
  function setRes(key, v, cap, rate) {
    var el = document.getElementById('r-' + key);
    if (!el) return;
    var rv = el.querySelector('.rv');
    if (rv) rv.textContent = Math.floor(v) + '';
    var pct = clamp(v / (cap || 1), 0, 1) * 100;
    el.style.background = 'linear-gradient(90deg, rgba(224,177,90,.30) ' + pct + '%, rgba(0,0,0,.22) ' + pct + '%)';
    el.title = Math.floor(v) + ' / ' + Math.floor(cap) + (rate ? '  (+' + perMin(rate) + '/min)' : '');
  }
  function setPopChip() {
    var el = document.getElementById('r-pop');
    if (!el) return;
    var rv = el.querySelector('.rv');
    var short = popUsed > pop;
    if (rv) rv.textContent = pop + (short ? ' ⚠' : '');
    el.style.background = short ? 'rgba(255,90,90,.30)' : 'rgba(0,0,0,.22)';
    el.title = 'population ' + pop + ' · workers needed ' + popUsed;
  }

  // ---------- input ----------
  function cpt(clientX, clientY) {
    var b = canvas.getBoundingClientRect();
    return { x: (clientX - b.left) * (CW / b.width), y: (clientY - b.top) * (CH / b.height) };
  }
  canvas.addEventListener('pointerdown', function (e) {
    Juice.Audio.unlock && Juice.Audio.unlock();
    var p = cpt(e.clientX, e.clientY);
    var t = pickTile(p.x, p.y);
    if (t) { openPanel(t); Juice.Audio.play('tap'); }
    else { closePanel(); }
  });
  document.getElementById('panel-close').addEventListener('click', closePanel);
  menuBtn.addEventListener('click', showMenu);
  var muteBtn = document.getElementById('mute');
  muteBtn.addEventListener('click', function () {
    var m = Juice.Audio.toggleMute(); Retention.set(GAME, 'muted', m); Portal.mute(m);
    this.textContent = m ? '🔇' : '🔊';
  });

  // ---------- loop ----------
  var REDUCED = false;
  try { REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var clock = 0;

  var questT = 0, saveT = 0, fxT = 0;
  function update(dt) {
    clock += dt;
    particles.update(dt); popups.update(dt);
    if (sweep > 0) sweep = Math.max(0, sweep - dt * 0.7);
    if (!S) return;
    accrue(dt);                 // live production into the store (capped)
    questT -= dt;
    if (questT <= 0) { questT = 0.5; checkQuests(); bumpAbsMissions(); }
    saveT -= dt;
    if (saveT <= 0) { saveT = 5; save(); }   // periodic autosave keeps lastSeen fresh for offline calc
    fxT -= dt;
    if (fxT <= 0) { fxT = REDUCED ? 2.6 : 1.1; emitProducerFx(); }   // a living city: drifting resource motes
  }
  function emitProducerFx() {
    var prods = [];
    eachBuilding(function (t, d) { if (d.prod && rateOf(t) > 0) prods.push({ t: t, res: d.prod.res }); });
    if (!prods.length) return;
    var pk = prods[(Math.random() * prods.length) | 0], p = isoOf(pk.t);
    popups.add(p.x, p.y - TW * 0.55, RES_ICON[pk.res], { color: '#fff7ea', size: TW * 0.26, life: 1.1 });
  }

  // ---------- boot ----------
  function boot() {
    Portal.loadingStart();
    if (Retention.get(GAME, 'muted', false)) { Juice.Audio.setMuted(true); muteBtn.textContent = '🔇'; }
    Progress.dailyMissions(GAME, MISSIONS, 3);
    Retention.touchStreak(GAME);
    var us = urlSeed(), loaded = false;
    if (us != null) newGame(us);
    else loaded = load() || (newGame(), false);
    if (urlHas('demo')) demoSetup();
    layout(); renderHUD(); renderAdvisor();
    if (loaded && !urlHas('demo')) offlineWelcome();

    if (window.ResizeObserver) new ResizeObserver(function () { layout(); }).observe(wrap);
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', function () { setTimeout(layout, 200); });
    window.addEventListener('beforeunload', save);

    var last = performance.now();
    (function frame(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      update(dt); draw(); renderHUD();
      requestAnimationFrame(frame);
    })(performance.now());

    Portal.init().then(function () {
      Portal.loadingStop(); Portal.mute(Juice.Audio.isMuted());
      if (loader) loader.classList.add('hidden');
      Portal.gameStart();
      if (!urlHas('demo') && !Retention.get(GAME, 'taught', false)) {
        Retention.set(GAME, 'taught', true);
        Stage.card({
          kicker: 'Welcome to POLIS', title: 'Build through the ages',
          body: 'Tap a tile to <b>build</b>. Farms, lumber camps and houses produce over time — even while you’re away. Gather <b>📜 knowledge</b> to <b>advance the age</b> and watch your village grow into a Roman city.',
          actions: [{ label: 'Begin ▶', onClick: function () {} }]
        });
      }
    });
  }

  // ---------- headless test hook ----------
  window.__polis = {
    newGame: newGame,
    state: function () {
      return {
        seed: S.seed, age: S.age, res: JSON.parse(JSON.stringify(S.res)),
        cap: JSON.parse(JSON.stringify(S.cap)), pop: pop, popUsed: popUsed, eff: Math.round(eff * 100) / 100,
        rates: ratesPerSec(), unlockR: unlockR(),
        buildable: countBuildable(), buildings: countBuildings()
      };
    },
    tiles: function () { return S.tiles; },
    tile: function (gx, gy) { return tileAt(gx, gy); },
    isBuildable: function (gx, gy) { return isBuildable(tileAt(gx, gy)); },
    defs: function () { return CATALOG.map(function (d) { return d.id; }); },
    canBuild: canBuild,
    buildPreview: buildPreview,
    build: build,
    rateOf: function (gx, gy) { return rateOf(tileAt(gx, gy)); },
    rates: ratesPerSec,
    accrue: function (sec) { var g = accrue(sec); recompute(); return g; },
    recompute: recompute,
    canAdvance: canAdvance,
    advanceAge: advanceAge,
    rating: cityRating,
    setRes: function (o) { for (var k in o) S.res[k] = o[k]; recompute(); },  // test helper
    setAge: function (a) { S.age = a; recompute(); layout(); },               // test helper
    setLastSeen: function (ms) { S.lastSeen = ms; },                          // test helper (offline)
    offline: offlineWelcome,
    pick: function (gx, gy) { var t = tileAt(gx, gy); if (t) openPanel(t); return t; },
    save: save, load: load,
    _S: function () { return S; }
  };
  function countBuildable() { var n = 0; for (var i = 0; i < GRID; i++) for (var j = 0; j < GRID; j++) if (isBuildable(S.tiles[i][j])) n++; return n; }
  function countBuildings() { var n = 0; for (var i = 0; i < GRID; i++) for (var j = 0; j < GRID; j++) if (S.tiles[i][j].b) n++; return n; }

  boot();
})();
