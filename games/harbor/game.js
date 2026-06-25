/* HARBOR — Phase 2 look update: detailed, brighter, biome backdrops, smoother camera.
 * Builds the static port as 3 merged meshes (facade / grit / flat-colour) per biome,
 * animates the crane, day/night with lit windows, free orbit + inertial pinch-zoom.
 * Renderer is guarded so the sim/hook still load headlessly without WebGL.
 */
(function () {
  'use strict';
  var GAME = 'harbor', mat4 = window.HGL && HGL.mat4;
  var canvas = document.getElementById('game'), loader = document.getElementById('loader');
  var clockEl = document.getElementById('clock'), hintEl = document.getElementById('hint'), wrap = document.querySelector('.board-wrap');
  var gl = null, E = null;
  try { gl = canvas.getContext('webgl2', { antialias: true, alpha: false }); } catch (e) {}

  var CW = 0, CH = 0, DPR = 1, clock = 0, tod = 0.42, todSpeed = 1 / 160, paused = false;
  // camera: current + targets + fling velocity
  var C = { az: 2.42, el: 0.5, dist: 120, azT: 2.42, elT: 0.5, distT: 120, vAz: 0, vEl: 0, tx: 0, ty: 6, tz: 4 };
  var biomeId = 'green', biome = null;

  function resize() {
    var bw = wrap.clientWidth || 360, bh = wrap.clientHeight || 560;
    CW = Math.max(240, bw); CH = Math.max(320, bh); DPR = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR);
    canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
  }

  // ---- procedural textures ----
  function facadeTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d');
    var img = x.createImageData(256, 256), D = img.data;
    for (var y = 0; y < 256; y++) for (var px = 0; px < 256; px++) {
      var i = (y * 256 + px) * 4, wx = px % 32, wy = y % 24;
      var win = wx > 6 && wx < 27 && wy > 5 && wy < 20;
      var n = (Math.random() * 24) | 0;
      if (win) { D[i] = 70 + n; D[i + 1] = 84 + n; D[i + 2] = 104 + n; D[i + 3] = 255; }
      else { var g = 150 + n; D[i] = g; D[i + 1] = g; D[i + 2] = g + 6; D[i + 3] = 0; }
    }
    x.putImageData(img, 0, 0); return c;
  }
  function gritTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d');
    var img = x.createImageData(256, 256), D = img.data;
    for (var i = 0; i < D.length; i += 4) { var g = 150 + (Math.random() * 60 | 0); D[i] = g; D[i + 1] = g; D[i + 2] = g; D[i + 3] = 0; }
    x.putImageData(img, 0, 0); return c;
  }

  // ---- rng ----
  function hash(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ---- scene ----
  var meshFac, meshGrit, meshFlat, waterMesh, boxMesh, facTex, gritTex;
  function buildBiome(id) {
    if (!HARBOR_BIOMES[id]) id = 'green';
    biomeId = id; biome = HARBOR_BIOMES[id];
    var rng = mulberry(hash('harbor:' + id));
    var fac = new HGL.Builder(), grit = new HGL.Builder(), flat = new HGL.Builder();
    HARBOR_MODELS.buildStatic({ fac: fac, grit: grit, flat: flat }, biome, rng);
    meshFac = E.mesh(fac.data()); meshGrit = E.mesh(grit.data()); meshFlat = E.mesh(flat.data());
    if (window.Retention) Retention.set(GAME, 'biome', id);
  }

  // ---- day/night ----
  function env() {
    var day = (1 - Math.cos(tod * Math.PI * 2)) / 2;          // 0 night .. 1 noon
    var night = clamp(1 - day * 1.7, 0, 1);
    var warm = clamp(1 - Math.abs(day - 0.16) * 2.2, 0, 1) * 0.6;   // dawn/dusk glow
    function s(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
    function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    var top = s(biome.skyTop, 0.16 + 0.9 * day);
    var bot = lerp3(s(biome.skyBot, 0.2 + 0.85 * day), [1.0, 0.55, 0.3], warm);
    var sun = s(biome.sun, 0.3 + 0.8 * day);
    var fog = lerp3(s(biome.fog, 0.22 + 0.85 * day), [1.0, 0.6, 0.4], warm * 0.6);
    return { day: day, night: night, top: top, bot: bot, sun: sun, fog: fog };
  }
  function sunDir() { var ang = (tod - 0.25) * Math.PI * 2, y = Math.max(0.07, Math.sin(ang) * 0.9 + 0.12); return norm([Math.cos(ang) * 0.7, y, 0.42]); }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---- matrices ----
  var mView = mat4 && mat4.create(), mProj = mat4 && mat4.create(), mVP = mat4 && mat4.create(),
    mLV = mat4 && mat4.create(), mLP = mat4 && mat4.create(), mLVP = mat4 && mat4.create(), mModel = mat4 && mat4.create(), mI = mat4 && mat4.create();
  function compose(o, tx, ty, tz, sx, sy, sz) { o[0] = sx; o[1] = 0; o[2] = 0; o[3] = 0; o[4] = 0; o[5] = sy; o[6] = 0; o[7] = 0; o[8] = 0; o[9] = 0; o[10] = sz; o[11] = 0; o[12] = tx; o[13] = ty; o[14] = tz; o[15] = 1; }
  function eye() { var ce = Math.cos(C.el), se = Math.sin(C.el); return [C.tx + C.dist * ce * Math.sin(C.az), C.ty + C.dist * se, C.tz + C.dist * ce * Math.cos(C.az)]; }

  // ---- crane dynamic parts ----
  function craneParts() {
    var h = 32, z = -6, ph = (clock * 0.16) % 1, carry = ph > 0.30 && ph < 0.86, tx, drop;
    if (ph < 0.15) { tx = -13 + 26 * (ph / 0.15); drop = 2; }
    else if (ph < 0.30) { tx = 13; drop = 2 + 22 * ((ph - 0.15) / 0.15); }
    else if (ph < 0.52) { tx = 13; drop = 24 - 22 * ((ph - 0.30) / 0.22); }
    else if (ph < 0.70) { tx = 13 - 26 * ((ph - 0.52) / 0.18); drop = 2; }
    else if (ph < 0.84) { tx = -13; drop = 2 + 18 * ((ph - 0.70) / 0.14); }
    else { tx = -13; drop = 20 - 18 * ((ph - 0.84) / 0.16); }
    var p = [{ t: [tx, h + 2.1, z], s: [6, 1.6, 4], c: [0.85, 0.5, 0.12] },
             { t: [tx, h + 2.1 - drop, z], s: [5, 0.9, 4.6], c: [0.13, 0.14, 0.16] }];
    if (carry) p.push({ t: [tx, h + 1.0 - drop, z], s: [4.8, 2.3, 4.4], c: HARBOR_MODELS.CONT[(clock | 0) % 7] });
    return p;
  }

  function drawMesh(P, m) { gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, m.itype, 0); }

  function render() {
    if (!gl) return;
    var en = env(), sd = sunDir(), ev = eye(), target = [C.tx, C.ty, C.tz], parts = craneParts();

    // shadow pass
    var sp = [target[0] + sd[0] * 90, target[1] + sd[1] * 90, target[2] + sd[2] * 90];
    mat4.lookAt(mLV, sp, target, [0, 1, 0]); mat4.ortho(mLP, -110, 110, -110, 110, 1, 260); mat4.mul(mLVP, mLP, mLV);
    gl.bindFramebuffer(gl.FRAMEBUFFER, E.shadowFB); gl.viewport(0, 0, E.SH, E.SH); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
    var D = E.P_depth; gl.useProgram(D.p); gl.uniformMatrix4fv(D.u.uLightVP, false, mLVP);
    compose(mI, 0, 0, 0, 1, 1, 1); gl.uniformMatrix4fv(D.u.uModel, false, mI);
    drawMesh(D, meshFac); drawMesh(D, meshGrit); drawMesh(D, meshFlat);
    for (var i = 0; i < parts.length; i++) { compose(mModel, parts[i].t[0], parts[i].t[1], parts[i].t[2], parts[i].s[0], parts[i].s[1], parts[i].s[2]); gl.uniformMatrix4fv(D.u.uModel, false, mModel); drawMesh(D, boxMesh); }
    gl.cullFace(gl.BACK);

    // main
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(en.bot[0], en.bot[1], en.bot[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    mat4.perspective(mProj, 0.82, canvas.width / canvas.height, 0.5, 900); mat4.lookAt(mView, ev, target, [0, 1, 0]); mat4.mul(mVP, mProj, mView);

    // sky
    gl.depthMask(false); gl.disable(gl.CULL_FACE);
    var S = E.P_sky; gl.useProgram(S.p);
    gl.uniform3fv(S.u.uTop, en.top); gl.uniform3fv(S.u.uBot, en.bot); gl.uniform3fv(S.u.uSunCol, en.sun);
    gl.uniform2fv(S.u.uSun, [0.5 + sd[0] * 0.42, 0.32 + sd[1] * 0.5]);
    drawMesh(S, E.quad); gl.depthMask(true); gl.enable(gl.CULL_FACE);

    // scene meshes
    var M = E.P_main; gl.useProgram(M.p);
    gl.uniformMatrix4fv(M.u.uVP, false, mVP); gl.uniformMatrix4fv(M.u.uLightVP, false, mLVP);
    gl.uniform3fv(M.u.uSunDir, sd); gl.uniform3fv(M.u.uSunCol, en.sun);
    gl.uniform3fv(M.u.uAmbTop, [0.45 * (0.4 + en.day), 0.5 * (0.4 + en.day), 0.62 * (0.4 + en.day)]);
    gl.uniform3fv(M.u.uAmbBot, [0.16, 0.17, 0.2]);
    gl.uniform3fv(M.u.uCam, ev); gl.uniform3fv(M.u.uFog, en.bot); gl.uniform1f(M.u.uFogD, 0.0019);
    gl.uniform3fv(M.u.uWin, [1.0, 0.82, 0.46]); gl.uniform1f(M.u.uNight, en.night); gl.uniform1f(M.u.uTime, clock);
    gl.uniform1f(M.u.uExposure, 1.5); gl.uniform1f(M.u.uSat, 1.14); gl.uniform1f(M.u.uShadowOn, 1);
    gl.uniform1f(M.u.uVCol, 1);
    gl.uniformMatrix4fv(M.u.uModel, false, mI);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, E.shadowTex); gl.uniform1i(M.u.uShadow, 0);
    gl.activeTexture(gl.TEXTURE1); gl.uniform1i(M.u.uTex, 1);
    // flat (no tex), grit (grit tex), fac (window tex)
    gl.uniform1f(M.u.uTexMix, 0); drawMesh(M, meshFlat);
    gl.bindTexture(gl.TEXTURE_2D, gritTex); gl.uniform1f(M.u.uTexMix, 0.5); drawMesh(M, meshGrit);
    gl.bindTexture(gl.TEXTURE_2D, facTex); gl.uniform1f(M.u.uTexMix, 0.8); drawMesh(M, meshFac);
    // dynamic crane parts (flat colour)
    gl.uniform1f(M.u.uVCol, 0); gl.uniform1f(M.u.uTexMix, 0); gl.uniform1f(M.u.uRough, 0.5);
    for (i = 0; i < parts.length; i++) { gl.uniform3fv(M.u.uBase, parts[i].c); compose(mModel, parts[i].t[0], parts[i].t[1], parts[i].t[2], parts[i].s[0], parts[i].s[1], parts[i].s[2]); gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh); }

    // water
    var W = E.P_water; gl.useProgram(W.p); gl.uniformMatrix4fv(W.u.uVP, false, mVP); gl.uniform1f(W.u.uTime, clock);
    gl.uniform3fv(W.u.uCam, ev); gl.uniform3fv(W.u.uSunDir, sd); gl.uniform3fv(W.u.uSunCol, en.sun);
    gl.uniform3fv(W.u.uDeep, biome.deep); gl.uniform3fv(W.u.uShallow, biome.shallow);
    gl.uniform3fv(W.u.uSky, en.bot); gl.uniform3fv(W.u.uFog, en.bot); gl.uniform1f(W.u.uFogD, 0.0019);
    gl.uniform1f(W.u.uExposure, 1.5); gl.uniform1f(W.u.uSat, 1.14);
    gl.disable(gl.CULL_FACE); drawMesh(W, waterMesh); gl.enable(gl.CULL_FACE);
  }

  // ---- input: orbit + inertial + pinch ----
  var drag = false, lx = 0, ly = 0, pinch = 0, lastTap = 0, rot = clamp;
  function pxy(e) { var b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
  function defaultView() { C.azT = 2.42; C.elT = 0.5; C.distT = Math.min(140, Math.max(90, CH * 0.18)); }
  if (canvas.addEventListener) {
    canvas.addEventListener('pointerdown', function (e) { drag = true; var p = pxy(e); lx = p.x; ly = p.y; C.vAz = C.vEl = 0;
      var now = Date.now(); if (now - lastTap < 300) defaultView(); lastTap = now; });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return; var p = pxy(e), dx = p.x - lx, dy = p.y - ly; lx = p.x; ly = p.y;
      C.azT -= dx * 0.007; C.elT = clamp(C.elT - dy * 0.005, 0.14, 1.3); C.vAz = -dx * 0.007; C.vEl = -dy * 0.005;
      if (hintEl) hintEl.classList.add('gone');
    });
    window.addEventListener('pointerup', function () { drag = false; });
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); C.distT = clamp(C.distT * (1 + e.deltaY * 0.0012), 42, 230); }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2) { e.preventDefault(); var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); if (pinch) C.distT = clamp(C.distT * (pinch / d), 42, 230); pinch = d; }
    }, { passive: false });
    canvas.addEventListener('touchend', function () { pinch = 0; });
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - (frame._l || now)) / 1000); frame._l = now;
    clock += dt; if (!paused) tod = (tod + dt * todSpeed) % 1;
    if (!drag) { C.azT += C.vAz; C.elT = clamp(C.elT + C.vEl, 0.14, 1.3); C.vAz *= 0.92; C.vEl *= 0.92; if (Math.abs(C.vAz) < 1e-4) C.vAz = 0; if (Math.abs(C.vEl) < 1e-4) C.vEl = 0; }
    var k = Math.min(1, dt * 11); C.az += (C.azT - C.az) * k; C.el += (C.elT - C.el) * k; C.dist += (C.distT - C.dist) * Math.min(1, dt * 9);
    if (clockEl) { var hh = Math.floor(tod * 24), mm = Math.floor((tod * 24 % 1) * 60); clockEl.textContent = ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2); }
    render(); requestAnimationFrame(frame);
  }

  // ---- biome selector UI ----
  function buildSelector() {
    var bar = document.createElement('div'); bar.id = 'biomebar';
    HARBOR_BIOME_ORDER.forEach(function (id) {
      var btn = document.createElement('button'); btn.className = 'biome-btn'; btn.textContent = HARBOR_BIOMES[id].name;
      btn.addEventListener('click', function () { buildBiome(id); setActive(); });
      bar.appendChild(btn);
    });
    wrap.appendChild(bar);
    function setActive() { var bs = bar.querySelectorAll('.biome-btn'); for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', HARBOR_BIOME_ORDER[i] === biomeId); }
    setActive(); buildSelector._set = setActive;
  }

  function boot() {
    if (window.Portal) Portal.loadingStart();
    if (!gl) { if (loader) loader.innerHTML = '<div style="color:#fff;font-family:sans-serif;padding:20px;text-align:center">WebGL2 is required to play HARBOR.</div>'; return; }
    E = HGL.createEngine(gl);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    boxMesh = E.mesh(new HGL.Builder().box(0, 0, 0, 1, 1, 1, [1, 1, 1]).data());
    waterMesh = E.mesh(E.plane(620, 150)); facTex = E.texture(facadeTexture()); gritTex = E.texture(gritTexture());
    var saved = window.Retention && Retention.get(GAME, 'biome', null);
    buildBiome(saved || 'green');
    resize(); defaultView(); C.dist = C.distT; buildSelector();
    try { var q = window.location.search; var m;
      if ((m = /[?&]biome=(\w+)/.exec(q))) { buildBiome(m[1]); buildSelector._set && buildSelector._set(); }
      if ((m = /[?&]tod=([0-9.]+)/.exec(q))) tod = +m[1] % 1;
      if ((m = /[?&]az=(-?[0-9.]+)/.exec(q))) { C.az = C.azT = +m[1]; }
      if ((m = /[?&]el=([0-9.]+)/.exec(q))) { C.el = C.elT = +m[1]; }
      if ((m = /[?&]dist=([0-9.]+)/.exec(q))) { C.dist = C.distT = +m[1]; }
      if (/[?&]still\b/.test(q)) paused = true;
    } catch (e) {}
    if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);
    window.addEventListener('resize', resize);
    requestAnimationFrame(frame);
    if (window.Portal) Portal.init().then(function () { Portal.loadingStop(); if (loader) loader.classList.add('hidden'); Portal.gameStart(); });
  }

  window.__harbor = {
    state: function () { return { biome: biomeId, tod: Math.round(tod * 1000) / 1000, cam: { az: +C.az.toFixed(2), el: +C.el.toFixed(2), dist: Math.round(C.dist) }, webgl: !!gl, phase: 'look-2' }; },
    setBiome: function (id) { if (E) buildBiome(id); }, setTod: function (t) { tod = t % 1; }, pause: function (p) { paused = !!p; }
  };

  if (canvas && canvas.getContext) boot();
})();
