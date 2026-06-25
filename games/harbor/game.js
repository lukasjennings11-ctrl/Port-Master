/* HARBOR — a living side-on port (Phase 1: the LOOK SLICE).
 *
 * Pure procedural canvas: parallax sky + day/night cycle, animated water (waves,
 * sun/moon glitter, reflections), a docked container ship, a working gantry crane
 * that cycles containers, warehouses, a lighthouse, and a city skyline whose
 * windows light up at dusk. Drag to pan. No gameplay yet — this exists to set the
 * visual bar before the systems are built on top.
 *
 * URL params for screenshots: ?tod=0.78 (time of day 0..1), ?pan=0.5, ?still
 * Shared: juice.js, retention.js, portal.js, progression.js, stage.js.
 */
(function () {
  'use strict';

  var GAME = 'harbor';
  var clamp = Juice.clamp, lerp = Juice.lerp, TAU = Math.PI * 2;

  // ---- DOM ----
  var canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  var wrap = document.querySelector('.board-wrap');
  var loader = document.getElementById('loader');
  var clockEl = document.getElementById('clock');
  var hintEl = document.getElementById('hint');

  // ---- view ----
  var CW = 0, CH = 0, DPR = 1;
  var WORLDW = 1700;                 // logical width of the slice world
  var panX = 0, panTarget = 0, HERO_X = 430, userPanned = false;
  var tod = 0.30;                    // time of day 0..1 (0=midnight, .5=noon)
  var TOD_SPEED = 1 / 130;           // full day per ~130s
  var paused = false, clock = 0;

  // scene layout (recomputed on layout)
  var horizonY = 0, quayY = 0, scale = 1;

  function layout() {
    var bw = wrap.clientWidth || 360, bh = wrap.clientHeight || 560;
    CW = Math.max(240, bw); CH = Math.max(320, bh);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR);
    canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    horizonY = CH * 0.42;
    quayY = CH * 0.66;               // waterline / top of the dock
    scale = clamp(CH / 640, 0.7, 1.6);
    var maxPan = Math.max(0, WORLDW - CW);
    if (!userPanned) { panX = panTarget = clamp(HERO_X - CW / 2, 0, maxPan); }   // frame the hero berth on load
    panX = clamp(panX, 0, maxPan);
    panTarget = clamp(panTarget, 0, maxPan);
  }

  // ---- colour helpers ----
  function hx(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rgb(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a == null ? 1 : a) + ')'; }

  // day/night keyframes: t, skyTop, skyBottom(horizon), darkness(0 day..1 night)
  var SKY = [
    { t: 0.00, top: '#0a1330', bot: '#152648', dark: 1.0 },
    { t: 0.20, top: '#243a6e', bot: '#7d5a8c', dark: 0.75 },
    { t: 0.26, top: '#5a86c4', bot: '#f0a563', dark: 0.25 },
    { t: 0.40, top: '#5fa6e6', bot: '#bfe6f5', dark: 0.0 },
    { t: 0.60, top: '#5fa6e6', bot: '#cfeaf6', dark: 0.0 },
    { t: 0.72, top: '#3f5fa0', bot: '#ffb066', dark: 0.25 },
    { t: 0.80, top: '#243a6e', bot: '#c0604e', dark: 0.7 },
    { t: 0.90, top: '#101c44', bot: '#1f2a55', dark: 0.95 },
    { t: 1.00, top: '#0a1330', bot: '#152648', dark: 1.0 }
  ];
  function skyAt(t) {
    for (var i = 0; i < SKY.length - 1; i++) {
      if (t >= SKY[i].t && t <= SKY[i + 1].t) {
        var f = (t - SKY[i].t) / (SKY[i + 1].t - SKY[i].t || 1);
        return {
          top: mix(hx(SKY[i].top), hx(SKY[i + 1].top), f),
          bot: mix(hx(SKY[i].bot), hx(SKY[i + 1].bot), f),
          dark: lerp(SKY[i].dark, SKY[i + 1].dark, f)
        };
      }
    }
    return { top: hx(SKY[0].top), bot: hx(SKY[0].bot), dark: SKY[0].dark };
  }

  // ---- deterministic noise for stars/glitter (stable per frame seed) ----
  function rnd(n) { var x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }

  // ===================== RENDER =====================
  var sky;   // current sky sample

  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, quayY);
    g.addColorStop(0, rgb(sky.top)); g.addColorStop(1, rgb(sky.bot));
    ctx.fillStyle = g; ctx.fillRect(0, 0, CW, quayY + 2);
    // stars
    if (sky.dark > 0.2) {
      ctx.fillStyle = rgb([255, 255, 255], (sky.dark - 0.2) * 0.9);
      for (var i = 0; i < 70; i++) {
        var sx = rnd(i * 1.3) * CW, sy = rnd(i * 2.7) * horizonY;
        var tw = 0.5 + 0.5 * Math.sin(clock * 2 + i);
        ctx.globalAlpha = (sky.dark - 0.2) * (0.4 + 0.6 * tw);
        ctx.fillRect(sx, sy, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    }
  }

  // sun/moon — screen-space arc; returns {x,y,sun}
  function lightSource() {
    // sun rises ~0.22, sets ~0.78
    var sunUp = tod > 0.22 && tod < 0.78;
    var f = sunUp ? (tod - 0.22) / 0.56 : ((tod < 0.22 ? tod + 1 : tod) - 0.78) / 0.44;
    var x = f * CW;
    var y = horizonY - Math.sin(clamp(f, 0, 1) * Math.PI) * (horizonY * 0.78) + horizonY * 0.06;
    return { x: x, y: y, sun: sunUp };
  }
  function drawSunMoon(ls) {
    ctx.save();
    if (ls.sun) {
      var r = 26 * scale;
      var g = ctx.createRadialGradient(ls.x, ls.y, 0, ls.x, ls.y, r * 4);
      g.addColorStop(0, 'rgba(255,240,200,.6)'); g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ls.x, ls.y, r * 4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff4d6'; ctx.beginPath(); ctx.arc(ls.x, ls.y, r, 0, TAU); ctx.fill();
    } else {
      var mr = 18 * scale;
      ctx.fillStyle = 'rgba(225,235,255,' + (0.4 + sky.dark * 0.6) + ')';
      ctx.beginPath(); ctx.arc(ls.x, ls.y, mr, 0, TAU); ctx.fill();
      ctx.fillStyle = rgb(sky.top, 0.5);
      ctx.beginPath(); ctx.arc(ls.x + mr * 0.4, ls.y - mr * 0.35, mr * 0.85, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawClouds() {
    var n = 5, baseA = 0.18 + (1 - sky.dark) * 0.22;
    for (var i = 0; i < n; i++) {
      var cx = ((clock * (4 + i * 2) + i * 480) % (CW + 300)) - 150;
      var cy = horizonY * (0.22 + 0.13 * i);
      var w = (120 + i * 40) * scale, h = w * 0.34;
      ctx.fillStyle = rgb(mix(sky.top, [255, 255, 255], 0.55), baseA);
      blob(cx, cy, w, h);
    }
  }
  function blob(x, y, w, h) {
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.5, h * 0.5, 0, 0, TAU);
    ctx.ellipse(x - w * 0.28, y + h * 0.1, w * 0.3, h * 0.4, 0, 0, TAU);
    ctx.ellipse(x + w * 0.3, y + h * 0.08, w * 0.32, h * 0.42, 0, 0, TAU);
    ctx.fill();
  }

  // distant city skyline (parallax 0.35), bases at quayY
  var SKYLINE = [];
  function buildSkyline() {
    SKYLINE = [];
    var x = 0;
    while (x < WORLDW) {
      var w = 40 + rnd(x) * 70, h = 60 + rnd(x * 3.1) * 190;
      SKYLINE.push({ x: x, w: w, h: h, tone: 0.3 + rnd(x * 1.7) * 0.4 });
      x += w + 6 + rnd(x * 2.3) * 20;
    }
  }
  function drawSkyline() {
    var par = 0.4, baseCol = mix(sky.bot, sky.top, 0.5);
    for (var i = 0; i < SKYLINE.length; i++) {
      var b = SKYLINE[i], sx = b.x * par - panX * par;
      if (sx + b.w < -20 || sx > CW + 20) continue;
      var col = mix(baseCol, [20, 30, 50], 0.5 + b.tone * 0.3);
      // haze: fade with darkness less
      ctx.fillStyle = rgb(col, 0.9);
      ctx.fillRect(sx, quayY - b.h * scale, b.w * scale, b.h * scale);
      // windows lit at night
      if (sky.dark > 0.25) {
        for (var wy = quayY - b.h * scale + 10; wy < quayY - 8; wy += 12 * scale) {
          for (var wx = sx + 5; wx < sx + b.w * scale - 5; wx += 10 * scale) {
            if (rnd(wx * 0.7 + wy * 1.3 + i) > 0.45) {
              ctx.fillStyle = rgb([255, 214, 130], (sky.dark - 0.25) * (0.5 + 0.5 * rnd(wx + wy)));
              ctx.fillRect(wx, wy, 4 * scale, 5 * scale);
            }
          }
        }
      }
    }
  }

  // ---- water ----
  function drawSea(ls) {
    var topC = mix(sky.bot, [10, 40, 60], 0.45), deepC = mix([8, 24, 38], sky.top, 0.15);
    var g = ctx.createLinearGradient(0, quayY, 0, CH);
    g.addColorStop(0, rgb(topC)); g.addColorStop(1, rgb(deepC));
    ctx.fillStyle = g; ctx.fillRect(0, quayY, CW, CH - quayY);

    // sun/moon glitter column
    var gx = ls.x;
    var glow = ls.sun ? 'rgba(255,240,200,' : 'rgba(220,235,255,';
    for (var i = 0; i < 90; i++) {
      var yy = quayY + rnd(i * 3.3) * (CH - quayY);
      var spread = (yy - quayY) / (CH - quayY) * 70 * scale + 6;
      var xx = gx + (rnd(i * 1.9 + Math.floor(clock * 3)) - 0.5) * spread * 2;
      var fl = 0.3 + 0.7 * Math.abs(Math.sin(clock * 4 + i));
      ctx.fillStyle = glow + (fl * (ls.sun ? 0.5 : 0.3 + sky.dark * 0.3)) + ')';
      ctx.fillRect(xx, yy, 7 * scale, 1.5 * scale);
    }
    // soft reflection bloom of the light source on the water
    var rg = ctx.createRadialGradient(gx, quayY + 6, 4, gx, quayY + 6, 150 * scale);
    rg.addColorStop(0, ls.sun ? 'rgba(255,235,180,.20)' : 'rgba(200,220,255,' + (0.08 + sky.dark * 0.12) + ')');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, quayY, CW, CH - quayY);
    // rolling wave crests
    for (var k = 0; k < 5; k++) {
      var yBase = quayY + (CH - quayY) * (0.12 + k * 0.2);
      var amp = (2 + k * 1.4) * scale, len = 90 + k * 50, spd = (8 + k * 6);
      ctx.strokeStyle = rgb(mix(topC, [255, 255, 255], 0.5 - k * 0.06), 0.10 + (1 - sky.dark) * 0.05);
      ctx.lineWidth = 1.4 * scale; ctx.beginPath();
      for (var x = 0; x <= CW; x += 8) {
        var yy2 = yBase + Math.sin((x + clock * spd * 6 + panX * 0.3) / len) * amp;
        if (x === 0) ctx.moveTo(x, yy2); else ctx.lineTo(x, yy2);
      }
      ctx.stroke();
    }
  }

  function worldToScreen(x) { return x - panX; }

  // vertical wavy reflection of a solid color band under an object
  function reflect(x, w, col, alpha) {
    var grd = ctx.createLinearGradient(0, quayY, 0, quayY + 40 * scale);
    grd.addColorStop(0, rgb(col, alpha)); grd.addColorStop(1, rgb(col, 0));
    ctx.fillStyle = grd;
    for (var rx = x; rx < x + w; rx += 3) {
      var off = Math.sin((rx + clock * 30) / 18) * 2;
      ctx.fillRect(rx + off, quayY, 3, 36 * scale);
    }
  }

  // ---- quay (dock front wall + deck) ----
  function drawQuay() {
    var sx = worldToScreen(0), w = WORLDW;
    // deck top
    ctx.fillStyle = '#5b6470'; ctx.fillRect(sx, quayY - 4, w, 6);
    // front wall
    var g = ctx.createLinearGradient(0, quayY, 0, quayY + 26 * scale);
    g.addColorStop(0, '#3a434e'); g.addColorStop(1, '#222a33');
    ctx.fillStyle = g; ctx.fillRect(sx, quayY, w, 26 * scale);
    // bollards
    ctx.fillStyle = '#2c333c';
    for (var bx = 40; bx < WORLDW; bx += 120) {
      var px = worldToScreen(bx);
      if (px < -10 || px > CW + 10) continue;
      ctx.fillRect(px, quayY - 10 * scale, 6 * scale, 10 * scale);
    }
  }

  // ---- lighthouse ----
  function drawLighthouse(wx) {
    var x = worldToScreen(wx); if (x < -80 || x > CW + 80) return;
    var baseY = quayY, h = 120 * scale, w = 26 * scale;
    // rock
    ctx.fillStyle = '#2e3640'; ctx.beginPath();
    ctx.moveTo(x - w, baseY); ctx.lineTo(x + w, baseY); ctx.lineTo(x + w * 0.7, baseY - 10 * scale); ctx.lineTo(x - w * 0.7, baseY - 10 * scale); ctx.closePath(); ctx.fill();
    // tower (tapered, striped)
    var topW = w * 0.5;
    for (var s = 0; s < 5; s++) {
      var y0 = baseY - 10 * scale - (h / 5) * s, y1 = baseY - 10 * scale - (h / 5) * (s + 1);
      var w0 = lerp(w, topW, s / 5), w1 = lerp(w, topW, (s + 1) / 5);
      ctx.fillStyle = s % 2 ? '#d8dde2' : '#c8443a';
      ctx.beginPath(); ctx.moveTo(x - w0, y0); ctx.lineTo(x + w0, y0); ctx.lineTo(x + w1, y1); ctx.lineTo(x - w1, y1); ctx.closePath(); ctx.fill();
    }
    var lampY = baseY - 10 * scale - h;
    // lamp housing
    ctx.fillStyle = '#1b2127'; ctx.fillRect(x - topW, lampY, topW * 2, 14 * scale);
    // beam (sweeps)
    var beam = (Math.sin(clock * 1.1) * 0.5 + 0.5);
    var ba = (0.12 + sky.dark * 0.5);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    var ang = -0.5 + beam * 1.0;
    var bg = ctx.createLinearGradient(x, lampY, x + Math.cos(ang) * 240, lampY + Math.sin(ang) * 240);
    bg.addColorStop(0, 'rgba(255,245,200,' + ba + ')'); bg.addColorStop(1, 'rgba(255,245,200,0)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(x, lampY + 6 * scale);
    ctx.lineTo(x + Math.cos(ang - 0.12) * 260, lampY + Math.sin(ang - 0.12) * 260);
    ctx.lineTo(x + Math.cos(ang + 0.12) * 260, lampY + Math.sin(ang + 0.12) * 260);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // lamp glow
    ctx.fillStyle = 'rgba(255,240,190,' + (0.5 + sky.dark * 0.5) + ')';
    ctx.beginPath(); ctx.arc(x, lampY + 7 * scale, 4 * scale, 0, TAU); ctx.fill();
  }

  // ---- warehouse ----
  function drawWarehouse(wx, w, col) {
    var x = worldToScreen(wx); if (x + w < -20 || x > CW + 20) return;
    var h = 70 * scale; w *= scale;
    var bodyY = quayY - h;
    // body
    var g = ctx.createLinearGradient(x, bodyY, x, quayY);
    g.addColorStop(0, rgb(mix(hx(col), [255, 255, 255], 0.12 * (1 - sky.dark)))); g.addColorStop(1, rgb(hx(col)));
    ctx.fillStyle = g; ctx.fillRect(x, bodyY, w, h);
    // roof
    ctx.fillStyle = rgb(mix(hx(col), [0, 0, 0], 0.45));
    ctx.beginPath(); ctx.moveTo(x - 4, bodyY); ctx.lineTo(x + w + 4, bodyY); ctx.lineTo(x + w - 6, bodyY - 12 * scale); ctx.lineTo(x + 6, bodyY - 12 * scale); ctx.closePath(); ctx.fill();
    // roller doors
    ctx.fillStyle = rgb(mix(hx(col), [0, 0, 0], 0.3));
    var dn = Math.max(1, Math.floor(w / (28 * scale)));
    for (var d = 0; d < dn; d++) {
      var dx = x + 8 + d * (w - 16) / dn;
      ctx.fillRect(dx, quayY - 34 * scale, (w - 16) / dn - 6, 34 * scale);
    }
    // night wall light
    if (sky.dark > 0.3) {
      ctx.fillStyle = 'rgba(255,220,150,' + (sky.dark - 0.3) * 0.5 + ')';
      ctx.beginPath(); ctx.arc(x + 6, bodyY + 8 * scale, 8 * scale, 0, TAU); ctx.fill();
    }
  }

  // ---- container ship (docked) ----
  var CONT_COLS = ['#c0473a', '#2f7fb0', '#d99a32', '#3a9d6e', '#8a5fb0', '#cf6a8e'];
  function drawShip(wx) {
    var x = worldToScreen(wx); var L = 360 * scale; if (x + L < -40 || x > CW + 40) return;
    var bob = Math.sin(clock * 0.5) * 2 * scale;
    var deckY = quayY - 30 * scale + bob;   // deck just below quay top
    var hullH = 46 * scale;
    ctx.save();
    // reflection
    reflect(x + 20, L - 40, [20, 30, 40], 0.18);
    // hull
    var hg = ctx.createLinearGradient(0, deckY, 0, deckY + hullH);
    hg.addColorStop(0, '#2b3a47'); hg.addColorStop(1, '#161f28');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(x, deckY); ctx.lineTo(x + L, deckY);
    ctx.lineTo(x + L - 26 * scale, deckY + hullH); ctx.lineTo(x + 16 * scale, deckY + hullH);
    ctx.closePath(); ctx.fill();
    // waterline stripe
    ctx.fillStyle = '#c0473a'; ctx.fillRect(x + 14 * scale, deckY + hullH - 7 * scale, L - 36 * scale, 4 * scale);
    // foam at waterline
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    for (var fx = x + 10; fx < x + L - 20; fx += 9) ctx.fillRect(fx, deckY + hullH - 2 + Math.sin((fx + clock * 40) / 14) * 1.5, 5, 2);
    // container stacks on deck
    var cw = 30 * scale, ch = 13 * scale, cols = Math.floor((L - 110 * scale) / cw);
    for (var c = 0; c < cols; c++) {
      var stack = 1 + Math.floor(rnd(c * 1.7 + wx) * 3);
      for (var r = 0; r < stack; r++) {
        ctx.fillStyle = CONT_COLS[(c + r) % CONT_COLS.length];
        var ccx = x + 50 * scale + c * cw, ccy = deckY - (r + 1) * ch;
        ctx.fillRect(ccx, ccy, cw - 3, ch - 2);
        ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(ccx, ccy + ch - 4, cw - 3, 2);
      }
    }
    // superstructure (bridge) at stern
    ctx.fillStyle = '#e7edf1'; ctx.fillRect(x + L - 70 * scale, deckY - 46 * scale, 44 * scale, 46 * scale);
    ctx.fillStyle = '#26323c';
    for (var wy = 0; wy < 3; wy++) ctx.fillRect(x + L - 66 * scale, deckY - 42 * scale + wy * 12 * scale, 36 * scale, 6 * scale);
    // funnel + smoke
    ctx.fillStyle = '#39434d'; ctx.fillRect(x + L - 50 * scale, deckY - 64 * scale, 16 * scale, 20 * scale);
    ctx.fillStyle = '#c0473a'; ctx.fillRect(x + L - 50 * scale, deckY - 64 * scale, 16 * scale, 5 * scale);
    smoke(x + L - 42 * scale, deckY - 64 * scale, wx);
    ctx.restore();
    return { x: x, deckY: deckY, L: L };
  }

  var smokePuffs = {};
  function smoke(sx, sy, key) {
    var arr = smokePuffs[key] || (smokePuffs[key] = []);
    if (Math.random() < 0.14) arr.push({ x: sx, y: sy, r: 4 * scale, life: 0, max: 3 + Math.random() * 2, vx: 6 + Math.random() * 6 });
    for (var i = arr.length - 1; i >= 0; i--) {
      var p = arr[i];
      if (paused && p.life === 0) { /* still: show a static puff */ }
      p.life += 1 / 60; p.x += p.vx * (1 / 60); p.y -= 10 * (1 / 60); p.r += 9 * (1 / 60);
      var a = clamp(1 - p.life / p.max, 0, 1) * 0.4;
      if (a <= 0) { arr.splice(i, 1); continue; }
      ctx.fillStyle = 'rgba(80,90,100,' + a + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
  }

  // ---- gantry crane with a working load cycle ----
  function drawCrane(wx, opts) {
    opts = opts || {};
    var x = worldToScreen(wx); var legSpan = 70 * scale; if (x + 200 < -40 || x - 80 > CW + 40) return;
    var h = 150 * scale, topY = quayY - h, boomY = topY + 14 * scale;
    var boomOut = x + 150 * scale;     // reaches out over the water/ship
    var boomIn = x - 50 * scale;       // back over the quay stacks
    var col = '#e8b04a';
    ctx.lineWidth = 5 * scale; ctx.strokeStyle = col;
    // legs
    line(x - legSpan * 0.3, quayY, x - legSpan * 0.1, topY);
    line(x + legSpan * 0.6, quayY, x + legSpan * 0.3, topY);
    line(x - legSpan * 0.3 + 18 * scale, quayY, x - legSpan * 0.1 + 18 * scale, topY);
    // top + boom
    ctx.lineWidth = 6 * scale;
    line(boomIn, boomY, boomOut, boomY);
    line(boomIn, topY, boomOut - 20 * scale, topY);
    // A-frame apex tie
    ctx.lineWidth = 3 * scale;
    line(x + 10 * scale, topY - 26 * scale, boomOut - 20 * scale, boomY);
    line(x + 10 * scale, topY - 26 * scale, boomIn, boomY);
    line(x, topY, x + 10 * scale, topY - 26 * scale);

    // working cycle
    if (opts.work) {
      var ph = (clock * 0.18) % 1;
      var carrying = ph > 0.34 && ph < 0.86;
      var trolleyX, spreaderDrop;
      if (ph < 0.15) { trolleyX = lerp(boomIn, boomOut, ph / 0.15); spreaderDrop = 8 * scale; }
      else if (ph < 0.30) { trolleyX = boomOut; spreaderDrop = lerp(8, 92, (ph - 0.15) / 0.15) * scale; }
      else if (ph < 0.36) { trolleyX = boomOut; spreaderDrop = 92 * scale; }
      else if (ph < 0.52) { trolleyX = boomOut; spreaderDrop = lerp(92, 8, (ph - 0.36) / 0.16) * scale; }
      else if (ph < 0.70) { trolleyX = lerp(boomOut, boomIn, (ph - 0.52) / 0.18); spreaderDrop = 8 * scale; }
      else if (ph < 0.84) { trolleyX = boomIn; spreaderDrop = lerp(8, 70, (ph - 0.70) / 0.14) * scale; }
      else { trolleyX = boomIn; spreaderDrop = lerp(70, 8, (ph - 0.84) / 0.16) * scale; }
      // cable
      ctx.lineWidth = 1.5 * scale; ctx.strokeStyle = '#cfd6da';
      line(trolleyX, boomY, trolleyX, boomY + spreaderDrop);
      // trolley
      ctx.fillStyle = '#cf8a2e'; ctx.fillRect(trolleyX - 8 * scale, boomY - 4 * scale, 16 * scale, 8 * scale);
      // spreader + container
      ctx.fillStyle = '#2b333b'; ctx.fillRect(trolleyX - 16 * scale, boomY + spreaderDrop, 32 * scale, 4 * scale);
      if (carrying) { ctx.fillStyle = CONT_COLS[Math.floor(ph * 13) % CONT_COLS.length]; ctx.fillRect(trolleyX - 15 * scale, boomY + spreaderDrop + 4 * scale, 30 * scale, 13 * scale); }
    }
    // quay container stack near boomIn
    for (var s = 0; s < 4; s++) {
      ctx.fillStyle = CONT_COLS[(s + (wx | 0)) % CONT_COLS.length];
      ctx.fillRect(boomIn - 18 * scale, quayY - (s + 1) * 13 * scale, 30 * scale, 12 * scale);
    }
  }
  function line(x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }

  // night darkening overlay on the water/foreground for mood
  function drawNightVeil() {
    if (sky.dark <= 0.05) return;
    ctx.fillStyle = 'rgba(8,14,32,' + sky.dark * 0.28 + ')';
    ctx.fillRect(0, 0, CW, CH);
  }

  function draw() {
    sky = skyAt(tod);
    var ls = lightSource();
    ctx.clearRect(0, 0, CW, CH);
    drawSky();
    drawSunMoon(ls);
    drawClouds();
    drawSkyline();
    drawSea(ls);
    drawQuay();
    // foreground scene objects (back-to-front) — composed around the hero berth
    drawLighthouse(40);
    drawWarehouse(150, 110, '#7c8794');
    drawShip(250);                       // hero: docked container ship 250..~610
    drawCrane(430, { work: true });      // working crane over the ship
    drawWarehouse(660, 120, '#6f7b86');
    drawCrane(800, { work: false });
    drawWarehouse(1000, 160, '#79848f');
    drawCrane(1180, { work: false });
    drawWarehouse(1380, 130, '#6f7b86');
    drawNightVeil();
  }

  // ===================== LOOP / INPUT =====================
  function update(dt) {
    clock += dt;
    if (!paused) tod = (tod + dt * TOD_SPEED) % 1;
    panX += (panTarget - panX) * Math.min(1, dt * 10);
    // clock label
    var hh = Math.floor(tod * 24), mm = Math.floor((tod * 24 % 1) * 60);
    if (clockEl) clockEl.textContent = ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2);
  }

  var dragging = false, lastX = 0, moved = 0;
  function cptX(clientX) { var b = canvas.getBoundingClientRect(); return (clientX - b.left) * (CW / b.width); }
  canvas.addEventListener('pointerdown', function (e) { dragging = true; lastX = cptX(e.clientX); moved = 0; });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var x = cptX(e.clientX), d = x - lastX; lastX = x; moved += Math.abs(d);
    userPanned = true;
    panTarget = clamp(panTarget - d, 0, Math.max(0, WORLDW - CW));
    if (moved > 30 && hintEl) hintEl.classList.add('gone');
  });
  window.addEventListener('pointerup', function () { dragging = false; });

  // ---- boot ----
  function boot() {
    Portal.loadingStart();
    buildSkyline(); layout();
    // URL overrides (screenshots)
    try {
      var q = window.location.search;
      var mt = /[?&]tod=([0-9.]+)/.exec(q); if (mt) tod = +mt[1] % 1;
      var mp = /[?&]pan=([0-9.]+)/.exec(q); if (mp) { userPanned = true; panTarget = panX = (+mp[1]) * Math.max(0, WORLDW - CW); }
      if (/[?&]still\b/.test(q)) paused = true;
    } catch (e) {}

    if (window.ResizeObserver) new ResizeObserver(function () { buildSkyline(); layout(); }).observe(wrap);
    window.addEventListener('resize', function () { buildSkyline(); layout(); });
    window.addEventListener('orientationchange', function () { setTimeout(layout, 200); });

    var last = performance.now();
    (function frame(now) { var dt = Math.min(0.05, (now - last) / 1000); last = now; update(dt); draw(); requestAnimationFrame(frame); })(performance.now());

    Portal.init().then(function () {
      Portal.loadingStop(); Portal.mute(Juice.Audio.isMuted());
      if (loader) loader.classList.add('hidden');
      Portal.gameStart();
    });
  }

  // ---- headless hook (expands in later phases) ----
  window.__harbor = {
    state: function () { return { tod: Math.round(tod * 1000) / 1000, panX: Math.round(panX), worldW: WORLDW, dark: Math.round((skyAt(tod).dark) * 100) / 100, phase: 'look-slice' }; },
    setTod: function (t) { tod = t % 1; },
    setPan: function (f) { panTarget = panX = f * Math.max(0, WORLDW - CW); },
    pause: function (p) { paused = !!p; }
  };

  boot();
})();
