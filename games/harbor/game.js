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
  function buildBiome(id) {
    if (!HARBOR_BIOMES[id]) id = 'green';
    biomeId = id; biome = HARBOR_BIOMES[id];
    var rng = mulberry(hash('harbor:' + id + ':e' + era));
    var fac = new HGL.Builder(), grit = new HGL.Builder(), flat = new HGL.Builder();
    var port = founded[id] || null;
    scene = HARBOR_MODELS.buildStatic({ fac: fac, grit: grit, flat: flat }, biome, rng, era, port) || { city: [], blobs: [], crane: false, era: era, founded: !!port, port: null };
    meshFac = E.mesh(fac.data()); meshGrit = E.mesh(grit.data()); meshFlat = E.mesh(flat.data());
    if (window.Retention) Retention.set(GAME, 'biome', id);
    if (typeof updateFoundUI === 'function') updateFoundUI();
  }
  function loadFounded() { var f = window.Retention && Retention.get(GAME, 'founded', null); if (f && typeof f === 'object') founded = f; }
  function saveFounded() { if (window.Retention) Retention.set(GAME, 'founded', founded); }
  function foundHere(x, z) {
    var yaw = HARBOR_MODELS.portYaw(x, z);
    founded[biomeId] = { x: x, z: z, yaw: yaw }; saveFounded();
    buildBiome(biomeId);
    C.txT = x; C.tzT = z; C.distT = 130; C.elT = 0.5;        // frame the new harbour
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

  function render() {
    if (!gl) return;
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
    gl.uniform1f(M.u.uExposure, 1.62); gl.uniform1f(M.u.uSat, 1.3); gl.uniform1f(M.u.uShadowOn, 0);
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

    // founding marker (bright beacon at the spot being scouted)
    if (pendingFound && foundMode()) {
      var my = HARBOR_MODELS.heightAt(pendingFound.x, pendingFound.z);
      gl.uniform3fv(M.u.uBase, [1.5, 1.2, 0.2]); composeRYS(mModel, pendingFound.x, my + 9, pendingFound.z, 1.3, 18, 1.3, 0); gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh);
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
  var pendingFound = null, foundPanel = null, foundLabel = null, foundBtn = null;
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
  function scoutAt(sx, sy) {
    var p = screenToGround(sx, sy); if (!p) return;
    pendingFound = p; C.txT = p.x; C.tzT = p.z;                                        // centre view on the spot
    var r = HARBOR_MODELS.rate(p.x, p.z);
    if (foundLabel) foundLabel.innerHTML = (r.stars ? '★★★★'.slice(0, r.stars) + '☆☆☆☆'.slice(0, 3 - r.stars) + '  ' : '') + r.label;
    if (foundBtn) foundBtn.disabled = !r.onCoast;
    if (foundPanel) foundPanel.classList.add('show');
  }
  function confirmFound() { if (pendingFound) { foundHere(pendingFound.x, pendingFound.z); pendingFound = null; if (foundPanel) foundPanel.classList.remove('show'); updateFoundUI(); } }
  function updateFoundUI() {
    if (!foundPanel) return;
    if (foundMode()) { foundPanel.classList.add('show'); if (foundBtn) foundBtn.disabled = !pendingFound; if (!pendingFound && foundLabel) foundLabel.textContent = 'Tap the coast to scout a harbour'; }
    else { foundPanel.classList.remove('show'); pendingFound = null; }
  }
  function autoFound() { // QA/deterministic: scan the island coast, found the best-rated spot
    var best = null;
    for (var x = -500; x <= 500; x += 40) for (var z = -150; z <= 80; z += 12) { var r = HARBOR_MODELS.rate(x, z); if (r.onCoast && (!best || r.score > best.score)) best = { x: x, z: z, score: r.score }; }
    if (best) foundHere(best.x, best.z);
  }

  // ---- input: PAN-FIRST. 1 finger / left-drag = travel along the coast; pinch / wheel = zoom;
  // 2-finger twist (or right-drag / Shift+drag) = rotate; tap = scout; arrow keys / WASD pan. ----
  var ptrs = new Map(), pinchPrev = 0, panPrev = null, twistPrev = null, lastTap = 0, downPt = null, moved = false, multi = false, orbitMode = false;
  function pxy(e) { var b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
  function defaultView() {
    if (founded[biomeId]) { C.azT = 2.42; C.elT = 0.5; C.distT = 150; C.txT = founded[biomeId].x; C.tzT = founded[biomeId].z; }
    else { C.azT = 2.42; C.elT = 0.56; C.distT = 360; C.txT = 0; C.tzT = 120; }   // frame the whole island
  }
  // screen drag (px) -> world pan of the focus point, along the camera azimuth basis ("grab the world")
  function panBy(mx, my) {
    var scl = C.dist * 0.0016, ce = Math.cos(C.az), se = Math.sin(C.az);
    var ddx = -mx * scl * ce + my * scl * se, ddz = mx * scl * se + my * scl * ce;
    C.txT = clamp(C.txT + ddx, -PANX, PANX); C.tzT = clamp(C.tzT + ddz, PANZ0, PANZ1);
    C.vTx = ddx; C.vTz = ddz;
  }
  if (canvas.addEventListener) {
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('pointerdown', function (e) {
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
        else panBy(dx, dy);                                  // pan-first: drag travels along the coast
      } else if (ptrs.size >= 2) {
        var pts = Array.from(ptrs.values()), a = pts[0], b = pts[1];
        var d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinchPrev) { var f = clamp(pinchPrev / d, 0.5, 1.5); C.distT = clamp(C.distT * f, 40, 520); }
        pinchPrev = d;
        var ang = Math.atan2(a.y - b.y, a.x - b.x);          // twist -> rotate
        if (twistPrev != null) { var da = ang - twistPrev; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; C.azT += da; C.vAz = da; }
        twistPrev = ang;
        if (panPrev) panBy(mid.x - panPrev.x, mid.y - panPrev.y);
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
      var k = e.key, m = 46;
      if (k === 'ArrowRight' || k === 'd' || k === 'D') panBy(-m, 0);
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') panBy(m, 0);
      else if (k === 'ArrowUp' || k === 'w' || k === 'W') panBy(0, m);
      else if (k === 'ArrowDown' || k === 's' || k === 'S') panBy(0, -m);
      else return;
      C.vTx = C.vTz = 0; e.preventDefault();
    });
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - (frame._l || now)) / 1000); frame._l = now;
    clock += dt; if (!paused) tod = (tod + dt * todSpeed) % 1;
    if (ptrs.size === 0) {
      C.azT += C.vAz; C.elT = clamp(C.elT + C.vEl, 0.14, 1.3); C.vAz *= 0.92; C.vEl *= 0.92; if (Math.abs(C.vAz) < 1e-4) C.vAz = 0; if (Math.abs(C.vEl) < 1e-4) C.vEl = 0;
      C.txT = clamp(C.txT + C.vTx, -PANX, PANX); C.tzT = clamp(C.tzT + C.vTz, PANZ0, PANZ1); C.vTx *= 0.90; C.vTz *= 0.90; if (Math.abs(C.vTx) < 1e-3) C.vTx = 0; if (Math.abs(C.vTz) < 1e-3) C.vTz = 0;
    }
    var k = Math.min(1, dt * 11); C.az += (C.azT - C.az) * k; C.el += (C.elT - C.el) * k; C.dist += (C.distT - C.dist) * Math.min(1, dt * 9);
    C.tx += (C.txT - C.tx) * k; C.tz += (C.tzT - C.tz) * k;
    if (clockEl) { var hh = Math.floor(tod * 24), mm = Math.floor((tod * 24 % 1) * 60); clockEl.textContent = ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2); }
    render(); requestAnimationFrame(frame);
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
  function buildFoundUI() {
    foundPanel = document.createElement('div'); foundPanel.id = 'foundpanel';
    foundLabel = document.createElement('span'); foundLabel.id = 'foundlabel'; foundLabel.textContent = 'Tap the coast to scout a harbour';
    foundBtn = document.createElement('button'); foundBtn.id = 'foundbtn'; foundBtn.textContent = 'Found village'; foundBtn.disabled = true;
    foundBtn.addEventListener('click', confirmFound);
    foundPanel.appendChild(foundLabel); foundPanel.appendChild(foundBtn);
    wrap.appendChild(foundPanel); updateFoundUI();
  }

  function boot() {
    if (window.Portal) Portal.loadingStart();
    if (!gl) { if (loader) loader.innerHTML = '<div style="color:#fff;font-family:sans-serif;padding:20px;text-align:center">WebGL2 is required to play HARBOR.</div>'; return; }
    E = HGL.createEngine(gl);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    boxMesh = E.mesh(new HGL.Builder().box(0, 0, 0, 1, 1, 1, [1, 1, 1]).data());
    waterMesh = E.mesh(E.plane(2900, 300)); facTex = E.texture(facadeTexture()); gritTex = E.texture(gritTexture()); blobTex = E.texture(blobTexture());
    loadAssets();
    loadUnlocked(); loadFounded();
    era = (window.Retention && Retention.get(GAME, 'era', 0) | 0) || 0;
    var saved = window.Retention && Retention.get(GAME, 'biome', null);
    if (saved && !isUnlocked(saved)) saved = null;
    buildBiome(saved || 'green');
    resize(); defaultView(); C.dist = C.distT; C.tx = C.txT; C.tz = C.tzT; buildSelector(); buildFoundUI();
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
    if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);
    window.addEventListener('resize', resize);
    requestAnimationFrame(frame);
    if (window.Portal) Portal.init().then(function () { Portal.loadingStop(); if (loader) loader.classList.add('hidden'); Portal.gameStart(); });
  }

  window.__harbor = {
    state: function () { return { biome: biomeId, era: era, founded: !!founded[biomeId], port: founded[biomeId] || null, worlds: HARBOR_BIOME_ORDER.slice(), unlocked: unlocked.slice(), city: scene.city.length, crane: scene.crane, assets: !!(cityModels && atlasTex), tod: Math.round(tod * 1000) / 1000, cam: { az: +C.az.toFixed(2), el: +C.el.toFixed(2), dist: Math.round(C.dist), tx: Math.round(C.tx), tz: Math.round(C.tz) }, webgl: !!gl, phase: 'world-4.1' }; },
    setBiome: function (id) { if (E) buildBiome(id); }, setTod: function (t) { tod = t % 1; }, pause: function (p) { paused = !!p; },
    setEra: function (n) { era = Math.max(0, n | 0); if (window.Retention) Retention.set(GAME, 'era', era); if (E) buildBiome(biomeId); },
    foundPort: function (x, z) { if (E) foundHere(x, z); }, autoFound: function () { if (E) autoFound(); }, rate: function (x, z) { return HARBOR_MODELS.rate(x, z); },
    unlockWorld: function (id) { unlockWorld(id); },
    unlockAll: function () { HARBOR_BIOME_ORDER.forEach(function (id) { if (unlocked.indexOf(id) < 0) unlocked.push(id); }); saveUnlocked(); if (buildSelector._set) buildSelector._set(); }
  };

  if (canvas && canvas.getContext) boot();
})();
