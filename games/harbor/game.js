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
  var C = { az: 2.42, el: 0.5, dist: 120, azT: 2.42, elT: 0.5, distT: 120, vAz: 0, vEl: 0, tx: 0, ty: 6, tz: 4, txT: 0, tzT: 4, vTx: 0, vTz: 0 };
  var PANX = 1140, PANZ0 = -90, PANZ1 = 280;   // pan clamp over the long coast
  var biomeId = 'green', biome = null, unlocked = ['green'];

  // ---- 2D FX overlay (juice: particles / popups / screenshake), drawn over the WebGL canvas ----
  var fxCanvas = null, fxCtx = null, FX = null;
  function ensureFX() {
    if (fxCanvas || !window.Juice) return;
    fxCanvas = document.createElement('canvas'); fxCanvas.id = 'fx';
    fxCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4';
    wrap.appendChild(fxCanvas); fxCtx = fxCanvas.getContext('2d');
    FX = { p: new Juice.Particles(), pop: new Juice.Popups(), shake: new Juice.Shake() };
  }
  function resize() {
    var bw = wrap.clientWidth || 360, bh = wrap.clientHeight || 560;
    CW = Math.max(240, bw); CH = Math.max(320, bh); DPR = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR);
    canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
    if (fxCanvas) { fxCanvas.width = Math.round(CW * DPR); fxCanvas.height = Math.round(CH * DPR); fxCanvas.style.width = CW + 'px'; fxCanvas.style.height = CH + 'px'; }
    if (tradeOpen && typeof sizeTrade === 'function') sizeTrade();
  }
  // project a world point to overlay pixel coords (uses the last frame's view-projection)
  function worldToScreen(x, y, z) {
    var m = mVP; if (!m) return null;
    var cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.0001) return null;
    return { x: (cx / cw * 0.5 + 0.5) * CW, y: (1 - (cy / cw * 0.5 + 0.5)) * CH, behind: false };
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
  function blobTexture() { // soft radial dark decal (alpha falloff) for contact shadows
    var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d');
    var gr = x.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return c;
  }

  // ---- rng ----
  function hash(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ---- scene ----
  var meshFac, meshGrit, meshFlat, waterMesh, boxMesh, facTex, gritTex;
  var era = 0, scene = { city: [], blobs: [], crane: false, era: 0, founded: false, port: null };
  var cityModels = null, atlasTex = null, blobTex = null;   // glTF buildings (async) + shared atlas + shadow decal
  var founded = {};                                          // biomeId -> {x,z,yaw} (founded harbours)
  var sites = [], selSite = -1;                              // curated harbour candidates + selected index
  var ambient = null;                                        // living port: sailing boats + wheeling gulls
  function buildBiome(id) {
    if (!HARBOR_BIOMES[id]) id = 'green';
    biomeId = id; biome = HARBOR_BIOMES[id]; ambient = null;
    if (SIM && SIM.raw()) {
      if (founded[id] && !SIM.port(id)) SIM.foundPort(id);         // reconcile legacy/missing port economy
      SIM.setActive(id);                                          // HUD/manage now follow this port
    }
    if (simReady() && founded[id]) era = SIM.raw().era;            // sim is the authority on era when founded
    var rng = mulberry(hash('harbor:' + id + ':e' + era));
    var fac = new HGL.Builder(), grit = new HGL.Builder(), flat = new HGL.Builder();
    var port = founded[id] || null;
    scene = HARBOR_MODELS.buildStatic({ fac: fac, grit: grit, flat: flat }, biome, rng, era, port) || { city: [], blobs: [], crane: false, era: era, founded: !!port, port: null };
    meshFac = E.mesh(fac.data()); meshGrit = E.mesh(grit.data()); meshFlat = E.mesh(flat.data());
    sites = port ? [] : HARBOR_MODELS.sites(); selSite = -1;  // curated candidates only when wild
    if (window.Retention) Retention.set(GAME, 'biome', id);
    if (typeof buildSiteChips === 'function') buildSiteChips();
    if (typeof updateFoundUI === 'function') updateFoundUI();
  }
  function loadFounded() { var f = window.Retention && Retention.get(GAME, 'founded', null); if (f && typeof f === 'object') founded = f; }
  function saveFounded() { if (window.Retention) Retention.set(GAME, 'founded', founded); }
  function foundHere(x, z, yaw) {
    if (yaw == null) yaw = HARBOR_MODELS.portYaw(x, z);
    founded[biomeId] = { x: x, z: z, yaw: yaw }; saveFounded();
    if (SIM) { SIM.foundPort(biomeId); era = SIM.raw().era; if (typeof bumpDaily === 'function') bumpDaily('found'); }   // start this world's port economy
    buildBiome(biomeId);
    C.txT = x; C.tzT = z; C.distT = 130; C.elT = 0.5;        // frame the new harbour
    if (typeof updateHUD === 'function') updateHUD();
  }

  // ---- glTF city assets (loaded once, async; procedural scene renders meanwhile) ----
  function uploadAtlas(bytes) {
    var blob = new Blob([bytes], { type: 'image/png' }), url = URL.createObjectURL(blob), img = new Image();
    img.onload = function () { atlasTex = E.texture(img); URL.revokeObjectURL(url); };
    img.src = url;
  }
  function loadAssets() {
    if (!window.HGLTF || !window.HARBOR_ASSETS) return;
    var urls = HARBOR_ASSETS.buildings; cityModels = new Array(urls.length);
    urls.forEach(function (u, bi) {
      HGLTF.load(u).then(function (model) {
        cityModels[bi] = {
          prims: model.primitives.map(function (p) {
            return { mesh: E.mesh({ positions: p.positions, normals: p.normals, uvs: p.uvs, colors: p.colors, indices: p.indices }), textured: p.image != null, baseColor: p.baseColor };
          }),
          h: (model.max[1] - model.min[1]) || 1
        };
        if (!atlasTex) for (var i = 0; i < model.primitives.length; i++) { var im = model.primitives[i].image; if (im != null && model.images[im]) { uploadAtlas(model.images[im]); break; } }
      }).catch(function () { cityModels[bi] = null; });
    });
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
  function composeRY(o, tx, ty, tz, s, ry) { var c = Math.cos(ry), sn = Math.sin(ry); o[0] = c * s; o[1] = 0; o[2] = -sn * s; o[3] = 0; o[4] = 0; o[5] = s; o[6] = 0; o[7] = 0; o[8] = sn * s; o[9] = 0; o[10] = c * s; o[11] = 0; o[12] = tx; o[13] = ty; o[14] = tz; o[15] = 1; }
  function composeRYS(o, tx, ty, tz, sx, sy, sz, ry) { var c = Math.cos(ry), sn = Math.sin(ry); o[0] = c * sx; o[1] = 0; o[2] = -sn * sx; o[3] = 0; o[4] = 0; o[5] = sy; o[6] = 0; o[7] = 0; o[8] = sn * sz; o[9] = 0; o[10] = c * sz; o[11] = 0; o[12] = tx; o[13] = ty; o[14] = tz; o[15] = 1; }
  function eye() { var ce = Math.cos(C.el), se = Math.sin(C.el); return [C.tx + C.dist * ce * Math.sin(C.az), C.ty + C.dist * se, C.tz + C.dist * ce * Math.cos(C.az)]; }

  // draw the modern skyline (glTF buildings) — textured prim uses the shared atlas, flat "lit" prims use baseColor
  function drawCity(M) {
    if (!atlasTex || !cityModels || !scene.city.length) return;
    gl.uniform1f(M.u.uVCol, 0); gl.uniform1f(M.u.uRough, 0.5);
    for (var i = 0; i < scene.city.length; i++) {
      var c = scene.city[i], cm = cityModels[c.bi]; if (!cm) continue;
      composeRY(mModel, c.x, HARBOR_MODELS.heightAt(c.x, c.z) - 0.3, c.z, c.s, c.rot); gl.uniformMatrix4fv(M.u.uModel, false, mModel);
      for (var pi = 0; pi < cm.prims.length; pi++) {
        var pr = cm.prims[pi];
        if (pr.textured) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1f(M.u.uAlbedo, 1); gl.uniform3fv(M.u.uBase, c.tint); }
        else { gl.uniform1f(M.u.uAlbedo, 0); gl.uniform3fv(M.u.uBase, [pr.baseColor[0] * c.tint[0], pr.baseColor[1] * c.tint[1], pr.baseColor[2] * c.tint[2]]); }
        drawMesh(M, pr.mesh);
      }
    }
    gl.uniform1f(M.u.uAlbedo, 0);
  }

  // soft contact shadows: flat dark radial decals on the ground under objects (no shadow map)
  function drawBlobs() {
    if (!blobTex || !scene.blobs || !scene.blobs.length) return;
    var Bp = E.P_blob; gl.useProgram(Bp.p); gl.uniformMatrix4fv(Bp.u.uVP, false, mVP);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blobTex); gl.uniform1i(Bp.u.uTex, 1); gl.uniform1f(Bp.u.uStr, 0.34);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    for (var i = 0; i < scene.blobs.length; i++) {
      var b = scene.blobs[i], y = HARBOR_MODELS.heightAt(b.x, b.z) + 0.06;
      compose(mModel, b.x, y, b.z, b.r, 1, b.r); gl.uniformMatrix4fv(Bp.u.uModel, false, mModel);
      drawMesh(Bp, E.blobQuad);
    }
    gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE);
  }

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

  // ---- ambient port life (boats sailing the bay, gulls wheeling above) ----
  // Built once per founded scene; population scales with era so the port feels busier as it grows.
  function buildAmbient() {
    var p = scene.port; if (!p) { ambient = { boats: [], gulls: [], cx: 0, cz: 0 }; return; }
    // find the deepest water offshore to anchor the boat traffic so they never sail over land
    var bestA = 0, bestDepth = 1e9;
    for (var a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      var dx = Math.sin(a), dz = Math.cos(a), sum = 0, ok = true;
      for (var d = 45; d <= 120; d += 15) { var h = HARBOR_MODELS.heightAt(p.x + dx * d, p.z + dz * d); if (h > 0.4) ok = false; sum += h; }
      if (ok && sum < bestDepth) { bestDepth = sum; bestA = a; }
    }
    var cx = p.x + Math.sin(bestA) * 78, cz = p.z + Math.cos(bestA) * 78;
    var rng = mulberry(hash('amb:' + biomeId + ':' + Math.round(cx) + ':' + era));
    var nBoats = 2 + Math.min(7, era * 2), nGulls = 4 + era * 2, boats = [], gulls = [], i;
    for (i = 0; i < nBoats; i++) {
      boats.push({ a0: rng() * 6.283, sp: (0.05 + rng() * 0.07) * (rng() < 0.5 ? 1 : -1), rx: 30 + rng() * 26, rz: 22 + rng() * 20, hull: rng() < 0.5 ? [0.45, 0.22, 0.14] : [0.5, 0.4, 0.28], big: rng() < 0.4 });
    }
    for (i = 0; i < nGulls; i++) {
      gulls.push({ a0: rng() * 6.283, sp: 0.5 + rng() * 0.4, r: 12 + rng() * 24, h: 22 + rng() * 22, bob: rng() * 6.283 });
    }
    ambient = { boats: boats, gulls: gulls, cx: cx, cz: cz };
  }
  // draw boats + gulls; assumes M program is bound with uVCol=0, uTexMix=0, uAlbedo=0 (flat colour)
  function drawAmbient(M) {
    if (!ambient) return;
    var p = scene.port, by = p ? p.by : 0, b, i, t, ang, x, z, nx, nz, yaw;
    for (i = 0; i < ambient.boats.length; i++) {
      b = ambient.boats[i]; ang = b.a0 + clock * b.sp;
      x = ambient.cx + Math.cos(ang) * b.rx; z = ambient.cz + Math.sin(ang) * b.rz;
      // heading = tangent of the ellipse
      nx = -Math.sin(ang) * b.rx * (b.sp < 0 ? -1 : 1); nz = Math.cos(ang) * b.rz * (b.sp < 0 ? -1 : 1);
      yaw = Math.atan2(nx, nz);
      var sc = b.big ? 1.5 : 1, bob = Math.sin(clock * 1.3 + b.a0) * 0.3;
      gl.uniform3fv(M.u.uBase, b.hull);
      composeRYS(mModel, x, 0.5 + bob, z, 6 * sc, 1.8, 2.4 * sc, yaw); gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh);
      gl.uniform3fv(M.u.uBase, [0.93, 0.93, 0.9]);                         // sail / cabin
      composeRYS(mModel, x, 3.2 + bob, z, 0.5, 4.2, 3.0 * sc, yaw); gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh);
    }
    gl.uniform3fv(M.u.uBase, [0.97, 0.97, 0.95]);
    for (i = 0; i < ambient.gulls.length; i++) {
      var g = ambient.gulls[i], ga = g.a0 + clock * g.sp;
      x = (p ? p.x : ambient.cx) + Math.cos(ga) * g.r; z = (p ? p.z : ambient.cz) + Math.sin(ga) * g.r;
      var gy = by + g.h + Math.sin(clock * 2 + g.bob) * 3;
      var flap = 1 + Math.sin(clock * 9 + g.bob) * 0.4;                    // wing-flap shimmer
      composeRYS(mModel, x, gy, z, 2.4 * flap, 0.4, 0.9, ga); gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh);
    }
  }

  function render() {
    if (!gl) return;
    if (scene.port && !ambient) buildAmbient();
    var en = env(), sd = sunDir(), ev = eye(), target = [C.tx, C.ty, C.tz];
    var parts = scene.crane ? craneParts() : [];

    // main (shadows removed — cleaner cartoon look)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(en.bot[0], en.bot[1], en.bot[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    mat4.perspective(mProj, 0.82, canvas.width / canvas.height, 0.5, 1600); mat4.lookAt(mView, ev, target, [0, 1, 0]); mat4.mul(mVP, mProj, mView);
    var i;

    // sky
    gl.depthMask(false); gl.disable(gl.CULL_FACE);
    var S = E.P_sky; gl.useProgram(S.p);
    gl.uniform3fv(S.u.uTop, en.top); gl.uniform3fv(S.u.uBot, en.bot); gl.uniform3fv(S.u.uSunCol, en.sun);
    gl.uniform2fv(S.u.uSun, [0.5 + sd[0] * 0.42, 0.32 + sd[1] * 0.5]);
    drawMesh(S, E.quad); gl.depthMask(true); gl.enable(gl.CULL_FACE);

    // scene meshes
    var M = E.P_main; gl.useProgram(M.p);
    gl.uniformMatrix4fv(M.u.uVP, false, mVP);
    gl.uniform3fv(M.u.uSunDir, sd); gl.uniform3fv(M.u.uSunCol, en.sun);
    gl.uniform3fv(M.u.uAmbTop, [0.42 * (0.5 + en.day * 0.8), 0.47 * (0.5 + en.day * 0.8), 0.58 * (0.5 + en.day * 0.8)]);
    gl.uniform3fv(M.u.uAmbBot, [0.18, 0.19, 0.22]);
    gl.uniform3fv(M.u.uCam, ev); gl.uniform3fv(M.u.uFog, en.bot); gl.uniform1f(M.u.uFogD, 0.0);  // no fog — crisp distance
    gl.uniform3fv(M.u.uWin, [1.0, 0.82, 0.46]); gl.uniform1f(M.u.uNight, en.night); gl.uniform1f(M.u.uTime, clock);
    gl.uniform1f(M.u.uExposure, 1.6); gl.uniform1f(M.u.uSat, 1.36); gl.uniform1f(M.u.uShadowOn, 0);
    gl.uniform1f(M.u.uToon, 1); gl.uniform1f(M.u.uVCol, 1); gl.uniform1f(M.u.uAlbedo, 0);
    gl.uniformMatrix4fv(M.u.uModel, false, mI);
    gl.activeTexture(gl.TEXTURE1); gl.uniform1i(M.u.uTex, 1);
    // flat (no tex), grit (grit tex), fac (window tex)
    gl.uniform1f(M.u.uTexMix, 0); drawMesh(M, meshFlat);
    gl.bindTexture(gl.TEXTURE_2D, gritTex); gl.uniform1f(M.u.uTexMix, 0.5); drawMesh(M, meshGrit);
    gl.bindTexture(gl.TEXTURE_2D, facTex); gl.uniform1f(M.u.uTexMix, 0.8); drawMesh(M, meshFac);
    // modern skyline (glTF assets)
    gl.uniform1f(M.u.uTexMix, 0); drawCity(M);
    // dynamic crane parts (flat colour) — transformed to the founded port frame
    gl.uniform1f(M.u.uVCol, 0); gl.uniform1f(M.u.uTexMix, 0); gl.uniform1f(M.u.uAlbedo, 0); gl.uniform1f(M.u.uRough, 0.5);
    var pf = scene.port, pc = pf ? Math.cos(pf.yaw) : 1, psn = pf ? Math.sin(pf.yaw) : 0;
    for (i = 0; i < parts.length; i++) {
      var t = parts[i].t, lx = t[0], lz = t[2];
      var wx = pf ? lx * pc + lz * psn + pf.x : lx, wz = pf ? -lx * psn + lz * pc + pf.z : lz, wy = t[1] + (pf ? pf.by : 0);
      gl.uniform3fv(M.u.uBase, parts[i].c); composeRYS(mModel, wx, wy, wz, parts[i].s[0], parts[i].s[1], parts[i].s[2], pf ? pf.yaw : 0); gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh);
    }
    // living port: sailing boats + wheeling gulls (flat-colour, same program state as crane parts)
    if (scene.port) drawAmbient(M);

    // curated harbour beacons (highlight each candidate; the selected one taller, brighter, pulsing)
    if (foundMode() && sites.length) {
      for (var si = 0; si < sites.length; si++) {
        var s = sites[si], sy = HARBOR_MODELS.heightAt(s.x, s.z), on = si === selSite;
        var pulse = on ? 1 + 0.12 * Math.sin(clock * 4) : 1;
        gl.uniform3fv(M.u.uBase, on ? [1.7, 1.35, 0.25] : [0.35, 0.95, 1.25]);
        composeRYS(mModel, s.x, sy + 11 * pulse, s.z, on ? 1.7 : 1.2, 22 * pulse, on ? 1.7 : 1.2, 0); gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh);
      }
    }

    // soft contact shadows
    drawBlobs();

    // water
    var W = E.P_water; gl.useProgram(W.p); gl.uniformMatrix4fv(W.u.uVP, false, mVP); gl.uniform1f(W.u.uTime, clock);
    gl.uniform3fv(W.u.uCam, ev); gl.uniform3fv(W.u.uSunDir, sd); gl.uniform3fv(W.u.uSunCol, en.sun);
    gl.uniform3fv(W.u.uDeep, biome.deep); gl.uniform3fv(W.u.uShallow, biome.shallow);
    gl.uniform3fv(W.u.uSky, en.bot); gl.uniform3fv(W.u.uFog, en.bot); gl.uniform1f(W.u.uFogD, 0.0);
    gl.uniform1f(W.u.uExposure, 1.58); gl.uniform1f(W.u.uSat, 1.25);
    gl.disable(gl.CULL_FACE); drawMesh(W, waterMesh); gl.enable(gl.CULL_FACE);
  }

  // ---- founding a harbour (tap the wild coast; rated) ----
  var foundPanel = null, foundLabel = null, foundBtn = null, siteChips = null;
  function foundMode() { return !founded[biomeId]; }
  // screen px -> world point on the sea-level plane (y=0), via a camera-basis ray (no matrix invert)
  function screenToGround(sx, sy) {
    var ev = eye(), fx = C.tx - ev[0], fy = C.ty - ev[1], fz = C.tz - ev[2], fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    var rx = -fz, rz = fx, rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;            // right = forward × up(0,1,0)
    var ux = rz * fy - 0 * fz, uy = 0 * fz - rx * fz, uz = rx * 0 - rz * fy;            // up' = right × forward
    var th = Math.tan(0.82 / 2), asp = (CW || 1) / (CH || 1);
    var ndcx = sx / CW * 2 - 1, ndcy = 1 - sy / CH * 2;
    var dx = fx + rx * ndcx * th * asp + ux * ndcy * th, dy = fy + uy * ndcy * th, dz = fz + rz * ndcx * th * asp + uz * ndcy * th;
    var dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    if (Math.abs(dy) < 1e-4) return null;
    var t = -ev[1] / dy; if (t < 0) return null;
    return { x: ev[0] + dx * t, z: ev[2] + dz * t };
  }
  // camera azimuth that views a site from offshore (downhill = toward open sea)
  function seaAz(x, z) { var e = 8, gx = HARBOR_MODELS.heightAt(x + e, z) - HARBOR_MODELS.heightAt(x - e, z), gz = HARBOR_MODELS.heightAt(x, z + e) - HARBOR_MODELS.heightAt(x, z - e); return Math.atan2(-gx, -gz); }
  function selectSite(i, fly) {
    if (i < 0 || i >= sites.length) return;
    selSite = i; var s = sites[i];
    if (fly !== false) { C.txT = s.x; C.tzT = s.z; C.distT = 138; C.elT = 0.5; C.azT = seaAz(s.x, s.z); if (hintEl) hintEl.classList.add('gone'); }
    if (foundLabel) foundLabel.innerHTML = s.name + '  ' + '★★★'.slice(0, s.stars) + '☆☆☆'.slice(0, 3 - s.stars);
    if (foundBtn) foundBtn.disabled = false;
    if (siteChips) for (var k = 0; k < siteChips.children.length; k++) siteChips.children[k].classList.toggle('on', k === i);
  }
  // tap on the scene -> select the nearest curated site (if reasonably close)
  function scoutAt(sx, sy) {
    var p = screenToGround(sx, sy); if (!p || !sites.length) return;
    var bi = -1, bd = 1e9; for (var i = 0; i < sites.length; i++) { var d = Math.hypot(sites[i].x - p.x, sites[i].z - p.z); if (d < bd) { bd = d; bi = i; } }
    if (bi >= 0 && bd < 220) selectSite(bi);
  }
  function confirmFound() { if (selSite >= 0 && sites[selSite]) { var s = sites[selSite]; foundHere(s.x, s.z, s.yaw); if (foundPanel) foundPanel.classList.remove('show'); updateFoundUI(); } }
  function updateFoundUI() {
    if (!foundPanel) return;
    if (foundMode()) {
      foundPanel.classList.add('show');
      if (sites.length === 1 && selSite < 0) selectSite(0, false);    // one obvious harbour — pre-select it
      if (foundBtn) foundBtn.disabled = selSite < 0;
      if (selSite < 0 && foundLabel) foundLabel.textContent = 'Choose your harbour';
    } else { foundPanel.classList.remove('show'); }
  }
  function autoFound() { var ss = sites.length ? sites : HARBOR_MODELS.sites(); if (ss[0]) foundHere(ss[0].x, ss[0].z, ss[0].yaw); }

  // ---- input: PAN-FIRST. 1 finger / left-drag = travel along the coast; pinch / wheel = zoom;
  // 2-finger twist (or right-drag / Shift+drag) = rotate; tap = scout; arrow keys / WASD pan. ----
  var ptrs = new Map(), pinchPrev = 0, panPrev = null, twistPrev = null, lastTap = 0, downPt = null, moved = false, multi = false, orbitMode = false;
  function pxy(e) { var b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
  function defaultView() {
    if (founded[biomeId]) { C.azT = 2.42; C.elT = 0.5; C.distT = 150; C.txT = founded[biomeId].x; C.tzT = founded[biomeId].z; }
    else { C.azT = 2.42; C.elT = 0.56; C.distT = 360; C.txT = 0; C.tzT = 120; }   // frame the whole island
  }
  // content-follows-finger pan: move the focus so the world point grabbed at (ax,ay) ends up
  // under (bx,by). Uses real ground-ray hits, so it's never inverted at any angle/zoom.
  function panDrag(ax, ay, bx, by) {
    var g0 = screenToGround(ax, ay), g1 = screenToGround(bx, by);
    if (!g0 || !g1) return;
    var ddx = g0.x - g1.x, ddz = g0.z - g1.z;
    C.txT = clamp(C.txT + ddx, -PANX, PANX); C.tzT = clamp(C.tzT + ddz, PANZ0, PANZ1);
    C.vTx = ddx; C.vTz = ddz;
  }
  if (canvas.addEventListener) {
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('pointerdown', function (e) {
      if (window.Juice && !muted) Juice.Audio.unlock();           // unlock WebAudio on first gesture
      if (canvas.setPointerCapture) try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
      ptrs.set(e.pointerId, pxy(e)); C.vAz = C.vEl = C.vTx = C.vTz = 0;
      if (ptrs.size === 1) { downPt = pxy(e); moved = false; multi = false; orbitMode = (e.button === 2 || e.shiftKey); var now = Date.now(); if (now - lastTap < 300) defaultView(); lastTap = now; }
      else { multi = true; pinchPrev = 0; panPrev = null; twistPrev = null; }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!ptrs.has(e.pointerId)) return;
      var p = pxy(e), prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, p);
      if (ptrs.size === 1) {
        var dx = p.x - prev.x, dy = p.y - prev.y;
        if (downPt && Math.hypot(p.x - downPt.x, p.y - downPt.y) > 8) { moved = true; if (hintEl) hintEl.classList.add('gone'); }
        if (orbitMode) { C.azT -= dx * 0.0045; C.elT = clamp(C.elT - dy * 0.0035, 0.14, 1.3); C.vAz = -dx * 0.0045; C.vEl = -dy * 0.0035; }
        else panDrag(prev.x, prev.y, p.x, p.y);              // pan-first: drag travels along the coast (natural)
      } else if (ptrs.size >= 2) {
        var pts = Array.from(ptrs.values()), a = pts[0], b = pts[1];
        var d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinchPrev) { var f = clamp(pinchPrev / d, 0.5, 1.5); C.distT = clamp(C.distT * f, 40, 520); }
        pinchPrev = d;
        var ang = Math.atan2(a.y - b.y, a.x - b.x);          // twist -> rotate
        if (twistPrev != null) { var da = ang - twistPrev; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; C.azT += da; C.vAz = da; }
        twistPrev = ang;
        if (panPrev) panDrag(panPrev.x, panPrev.y, mid.x, mid.y);
        panPrev = mid;
      }
    });
    function up(e) {
      var was = ptrs.has(e.pointerId);
      if (ptrs.delete(e.pointerId) && canvas.releasePointerCapture) try { canvas.releasePointerCapture(e.pointerId); } catch (x) {}
      if (was && !moved && !multi && ptrs.size === 0 && downPt) { if (foundMode()) scoutAt(downPt.x, downPt.y); }   // clean tap = scout
      if (ptrs.size < 2) { pinchPrev = 0; panPrev = null; twistPrev = null; multi = false; }
    }
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); var f = clamp(1 + e.deltaY * 0.0012, 0.8, 1.25); C.distT = clamp(C.distT * f, 40, 520); }, { passive: false });
    window.addEventListener('keydown', function (e) {
      var k = e.key, step = C.dist * 0.06, dx = 0, dz = 0;
      if (k === 'ArrowRight' || k === 'd' || k === 'D') dx = step;
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') dx = -step;
      else if (k === 'ArrowUp' || k === 'w' || k === 'W') dz = -step;
      else if (k === 'ArrowDown' || k === 's' || k === 'S') dz = step;
      else return;
      C.txT = clamp(C.txT + dx, -PANX, PANX); C.tzT = clamp(C.tzT + dz, PANZ0, PANZ1); C.vTx = C.vTz = 0; e.preventDefault();
    });
  }

  // ---- feel: audio + particle/popup helpers ----
  var muted = false, hudShownMoney = 0, prevMoney = 0, incomeTimer = 0, cine = null, ascendBanner = null;
  function sfx(name, a) { if (window.Juice && !muted) Juice.Audio.play(name, a); }
  function haptic(ms) { if (window.Juice) Juice.vibrate(ms); }
  function popWorld(wx, wy, wz, text, opts) { if (!FX) return; var s = worldToScreen(wx, wy, wz); if (s) FX.pop.add(s.x, s.y, text, opts); }
  function burstWorld(wx, wy, wz, opts) { if (!FX) return; var s = worldToScreen(wx, wy, wz); if (s) FX.p.burst(s.x, s.y, opts); }
  function shakeFX(m, d) { if (FX) FX.shake.add(m, d); }
  function portWorld() { var p = scene.port; return p ? { x: p.x, y: p.by + 4, z: p.z } : { x: C.tx, y: 4, z: C.tz }; }

  function confettiBurst() {
    if (!FX) return;
    for (var i = 0; i < 80; i++) FX.p.list.push({ x: Math.random() * CW, y: -12 - Math.random() * 70, vx: (Math.random() - 0.5) * 70, vy: 70 + Math.random() * 130, life: 2.0, max: 2.0, size: 5 + Math.random() * 4, color: ['#ff6b6b', '#ffd24a', '#4fd6c4', '#7fe0ff', '#c084fc', '#f2b35e'][(Math.random() * 6) | 0], gravity: 80, shape: 'rect' });
  }
  // ---- Era Ascension cinematic ----
  function startAscension(toEra, eraName, unlocksText, bonus) {
    cine = { t: 0, dur: 4.2, flashed: false, banner: false, toEra: toEra, name: eraName, unlocks: unlocksText, bonus: bonus, az0: C.azT };
    if (window.Juice && !muted) Juice.Audio.tone(170, 0.7, 'sawtooth', { vol: 0.3, glide: 340 });
    haptic([10, 40, 20]);
  }
  function updateCine(dt) {
    cine.t += dt; var t = cine.t, pw = portWorld();
    C.txT = pw.x; C.tzT = pw.z;
    if (t < 2.0) { C.distT = 270; C.elT = 0.88; C.azT = cine.az0 + 0.5 * (t / 2.0); }      // pull back + orbit
    if (t >= 2.0 && !cine.flashed) {                                                        // the bloom
      cine.flashed = true; era = cine.toEra; buildBiome(biomeId);
      if (cine.bonus && SIM.raw()) SIM.raw().money += cine.bonus;
      var p = portWorld();
      burstWorld(p.x, p.y, p.z, { count: 64, colors: ['#ffe27a', '#ffd24a', '#fff3c4', '#7fe0ff'], speed: 270, life: 1.5, size: 6, gravity: 110 });
      shakeFX(9, 0.6); sfx('win'); haptic(30); confettiBurst();
    }
    if (t >= 2.35 && !cine.banner) { cine.banner = true; showAscendBanner(cine.name, cine.unlocks, cine.bonus); }
    if (t >= cine.dur) { C.distT = 150; C.elT = 0.5; cine = null; }
  }
  function drawCine(ctx) {
    if (!cine) return; var t = cine.t;
    if (t < 2.0) { ctx.fillStyle = 'rgba(4,10,16,' + (0.4 * Math.min(1, t / 0.6)) + ')'; ctx.fillRect(0, 0, CW, CH); }
    if (t >= 1.94 && t < 2.75) { var a = t < 2.0 ? Math.min(1, (t - 1.94) / 0.06) : (1 - clamp((t - 2.0) / 0.7, 0, 1)); ctx.fillStyle = 'rgba(255,255,255,' + a + ')'; ctx.fillRect(0, 0, CW, CH); }
  }
  function showAscendBanner(name, unlocks, bonus) {
    if (!ascendBanner) { ascendBanner = document.createElement('div'); ascendBanner.id = 'ascendbanner'; wrap.appendChild(ascendBanner); }
    ascendBanner.innerHTML = '<div class="ab-sub">ERA ASCENSION</div><div class="ab-name">' + name + '</div>' + (unlocks ? '<div class="ab-unlock">Unlocked: ' + unlocks + '</div>' : '') + (bonus ? '<div class="ab-bonus">+ £' + fmt(bonus) + ' grant</div>' : '');
    ascendBanner.classList.remove('show'); void ascendBanner.offsetWidth; ascendBanner.classList.add('show');
    clearTimeout(showAscendBanner._t); showAscendBanner._t = setTimeout(function () { ascendBanner.classList.remove('show'); }, 2600);
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - (frame._l || now)) / 1000); frame._l = now;
    clock += dt; if (!paused) tod = (tod + dt * todSpeed) % 1;
    if (cine) updateCine(dt);
    if (ptrs.size === 0) {
      C.azT += C.vAz; C.elT = clamp(C.elT + C.vEl, 0.14, 1.3); C.vAz *= 0.92; C.vEl *= 0.92; if (Math.abs(C.vAz) < 1e-4) C.vAz = 0; if (Math.abs(C.vEl) < 1e-4) C.vEl = 0;
      C.txT = clamp(C.txT + C.vTx, -PANX, PANX); C.tzT = clamp(C.tzT + C.vTz, PANZ0, PANZ1); C.vTx *= 0.90; C.vTz *= 0.90; if (Math.abs(C.vTx) < 1e-3) C.vTx = 0; if (Math.abs(C.vTz) < 1e-3) C.vTz = 0;
    }
    var k = Math.min(1, dt * 11); C.az += (C.azT - C.az) * k; C.el += (C.elT - C.el) * k; C.dist += (C.distT - C.dist) * Math.min(1, dt * 9);
    C.tx += (C.txT - C.tx) * k; C.tz += (C.tzT - C.tz) * k;
    if (clockEl) { var hh = Math.floor(tod * 24), mm = Math.floor((tod * 24 % 1) * 60); clockEl.textContent = ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2); }
    // economy tick (founded ports earn over time)
    if (!paused && simReady()) {
      SIM.tick(dt);
      frame._hud = (frame._hud || 0) + dt; if (frame._hud > 0.2) { updateHUD(); frame._hud = 0; }
      frame._sv = (frame._sv || 0) + dt; if (frame._sv > 5) { SIM.mark(); frame._sv = 0; }
      var m = SIM.raw().money; if (!prevMoney) prevMoney = m;
      incomeTimer += dt;
      if (incomeTimer > 0.8) {                                   // floating +£ income from the port
        var d = m - prevMoney; if (d > 0.5 && !cine) { var pw = portWorld(); popWorld(pw.x, pw.y + 6, pw.z, '+£' + fmt(d), { color: '#ffe27a', size: 17, life: 1.15, vy: -52 }); }
        prevMoney = m; incomeTimer = 0;
      }
      hudShownMoney += (m - hudShownMoney) * Math.min(1, dt * 6);  // HUD counter tweens up
      if (hudMoney) hudMoney.textContent = fmt(hudShownMoney);
    }
    render();
    if (FX && fxCtx) {                                            // draw the 2D juice overlay (with screenshake)
      FX.p.update(dt); FX.pop.update(dt); var sh = FX.shake.update(dt);
      fxCtx.setTransform(1, 0, 0, 1, 0, 0); fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
      fxCtx.setTransform(DPR, 0, 0, DPR, sh.x * DPR, sh.y * DPR);
      drawCine(fxCtx);
      if (flashT > 0) { flashT -= dt; fxCtx.fillStyle = 'rgba(255,70,45,' + (0.32 * Math.max(0, flashT)) + ')'; fxCtx.fillRect(0, 0, fxCanvas.width, fxCanvas.height); }
      FX.p.draw(fxCtx); FX.pop.draw(fxCtx);
      canvas.style.transform = (sh.x || sh.y) ? ('translate(' + sh.x.toFixed(1) + 'px,' + sh.y.toFixed(1) + 'px)') : '';
    }
    if (tradeOpen) drawTradeMap();
    requestAnimationFrame(frame);
  }

  // ---- Trade Network map (full-screen 2D overlay over the 3D scene) ----
  // Islands are fixed nodes on a stylised sea; routes are animated lines that ship cargo between
  // your ports. Tap two founded ports to open a route; tap a route to upgrade/remove it.
  var tradeMap = null, tradeCanvas = null, tradeCtx = null, tradeOpen = false, tradeAct = null, tradeBar = null;
  var tradeSel = { node: null, route: null };
  var NODES = { green: [0.24, 0.66], tropical: [0.40, 0.40], mountain: [0.58, 0.23], nordic: [0.70, 0.70], desert: [0.84, 0.46] };
  var RESCOL = { fish: '#57c7e0', timber: '#cf9a52', goods: '#b884f0' };
  function portFounded(id) { return !!(SIM && SIM.port && SIM.port(id)); }
  function ensureTradeMap() {
    if (tradeMap) return;
    tradeMap = document.createElement('div'); tradeMap.id = 'trademap';
    tradeMap.innerHTML = '<div class="tm-top"><span class="tm-title">Trade Network</span><span class="tm-lvl" id="tm-lvl"></span><button class="tm-close" id="tm-close">✕</button></div>' +
      '<div class="tm-xp"><i id="tm-xpfill"></i></div>' +
      '<canvas id="tradecanvas"></canvas>' +
      '<div class="tm-act" id="tm-act"></div>';
    wrap.appendChild(tradeMap);
    tradeCanvas = tradeMap.querySelector('#tradecanvas'); tradeCtx = tradeCanvas.getContext('2d');
    tradeAct = tradeMap.querySelector('#tm-act'); tradeBar = tradeMap.querySelector('#tm-xpfill');
    tradeMap.querySelector('#tm-close').addEventListener('click', closeTrade);
    tradeCanvas.addEventListener('pointerdown', function (e) { var r = tradeCanvas.getBoundingClientRect(); tradeTap(e.clientX - r.left, e.clientY - r.top); });
    sizeTrade();
  }
  function sizeTrade() {
    if (!tradeCanvas) return;
    var r = tradeMap.getBoundingClientRect();
    tradeCanvas.width = Math.max(2, r.width * DPR); tradeCanvas.height = Math.max(2, (r.height - 0) * DPR);
    tradeCanvas.style.width = r.width + 'px'; tradeCanvas.style.height = r.height + 'px';
  }
  function openTrade() {
    if (!SIM || !SIM.raw()) return;
    ensureTradeMap(); tradeOpen = true; tradeSel = { node: null, route: null };
    tradeMap.classList.add('show'); sizeTrade(); renderTradeAct(); sfx('tap'); haptic(10);
  }
  function closeTrade() { tradeOpen = false; if (tradeMap) tradeMap.classList.remove('show'); }
  function nodeXY(id) { var p = NODES[id] || [0.5, 0.5], w = tradeCanvas.width, h = tradeCanvas.height; return [p[0] * w, p[1] * h]; }
  function tradeTap(sx, sy) {
    sx *= DPR; sy *= DPR;
    var net = SIM.network(), hitR = null;
    // routes first (thin targets) — midpoint hit
    for (var i = 0; i < net.routes.length; i++) {
      var rt = net.routes[i], A = nodeXY(rt.a), B = nodeXY(rt.b);
      if (segDist(sx, sy, A[0], A[1], B[0], B[1]) < 18 * DPR) { hitR = rt; break; }
    }
    var hitN = null;
    for (var id in NODES) { var c = nodeXY(id); if (Math.hypot(sx - c[0], sy - c[1]) < 30 * DPR) { hitN = id; break; } }
    if (hitN) {
      tradeSel.route = null;
      if (!portFounded(hitN)) { showTradeMsg('Found this harbour first'); tradeSel.node = null; }
      else if (!tradeSel.node) { tradeSel.node = hitN; sfx('tap'); }
      else if (tradeSel.node === hitN) { tradeSel.node = null; }
      else { tradeSel.dest = hitN; renderTradeAct(); sfx('tap'); return; }   // src+dest chosen -> builder
    } else if (hitR) {
      tradeSel.node = null; tradeSel.dest = null; tradeSel.route = hitR.id; sfx('tap');
    } else { tradeSel.node = null; tradeSel.dest = null; tradeSel.route = null; }
    renderTradeAct();
  }
  function showTradeMsg(m) { if (tradeAct) { tradeAct.innerHTML = '<div class="ta-msg">' + m + '</div>'; } }
  function wname(id) { return (window.HARBOR_BIOMES[id] && HARBOR_BIOMES[id].name) || id; }
  function renderTradeAct() {
    if (!tradeAct) return;
    var net = SIM.network();
    var lvlEl = document.getElementById('tm-lvl'); if (lvlEl) lvlEl.textContent = 'Lv ' + net.level + ' · ' + net.routes.length + '/' + net.maxRoutes + ' routes' + (net.insurance ? ' · insured' : '');
    if (tradeBar) tradeBar.style.width = Math.round(100 * net.xp / Math.max(1, net.need)) + '%';
    // building a route (source + dest selected)
    if (tradeSel.node && tradeSel.dest) {
      var a = tradeSel.node, b = tradeSel.dest, html = '<div class="ta-head">Ship from <b>' + wname(a) + '</b> → <b>' + wname(b) + '</b></div><div class="ta-res">';
      ['fish', 'timber', 'goods'].forEach(function (res) {
        var can = SIM.canAddRoute(a, b, res), cost = net.routeCreateCost;
        html += '<button class="ta-rbtn" data-res="' + res + '"' + (can ? '' : ' disabled') + ' style="border-color:' + RESCOL_(res) + '"><span>' + res + '</span><span class="ta-cost">£' + fmt(cost) + '</span></button>';
      });
      html += '</div><button class="ta-cancel" data-cancel="1">Cancel</button>';
      tradeAct.innerHTML = html;
      tradeAct.querySelectorAll('[data-res]').forEach(function (el) { el.addEventListener('click', function () { var res = el.getAttribute('data-res'); if (SIM.addRoute(a, b, res)) { tradeSel = { node: null, route: null }; sfx('merge'); haptic(18); renderTradeAct(); } else sfx('lose'); }); });
      tradeAct.querySelector('[data-cancel]').addEventListener('click', function () { tradeSel = { node: null, route: null }; renderTradeAct(); });
      return;
    }
    // inspecting a route
    if (tradeSel.route) {
      var rt = null; for (var i = 0; i < net.routes.length; i++) if (net.routes[i].id === tradeSel.route) rt = net.routes[i];
      if (rt) {
        tradeAct.innerHTML = '<div class="ta-head"><span class="ta-dot" style="background:' + RESCOL_(rt.res) + '"></span>' + wname(rt.a) + ' → ' + wname(rt.b) + ' · ' + rt.res + ' L' + rt.level + '</div>' +
          '<div class="ta-stat">' + rt.cap.toFixed(1) + '/s · £' + rt.tariff.toFixed(2) + '/unit tariff</div>' +
          '<div class="ta-row"><button class="ta-up" data-up="1">Upgrade £' + fmt(rt.up) + '</button><button class="ta-rm" data-rm="1">Remove</button></div>';
        tradeAct.querySelector('[data-up]').addEventListener('click', function () { if (SIM.upgradeRoute(rt.id)) { sfx('merge'); haptic(16); renderTradeAct(); } else sfx('lose'); });
        tradeAct.querySelector('[data-rm]').addEventListener('click', function () { SIM.removeRoute(rt.id); tradeSel.route = null; sfx('pop'); renderTradeAct(); });
        return;
      }
    }
    // default hint + network perks
    var founded = 0; for (var id in NODES) if (portFounded(id)) founded++;
    var perk = 'Network Lv ' + net.level + ' — +' + net.capPct + '% capacity, +' + net.tariffPct + '% tariffs' + (net.insurance ? ', storm insurance' : ', insurance at Lv 3');
    var hint = founded < 2 ? 'Found a second harbour to open trade routes.' : (tradeSel.node ? 'Now tap another port to ship to.' : 'Tap a port, then another, to build a route.');
    tradeAct.innerHTML = '<div class="ta-msg">' + hint + '</div><div class="ta-perk">' + perk + '</div>';
  }
  function RESCOL_(res) { return RESCOL[res] || '#9fb0bd'; }
  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; if (l2 === 0) return Math.hypot(px - ax, py - ay);
    var t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function drawTradeMap() {
    if (!tradeCtx) return;
    var w = tradeCanvas.width, h = tradeCanvas.height, ctx = tradeCtx, t = clock, net = SIM.network();
    var grd = ctx.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#0a2230'); grd.addColorStop(1, '#06151f');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
    // faint grid swell
    ctx.strokeStyle = 'rgba(120,200,220,.05)'; ctx.lineWidth = 1;
    for (var gx = 0; gx < w; gx += 46 * DPR) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
    for (var gy = 0; gy < h; gy += 46 * DPR) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
    // routes
    for (var i = 0; i < net.routes.length; i++) {
      var rt = net.routes[i], A = nodeXY(rt.a), B = nodeXY(rt.b), col = RESCOL_(rt.res), sel = tradeSel.route === rt.id;
      ctx.strokeStyle = col; ctx.globalAlpha = sel ? 1 : 0.7; ctx.lineWidth = (sel ? 5 : 3) * DPR;
      ctx.setLineDash([10 * DPR, 8 * DPR]); ctx.lineDashOffset = -(t * 40 * DPR) % (18 * DPR);
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); ctx.setLineDash([]);
      // moving ship dots (one per level, capacity feel)
      var ships = Math.min(4, rt.level);
      for (var sN = 0; sN < ships; sN++) {
        var f = ((t * 0.18 + sN / ships) % 1), x = A[0] + (B[0] - A[0]) * f, y = A[1] + (B[1] - A[1]) * f;
        ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 4.5 * DPR, 0, 6.283); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // proposed link preview (src selected, awaiting dest)
    if (tradeSel.node) { var c0 = nodeXY(tradeSel.node); ctx.fillStyle = 'rgba(255,220,120,.9)'; ctx.beginPath(); ctx.arc(c0[0], c0[1], 34 * DPR, 0, 6.283); ctx.globalAlpha = 0.18 + 0.06 * Math.sin(t * 4); ctx.fill(); ctx.globalAlpha = 1; }
    // nodes
    for (var id in NODES) {
      var c = nodeXY(id), fnd = portFounded(id), unl = isUnlocked(id);
      ctx.beginPath(); ctx.arc(c[0], c[1], 22 * DPR, 0, 6.283);
      ctx.fillStyle = fnd ? '#163a4a' : 'rgba(20,40,52,.55)';
      ctx.fill();
      ctx.lineWidth = (tradeSel.node === id ? 4 : 2.5) * DPR;
      ctx.strokeStyle = fnd ? (tradeSel.node === id ? '#ffd56a' : '#4fd6c4') : 'rgba(150,175,190,.4)';
      ctx.stroke();
      // label
      ctx.fillStyle = fnd ? '#eaf4f7' : 'rgba(190,205,214,.7)';
      ctx.font = '700 ' + (12 * DPR) + 'px Fredoka, system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(wname(id), c[0], c[1] - 30 * DPR);
      if (!unl) { ctx.fillStyle = 'rgba(190,205,214,.8)'; ctx.font = (15 * DPR) + 'px system-ui'; ctx.fillText('🔒', c[0], c[1] + 5 * DPR); }
      else if (!fnd) { ctx.fillStyle = 'rgba(190,205,214,.7)'; ctx.font = (10 * DPR) + 'px Fredoka, sans-serif'; ctx.fillText('unfounded', c[0], c[1] + 4 * DPR); }
      else { ctx.fillStyle = '#cfe9f0'; ctx.font = '600 ' + (9.5 * DPR) + 'px Fredoka, sans-serif'; var hint = (SIM.WORLD_SPEC[id] || {}).hint || ''; ctx.fillText(hint.split(' ')[0], c[0], c[1] + 4 * DPR); }
    }
    ctx.textAlign = 'left';
  }

  // ---- unlockable worlds ----
  var LOCK = '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path d="M7 10V7a5 5 0 0110 0v3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5" y="10" width="14" height="10" rx="2" fill="currentColor"/></svg>';
  function isUnlocked(id) { return unlocked.indexOf(id) >= 0; }
  function loadUnlocked() {
    var saved = window.Retention && Retention.get(GAME, 'worlds', null);
    if (saved && saved.length) unlocked = saved.slice();
    if (unlocked.indexOf('green') < 0) unlocked.unshift('green');
  }
  function saveUnlocked() { if (window.Retention) Retention.set(GAME, 'worlds', unlocked); }
  function unlockWorld(id) { if (HARBOR_BIOMES[id] && unlocked.indexOf(id) < 0) { unlocked.push(id); saveUnlocked(); if (buildSelector._set) buildSelector._set(); } }
  function showHint(msg) { if (!hintEl) return; hintEl.textContent = msg; hintEl.classList.remove('gone'); clearTimeout(showHint._t); showHint._t = setTimeout(function () { hintEl.classList.add('gone'); }, 1900); }

  // ---- world-select UI (unlocked = playable, locked = shows unlock condition) ----
  function buildSelector() {
    var bar = document.createElement('div'); bar.id = 'biomebar';
    HARBOR_BIOME_ORDER.forEach(function (id) {
      var w = HARBOR_BIOMES[id], btn = document.createElement('button');
      btn.className = 'biome-btn'; btn.setAttribute('data-world', id);
      btn.innerHTML = '<span class="bn">' + w.name + '</span>';
      btn.addEventListener('click', function () {
        if (isUnlocked(id)) { buildBiome(id); setActive(); }
        else showHint(w.unlockLabel || 'Locked');
      });
      bar.appendChild(btn);
    });
    wrap.appendChild(bar);
    function setActive() {
      var bs = bar.querySelectorAll('.biome-btn');
      for (var i = 0; i < bs.length; i++) {
        var id = bs[i].getAttribute('data-world'), lk = !isUnlocked(id), badge = bs[i].querySelector('.lock');
        bs[i].classList.toggle('on', id === biomeId);
        bs[i].classList.toggle('locked', lk);
        if (lk && !badge) { badge = document.createElement('span'); badge.className = 'lock'; badge.innerHTML = LOCK; bs[i].appendChild(badge); }
        else if (!lk && badge) badge.parentNode.removeChild(badge);
      }
    }
    setActive(); buildSelector._set = setActive;
  }

  // ---- founding prompt UI ----
  function buildSiteChips() {
    if (!siteChips) return;
    siteChips.innerHTML = '';
    if (sites.length <= 1) { siteChips.style.display = 'none'; return; }   // single obvious harbour: just label + button
    siteChips.style.display = '';
    sites.forEach(function (s, i) {
      var c = document.createElement('button'); c.className = 'site-chip';
      c.innerHTML = '<span class="sn">' + s.name + '</span><span class="ss">' + '★★★'.slice(0, s.stars) + '</span>';
      c.addEventListener('click', function () { selectSite(i); });
      siteChips.appendChild(c);
    });
  }
  function buildFoundUI() {
    foundPanel = document.createElement('div'); foundPanel.id = 'foundpanel';
    foundLabel = document.createElement('span'); foundLabel.id = 'foundlabel'; foundLabel.textContent = 'Choose your harbour';
    siteChips = document.createElement('div'); siteChips.id = 'sitechips';
    foundBtn = document.createElement('button'); foundBtn.id = 'foundbtn'; foundBtn.textContent = 'Found village'; foundBtn.disabled = true;
    foundBtn.addEventListener('click', confirmFound);
    foundPanel.appendChild(foundLabel); foundPanel.appendChild(siteChips); foundPanel.appendChild(foundBtn);
    wrap.appendChild(foundPanel); buildSiteChips(); updateFoundUI();
  }

  // ---- economy HUD + port management ----
  var econHud = null, hudMoney = null, hudFish = null, hudPop = null, advBtn = null, managePanel = null, manageOpen = false;
  var SIM = window.HARBOR_SIM || null;
  function simReady() { return !!(SIM && SIM.port && SIM.port()); }   // active world's port exists
  // idle number notation: 1.2k, 3.40M, 5.7B … Td, then scientific. Stays readable as numbers explode.
  var NUM_SUF = ['', 'k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td'];
  function fmt(n) {
    n = +n || 0; var neg = n < 0; n = Math.abs(n);
    if (n < 1000) return (neg ? '-' : '') + Math.round(n);
    var tier = Math.floor(Math.log10(n) / 3);
    if (tier < NUM_SUF.length) { var s = n / Math.pow(10, tier * 3); return (neg ? '-' : '') + (s < 10 ? s.toFixed(2) : s < 100 ? s.toFixed(1) : Math.round(s)) + NUM_SUF[tier]; }
    return (neg ? '-' : '') + n.toExponential(2).replace('e+', 'e');
  }

  var eraBar = null, muteBtn = null, goalBanner = null, legacyBtn = null;
  var statFlags = { orders: 0 };                              // session counters for objectives
  // guided objective ladder — each completes once, pays a small reward + juice, then reveals the next
  var GOALS = [
    { t: 'Build a Fishing Hut', ok: function (s) { return (s.counts.fishing_hut || 0) >= 1; }, r: 30 },
    { t: 'House a crew — build a Cottage', ok: function (s) { return (s.counts.cottage || 0) >= 1; }, r: 40 },
    { t: 'Sell your catch — build a Jetty', ok: function (s) { return (s.counts.jetty || 0) >= 1; }, r: 60 },
    { t: 'Bank £250', ok: function (s) { return s.money >= 250; }, r: 80 },
    { t: 'Advance to the Trading Post', ok: function (s) { return s.era >= 1; }, r: 120 },
    { t: 'Fulfil a harbour Order', ok: function () { return statFlags.orders >= 1; }, r: 120 },
    { t: 'Store more — build a Warehouse', ok: function (s) { return (s.counts.warehouse || 0) >= 1; }, r: 150 },
    { t: 'Hire your first Manager', ok: function (s) { return mgrTotal(s) >= 1; }, r: 180 },
    { t: 'Open a Fish Market', ok: function (s) { return (s.counts.market || 0) >= 1; }, r: 240 },
    { t: 'Rise to the Industrial Port', ok: function (s) { return s.era >= 2; }, r: 500 },
    { t: 'Build a Sawmill', ok: function (s) { return (s.counts.sawmill || 0) >= 1; }, r: 500 },
    { t: 'Manufacture goods — build a Factory', ok: function (s) { return (s.counts.factory || 0) >= 1; }, r: 700 },
    { t: 'Ship cargo — build a Cargo Dock', ok: function (s) { return (s.counts.dock || 0) >= 1; }, r: 900 },
    { t: 'Grow into a Metropolis', ok: function (s) { return s.era >= 3; }, r: 2000 },
    { t: 'Found a second harbour', ok: function (s) { return (s.ports || []).length >= 2; }, r: 600 },
    { t: 'Open your first trade route', ok: function (s) { return s.network && s.network.routes.length >= 1; }, r: 700 },
    { t: 'Weather a storm', ok: function (s) { return s.stats && s.stats.storms >= 1; }, r: 500 },
    { t: 'Raise the trade network to Lv 2', ok: function (s) { return s.network && s.network.level >= 2; }, r: 1000 },
    { t: 'Insure your empire — network Lv 3', ok: function (s) { return s.network && s.network.level >= 3; }, r: 2500 },
    { t: 'Found all five harbours', ok: function (s) { return (s.ports || []).length >= 5; }, r: 8000 }
  ];
  var goalIdx = 0;
  function mgrTotal(s) { var n = 0, m = s.managers || {}; for (var k in m) n += m[k].lvl || 0; return n; }
  function loadGoal() { var g = window.Retention && Retention.get(GAME, 'goal', null); goalIdx = (g && typeof g.i === 'number') ? g.i : 0; }
  function saveGoal() { if (window.Retention) Retention.set(GAME, 'goal', { i: goalIdx }); }
  function setGoalText(s) {
    if (!goalBanner) return;
    if (goalIdx >= GOALS.length) { goalBanner.querySelector('.gb-text').textContent = 'Port master — every goal complete!'; goalBanner.querySelector('.gb-rew').textContent = ''; return; }
    var g = GOALS[goalIdx];
    goalBanner.querySelector('.gb-text').textContent = g.t;
    goalBanner.querySelector('.gb-rew').textContent = '+£' + fmt(g.r);
  }
  function checkGoals(s) {
    if (!goalBanner || !s) return;
    goalBanner.classList.toggle('show', simReady() && !cine);
    if (goalIdx >= GOALS.length) { setGoalText(s); return; }
    var g = GOALS[goalIdx];
    if (g.ok(s)) {
      if (SIM.raw()) { SIM.raw().money += g.r; SIM.save(); }
      var pw = portWorld(); popWorld(pw.x, pw.y + 9, pw.z, 'Goal! +£' + fmt(g.r), { color: '#9ef0b0', size: 18, life: 1.5 });
      burstWorld(pw.x, pw.y, pw.z, { count: 22, colors: ['#9ef0b0', '#fff3c4', '#bfe9ff'], speed: 180, life: 1.0 });
      sfx('score'); haptic(22); shakeFX(3, 0.25);
      goalBanner.classList.add('hit'); setTimeout(function () { goalBanner && goalBanner.classList.remove('hit'); }, 500);
      goalIdx++; saveGoal();
    }
    setGoalText(s);
  }

  // ---- hazards: storm warning banner + strike juice (consumes the sim's telegraph/strike signals) ----
  var lastStrikeId = 0, stormAlert = null, flashT = 0;
  function ensureStormAlert() {
    if (stormAlert) return;
    stormAlert = document.createElement('div'); stormAlert.id = 'stormalert';
    stormAlert.innerHTML = '<span class="sa-ic">⚠</span><span class="sa-txt"></span><span class="sa-cd"></span>';
    wrap.appendChild(stormAlert);
  }
  function handleHazard(s) {
    var hz = s.hazard || { phase: 'idle', strikeId: 0 };
    ensureStormAlert();
    if (hz.phase === 'warn' && hz.port) {
      stormAlert.classList.remove('crash');
      stormAlert.querySelector('.sa-txt').textContent = (hz.kind || 'Storm') + ' approaching ' + wname(hz.port);
      stormAlert.querySelector('.sa-cd').textContent = hz.in + 's';
      stormAlert.classList.add('show');
    } else if (s.crash) {
      stormAlert.classList.add('crash');
      stormAlert.querySelector('.sa-txt').textContent = 'Market crash — ' + s.crash.res + ' prices slump';
      stormAlert.querySelector('.sa-cd').textContent = s.crash.t + 's';
      stormAlert.classList.add('show');
    } else { stormAlert.classList.remove('show'); }
    // a fresh strike fired in the sim — react with juice
    if (hz.strikeId && hz.strikeId !== lastStrikeId) {
      lastStrikeId = hz.strikeId; var last = hz.last;
      shakeFX(11, 0.7); flashT = 0.85; sfx('lose'); haptic([10, 50, 20]); bumpDaily('storm');
      if (Math.random() < 0.35) { grantCrate(1); showHint('Salvage washed ashore — a crate! 🎁'); }   // storms occasionally drop salvage
      if (last && last.crash) { showHint('Market crash — ' + last.res + ' prices slump'); }
      else if (last) {
        showHint((last.kind || 'Storm') + ' hit ' + wname(last.port) + '! ' + last.damaged + ' building' + (last.damaged === 1 ? '' : 's') + ' damaged');
        if (last.port === biomeId) { var pw = portWorld(); burstWorld(pw.x, pw.y, pw.z, { count: 32, colors: ['#9aa6ad', '#cdd6da', '#ffd24a', '#88b0c0'], speed: 230, life: 1.1, size: 5, gravity: 240 }); }
      }
    }
  }

  // ---- Legacy / Prestige: meta progression persisted across runs (via Retention, survives a wipe) ----
  var LEGACY_TREE = [
    { id: 'prod', name: 'Master Shipwrights', desc: '+25% global production / lvl', base: 3, mul: 1.6, per: 0.25, max: 30, meta: 'prodMul' },
    { id: 'sell', name: 'Trade Barons', desc: '+25% global sales / lvl', base: 3, mul: 1.6, per: 0.25, max: 30, meta: 'sellMul' },
    { id: 'start', name: 'Inheritance', desc: '+£1k starting money / lvl', base: 2, mul: 1.5, per: 1000, max: 25, meta: 'startMoney' },
    { id: 'offline', name: 'Standing Orders', desc: '+2h offline earnings / lvl', base: 5, mul: 1.8, per: 2, max: 8, meta: 'offlineHours' },
    { id: 'cost', name: 'Bulk Charters', desc: '−4% build costs / lvl', base: 4, mul: 1.7, per: 0.04, max: 15, meta: 'costMul' },
    { id: 'hazard', name: 'Storm Wardens', desc: '+6% storm resistance / lvl', base: 3, mul: 1.6, per: 0.06, max: 12, meta: 'hazardResist' },
    { id: 'route', name: 'Trade Winds', desc: '+20% route capacity / lvl', base: 4, mul: 1.6, per: 0.20, max: 15, meta: 'routeMul' }
  ];
  function ln(id) { for (var i = 0; i < LEGACY_TREE.length; i++) if (LEGACY_TREE[i].id === id) return LEGACY_TREE[i]; return null; }
  function legacyBal() { return (window.Retention ? (Retention.get(GAME, 'legacyBal', 0) | 0) : 0); }
  function setLegacyBal(v) { if (window.Retention) Retention.set(GAME, 'legacyBal', Math.max(0, v | 0)); }
  function legacyTreeMap() { return (window.Retention && Retention.get(GAME, 'legacyTree', {})) || {}; }
  function legacyLvl(id) { return (legacyTreeMap()[id] || 0) | 0; }
  function legacyNodeCost(node) { return Math.round(node.base * Math.pow(node.mul, legacyLvl(node.id))); }
  function canBuyLegacy(node) { return legacyLvl(node.id) < node.max && legacyBal() >= legacyNodeCost(node); }
  function buyLegacy(id) {
    var node = ln(id); if (!node || !canBuyLegacy(node)) return false;
    setLegacyBal(legacyBal() - legacyNodeCost(node));
    var tr = legacyTreeMap(); tr[id] = (tr[id] || 0) + 1; Retention.set(GAME, 'legacyTree', tr);
    computeMeta(); return true;
  }
  function computeMeta() {
    var tr = legacyTreeMap(), M = { prodMul: 1, sellMul: 1, costMul: 1, startMoney: 0, offlineHours: 8, hazardResist: 0, routeMul: 1 };
    LEGACY_TREE.forEach(function (nd) {
      var amt = nd.per * (tr[nd.id] || 0);
      if (nd.meta === 'prodMul') M.prodMul = 1 + amt;
      else if (nd.meta === 'sellMul') M.sellMul = 1 + amt;
      else if (nd.meta === 'routeMul') M.routeMul = 1 + amt;
      else if (nd.meta === 'startMoney') M.startMoney = amt;
      else if (nd.meta === 'offlineHours') M.offlineHours = 8 + amt;
      else if (nd.meta === 'hazardResist') M.hazardResist = amt;
      else if (nd.meta === 'costMul') M.costMul = Math.max(0.2, 1 - amt);
    });
    // owned blueprints stack permanent bonuses on top of the Legacy tree
    if (window.Progress) BLUEPRINTS.forEach(function (bp) {
      if (!Progress.unlocked(GAME, bp.id)) return;
      if (bp.meta === 'prodMul') M.prodMul += bp.amt; else if (bp.meta === 'sellMul') M.sellMul += bp.amt;
      else if (bp.meta === 'routeMul') M.routeMul += bp.amt; else if (bp.meta === 'offlineHours') M.offlineHours += bp.amt;
      else if (bp.meta === 'hazardResist') M.hazardResist += bp.amt;
    });
    if (SIM && SIM.applyMeta) SIM.applyMeta(M);
    return M;
  }
  function doPrestige() {
    if (!SIM || !SIM.canPrestige() || cine) { sfx('lose'); return; }
    var gain = SIM.prestigeGain();
    setLegacyBal(legacyBal() + gain);
    if (window.Progress) Progress.addPrestige(GAME, gain);          // lifetime Legacy (achievements/leaderboard)
    computeMeta();                                                  // META now includes any newly-bought-able bonuses
    SIM.resetRun();                                                 // wipe the run; fresh() applies META start bonuses
    founded = {}; saveFounded(); era = 0; if (window.Retention) Retention.set(GAME, 'era', 0);
    closeLegacy();
    buildBiome('green'); if (buildSelector._set) buildSelector._set();
    autoFound();                                                   // re-found green so play continues immediately
    updateHUD();
    flashT = 0.9; shakeFX(6, 0.5); sfx('win'); haptic([10, 40, 20, 40]); confettiBurst();
    showHint('New Charter signed — +' + fmt(gain) + ' Legacy banked. Multipliers are permanent!');
  }

  // Legacy panel (full-screen overlay; reuses the trade-map panel pattern)
  var legacyPanel = null, legacyOpen = false;
  function ensureLegacy() {
    if (legacyPanel) return;
    legacyPanel = document.createElement('div'); legacyPanel.id = 'legacypanel';
    legacyPanel.innerHTML = '<div class="lg-top"><span class="lg-title">Legacy</span><span class="lg-bal" id="lg-bal"></span><button class="lg-close" id="lg-close">✕</button></div>' +
      '<div class="lg-prestige" id="lg-prestige"></div><div class="lg-tree" id="lg-tree"></div>';
    wrap.appendChild(legacyPanel);
    legacyPanel.querySelector('#lg-close').addEventListener('click', closeLegacy);
  }
  function openLegacy() { ensureLegacy(); legacyOpen = true; legacyPanel.classList.add('show'); renderLegacy(); sfx('tap'); }
  function closeLegacy() { legacyOpen = false; if (legacyPanel) legacyPanel.classList.remove('show'); }
  function renderLegacy() {
    if (!legacyPanel || !SIM) return;
    var p = SIM.state().prestige || { gain: 0, can: false };
    legacyPanel.querySelector('#lg-bal').textContent = '✦ ' + fmt(legacyBal()) + ' Legacy';
    var pres = legacyPanel.querySelector('#lg-prestige');
    pres.innerHTML = '<div class="lg-pdesc">Cash your empire\'s lifetime earnings into <b>Legacy</b> — a permanent multiplier on every future run.</div>' +
      '<button class="lg-pbtn" id="lg-pbtn"' + (p.can ? '' : ' disabled') + '>' + (p.can ? 'Sign a New Charter  ·  +' + fmt(p.gain) + ' ✦' : 'Reach £1M lifetime to prestige') + '</button>';
    var tree = legacyPanel.querySelector('#lg-tree'), html = '<div class="lg-sec">Permanent upgrades</div>';
    LEGACY_TREE.forEach(function (nd) {
      var lv = legacyLvl(nd.id), maxed = lv >= nd.max, can = canBuyLegacy(nd);
      html += '<button class="lg-node" data-leg="' + nd.id + '"' + ((can && !maxed) ? '' : ' disabled') + '>' +
        '<span class="ln-n">' + nd.name + ' <i>L' + lv + '</i></span><span class="ln-d">' + nd.desc + '</span>' +
        '<span class="ln-c">' + (maxed ? 'MAX' : '✦ ' + fmt(legacyNodeCost(nd))) + '</span></button>';
    });
    var owned = ownedBlueprints();
    if (owned.length) { html += '<div class="lg-sec">Blueprints collected (' + owned.length + '/' + BLUEPRINTS.length + ')</div>'; owned.forEach(function (bp) { html += '<div class="lg-bp"><span class="bp-n">📜 ' + bp.name + '</span><span class="bp-d">' + bp.desc + '</span></div>'; }); }
    tree.innerHTML = html;
    pres.querySelector('#lg-pbtn').addEventListener('click', function () { doPrestige(); renderLegacy(); });
    tree.querySelectorAll('[data-leg]').forEach(function (el) { el.addEventListener('click', function () { if (buyLegacy(el.getAttribute('data-leg'))) { sfx('merge'); haptic(16); renderLegacy(); updateHUD(); } else sfx('lose'); }); });
  }

  // ---- Daily cadence: rotating market tide, daily missions, login streak (reuses Progress/Retention) ----
  var TIDES = [
    { name: 'Fish Boom', desc: '+60% fish prices today', tide: { prod: 1, sell: { fish: 1.6 } } },
    { name: 'Timber Boom', desc: '+60% timber prices today', tide: { prod: 1, sell: { timber: 1.6 } } },
    { name: 'Goods Boom', desc: '+60% goods prices today', tide: { prod: 1, sell: { goods: 1.6 } } },
    { name: 'Calm Seas', desc: '+30% production today', tide: { prod: 1.3, sell: {} } },
    { name: 'Busy Docks', desc: '+25% all sales today', tide: { prod: 1, sell: { fish: 1.25, timber: 1.25, goods: 1.25 } } },
    { name: 'Fair Winds', desc: '+20% production & sales today', tide: { prod: 1.2, sell: { fish: 1.2, timber: 1.2, goods: 1.2 } } }
  ];
  function todayTide() { var seed = (window.Retention ? Retention.dailySeed(GAME) : 0); return TIDES[seed % TIDES.length]; }
  function applyTide() { if (SIM && SIM.setTide) SIM.setTide(todayTide().tide); }
  var DAILY_POOL = [
    { id: 'earn', text: 'Earn £25k today', target: 25000, reward: 2 },
    { id: 'build', text: 'Build 8 structures', target: 8, reward: 2 },
    { id: 'order', text: 'Fulfil 4 harbour orders', target: 4, reward: 3 },
    { id: 'ship', text: 'Ship 250 cargo', target: 250, reward: 3 },
    { id: 'storm', text: 'Weather 2 storms', target: 2, reward: 3 },
    { id: 'upgrade', text: 'Upgrade 6 buildings', target: 6, reward: 2 },
    { id: 'found', text: 'Found a new harbour', target: 1, reward: 4 },
    { id: 'manager', text: 'Hire 3 managers', target: 3, reward: 2 }
  ];
  function dailyList() { return window.Progress ? Progress.dailyMissions(GAME, DAILY_POOL, 3) : []; }
  function bumpDaily(kind, amt, absolute) {
    if (!window.Progress) return;
    var done = Progress.bumpMission(GAME, kind, amt == null ? 1 : amt, !!absolute);
    if (done) {
      setLegacyBal(legacyBal() + (done.reward || 1));
      var pw = portWorld(); popWorld(pw.x, pw.y + 11, pw.z, 'Daily done! +' + (done.reward || 1) + '✦', { color: '#9ef0b0', size: 17, life: 1.7 });
      burstWorld(pw.x, pw.y, pw.z, { count: 24, colors: ['#9ef0b0', '#fff3c4', '#d9b8ff'], speed: 190, life: 1.0 });
      sfx('score'); haptic(20); if (Math.random() < 0.35) grantCrate(1); if (manageOpen) renderManage();
    }
  }
  var dailyBase = { lm: null, sh: null };
  function trackDaily(s) {                                            // earn/ship missions tracked via snapshot deltas
    if (!window.Progress || !s) return;
    var lm = s.lifetimeMoney; if (dailyBase.lm == null) dailyBase.lm = lm; if (lm > dailyBase.lm) { bumpDaily('earn', lm - dailyBase.lm); dailyBase.lm = lm; }
    var sh = s.stats ? s.stats.shipped : 0; if (dailyBase.sh == null) dailyBase.sh = sh; if (sh > dailyBase.sh) { bumpDaily('ship', sh - dailyBase.sh); dailyBase.sh = sh; }
  }
  function showStreak() {                                             // once-per-day login reward
    if (!window.Retention) return;
    var last = Retention.get(GAME, 'lastDay', null), today = Retention.todayStr();
    var st = Retention.touchStreak(GAME);
    if (last !== today && st > 0) {
      var reward = Math.max(1, Math.min(10, st));
      setLegacyBal(legacyBal() + reward);
      showHint('Day ' + st + ' streak! +' + reward + '✦ Legacy · Today: ' + todayTide().name);
      setTimeout(function () { var pw = portWorld(); if (pw) burstWorld(pw.x, pw.y, pw.z, { count: 26, colors: ['#9ef0b0', '#ffe08a', '#d9b8ff'], speed: 200, life: 1.1 }); sfx('score'); }, 400);
    } else if (last === today) {
      showHint('Today: ' + todayTide().name + ' — ' + todayTide().desc);
    }
  }

  // ---- Salvage crates + blueprints (variable-ratio rewards: the dopamine layer) ----
  var BLUEPRINTS = [
    { id: 'bp_prod', name: 'Ancient Ledger', desc: '+10% production forever', meta: 'prodMul', amt: 0.10 },
    { id: 'bp_sell', name: 'Trade Compass', desc: '+10% sales forever', meta: 'sellMul', amt: 0.10 },
    { id: 'bp_off', name: 'Tide Charts', desc: '+1h offline forever', meta: 'offlineHours', amt: 1 },
    { id: 'bp_haz', name: 'Storm Glass', desc: '+8% storm resistance forever', meta: 'hazardResist', amt: 0.08 },
    { id: 'bp_route', name: 'Old Sea Maps', desc: '+15% route capacity forever', meta: 'routeMul', amt: 0.15 }
  ];
  function crateCount() { return window.Retention ? (Retention.get(GAME, 'crates', 0) | 0) : 0; }
  function setCrates(n) { if (window.Retention) Retention.set(GAME, 'crates', Math.max(0, n | 0)); }
  function grantCrate(n) { n = n || 1; setCrates(crateCount() + n); if (crateBtn) crateBtn.classList.add('bump'); setTimeout(function () { crateBtn && crateBtn.classList.remove('bump'); }, 400); }
  function ownedBlueprints() { var a = []; BLUEPRINTS.forEach(function (b) { if (window.Progress && Progress.unlocked(GAME, b.id)) a.push(b); }); return a; }
  function unownedBlueprints() { return BLUEPRINTS.filter(function (b) { return !(window.Progress && Progress.unlocked(GAME, b.id)); }); }
  // weighted roll → applies the reward, returns { tier, color, title, sub }
  function rollCrate() {
    var s = SIM.state(), r = Math.random(), tier, color, title, sub;
    var moneyBase = Math.max(50, (s.money || 0) * 0.15 + (s.era + 1) * 80);
    if (r < 0.50) {                                                    // common — cash
      tier = 'Common'; color = '#bfe9ff'; var amt = Math.round(moneyBase * (0.6 + Math.random() * 0.9));
      if (SIM.raw()) SIM.raw().money += amt; title = '+£' + fmt(amt); sub = 'Salvaged coin';
    } else if (r < 0.74) {                                             // common — resources into active port
      tier = 'Common'; color = '#8fe0c0'; var res = ['fish', 'timber', 'goods'][Math.floor(Math.random() * 3)];
      var port = SIM.port(); var q = Math.round((s.caps[res] || 80) * (0.4 + Math.random() * 0.6));
      if (port) port.res[res] = Math.min((s.caps[res] || 80) * 3, (port.res[res] || 0) + q);
      title = '+' + fmt(q) + ' ' + res; sub = 'Crate of cargo';
    } else if (r < 0.90) {                                             // rare — Legacy
      tier = 'Rare'; color = '#d9b8ff'; var lg = 1 + Math.floor(Math.random() * 3);
      setLegacyBal(legacyBal() + lg); title = '+' + lg + ' ✦ Legacy'; sub = 'Rare find';
    } else if (r < 0.985) {                                            // epic — production surge
      tier = 'Epic'; color = '#ffd24a'; var secs = 60 + Math.floor(Math.random() * 60);
      if (SIM.setBoost) SIM.setBoost(2, secs); title = '2× production'; sub = secs + 's surge!';
    } else {                                                           // legendary — a blueprint (or jackpot Legacy)
      tier = 'Legendary'; color = '#ff9a5a'; var pool = unownedBlueprints();
      if (pool.length) { var bp = pool[Math.floor(Math.random() * pool.length)]; if (window.Progress) Progress.unlock(GAME, bp.id); computeMeta(); title = bp.name; sub = bp.desc; }
      else { var jp = 15 + Math.floor(Math.random() * 25); setLegacyBal(legacyBal() + jp); title = '+' + jp + ' ✦ Legacy'; sub = 'Jackpot!'; }
    }
    return { tier: tier, color: color, title: title, sub: sub };
  }

  var crateModal = null, crateBtn = null, crateBusy = false;
  function ensureCrateModal() {
    if (crateModal) return;
    crateModal = document.createElement('div'); crateModal.id = 'cratemodal';
    crateModal.innerHTML = '<div class="cm-card"><div class="cm-box" id="cm-box">🎁</div><div class="cm-tier" id="cm-tier"></div><div class="cm-title" id="cm-title"></div><div class="cm-sub" id="cm-sub"></div><button class="cm-btn" id="cm-btn">Open</button></div>';
    wrap.appendChild(crateModal);
    crateModal.addEventListener('click', function (e) { if (e.target === crateModal && !crateBusy) closeCrate(); });
    crateModal.querySelector('#cm-btn').addEventListener('click', onCrateBtn);
  }
  function openCrate() { if (crateCount() <= 0) return; ensureCrateModal(); crateModal.classList.add('show'); resetCrateCard(); }
  function resetCrateCard() {
    crateBusy = false;
    crateModal.querySelector('#cm-box').textContent = '🎁'; crateModal.querySelector('#cm-box').className = 'cm-box';
    crateModal.querySelector('#cm-tier').textContent = ''; crateModal.querySelector('#cm-title').textContent = 'Salvage Crate';
    crateModal.querySelector('#cm-sub').textContent = crateCount() + ' to open';
    var b = crateModal.querySelector('#cm-btn'); b.textContent = 'Open'; b.disabled = crateCount() <= 0;
  }
  function onCrateBtn() {
    var b = crateModal.querySelector('#cm-btn');
    if (b.textContent === 'Open') {
      if (crateCount() <= 0 || crateBusy) return; crateBusy = true; setCrates(crateCount() - 1);
      var rew = rollCrate();
      var box = crateModal.querySelector('#cm-box'); box.classList.add('opening'); sfx('move');
      setTimeout(function () {
        box.textContent = rew.tier === 'Legendary' ? '🏆' : rew.tier === 'Epic' ? '⭐' : '✦';
        box.className = 'cm-box reveal'; box.style.color = rew.color;
        crateModal.querySelector('#cm-tier').textContent = rew.tier; crateModal.querySelector('#cm-tier').style.color = rew.color;
        crateModal.querySelector('#cm-title').textContent = rew.title; crateModal.querySelector('#cm-sub').textContent = rew.sub;
        b.textContent = crateCount() > 0 ? 'Open next' : 'Collect'; b.disabled = false; crateBusy = false;
        var pw = portWorld(); if (pw) burstWorld(pw.x, pw.y, pw.z, { count: rew.tier === 'Legendary' ? 50 : 28, colors: [rew.color, '#fff3c4', '#ffffff'], speed: 230, life: 1.2, size: 5 });
        sfx(rew.tier === 'Legendary' || rew.tier === 'Epic' ? 'win' : 'score'); haptic(rew.tier === 'Common' ? 14 : 26);
        if (rew.tier === 'Legendary') { confettiBurst(); shakeFX(5, 0.4); }
        updateHUD();
      }, 520);
    } else { closeCrate(); }
  }
  function closeCrate() { if (crateModal) crateModal.classList.remove('show'); }

  function buildEconUI() {
    econHud = document.createElement('div'); econHud.id = 'econhud';
    function chip(id, icon) { var s = document.createElement('span'); s.className = 'estat'; s.innerHTML = '<b>' + icon + '</b><i id="' + id + '">0</i>'; econHud.appendChild(s); return s.querySelector('i'); }
    hudMoney = chip('e-money', '£'); hudFish = chip('e-fish', 'Fish'); hudPop = chip('e-pop', 'Crew');
    muteBtn = document.createElement('button'); muteBtn.id = 'mutebtn'; muteBtn.textContent = '♪'; muteBtn.title = 'Sound';
    muteBtn.addEventListener('click', function () { muted = !muted; if (window.Juice) Juice.Audio.setMuted(muted); muteBtn.textContent = muted ? '♪̸' : '♪'; muteBtn.classList.toggle('off', muted); });
    var mBtn = document.createElement('button'); mBtn.id = 'managebtn'; mBtn.textContent = 'Manage port'; mBtn.addEventListener('click', toggleManage);
    var nBtn = document.createElement('button'); nBtn.id = 'netbtn'; nBtn.textContent = 'Trade network'; nBtn.addEventListener('click', openTrade);
    legacyBtn = document.createElement('button'); legacyBtn.id = 'legacybtn'; legacyBtn.textContent = '✦ Legacy'; legacyBtn.style.display = 'none'; legacyBtn.addEventListener('click', openLegacy);
    crateBtn = document.createElement('button'); crateBtn.id = 'cratebtn'; crateBtn.textContent = '🎁'; crateBtn.style.display = 'none'; crateBtn.addEventListener('click', openCrate);
    advBtn = document.createElement('button'); advBtn.id = 'advbtn'; advBtn.textContent = 'Advance era'; advBtn.style.display = 'none'; advBtn.addEventListener('click', doAdvance);
    econHud.appendChild(muteBtn); econHud.appendChild(advBtn); econHud.appendChild(crateBtn); econHud.appendChild(legacyBtn); econHud.appendChild(nBtn); econHud.appendChild(mBtn);
    wrap.appendChild(econHud);

    // always-visible era progress bar (goal-gradient carrot)
    eraBar = document.createElement('div'); eraBar.id = 'erabar';
    eraBar.innerHTML = '<div class="eb-fill"></div><div class="eb-label"></div><div class="eb-need"></div>';
    wrap.appendChild(eraBar);

    // guided objective banner — the "what next" carrot that makes early progress legible
    goalBanner = document.createElement('div'); goalBanner.id = 'goalbar';
    goalBanner.innerHTML = '<span class="gb-tick">◎</span><span class="gb-text"></span><span class="gb-rew"></span>';
    wrap.appendChild(goalBanner);

    managePanel = document.createElement('div'); managePanel.id = 'managepanel';
    wrap.appendChild(managePanel);
    updateHUD();
  }

  function updateHUD() {
    if (!econHud) return;
    var on = simReady();
    econHud.classList.toggle('show', on); if (eraBar) eraBar.classList.toggle('show', on && !cine);
    if (!on) { if (managePanel) managePanel.classList.remove('show'); return; }
    var s = SIM.state();
    hudFish.textContent = fmt(s.res.fish); hudPop.textContent = fmt(s.pop);
    if (hudFish.parentNode) hudFish.parentNode.classList.toggle('full', s.res.fish >= s.caps.fish * 0.98);  // storage-full nudge
    var pill = document.getElementById('era-pill'); if (pill) pill.textContent = s.eraName;
    advBtn.style.display = s.canAdvance ? '' : 'none';
    advBtn.textContent = s.nextEra ? 'Advance → ' + s.nextEra : 'Advance era';
    // era progress bar
    var req = SIM.ERA_REQ[s.era];
    if (eraBar) {
      if (!req) { eraBar.querySelector('.eb-fill').style.width = '100%'; eraBar.querySelector('.eb-label').textContent = 'Max era — ' + s.eraName; eraBar.querySelector('.eb-need').textContent = ''; }
      else {
        var mr = clamp(s.money / req.money, 0, 1);
        eraBar.querySelector('.eb-fill').style.width = (mr * 100).toFixed(0) + '%';
        eraBar.querySelector('.eb-label').textContent = '→ ' + (s.nextEra || '') + '  £' + fmt(s.money) + ' / £' + fmt(req.money);
        var need = '', c = s.counts || {}; if (req.need) for (var nk in req.need) { var have = c[nk] || 0; if (have < req.need[nk]) need += (need ? ' · ' : '') + (SIM.BT[nk] ? SIM.BT[nk].name : nk) + ' ' + have + '/' + req.need[nk]; }
        eraBar.querySelector('.eb-need').textContent = need;
        eraBar.classList.toggle('ready', s.canAdvance);
      }
    }
    // glow the Manage button when an order is ready to deliver
    var mBtn = document.getElementById('managebtn');
    if (mBtn) { var ready = (s.contracts || []).some(function (c) { return c.can; }); mBtn.classList.toggle('order-ready', ready && !manageOpen); }
    checkGoals(s);
    handleHazard(s);
    checkAchievements(s);
    trackDaily(s);
    // reveal the Legacy button once prestige is relevant; pulse when a prestige is available
    if (legacyBtn) { var lp = s.prestige || { can: false }; var show = lp.can || legacyBal() > 0; legacyBtn.style.display = show ? '' : 'none'; legacyBtn.classList.toggle('ready', lp.can && !legacyOpen); }
    if (crateBtn) { var nc = crateCount(); crateBtn.style.display = nc > 0 ? '' : 'none'; crateBtn.setAttribute('data-n', nc); }
    if (legacyOpen) renderLegacy();
    if (manageOpen) renderManage();
  }
  function toggleManage() { manageOpen = !manageOpen; managePanel.classList.toggle('show', manageOpen); if (manageOpen) renderManage(); }
  function renderManage() {
    if (!simReady()) { managePanel.classList.remove('show'); manageOpen = false; return; }
    var s = SIM.state(), BT = SIM.BT, html = '<div class="mp-head">Build & upgrade<button id="mp-close">✕</button></div>';
    // daily missions — a "come back tomorrow" loop, rewarding Legacy; today's tide shown in the header
    var dl = dailyList();
    if (dl && dl.length) {
      html += '<div class="mp-sec">Daily missions ✦ · Tide: ' + todayTide().name + '</div><div class="mp-grid">';
      dl.forEach(function (m) {
        var pct = Math.min(100, Math.round(100 * m.prog / m.target));
        html += '<div class="mp-item daily' + (m.done ? ' done' : '') + '"><span class="mi-n">' + m.text + (m.done ? ' ✓' : '') + '</span>' +
          '<span class="md-bar"><i style="width:' + pct + '%"></i></span>' +
          '<span class="mi-c">' + Math.min(m.prog, m.target) + '/' + m.target + ' · +' + m.reward + '✦</span></div>';
      });
      html += '</div>';
    }
    // orders: active delivery goals paying a premium — listed first so they grab attention
    if (s.contracts && s.contracts.length) {
      html += '<div class="mp-sec">Orders</div><div class="mp-grid">';
      s.contracts.forEach(function (c) {
        var unit = c.res.charAt(0).toUpperCase() + c.res.slice(1);
        html += '<button class="mp-item order' + (c.can ? ' ready' : '') + '" data-order="' + c.id + '">' +
          '<span class="mi-n">' + c.who + '</span>' +
          '<span class="mi-d">' + c.amt + ' ' + unit + ' &middot; ' + c.have + '/' + c.amt + '</span>' +
          '<span class="mi-c">' + (c.can ? 'Deliver £' + fmt(c.reward) : '£' + fmt(c.reward)) + '</span></button>';
      });
      html += '</div>';
    }
    // storm-damaged buildings — repair them to restore output (salvage-priced vs rebuilding)
    if (s.damaged) {
      html += '<div class="mp-sec">Storm damage</div><div class="mp-grid">';
      s.buildings.forEach(function (b) {
        if (b.hp >= 100) return; var can = b.rep > 0 && s.money >= b.rep;
        html += '<button class="mp-item repair" data-repair="' + b.i + '"' + (can ? '' : ' disabled') + '><span class="mi-n">' + b.name + ' <i class="mi-hp">' + b.hp + '%</i></span><span class="mi-c">Repair £' + fmt(b.rep) + '</span></button>';
      });
      html += '</div>';
    }
    html += '<div class="mp-sec">New buildings</div><div class="mp-grid">';
    Object.keys(BT).forEach(function (id) {
      var t = BT[id]; if (s.era < t.era) return;                    // hide future-era types
      if (SIM.blocked && SIM.blocked(id)) return;                   // hide buildings this world can't run (e.g. desert sawmill)
      var cost = SIM.buildCost(id), can = SIM.canBuild(id);
      html += '<button class="mp-item" data-build="' + id + '"' + (can ? '' : ' disabled') + '><span class="mi-n">' + t.name + '</span><span class="mi-c">£' + fmt(cost) + '</span></button>';
    });
    html += '</div>';
    if (s.buildings.length) {
      html += '<div class="mp-sec">Your port (' + s.buildings.length + ')</div><div class="mp-grid">';
      s.buildings.forEach(function (b) {
        var can = SIM.canUpgrade(b.i), hp = (b.hp != null && b.hp < 100) ? ' <i class="mi-hp">' + b.hp + '%</i>' : '';
        html += '<button class="mp-item up' + (b.hp != null && b.hp < 100 ? ' hurt' : '') + '" data-up="' + b.i + '"' + (can ? '' : ' disabled') + '><span class="mi-n">' + b.name + ' L' + b.level + hp + '</span><span class="mi-c">↑£' + fmt(b.up) + '</span></button>';
      });
      html += '</div>';
    }
    // managers: permanent multipliers — a real money sink that defines your port's strengths
    if (s.managers) {
      html += '<div class="mp-sec">Managers</div><div class="mp-grid">';
      Object.keys(s.managers).forEach(function (k) {
        var m = s.managers[k], maxed = m.lvl >= m.max;
        html += '<button class="mp-item mgr" data-mgr="' + k + '"' + ((m.can && !maxed) ? '' : ' disabled') + '>' +
          '<span class="mi-n">' + m.name + ' <i class="mi-lv">L' + m.lvl + '</i></span>' +
          '<span class="mi-d">' + m.desc + '</span>' +
          '<span class="mi-c">' + (maxed ? 'MAX' : '£' + fmt(m.cost)) + '</span></button>';
      });
      html += '</div>';
    }
    // demand strip: shows how saturated each market is (lower = you're flooding it)
    if (s.demand) {
      html += '<div class="mp-sec">Market demand</div><div class="mp-dem">';
      [['fish', 'Fish'], ['timber', 'Timber'], ['goods', 'Goods']].forEach(function (d) {
        var v = Math.round((s.demand[d[0]] || 1) * 100);
        html += '<div class="dem-i"><span class="dem-n">' + d[1] + '</span><span class="dem-bar"><i style="width:' + v + '%"></i></span><span class="dem-v">' + v + '%</span></div>';
      });
      html += '</div>';
    }
    managePanel.innerHTML = html;
    managePanel.querySelector('#mp-close').addEventListener('click', toggleManage);
    managePanel.querySelectorAll('[data-build]').forEach(function (el) { el.addEventListener('click', function () { var id = el.getAttribute('data-build'); var t = SIM.BT[id]; if (SIM.build(id)) { plopFeedback(t ? t.era + 1 : 1, t ? t.name : 'Built'); checkMilestones(); bumpDaily('build'); updateHUD(); renderManage(); } else sfx('lose'); }); });
    managePanel.querySelectorAll('[data-up]').forEach(function (el) { el.addEventListener('click', function () { var i = +el.getAttribute('data-up'); if (SIM.canUpgrade(i)) { var lv = SIM.port().buildings[i].level; SIM.upgrade(i); plopFeedback(lv + 1, 'Upgraded'); bumpDaily('upgrade'); updateHUD(); renderManage(); } else sfx('lose'); }); });
    managePanel.querySelectorAll('[data-mgr]').forEach(function (el) { el.addEventListener('click', function () { var k = el.getAttribute('data-mgr'); if (SIM.buyManager(k)) { plopFeedback(2, 'Hired!'); sfx('merge'); haptic(20); bumpDaily('manager'); updateHUD(); renderManage(); } else sfx('lose'); }); });
    managePanel.querySelectorAll('[data-repair]').forEach(function (el) { el.addEventListener('click', function () { var i = +el.getAttribute('data-repair'); if (SIM.repair(i)) { plopFeedback(2, 'Repaired'); sfx('merge'); haptic(16); updateHUD(); renderManage(); } else sfx('lose'); }); });
    managePanel.querySelectorAll('[data-order]').forEach(function (el) { el.addEventListener('click', function () { var id = el.getAttribute('data-order'); var paid = SIM.fulfillContract(id); if (paid > 0) { statFlags.orders++; bumpDaily('order'); var pw = portWorld(); if (pw) { popWorld(pw.x, pw.y + 7, pw.z, '+£' + fmt(paid), { color: '#ffe08a', size: 22, life: 1.4, vy: -56 }); burstWorld(pw.x, pw.y, pw.z, { count: 30, colors: ['#ffe08a', '#fff3c4', '#ffd24a'], speed: 200, life: 1.0, size: 5 }); } shakeFX(5, 0.3); sfx('win'); haptic(30); confettiBurst(); updateHUD(); renderManage(); } else sfx('lose'); }); });
  }
  // build/upgrade "plop": shake + dust burst + ascending pitch + haptic + popup at the port
  function plopFeedback(tier, label) {
    var pw = portWorld();
    burstWorld(pw.x, pw.y, pw.z, { count: 16, colors: ['#ffe27a', '#fff3c4', '#cdeafe'], speed: 150, life: 0.6, size: 4, gravity: 320 });
    popWorld(pw.x, pw.y + 5, pw.z, label, { color: '#bfe9ff', size: 15, life: 0.9 });
    shakeFX(3.5, 0.22); sfx('merge', tier); haptic(14);
  }
  function checkMilestones() {
    if (!SIM.raw()) return; var r = SIM.raw(); r._ms = r._ms || {};
    function once(key, txt) { if (!r._ms[key]) { r._ms[key] = 1; var pw = portWorld(); popWorld(pw.x, pw.y + 9, pw.z, txt, { color: '#ffd24a', size: 19, life: 1.6 }); burstWorld(pw.x, pw.y, pw.z, { count: 26, colors: ['#ffd24a', '#fff3c4'], speed: 190, life: 1.0 }); sfx('score'); } }
    var c = SIM.state().counts || {};
    if (c.fishing_hut) once('hut', 'First Fishing Hut!');
    if (c.market) once('market', 'Market opened!');
    if (c.factory) once('factory', 'Goods Factory — industry!');
    if (c.dock) once('dock', 'Cargo Dock built!');
    if (SIM.raw().money >= 1000) once('1k', '£1,000 banked!');
  }
  // empire-scale achievements — checked every HUD tick (conditions change outside building)
  function checkAchievements(s) {
    if (!SIM.raw() || !s) return; var r = SIM.raw(); r._ms = r._ms || {};
    function ach(key, txt) { if (!r._ms[key]) { r._ms[key] = 1; var pw = portWorld(); popWorld(pw.x, pw.y + 11, pw.z, '🏆 ' + txt, { color: '#ffe08a', size: 18, life: 2.0 }); burstWorld(pw.x, pw.y, pw.z, { count: 30, colors: ['#ffe08a', '#fff3c4', '#9ef0b0'], speed: 200, life: 1.1 }); sfx('win'); haptic(20); } }
    var np = (s.ports || []).length, nl = s.network ? s.network.level : 1, st = s.stats ? s.stats.storms : 0, lm = s.lifetimeMoney || 0;
    if (lm >= 100000) ach('lm100k', '£100k earned');
    if (lm >= 1000000) ach('lm1m', 'Millionaire port baron');
    if (lm >= 10000000) ach('lm10m', '£10M trade empire');
    if (np >= 3) ach('p3', 'Three harbours founded');
    if (np >= 5) ach('p5', 'Master of all five seas');
    if (s.network && s.network.routes.length >= 1) ach('r1', 'First trade route');
    if (nl >= 3) ach('nl3', 'Network insured (Lv 3)');
    if (nl >= 5) ach('nl5', 'Trade network Lv 5');
    if (st >= 1) ach('s1', 'Weathered your first storm');
    if (st >= 10) ach('s10', 'Storm-hardened (10 survived)');
  }
  function doAdvance() {
    if (!SIM.canAdvance() || cine) return;
    var req = SIM.eraReq(SIM.raw().era), bonus = req ? Math.round(req.money * 0.1) : 0;   // 10% era-threshold grant
    SIM.advanceEra(); var toEra = SIM.raw().era;
    var newWorlds = []; HARBOR_BIOME_ORDER.forEach(function (id) { if (HARBOR_BIOMES[id].unlockEra <= toEra && !isUnlocked(id)) { newWorlds.push(HARBOR_BIOMES[id].name); unlockWorld(id); } });
    var name = SIM.eraName(toEra), newBuilds = [];
    for (var bk in SIM.BT) if (SIM.BT[bk].era === toEra) newBuilds.push(SIM.BT[bk].name);
    var unlockTxt = newBuilds.concat(newWorlds).slice(0, 4).join(' · ');
    grantCrate(1);                                                  // every era-up drops a salvage crate
    if (window.Juice) Juice.Audio.unlock();
    startAscension(toEra, name, unlockTxt, bonus);                  // cinematic does buildBiome + bonus at the bloom
  }

  function boot() {
    if (window.Portal) Portal.loadingStart();
    if (!gl) { if (loader) loader.innerHTML = '<div style="color:#fff;font-family:sans-serif;padding:20px;text-align:center">WebGL2 is required to play HARBOR.</div>'; return; }
    E = HGL.createEngine(gl); ensureFX();
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    boxMesh = E.mesh(new HGL.Builder().box(0, 0, 0, 1, 1, 1, [1, 1, 1]).data());
    waterMesh = E.mesh(E.plane(2900, 300)); facTex = E.texture(facadeTexture()); gritTex = E.texture(gritTexture()); blobTex = E.texture(blobTexture());
    loadAssets();
    loadUnlocked(); loadFounded(); loadGoal();
    if (SIM) { computeMeta(); applyTide(); }                          // Legacy multipliers + today's market tide before offline accrual
    dailyList();                                                     // materialise today's missions so event hooks can bump them
    var offGain = 0, offSec = 0;
    if (SIM) { SIM.load(); if (SIM.raw().founded) { var m0 = SIM.raw().money; offSec = SIM.applyOffline(); offGain = SIM.raw().money - m0; era = SIM.raw().era; } }
    if (SIM && SIM.raw()) { hudShownMoney = prevMoney = SIM.raw().money; }
    if (!(SIM && SIM.raw() && SIM.raw().founded)) era = (window.Retention && Retention.get(GAME, 'era', 0) | 0) || 0;
    var saved = window.Retention && Retention.get(GAME, 'biome', null);
    if (saved && !isUnlocked(saved)) saved = null;
    buildBiome(saved || 'green');
    resize(); defaultView(); C.dist = C.distT; C.tx = C.txT; C.tz = C.tzT; buildSelector(); buildFoundUI(); buildEconUI();
    try { var q = window.location.search; var m;
      if ((m = /[?&]era=(\d+)/.exec(q))) { era = +m[1] | 0; }
      if ((m = /[?&]biome=(\w+)/.exec(q))) { buildBiome(m[1]); buildSelector._set && buildSelector._set(); }
      else if (/[?&]era=/.test(q)) buildBiome(biomeId);   // rebuild for forced era
      var fm = /[?&]found=(-?[0-9.]+),(-?[0-9.]+)/.exec(q);
      if (fm) foundHere(+fm[1], +fm[2]);
      else if (/[?&]found\b/.test(q)) autoFound();
      if ((m = /[?&]tod=([0-9.]+)/.exec(q))) tod = +m[1] % 1;
      if ((m = /[?&]az=(-?[0-9.]+)/.exec(q))) { C.az = C.azT = +m[1]; }
      if ((m = /[?&]el=([0-9.]+)/.exec(q))) { C.el = C.elT = +m[1]; }
      if ((m = /[?&]dist=([0-9.]+)/.exec(q))) { C.dist = C.distT = +m[1]; }
      if ((m = /[?&]tx=(-?[0-9.]+)/.exec(q))) { C.tx = C.txT = +m[1]; }
      if ((m = /[?&]tz=(-?[0-9.]+)/.exec(q))) { C.tz = C.tzT = +m[1]; }
      if (/[?&]still\b/.test(q)) paused = true;
    } catch (e) {}
    updateFoundUI();
    setTimeout(showStreak, 1400);                                    // once-per-day login streak + today's tide
    if (offGain > 0 && offSec > 60) setTimeout(function () { showOffline(offGain, offSec); }, 900);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);
    window.addEventListener('resize', resize);
    requestAnimationFrame(frame);
    if (window.Portal) Portal.init().then(function () { Portal.loadingStop(); if (loader) loader.classList.add('hidden'); Portal.gameStart(); });
  }
  function showOffline(gain, sec) {
    var h = Math.floor(sec / 3600), mn = Math.floor((sec % 3600) / 60), ago = (h ? h + 'h ' : '') + mn + 'm';
    var ov = document.createElement('div'); ov.id = 'offlineModal';
    ov.innerHTML = '<div class="om-card"><div class="om-title">Welcome back!</div><div class="om-body">While you were away (' + ago + ') your port earned</div><div class="om-amt">£' + fmt(gain) + '</div><button class="om-btn">Collect</button></div>';
    wrap.appendChild(ov); requestAnimationFrame(function () { ov.classList.add('show'); });
    sfx('score');
    ov.querySelector('.om-btn').addEventListener('click', function () { ov.classList.remove('show'); sfx('merge', 4); var pw = portWorld(); burstWorld(pw.x, pw.y, pw.z, { count: 30, colors: ['#ffe27a', '#ffd24a'], speed: 200, life: 1.1 }); setTimeout(function () { ov.remove(); }, 300); });
  }

  window.__harbor = {
    state: function () { return { biome: biomeId, era: era, founded: !!founded[biomeId], port: founded[biomeId] || null, sites: sites.length, sel: selSite, worlds: HARBOR_BIOME_ORDER.slice(), unlocked: unlocked.slice(), city: scene.city.length, crane: scene.crane, assets: !!(cityModels && atlasTex), tod: Math.round(tod * 1000) / 1000, cam: { az: +C.az.toFixed(2), el: +C.el.toFixed(2), dist: Math.round(C.dist), tx: Math.round(C.tx), tz: Math.round(C.tz) }, webgl: !!gl, phase: 'world-4.3' }; },
    setBiome: function (id) { if (E) buildBiome(id); }, setTod: function (t) { tod = t % 1; }, pause: function (p) { paused = !!p; },
    setEra: function (n) { era = Math.max(0, n | 0); if (SIM && SIM.raw() && SIM.raw().founded) SIM.setEra(era); if (window.Retention) Retention.set(GAME, 'era', era); if (E) { buildBiome(biomeId); updateHUD(); } },
    econ: function () { return SIM ? SIM.state() : null; },
    foundPort: function (x, z) { if (E) foundHere(x, z); }, autoFound: function () { if (E) autoFound(); }, rate: function (x, z) { return HARBOR_MODELS.rate(x, z); },
    sites: function () { return sites.slice(); }, selectSite: function (i) { if (E) selectSite(i); }, groundAt: function (sx, sy) { return screenToGround(sx, sy); },
    unlockWorld: function (id) { unlockWorld(id); },
    ambient: function () { if (scene.port && !ambient) buildAmbient(); return ambient ? { boats: ambient.boats.length, gulls: ambient.gulls.length, cx: Math.round(ambient.cx), cz: Math.round(ambient.cz), seaH: Math.round(HARBOR_MODELS.heightAt(ambient.cx, ambient.cz) * 10) / 10 } : null; },
    goal: function () { return { i: goalIdx, total: GOALS.length, text: goalIdx < GOALS.length ? GOALS[goalIdx].t : 'done', shown: goalBanner ? goalBanner.classList.contains('show') : false }; },
    openTrade: function () { openTrade(); }, closeTrade: function () { closeTrade(); },
    tradeState: function () { var nv = SIM.network(); return { open: tradeOpen, shown: tradeMap ? tradeMap.classList.contains('show') : false, routes: nv.routes.length, level: nv.level }; },
    tradeTapNode: function (id) { if (!tradeOpen) openTrade(); var c = nodeXY(id); tradeTap(c[0] / DPR, c[1] / DPR); return { sel: tradeSel.node, dest: tradeSel.dest }; },
    forceHUD: function () { updateHUD(); return Object.keys((SIM.raw() && SIM.raw()._ms) || {}); },
    openLegacy: function () { openLegacy(); }, prestige: function () { doPrestige(); },
    legacy: function () { return { bal: legacyBal(), tree: legacyTreeMap(), meta: SIM.meta(), gain: SIM.prestigeGain(), can: SIM.canPrestige() }; },
    buyLegacy: function (id) { return buyLegacy(id); }, fmt: function (n) { return fmt(n); },
    grantCrate: function (n) { grantCrate(n || 1); return crateCount(); }, crates: function () { return crateCount(); }, openCrate: function () { openCrate(); },
    rollCrate: function () { return rollCrate(); }, blueprints: function () { return ownedBlueprints().map(function (b) { return b.id; }); },
    unlockAll: function () { HARBOR_BIOME_ORDER.forEach(function (id) { if (unlocked.indexOf(id) < 0) unlocked.push(id); }); saveUnlocked(); if (buildSelector._set) buildSelector._set(); }
  };

  if (canvas && canvas.getContext) boot();
})();
