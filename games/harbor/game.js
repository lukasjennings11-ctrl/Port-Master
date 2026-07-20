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

  // Phase 12b: portal mode — true when launched with ?portal= (a portal host page/iframe param)
  // or when a real (non-stub) ad provider is active, i.e. this build is running on a portal.
  // Gates the handful of things portals disallow or don't want: service-worker registration
  // (see index.html), the beforeinstallprompt/"Add to home screen" PWA install flow, and the
  // external privacy-policy link. Everything else about the game is byte-for-byte identical.
  var PORTAL_MODE = false;
  try { PORTAL_MODE = /[?&]portal=/.test(window.location.search) || !!(window.ADS && window.ADS.provider && window.ADS.provider !== 'stub'); } catch (e) {}

  var CW = 0, CH = 0, DPR = 1, clock = 0, tod = 0.42, todSpeed = 1 / 160, paused = false, awayPaused = false;
  // camera: current + targets + fling velocity
  var C = { az: 2.42, el: 0.5, dist: 120, azT: 2.42, elT: 0.5, distT: 120, vAz: 0, vEl: 0, tx: 0, ty: 6, tz: 4, txT: 0, tzT: 4, vTx: 0, vTz: 0 };
  // Phase 20a: pan clamp now follows the SLAB footprint (with a small margin) instead of the old
  // hand-tuned coast-strip numbers — the camera target can never wander out past the floating
  // island's own edge.
  var SLAB0 = (window.HARBOR_MODELS && HARBOR_MODELS.SLAB) || { cx: 0, cz: 150, rx: 1150, rz: 340 };
  var PANX = SLAB0.rx * 1.05, PANZ0 = SLAB0.cz - SLAB0.rz * 1.05, PANZ1 = SLAB0.cz + SLAB0.rz * 1.05;
  // Phase 20a: THE FLOATING DIORAMA camera bounds — CAM_EL_MIN lowered (0.14->0.07) so the player
  // can pitch down far enough to catch the rocky underside at the slab edge; CAM_DIST_MAX raised
  // (560->1300, still inside CAM_FAR=1600) so max zoom-out frames the ENTIRE floating slab,
  // cliff-skirt included, instead of cropping it. Pan is clamped to the slab footprint below.
  var CAM_EL_MIN = 0.07, CAM_DIST_MIN = 45, CAM_DIST_MAX = 1300;
  var biomeId = 'green', biome = null, unlocked = ['green'];
  var welcomeFraming = false;   // Phase 20b: true while the fresh-boot "model in hand" welcome framing is active (see boot() and showWelcome())

  // ---- Phase 10c/14a: quality-gated post pass (tilt-shift miniature DoF + bloom-lite +,
  // as of 14a, ink outlines) — and the same postEnabled() gate now also arms the revived PCF
  // soft-shadow pass (see renderShadowMap/uShadowOn below). One boolean, four cartoon-ification
  // features, one weak-device fallback: this is deliberately a single gate rather than four
  // independent toggles — they're all "fancier rendering" in the same performance bucket, and a
  // device too slow for one is too slow for all of them (the frame-time probe already measures
  // the combined cost since it samples real frames with everything on).
  // ONE optional render-to-texture composite: scene → offscreen RT → fullscreen quad that
  // blurs away from a horizontal focus band (diorama look), adds a warm bloom-lite halo from the
  // same taps, and (14a) reads the RT's depth back to draw screen-space ink outlines. Default ON;
  // a first-boot frame-time probe auto-disables it on weak devices (persisted via 'postAuto' so
  // they don't re-probe every boot). The Settings toggle re-arms the probe once when forced back
  // on. Deterministic escape hatches for headless swiftshader tests/screenshots: a
  // '?nopost-probe' query flag disarms the probe, and __harbor.setPost() disarms it too (forced
  // state). Any FBO failure → direct path (legacy look: no DoF/bloom/outlines/shadows).
  var POST_FOCUS_Y = 0.44, POST_FOCUS_W = 0.17, POST_BLOOM_T = 0.78, POST_BLOOM_A = 0.35;
  // Review fix (post-20a): the tilt-shift DoF used to blur at fixed strength regardless of zoom,
  // so pulling all the way out to CAM_DIST_MAX (see the "wide" framing, dist~1300) mushed the
  // slab's cliff strata into an indistinct blur instead of reading as a crisp miniature object.
  // dofAmt() eases the blur strength to ~0 as the camera nears max zoom-out (full slab shot =
  // crisp model) while staying at full strength through the normal play-zoom range (the tilt-shift
  // "miniature" read is exactly what you want up close). DOF_FADE_START is comfortably above the
  // default founded/wild framing distances (150/520) so ordinary play is never affected.
  var DOF_FADE_START = 700, DOF_FADE_END = 1300;
  function dofAmt() {
    var d = C.dist, t = clamp((d - DOF_FADE_START) / (DOF_FADE_END - DOF_FADE_START), 0, 1);
    return 1 - t * t * (3 - 2 * t);   // smoothstep ease-out, 1 at/under DOF_FADE_START, 0 at DOF_FADE_END
  }
  // Phase 20b: slab bob — the ENTIRE floating diorama (slab, port, water, waterfalls, void) drifts
  // vertically on a very slow sine, with a barely-perceptible roll, so the world reads as a
  // physical model resting in space rather than a locked-off diorama. Applied at the render ROOT
  // (camera eye+target shift the opposite way, which is optically identical to moving the whole
  // scene — see render()) so no per-mesh code changes anywhere; screen-space picking
  // (screenToGround/eye()) deliberately stays UN-bobbed (compensated out) so founding/trade taps
  // are unaffected — the ~0.4-unit drift would be sub-pixel noise there anyway. Pure functions of
  // `clock`, so stepClock() makes them deterministic/testable with zero wall-clock sleeps.
  var BOB_PERIOD = 13, BOB_AMP = 0.4, BOB_ROLL_AMP = 0.15 * Math.PI / 180;
  function bobY() { return Math.sin(clock * (2 * Math.PI / BOB_PERIOD)) * BOB_AMP; }
  function bobRoll() { return Math.sin(clock * (2 * Math.PI / BOB_PERIOD) + 1.1) * BOB_ROLL_AMP; }
  // edge-line tuning (Phase 14a detector) — see F_POST in gl.js for how these are used. NOTE: the
  // "distant" massif skyline sits at only ~60–100 VIEW units in the default framing (camera
  // orbits at ~110), inside the playable port's own depth range — so terrain cleanliness comes
  // from F_POST's Laplacian slope-rejection + distance-scaled threshold, not from these fades.
  // Phase 19a PAPERCRAFT: the line flipped from dark ink to a WHITE scissor-cut paper rim —
  // WIDTH pushed to 1.75x the 16b ink (2.8 vs 1.6, the rim must read as a cut paper edge, not a
  // pen stroke) and a WOBBLE amount added: F_POST sways rim width and threshold with a slow
  // screen-space noise so the cut meanders like real scissors (0 = the old vector-perfect line).
  // Same detector underneath — Laplacian slope-rejection + sky mask are untouched.
  var OUTLINE_DEPTH_T = 0.024, OUTLINE_NORM_T = 0.62, OUTLINE_FADE = 0.003, OUTLINE_MAXDIST = 300, OUTLINE_WIDTH = 2.8, OUTLINE_WOBBLE = 0.85;
  // Phase 16b: two-tone postcard water — F_WATER (gl.js) quantizes the vLandH shore-distance
  // signal into this many toon bands (rich deep teal far offshore -> bright turquoise shallows
  // right at the coast). Documented here for __harbor.water()'s test/debug hook below.
  var WATER_SHORE_BANDS = 4;
  // Phase 19b: paper-sea band boundary slide — each of the WATER_SHORE_BANDS-1 boundaries slides
  // laterally at its own speed (F_WATER's `spd=uWaterBandBase+uWaterBandStep*kf`, gl.js). Mirrored
  // here in JS (same constants) purely so __harbor.water() can report a deterministic, testable
  // "does the boundary phase advance" signal without any pixel readback.
  var WATER_BAND_BASE_SPD = 0.05, WATER_BAND_SPD_STEP = 0.035;
  function waterBandPhase(k, t) { return (t * (WATER_BAND_BASE_SPD + WATER_BAND_SPD_STEP * k)) % 1; }
  // Phase 20a: mirrors F_WATER's vFallMask downward-scroll term (gl.js) — fract(vW.y*0.18-uTime*0.6)
  // — purely so __harbor.water().waterfallScroll gives tests a deterministic "does it advance"
  // signal (via stepClock) without a pixel readback, same pattern as waterBandPhase() above.
  function fallScrollPhase(t) { return (1 - (t * 0.6) % 1 + 1) % 1; }
  // Phase 19a: papercraft grade — F_MAIN's diffuse ramp is quantized to TOON_BANDS steps (2: a
  // card face is lit or shaded, nothing between — documented here for the paper() test hook, the
  // constant lives in the F_MAIN source), and every pass gets a static screen-anchored
  // paper-fibre grain (two-octave value noise, uGrain amplitude per pass: terrain/buildings
  // strongest, water a touch less, sky gentlest so the backdrop stays airy).
  var TOON_BANDS = 2, GRAIN_MAIN = 0.055, GRAIN_WATER = 0.038, GRAIN_SKY = 0.026;
  // camera projection constants shared by the main perspective matrix AND the post pass's
  // depth-linearisation math (single source of truth so the outline reconstruction can never drift)
  var CAM_FOVY = 0.82, CAM_NEAR = 0.5, CAM_FAR = 1600;
  var postUserOn = window.Retention ? !!Retention.get(GAME, 'post', true) : true;
  var postAutoOff = window.Retention ? !!Retention.get(GAME, 'postAuto', false) : false;
  var postFail = false, postRT = null;
  var postProbe = { armed: !postAutoOff && !/[?&]nopost-probe\b/.test(window.location.search), done: false, t: 0, n: 0, warm: 0, avgMs: 0 };
  function postEnabled() { return postUserOn && !postAutoOff && !postFail && !!gl; }
  function setPost(v, fromUI) {
    postUserOn = !!v; if (window.Retention) Retention.set(GAME, 'post', postUserOn);
    if (postUserOn) {
      postAutoOff = false; if (window.Retention) Retention.set(GAME, 'postAuto', false);
      postFail = false;                                                       // give the FBO another chance
      if (fromUI) postProbe = { armed: true, done: false, t: 0, n: 0, warm: 0, avgMs: postProbe.avgMs };  // Settings re-arms the probe once
      else postProbe.armed = false;                                           // forced (tests) → no probe, deterministic
    }
    if (settingsOpen) renderSettings();
  }
  function ensurePostRT() {   // (re)create / resize the offscreen RT; null (and direct path) on any failure
    if (postFail || !E || !E.createRT) return null;
    if (!postRT) { postRT = E.createRT(canvas.width, canvas.height); if (!postRT) { postFail = true; return null; } }
    else if (postRT.w !== canvas.width || postRT.h !== canvas.height) { if (!postRT.resize(canvas.width, canvas.height)) { postFail = true; return null; } }
    return postRT;
  }

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
  // Phase 14a: scalloped white V-wake decal (alpha falloff), oriented bow(y=0)->tail(y=1). Drawn
  // as a stretched alpha quad trailing each moving hull via the existing P_blob decal pipeline
  // (see drawWakes) — cheaper and far more robust in this hand-rolled engine than a shader-driven
  // per-ship uniform array plumbed into F_WATER: boat counts are tiny (a dozen-ish), the decal
  // path is already battle-tested (soft contact shadows use it), and it composites correctly
  // over the wavy water surface with zero extra shader plumbing.
  function wakeTexture() {
    var c = document.createElement('canvas'); c.width = 48; c.height = 96; var x = c.getContext('2d');
    var img = x.createImageData(48, 96), D = img.data;
    for (var y = 0; y < 96; y++) {
      var ny = y / 95;                                     // 0 at the boat, 1 at the fading tail
      var spread = 0.12 + ny * 0.78;                        // the V widens behind the boat
      var wob = Math.sin(ny * 22) * 0.045;                  // gentle scalloped wobble along each arm
      for (var px = 0; px < 48; px++) {
        var nx = px / 47 * 2 - 1;                           // -1..1 lateral
        var dL = Math.abs(nx + spread + wob), dR = Math.abs(nx - spread - wob);
        var arm = Math.max(0, 1 - Math.min(dL, dR) / 0.16);      // bright core of each wake arm
        var centre = Math.max(0, 1 - Math.abs(nx) / 0.05) * 0.35; // faint straight prop-wash line
        var a = Math.max(arm, centre) * Math.pow(1 - ny, 0.65);
        var i = (y * 48 + px) * 4;
        D[i] = D[i + 1] = D[i + 2] = 255; D[i + 3] = Math.round(a * 235);
      }
    }
    x.putImageData(img, 0, 0); return c;
  }

  // ---- rng ----
  function hash(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ---- scene ----
  var meshFac, meshGrit, meshFlat, waterMesh, boxMesh, facTex, gritTex, gullMesh;
  var WATER_STATS = null;   // Phase 20a: bounded-pool/waterfall telemetry — see buildWaterMesh() + __harbor.water()
  // Phase 18b: the port's BUILDINGS live in their own two meshes (grit/flat split, LOCAL port
  // space — models.js scene.bldg) drawn each frame with a composeRYS transform at the port frame,
  // so the squash-and-stretch pop can scale the whole settlement via the draw transform. Quay/
  // crane/terrain/dressing stay in the static world bake exactly as before.
  var meshBldgGrit = null, meshBldgFlat = null;
  // Phase 16a: SHIPYARD — real ship-class meshes (models.js HARBOR_MODELS.SHIPYARD), reused every
  // frame via compose transforms — replaces the old single hull-box + triangle-sail (hullMesh/
  // sailMesh) that read as floating triangles at gameplay zoom.
  // SHIP[cls] = { hull: mesh (tint-ready), trim: mesh (baked real colours, drawn uVCol=1),
  //               sails: [{mesh, phase}], meta: {len,beam,funnel} }.
  // Phase 17b: the fleet grew from 6 classes to 25 (three 8-tier ladders — see models.js
  // HARBOR_MODELS.SHIPYARD.LADDERS) once ships evolve as the player buys fleet upgrades, so builds
  // are now LAZY: getShip(cls) below builds+uploads a class to the GPU on its first actual use and
  // caches it in SHIP[cls] forever after — a fresh game only ever pays for the handful of classes
  // it's actually shown (ambient traffic + whatever tiers are owned), not all 25 up front. No
  // eviction: every class is <=~3.2k verts (see shipStats), so even a save that's cycled through
  // every tier of every ladder holds at most 25 tiny meshes — trivial next to the static harbour
  // scene's own budget (10k-250k verts, see geomStats).
  var SHIP = {}, shipStats = null, DEBUG_SHIP = null;   // DEBUG_SHIP: test-only forced close-up ship (see __harbor.debugShip)
  function getShip(cls) {
    if (SHIP[cls]) return SHIP[cls];
    if (!E || !HARBOR_MODELS || HARBOR_MODELS.SHIPYARD.CLASSES.indexOf(cls) < 0) return null;
    var s = HARBOR_MODELS.SHIPYARD.build(cls);
    var hullV = s.hull.positions.length / 3, trimV = s.trim.positions.length / 3;
    var sailMeshes = s.sails.map(function (sd) { return { mesh: E.mesh(sd.data), phase: sd.phase, verts: sd.data.positions.length / 3 }; });
    var sailV = sailMeshes.reduce(function (a, sm) { return a + sm.verts; }, 0);
    var pennantV = s.pennant ? s.pennant.positions.length / 3 : 0;
    SHIP[cls] = { hull: E.mesh(s.hull), trim: E.mesh(s.trim), sails: sailMeshes, pennant: s.pennant ? E.mesh(s.pennant) : null, meta: s.meta };
    if (shipStats) { shipStats.classes[cls] = { hull: hullV, trim: trimV, sails: sailV, total: hullV + trimV + sailV + pennantV }; shipStats.total += hullV + trimV + sailV + pennantV; }
    return SHIP[cls];
  }
  // Phase 17b: the three fleet-registry ladders (models.js HARBOR_MODELS.SHIPYARD.LADDERS is the
  // source of truth — game.js just indexes by owned tier). Fallback tier 2 (used only when SIM isn't
  // ready) lands on dinghy/brig/schooner in every ladder — the exact pre-17b defaults — by design.
  var FLEET_LADDERS = (window.HARBOR_MODELS && HARBOR_MODELS.SHIPYARD.LADDERS) || { fishing: ['dinghy'], trade: ['brig'], expedition: ['schooner'] };
  var FLEET_NAMES = (window.HARBOR_MODELS && HARBOR_MODELS.SHIPYARD.NAMES) || {};
  function ladderClass(role, tier) { var L = FLEET_LADDERS[role] || ['dinghy']; return L[Math.max(0, Math.min(L.length - 1, tier | 0))]; }
  function fleetTierOf(role) { return (SIM && simReady()) ? SIM.fleetTier(role) : 2; }
  // Phase 17c: the Navy's own 5-rung ladder (models.js HARBOR_MODELS.SHIPYARD.NAVY) — index ===
  // navyTier()-1 (tier0 = no navy = no class); FLEET_NAMES already covers navy classes too since
  // models.js merges their display names into the same SHIPYARD.NAMES map.
  var NAVY_LADDER = (window.HARBOR_MODELS && HARBOR_MODELS.SHIPYARD.NAVY) || ['patrol_cutter'];
  function navyClass(tier) { return tier > 0 ? NAVY_LADDER[Math.max(0, Math.min(NAVY_LADDER.length - 1, (tier | 0) - 1))] : null; }
  function navyTierOf() { return (SIM && simReady()) ? SIM.navyTier() : 0; }
  var era = 0, scene = { city: [], blobs: [], lamps: [], crane: false, era: 0, founded: false, port: null };
  var cityModels = null, atlasTex = null, blobTex = null, wakeTex = null;   // glTF buildings (async) + shared atlas + shadow decal + wake decal
  var founded = {};                                          // biomeId -> {x,z,yaw} (founded harbours)
  var sites = [], selSite = -1;                              // curated harbour candidates + selected index
  var ambient = null;                                        // living port: sailing boats + wheeling gulls
  var geomStats = null;                                      // static-scene vertex/index counts (budget guard)
  function buildBiome(id) {
    if (!HARBOR_BIOMES[id]) id = 'green';
    biomeId = id; biome = HARBOR_BIOMES[id]; ambient = null;
    if (SIM && SIM.raw()) {
      // free=true: this reconciles a colony you already founded (e.g. after a prestige reset wipes
      // ports but this device's `founded` site map survives) — not a new founding decision, so it
      // never charges the Phase 15c colony fee.
      if (founded[id] && !SIM.port(id)) SIM.foundPort(id, true);   // reconcile legacy/missing port economy
      SIM.setActive(id);                                          // HUD/manage now follow this port
    }
    if (simReady() && founded[id]) era = SIM.raw().era;            // sim is the authority on era when founded
    var rng = mulberry(hash('harbor:' + id + ':e' + era));
    var fac = new HGL.Builder(), grit = new HGL.Builder(), flat = new HGL.Builder();
    var port = founded[id] || null;
    scene = HARBOR_MODELS.buildStatic({ fac: fac, grit: grit, flat: flat }, biome, rng, era, port) || { city: [], blobs: [], lamps: [], crane: false, era: era, founded: !!port, port: null };
    // Phase 18b: the building meshes (local port space, models.js scene.bldg) count toward the
    // same static-scene vertex budget as the baked world — they're just as resident on the GPU.
    var bldgV = scene.bldg ? (scene.bldg.grit.positions.length + scene.bldg.flat.positions.length) / 3 : 0;
    var bldgI = scene.bldg ? (scene.bldg.grit.indices.length + scene.bldg.flat.indices.length) : 0;
    geomStats = { fac: fac.P.length / 3, grit: grit.P.length / 3, flat: flat.P.length / 3, bldg: bldgV,
      verts: (fac.P.length + grit.P.length + flat.P.length) / 3 + bldgV, indices: fac.I.length + grit.I.length + flat.I.length + bldgI };   // vertex-budget guard (Phase 10b)
    meshFac = E.mesh(fac.data()); meshGrit = E.mesh(grit.data()); meshFlat = E.mesh(flat.data());
    meshBldgGrit = scene.bldg ? E.mesh(scene.bldg.grit) : null; meshBldgFlat = scene.bldg ? E.mesh(scene.bldg.flat) : null;
    buildWaterMesh();                                          // Phase 14a: rebake shore-foam heights for THIS biome's terrain
    sites = port ? [] : HARBOR_MODELS.sites(); selSite = -1;  // curated candidates only when wild
    if (window.Retention) Retention.set(GAME, 'biome', id);
    if (typeof buildSiteChips === 'function') buildSiteChips();
    if (typeof updateFoundUI === 'function') updateFoundUI();
  }
  // Phase 14a: build the sea-plane mesh with the terrain heightfield baked into its (otherwise
  // unused) vertex colour R channel — F_WATER reads it back as vLandH to band a scalloped foam
  // fringe right at the coastline. HARBOR_MODELS.buildStatic() (just above) already regenerated
  // the heightfield for THIS biome, so heightAt() is valid here. A one-time ~90k-vertex CPU bake
  // per biome switch (not per frame) — trivial next to the noise-heightfield generation it reads.
  // Phase 20a: THE FLOATING DIORAMA — the sea is no longer an infinite 2900x300 plane running to
  // the world edge; it's a BOUNDED radial pool clipped to (an inset of) the SLAB ellipse, so the
  // water visibly ENDS at the floating island's boundary instead of fading toward a horizon. The
  // R channel of aColor still carries vLandH (heightAt at that vertex) exactly as before — F_WATER
  // reads it back unchanged for the shore-band/foam signal, so the paper-sea shading is untouched.
  // Three merged pieces, one Builder, one draw call (same F_WATER program, no new shader needed):
  //  1. the pool itself (radial grid, shared verts, ~4.4k verts vs the old plane's ~90k)
  //  2. a thin raised RIM LIP at the pool's outer edge (pale card curb — reuses F_WATER's existing
  //     foam trigger by setting vLandH just inside the shoreBand window)
  //  3. WATERFALL sheets spilling over the rim: vertical strips whose top verts carry a "falling"
  //     sentinel vLandH (< -30) that F_WATER's new vFallMask term reads to scroll a banded pattern
  //     downward with clock/uTime, and whose bottom verts sit in the same foam-trigger window as
  //     the rim lip for a small foam curl where the fall lands.
  // Refinement round (post-79da179 review): the falls previously read as a flat white rim band because
  // only the very top sliver of each strip carried the "falling" sentinel colour (top vertex vLandH=-40,
  // bottom vertex vLandH=-0.05 — the fall shader term only triggers below -30, so almost the entire strip
  // was excluded and the visible band was just the rim-lip foam trigger). Both endpoints now carry
  // sentinel values (top -46, bottom -31) so the WHOLE strip renders as falling water, with the two
  // values letting F_WATER (gl.js) derive a taper (strong at the lip, fading as it nears the bottom) via
  // simple interpolation — no new attribute needed. Bottom verts also flare outward for an outward curl
  // at the base of each sheet.
  // Defect fix (review pass): WATER_POOL_INSET was 0.90 — the pool's outer edge sat 10% short of
  // the SLAB boundary (where buildFieldMesh's terrain clip and buildSkirtMesh's cliff-top both
  // begin, both anchored at normalized radius 1.0). That left an uncovered annulus of "deep"-
  // coloured seabed terrain (flat, khaki/tan — see buildFieldMesh's yavg<-0.2 colour band) exposed
  // between the pool's rim and the cliff top. At grazing/low-pitch angles that thin physical ring
  // (172 units wide at the x-extreme, 51 at the z-extreme) foreshortens into what reads as a vast
  // checkerboard ground plane filling the frame — the "checkered ground plane" review defect. The
  // pool now reaches all the way to the SLAB boundary (radius 1.0, matching slabPerim()/the skirt's
  // top edge exactly) so the waterfall lip coincides with the cliff top and no seabed is ever
  // exposed, at any camera angle.
  var WATER_POOL_INSET = 1.0, WATER_FALL_DROP = 22, WATER_FALL_FLARE = 1.07;
  function buildWaterMesh() {
    var SL = (HARBOR_MODELS && HARBOR_MODELS.SLAB) || SLAB0, B = new HGL.Builder();
    var rings = 40, segs = 96, prx = SL.rx * WATER_POOL_INSET, prz = SL.rz * WATER_POOL_INSET;
    var grid = [];
    for (var r = 0; r <= rings; r++) {
      var row = [], t = r / rings;
      for (var s = 0; s <= segs; s++) {
        var a = s / segs * Math.PI * 2, x = SL.cx + Math.cos(a) * prx * t, z = SL.cz + Math.sin(a) * prz * t;
        var lh = HARBOR_MODELS.heightAt(x, z);
        B.P.push(x, -0.12, z); B.N.push(0, 1, 0); B.U.push(t, s / segs); B.C.push(lh, lh, lh);
        row.push(B.P.length / 3 - 1);
      }
      grid.push(row);
    }
    for (r = 0; r < rings; r++) for (s = 0; s < segs; s++) {
      var i0 = grid[r][s], i1 = grid[r][s + 1], i2 = grid[r + 1][s], i3 = grid[r + 1][s + 1];
      B.I.push(i0, i2, i1, i1, i2, i3);
    }
    // rim lip: a thin raised pale-card curb right at the pool's outer edge (foam-trigger vLandH)
    for (s = 0; s < segs; s++) {
      var a0 = s / segs * Math.PI * 2, a1 = (s + 1) / segs * Math.PI * 2;
      var x0 = SL.cx + Math.cos(a0) * prx, z0 = SL.cz + Math.sin(a0) * prz;
      var x1 = SL.cx + Math.cos(a1) * prx, z1 = SL.cz + Math.sin(a1) * prz;
      var base = B.P.length / 3;
      B.P.push(x0, -0.12, z0); B.N.push(0, 1, 0); B.U.push(0, 0); B.C.push(-0.05, -0.05, -0.05);
      B.P.push(x1, -0.12, z1); B.N.push(0, 1, 0); B.U.push(1, 0); B.C.push(-0.05, -0.05, -0.05);
      B.P.push(x0, 0.22, z0 * 1); B.N.push(0, 1, 0); B.U.push(0, 1); B.C.push(-0.05, -0.05, -0.05);
      B.P.push(x1, 0.22, z1); B.N.push(0, 1, 0); B.U.push(1, 1); B.C.push(-0.05, -0.05, -0.05);
      B.I.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    // waterfall sheets: vertical strips all the way around the boundary (the SLAB is set well
    // outside the island, so every boundary segment is open water — no land ever touches the edge)
    var nfall = 48;
    for (s = 0; s < nfall; s++) {
      a0 = s / nfall * Math.PI * 2; a1 = (s + 1) / nfall * Math.PI * 2;
      x0 = SL.cx + Math.cos(a0) * prx; z0 = SL.cz + Math.sin(a0) * prz;
      x1 = SL.cx + Math.cos(a1) * prx; z1 = SL.cz + Math.sin(a1) * prz;
      var yb = -0.12 - WATER_FALL_DROP;
      // outward flare/curl at the lip: bottom verts pushed out from the pool centre so the sheet
      // visibly kicks outward as it falls, instead of hanging as a dead-straight vertical curtain.
      var fx0 = SL.cx + (x0 - SL.cx) * WATER_FALL_FLARE, fz0 = SL.cz + (z0 - SL.cz) * WATER_FALL_FLARE;
      var fx1 = SL.cx + (x1 - SL.cx) * WATER_FALL_FLARE, fz1 = SL.cz + (z1 - SL.cz) * WATER_FALL_FLARE;
      base = B.P.length / 3;
      B.P.push(x0, -0.12, z0); B.N.push(0, 0, 1); B.U.push(0, 0); B.C.push(-46, -46, -46);
      B.P.push(x1, -0.12, z1); B.N.push(0, 0, 1); B.U.push(1, 0); B.C.push(-46, -46, -46);
      B.P.push(fx0, yb, fz0); B.N.push(0, 0, 1); B.U.push(0, 1); B.C.push(-31, -31, -31);
      B.P.push(fx1, yb, fz1); B.N.push(0, 0, 1); B.U.push(1, 1); B.C.push(-31, -31, -31);
      B.I.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    WATER_STATS = { poolVerts: B.P.length / 3, bounded: true, waterfallSegs: nfall, rimLip: true, poolRx: prx, poolRz: prz };
    waterMesh = E.mesh(B.data());
  }
  function loadFounded() { var f = window.Retention && Retention.get(GAME, 'founded', null); if (f && typeof f === 'object') founded = f; }
  function saveFounded() { if (window.Retention) Retention.set(GAME, 'founded', founded); }
  function foundHere(x, z, yaw) {
    if (yaw == null) yaw = HARBOR_MODELS.portYaw(x, z);
    // Phase 15c: founding any colony after the first charges a fee (SIM.foundPort refuses and
    // returns null if unaffordable) — the UI already gates the button on canFoundPort(), but guard
    // here too so a stale click can't desync the local `founded` site map from sim's actual ports.
    if (SIM) {
      var res = SIM.foundPort(biomeId);
      if (!res) { sfx('lose'); return; }
      era = SIM.raw().era; if (typeof bumpDaily === 'function') bumpDaily('found');
    }
    founded[biomeId] = { x: x, z: z, yaw: yaw }; saveFounded();
    buildBiome(biomeId);
    C.txT = x; C.tzT = z; C.distT = 130; C.elT = 0.5;        // frame the new harbour
    if (typeof updateHUD === 'function') updateHUD();
    adsGameplayStart();   // Phase 12b: founding a port is the moment real gameplay begins
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

  // ---- day/night: authored time-of-day colour scripts (Phase 10a) ----
  // Four keyframed moods — night / dawn / day / dusk — smoothly interpolated by tod.
  // Each defines sky top/bot, sun colour, hemisphere ambient, fog colour+density and
  // how strongly shadows shift toward the biome's cool shadowTint. The keys are built
  // from the biome palette so every world keeps its identity across the whole cycle.
  function m3(c, m) { return [c[0] * m[0], c[1] * m[1], c[2] * m[2]]; }
  function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  // Phase 19a PAPERCRAFT mood pass — the whole cycle re-lit as paper under studio light: noon is
  // bright warm paper under daylight, dusk an amber card, night a deep blue-GREY card (the 16b
  // ink-violet pulled toward neutral — night paper is dim, not dyed) with pale whitish rims.
  // sparkle is 0 at EVERY key: matte card never glints (F_WATER's sparkle machinery is gone too;
  // the field is kept in env() so the authored-zero is a testable contract, not an absence).
  function todKeys() {
    var b = biome;
    var night = { // deep blue-grey card, moonlit; stars + window glow carry the magic — still
      // properly dark (the ACES curve lifts shadows more than raw values suggest) but the 16b
      // blue-violet dye is pulled toward neutral grey so it reads as unlit paper, not ink.
      top: m3(b.skyTop, [0.08, 0.09, 0.14]), bot: m3(b.skyBot, [0.045, 0.05, 0.08]),
      sun: [0.24, 0.27, 0.34],
      ambTop: [0.16, 0.18, 0.26], ambBot: [0.075, 0.08, 0.12],
      fog: m3(b.fog, [0.07, 0.075, 0.12]), fogD: 0.0011, shadowK: 0.35, water: [0.14, 0.16, 0.28],
      horizon: [0.04, 0.05, 0.10], sparkle: 0                    // near-black blue-grey rim; no glints
    };
    var dawn = { // soft peach-card sunrise — warm but chalky, long gentle light
      top: lerp3(m3(b.skyTop, [0.58, 0.55, 0.74]), [0.52, 0.46, 0.62], 0.35),
      bot: lerp3(m3(b.skyBot, [0.96, 0.78, 0.68]), [0.98, 0.72, 0.58], 0.5),
      sun: [0.86, 0.68, 0.50],
      ambTop: [0.33, 0.30, 0.38], ambBot: [0.24, 0.19, 0.20],
      fog: lerp3(m3(b.fog, [0.96, 0.78, 0.68]), [0.94, 0.70, 0.60], 0.4), fogD: 0.0009, shadowK: 0.72, water: [0.78, 0.70, 0.70],
      horizon: [1.12, 0.80, 0.60], sparkle: 0                    // warm peach card glow
    };
    var day = { // bright warm paper under daylight — the matte biome palette as painted.
      // Light energy sits LOWER than 16b's (sun ~1.1 vs 1.4, ambient trimmed): the desaturated
      // card colours have less chroma headroom, so 16b's blast just bleached them through ACES —
      // paper needs pigment left in the midtones.
      top: b.skyTop.slice(), bot: b.skyBot.slice(), sun: b.sun.slice(),
      ambTop: [0.34, 0.35, 0.41], ambBot: [0.20, 0.185, 0.165],
      fog: b.fog.slice(), fogD: 0.00045, shadowK: 0.50, water: [1, 1, 1],
      horizon: lerp3(b.skyBot, [0.99, 0.97, 0.92], 0.55), sparkle: 0   // soft bright haze
    };
    var dusk = { // amber card — warmer than dawn but chalky-matte, never a molten glow
      top: lerp3(m3(b.skyTop, [0.52, 0.42, 0.62]), [0.50, 0.34, 0.50], 0.46),
      bot: lerp3(m3(b.skyBot, [1.02, 0.66, 0.50]), [1.06, 0.56, 0.40], 0.62),
      sun: [0.94, 0.62, 0.38],
      ambTop: [0.34, 0.26, 0.31], ambBot: [0.27, 0.18, 0.19],
      fog: lerp3(m3(b.fog, [1.0, 0.66, 0.52]), [1.0, 0.54, 0.42], 0.52), fogD: 0.0009, shadowK: 0.75, water: [0.82, 0.62, 0.60],
      horizon: [1.26, 0.68, 0.42], sparkle: 0                    // amber-card band low over the sea
    };
    // sun crosses the horizon at tod≈0.23 / 0.77 (see sunDir) — keys straddle those moments
    return [[0.00, night], [0.185, night], [0.25, dawn], [0.34, day], [0.66, day], [0.755, dusk], [0.84, night], [1.00, night]];
  }
  function env() {
    var day = (1 - Math.cos(tod * Math.PI * 2)) / 2;          // 0 night .. 1 noon
    var night = clamp(1 - day * 1.7, 0, 1);
    var K = todKeys(), a = K[0], b = K[K.length - 1], i;
    for (i = 1; i < K.length; i++) if (K[i][0] >= tod) { a = K[i - 1]; b = K[i]; break; }
    var span = Math.max(1e-5, b[0] - a[0]), t = clamp((tod - a[0]) / span, 0, 1);
    t = t * t * (3 - 2 * t);                                   // smoothstep between keys
    var A = a[1], B = b[1];
    var out = {
      day: day, night: night,
      top: lerp3(A.top, B.top, t), bot: lerp3(A.bot, B.bot, t),
      sun: lerp3(A.sun, B.sun, t), fog: lerp3(A.fog, B.fog, t),
      ambTop: lerp3(A.ambTop, B.ambTop, t), ambBot: lerp3(A.ambBot, B.ambBot, t),
      water: lerp3(A.water, B.water, t), horizon: lerp3(A.horizon, B.horizon, t),
      fogD: A.fogD + (B.fogD - A.fogD) * t, shadowK: A.shadowK + (B.shadowK - A.shadowK) * t,
      sparkle: A.sparkle + (B.sparkle - A.sparkle) * t
    };
    // Phase 14c: storm keyframe — blend the whole palette toward a darker slate-card sky/void with
    // cooler light as DRAMA.stormT ramps up (real hazard-driven, not decorative on its own — see
    // updateDrama). Never touches fogD/shadowK/sparkle (those stay ToD-only) — just the paper colours.
    var st = (typeof DRAMA !== 'undefined') ? DRAMA.stormT : 0;
    if (st > 0.001) {
      var slateTop = [0.22, 0.24, 0.30], slateBot = [0.30, 0.32, 0.38], slateAmb = [0.16, 0.17, 0.21], slateWater = [0.42, 0.46, 0.52];
      out.top = lerp3(out.top, slateTop, st); out.bot = lerp3(out.bot, slateBot, st);
      out.ambTop = lerp3(out.ambTop, slateAmb, st); out.ambBot = lerp3(out.ambBot, slateAmb, st);
      out.water = lerp3(out.water, slateWater, st); out.horizon = lerp3(out.horizon, slateBot, st);
      out.sun = lerp3(out.sun, [0.62, 0.66, 0.74], st);
    }
    return out;
  }
  function sunDir() { var ang = (tod - 0.25) * Math.PI * 2, y = Math.max(0.07, Math.sin(ang) * 0.9 + 0.12); return norm([Math.cos(ang) * 0.7, y, 0.42]); }
  // Phase 19b: the paper moon card rides roughly the opposite arc from the sun (half a cycle out
  // of phase) so it's up and near its own screen-space track through the night, same math as
  // sunDir() otherwise — a stylised position, not a literal orbital model.
  function moonDir() { var ang = (tod - 0.25 + 0.5) * Math.PI * 2, y = Math.max(0.07, Math.sin(ang) * 0.9 + 0.12); return norm([Math.cos(ang) * 0.7, y, 0.42]); }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smoothstep01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  // Phase 19a PAPERCRAFT: the edge line is WHITE — the torn/scissor-cut rim of a paper layer,
  // the exact inversion of the 14a/16b dark ink. Slightly warm by day (paper stock, not printer
  // white) drifting to a paler, cooler rim after dark — pale card catching moonlight, never a
  // glow (values stay <=1 so the rim can't bloom).
  function outlineTint(en) {
    var t = lerp3([0.96, 0.95, 0.91], [0.78, 0.79, 0.84], en.night);
    var st = (typeof DRAMA !== 'undefined') ? DRAMA.stormT : 0;
    return st > 0.001 ? lerp3(t, [1, 1, 1], st * 0.6) : t;   // whiter rims under storm
  }
  // papercraft grade (19a): gentle, matte — the loud 16b uSat push (1.32+) is gone; construction
  // paper sits near unity saturation with only a whisper of noon lift / night dim, and the
  // mid-shadow crush eases too (deep inky crush reads as print, not card).
  function gradeSat(en) { return 1.02 + 0.05 * en.day - 0.06 * en.night; }
  function gradeCrush(en) { return 0.05 + 0.08 * en.night; }

  // ---- Phase 14b: drifting clouds — a handful of puffy cumulus meshes on a high world-space
  // layer, built ONCE at boot (like gullMesh/boxMesh, not per-biome) and translated every frame.
  // PLACEMENT IS A RING around the island over open sea (radius 560-950 from the island centre),
  // drifting slowly around it: the camera's sky window is a narrow band just above the horizon
  // (the orbit camera looks DOWN at the port — nothing high overhead is ever in frame, and the
  // portrait FOV is narrow), so distant clouds ringing the horizon are the placement that
  // actually shows up in play, whichever way the player orbits — an inland scatter left most
  // framings cloudless. Clouds cast no shadows (never added to renderShadowMap's draw list or
  // scene.blobs) and never intersect terrain/buildings: the 140-unit altitude floor was chosen
  // by measuring the true max scene height (terrain + landform outcrops + era7 towers) across
  // every biome x era combination with the game's real deterministic seeds — 127 at the massif
  // summit, ~14 out at the ring over open water — so the floor clears everything worldwide with
  // margin. Real 3D meshes at real world positions give parallax with the camera for free.
  var CLOUD_RING_CX = 0, CLOUD_RING_CZ = 150;                    // island centre (models.js ISLAND)
  var CLOUD_MESHES = null, CLOUDS = null, CLOUD_MESH_VERTS = 0;
  // Phase 19b PAPERCRAFT: clouds are now flat cutout cutouts — a single lumpy, scalloped 2D cloud
  // silhouette extruded a tiny depth (a thin paper card, not a puffy 3D volume). Drawn as a
  // camera-yaw-facing billboard (see drawClouds below) so the flat face always shows; the existing
  // F_POST screen-space outline pass automatically cuts a white scissor rim around its silhouette
  // (same mechanism every other papercraft mesh already rides), so no bespoke rim shader is needed
  // here. Replaces the old chamfered-box cumulus cluster (buildCloudMesh, ~160-280 verts) with a
  // single scalloped fan — cheaper (~60-90 verts) as well as flatter.
  function buildCloudMesh(rng) {
    var b = new HGL.Builder();
    var bumps = 3 + (rng() * 2 | 0), steps = bumps * 2, depth = 0.22, col = [1, 1, 1];
    var pts = [], trunkW = 0.30;
    pts.push([-trunkW * 3.2, -0.85]);                            // flat scalloped cloud base (slightly concave, cumulus-style)
    for (var i = 0; i <= steps; i++) {
      var t = i / steps, ang = Math.PI - t * Math.PI;
      var r = (0.85 + 0.28 * Math.sin(t * bumps * Math.PI * 2 + rng() * 0.7)) * (0.9 + rng() * 0.22);
      pts.push([Math.cos(ang) * r * 1.6, -0.15 + Math.sin(ang) * r]);
    }
    pts.push([trunkW * 3.2, -0.85]);
    var n = pts.length, cax = 0, cay = 0, k;
    for (k = 0; k < n; k++) { cax += pts[k][0]; cay += pts[k][1]; } cax /= n; cay /= n;
    // two caps (front z=+depth/2, back z=-depth/2 — real extrusion thickness) each pushed with
    // BOTH triangle windings so the card is robustly double-sided regardless of front-face
    // convention (cheap: caps are the bulk of this mesh's tiny budget either way).
    for (var cap = 0; cap < 2; cap++) {
      var cz = cap === 0 ? depth * 0.5 : -depth * 0.5, outward = cap === 0 ? 1 : -1;
      for (var wind = 0; wind < 2; wind++) {
        var nz = wind === 0 ? outward : -outward, base = b.P.length / 3;
        b.P.push(cax, cay, cz); b.N.push(0, 0, nz); b.U.push(0.5, 0.5); b.C.push(col[0], col[1], col[2]);
        for (k = 0; k < n; k++) { b.P.push(pts[k][0], pts[k][1], cz); b.N.push(0, 0, nz); b.U.push(0, 0); b.C.push(col[0], col[1], col[2]); }
        for (k = 0; k < n; k++) {
          var i0 = base + 1 + k, i1 = base + 1 + ((k + 1) % n);
          if (wind === 0) b.I.push(base, i0, i1); else b.I.push(base, i1, i0);
        }
      }
    }
    // thin side rim quads (the card's edge — mostly edge-on/invisible once billboarded, but gives
    // the mesh genuine 3-D thickness so it's never a degenerate zero-volume plane)
    for (i = 0; i < n; i++) {
      var j = (i + 1) % n, p0 = pts[i], p1 = pts[j];
      var ex = p1[1] - p0[1], ey = -(p1[0] - p0[0]), el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
      var rb = b.P.length / 3;
      b.P.push(p0[0], p0[1], depth * 0.5); b.N.push(ex, ey, 0); b.U.push(0, 0); b.C.push(col[0], col[1], col[2]);
      b.P.push(p1[0], p1[1], depth * 0.5); b.N.push(ex, ey, 0); b.U.push(1, 0); b.C.push(col[0], col[1], col[2]);
      b.P.push(p1[0], p1[1], -depth * 0.5); b.N.push(ex, ey, 0); b.U.push(1, 1); b.C.push(col[0], col[1], col[2]);
      b.P.push(p0[0], p0[1], -depth * 0.5); b.N.push(ex, ey, 0); b.U.push(0, 1); b.C.push(col[0], col[1], col[2]);
      b.I.push(rb, rb + 1, rb + 2, rb, rb + 2, rb + 3);
    }
    return b.data();
  }
  function buildClouds() {
    var rng = mulberry(hash('sky-clouds-v69'));                  // deterministic — same sky every boot
    var datas = [0, 1, 2].map(function () { return buildCloudMesh(rng); });
    CLOUD_MESH_VERTS = datas.reduce(function (a, d) { return a + d.positions.length / 3; }, 0);
    CLOUD_MESHES = datas.map(function (d) { return E.mesh(d); });
    CLOUDS = [];
    var n = 6 + (rng() * 2 | 0);                                 // 6..7 instances (max ~51deg ring gap)
    for (var i = 0; i < n; i++) {
      CLOUDS.push({
        a0: (i + rng() * 0.55) / n * Math.PI * 2,                // spread around the ring, jittered — never gridded
        r0: 560 + rng() * 390, y: 140 + rng() * 40, scale: 16 + rng() * 14,
        spd: (0.004 + rng() * 0.006) * (rng() < 0.25 ? -1 : 1),  // slow ring drift, mostly one prevailing direction
        ph: rng() * 6.283, ry: rng() * 6.283, meshIdx: i % CLOUD_MESHES.length
      });
    }
  }
  // current world (x,z) for one cloud instance — a pure function of `clock` so drift is fully
  // deterministic/reversible (and testable: sample twice at different clock values). Gentle
  // radial breathing on top of the angular drift keeps the ring from reading as a rail.
  function cloudWorldPos(c) {
    var ang = c.a0 + clock * c.spd * cloudDriftMul(), r = c.r0 + Math.sin(clock * 0.03 + c.ph) * 26;
    return [CLOUD_RING_CX + Math.cos(ang) * r, CLOUD_RING_CZ + Math.sin(ang) * r];
  }
  // ToD tint: crisp white at noon, warm pink through dawn/dusk twilight, dark slate by night —
  // reuses env()'s existing day/night factors (no new todKeys() entries needed).
  function cloudTint(en) {
    var duskT = clamp(1 - en.day - en.night, 0, 1);
    var t = lerp3([1.0, 1.0, 1.0], [1.0, 0.74, 0.72], duskT);
    t = lerp3(t, [0.36, 0.38, 0.48], en.night);
    var st = (typeof DRAMA !== 'undefined') ? DRAMA.stormT : 0;
    return st > 0.001 ? lerp3(t, [0.30, 0.32, 0.38], st * 0.75) : t;   // storm: clouds darken toward slate
  }
  function cloudDriftMul() { return 1 + ((typeof DRAMA !== 'undefined') ? DRAMA.stormT : 0) * 1.8; }   // storm: clouds drift faster
  function waterStormMul() { return 1 + ((typeof DRAMA !== 'undefined') ? DRAMA.stormT : 0) * 2; }   // storm: mirrors F_WATER's uStorm band-slide multiplier (1+2*uStorm) for __harbor.storm() — the shader owns the actual speed-up now (no clock distortion)
  // Phase 19b: flat cutout clouds are billboarded on the yaw (Y) axis — always facing the camera —
  // so the scalloped paper silhouette shows its flat face from any orbit angle instead of edge-on.
  function drawClouds(M, en, ev) {
    if (!CLOUDS) return;
    gl.uniform3fv(M.u.uBase, cloudTint(en));   // matte/chalky (19a: F_MAIN is all-matte now — no per-draw roughness left to set)
    // Phase 14c: while a storm is telegraphing, the ring CROWDS toward the threatened port — each
    // cloud eases part-way in from its ring position and drops a little altitude, so the sky
    // visibly gangs up over the harbour. Pure draw-side lerp on stormT: at 0 the 14b ring is
    // bit-identical (cloudWorldPos itself stays a pure fn of clock for the drift tests).
    var st14c = DRAMA.stormT, sp14c = scene.port;
    for (var i = 0; i < CLOUDS.length; i++) {
      var c = CLOUDS[i], p = cloudWorldPos(c);
      var cy = c.y;
      if (st14c > 0.001 && sp14c) {
        var pull = st14c * 0.55;
        p = [p[0] + (sp14c.x - p[0]) * pull, p[1] + (sp14c.z - p[1]) * pull];
        cy = c.y - st14c * 38;                                    // lower, heavier storm deck (still >90, clear of the massif)
      }
      var byaw = ev ? Math.atan2(ev[0] - p[0], ev[2] - p[1]) : c.ry;
      composeRYS(mModel, p[0], cy, p[1], c.scale, c.scale * 0.72, c.scale, byaw);
      gl.uniformMatrix4fv(M.u.uModel, false, mModel);
      drawMesh(M, CLOUD_MESHES[c.meshIdx]);
    }
  }

  // Phase 20b: void paper flecks — a sparse scatter of tiny billboard "confetti" quads drifting in
  // the void around/below the floating slab, giving the empty space a sense of depth/scale (dust
  // motes around a handcrafted model, not a hard black backdrop). Reuses the shared unit boxMesh
  // (scaled paper-thin) rather than a new mesh, same trick as the crane/dock-worker props. Static
  // twinkle-free: no per-frame opacity flicker, just a slow deterministic positional drift so
  // stepClock() gives a testable, reversible "did it move" signal with zero wall-clock sleeps.
  var FLECKS = null, FLECK_COUNT = 26;
  function buildFlecks() {
    var rng = mulberry(hash('void-flecks-v76'));                  // deterministic — same scatter every boot
    FLECKS = [];
    for (var i = 0; i < FLECK_COUNT; i++) {
      var ang = rng() * Math.PI * 2, r = SLAB0.rx * (0.55 + rng() * 0.85);
      FLECKS.push({
        a0: ang, r: r, y: -20 - rng() * 220,                      // scattered below/around the slab rim
        spd: (0.003 + rng() * 0.006) * (rng() < 0.5 ? -1 : 1), ph: rng() * 6.283,
        scale: 2.2 + rng() * 3.2, ry: rng() * 6.283
      });
    }
  }
  function fleckWorldPos(f) {
    var ang = f.a0 + clock * f.spd, r = f.r + Math.sin(clock * 0.02 + f.ph) * 18;
    return [CLOUD_RING_CX + Math.cos(ang) * r, f.y + Math.sin(clock * 0.05 + f.ph) * 6, CLOUD_RING_CZ + Math.sin(ang) * r];
  }
  function fleckTint(en) { return lerp3([0.92, 0.90, 0.86], [0.30, 0.32, 0.42], en.night); }   // faint ToD tint, never bright
  function drawFlecks(M, en, ev) {
    if (!FLECKS || !boxMesh) return;
    gl.uniform3fv(M.u.uBase, fleckTint(en));
    for (var i = 0; i < FLECKS.length; i++) {
      var f = FLECKS[i], p = fleckWorldPos(f);
      var byaw = ev ? Math.atan2(ev[0] - p[0], ev[2] - p[2]) : f.ry;
      composeRYS(mModel, p[0], p[1], p[2], f.scale, f.scale, 0.06, byaw);
      gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh);
    }
  }

  // ---- matrices ----
  var mView = mat4 && mat4.create(), mProj = mat4 && mat4.create(), mVP = mat4 && mat4.create(),
    mLV = mat4 && mat4.create(), mLP = mat4 && mat4.create(), mLVP = mat4 && mat4.create(), mModel = mat4 && mat4.create(), mI = mat4 && mat4.create();
  function compose(o, tx, ty, tz, sx, sy, sz) { o[0] = sx; o[1] = 0; o[2] = 0; o[3] = 0; o[4] = 0; o[5] = sy; o[6] = 0; o[7] = 0; o[8] = 0; o[9] = 0; o[10] = sz; o[11] = 0; o[12] = tx; o[13] = ty; o[14] = tz; o[15] = 1; }
  function composeRY(o, tx, ty, tz, s, ry) { var c = Math.cos(ry), sn = Math.sin(ry); o[0] = c * s; o[1] = 0; o[2] = -sn * s; o[3] = 0; o[4] = 0; o[5] = s; o[6] = 0; o[7] = 0; o[8] = sn * s; o[9] = 0; o[10] = c * s; o[11] = 0; o[12] = tx; o[13] = ty; o[14] = tz; o[15] = 1; }
  function composeRYS(o, tx, ty, tz, sx, sy, sz, ry) { var c = Math.cos(ry), sn = Math.sin(ry); o[0] = c * sx; o[1] = 0; o[2] = -sn * sx; o[3] = 0; o[4] = 0; o[5] = sy; o[6] = 0; o[7] = 0; o[8] = sn * sz; o[9] = 0; o[10] = c * sz; o[11] = 0; o[12] = tx; o[13] = ty; o[14] = tz; o[15] = 1; }
  // Phase 19c: composeRYS + one extra rotation — rx pitches the mesh about its OWN local X axis
  // (applied in local space, before the yaw), rides on top of the per-axis scale. This is the
  // "unfold hinge": at rx=0 it's bit-identical to composeRYS (verified below), so every existing
  // composeRYS caller is untouched; only the building-pop draw path (which now needs the hinge)
  // switches to this. Derivation: M = Ry(ry) * Rx(rx) * S(sx,sy,sz), columns worked out by hand.
  function composeHingeRYS(o, tx, ty, tz, sx, sy, sz, ry, rx) {
    var cy = Math.cos(ry), sny = Math.sin(ry), cx = Math.cos(rx), snx = Math.sin(rx);
    o[0] = cy * sx; o[1] = 0; o[2] = -sny * sx; o[3] = 0;
    o[4] = sny * snx * sy; o[5] = cx * sy; o[6] = cy * snx * sy; o[7] = 0;
    o[8] = sny * cx * sz; o[9] = -snx * sz; o[10] = cy * cx * sz; o[11] = 0;
    o[12] = tx; o[13] = ty; o[14] = tz; o[15] = 1;
  }
  function eye() { var ce = Math.cos(C.el), se = Math.sin(C.el); return [C.tx + C.dist * ce * Math.sin(C.az), C.ty + C.dist * se, C.tz + C.dist * ce * Math.cos(C.az)]; }

  // draw the modern skyline (glTF buildings) — textured prim uses the shared atlas, flat "lit" prims use baseColor
  function drawCity(M) {
    if (!atlasTex || !cityModels || !scene.city.length) return;
    gl.uniform1f(M.u.uVCol, 0);
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

  // soft contact shadows: flat dark radial decals on the ground under objects (no shadow map).
  // Coupled to the sun: low sun = longer, softer shadows stretched away from the light.
  function drawBlobs(sd) {
    if (!blobTex || !scene.blobs || !scene.blobs.length) return;
    sd = sd || sunDir();
    var sunY = clamp(sd[1], 0.07, 1);
    var str = 0.34 * clamp(0.30 + sunY * 1.25, 0.30, 1.0);              // fainter as the sun sinks
    var stretch = clamp(1.0 + (0.55 - sunY) * 1.4, 1.0, 1.85);          // longer at low sun
    var yaw = Math.atan2(-sd[0], -sd[2]);                               // stretch away from the light
    var hh = Math.hypot(sd[0], sd[2]) || 1, ox = -sd[0] / hh, oz = -sd[2] / hh;
    var Bp = E.P_blob; gl.useProgram(Bp.p); gl.uniformMatrix4fv(Bp.u.uVP, false, mVP);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blobTex); gl.uniform1i(Bp.u.uTex, 1); gl.uniform1f(Bp.u.uStr, str);
    gl.uniform3fv(Bp.u.uTint, [0, 0, 0]);   // black contact shadow (uTint is shared program state with drawWakes — always set it explicitly)
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    for (var i = 0; i < scene.blobs.length; i++) {
      var b = scene.blobs[i], y = HARBOR_MODELS.heightAt(b.x, b.z) + 0.06, sh = (stretch - 1) * b.r * 0.4;
      composeRYS(mModel, b.x + ox * sh, y, b.z + oz * sh, b.r, 1, b.r * stretch, yaw); gl.uniformMatrix4fv(Bp.u.uModel, false, mModel);
      drawMesh(Bp, E.blobQuad);
    }
    gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE);
  }

  // Phase 14b: night light pools — warm soft ground discs under the quay's lampposts (the yard
  // floodlight poles from models.js props()) and each warehouse's lit-window facade (scene.lamps —
  // see buildStatic's Phase 14b comments). Reuses the SAME P_blob decal quad pipeline as the
  // contact shadows above and the wake trails below (battle-tested, zero new shader plumbing) but
  // with an ADDITIVE warm tint instead of alpha-darkening, so the glow lifts the ground rather than
  // punching a dark hole in it. Strength is en.night-gated (never at day/dusk) and there's simply
  // nothing to draw before a real quay exists (scene.lamps is empty at era0 and on any wild world).
  function drawNightPools(en) {
    if (!blobTex || en.night < 0.05 || !scene.lamps || !scene.lamps.length) return;
    var Bp = E.P_blob; gl.useProgram(Bp.p); gl.uniformMatrix4fv(Bp.u.uVP, false, mVP);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blobTex); gl.uniform1i(Bp.u.uTex, 1);
    gl.uniform3fv(Bp.u.uTint, [1.0, 0.74, 0.38]);                       // warm lamplight (uTint is shared state — always set explicitly)
    gl.uniform1f(Bp.u.uStr, 0.78 * en.night);                            // fades in with night, gone by day (additive, so still soft — never a hotspot)
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false); gl.disable(gl.CULL_FACE);   // additive glow, not a dark decal
    var deckY = scene.port ? scene.port.by + 2.25 : 2.25;                // concrete quay deck top (see concreteQuay in models.js)
    for (var i = 0; i < scene.lamps.length; i++) {
      var l = scene.lamps[i], y = l.q ? deckY : HARBOR_MODELS.heightAt(l.x, l.z) + 0.05;   // quay-mounted lamps pool on the DECK, not the terrain buried beneath it
      var pulse = 0.92 + 0.08 * Math.sin(clock * 1.4 + i * 1.7);         // gentle flicker, echoes F_MAIN's window flicker
      composeRY(mModel, l.x, y, l.z, 4.6 * pulse, 0); gl.uniformMatrix4fv(Bp.u.uModel, false, mModel);
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
    var p = [{ t: [tx, h + 2.1, z], s: [6, 1.6, 4], c: [0.70, 0.54, 0.28] },   // 19a: mustard card (was candy amber)
             { t: [tx, h + 2.1 - drop, z], s: [5, 0.9, 4.6], c: [0.13, 0.14, 0.16] }];
    if (carry) p.push({ t: [tx, h + 1.0 - drop, z], s: [4.8, 2.3, 4.4], c: HARBOR_MODELS.CONT[(clock | 0) % 7] });
    return p;
  }

  function drawMesh(P, m) { gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, m.itype, 0); }

  // ---- ambient port life (boats sailing the bay, gulls wheeling above) ----
  // Built once per founded scene; population scales with era so the port feels busier as it grows.
  function buildAmbient() {
    var p = scene.port; if (!p) { ambient = { boats: [], gulls: [], workers: [], cx: 0, cz: 0 }; return; }
    // find the deepest water offshore to anchor the boat traffic so they never sail over land
    var bestA = 0, bestDepth = 1e9;
    for (var a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      var dx = Math.sin(a), dz = Math.cos(a), sum = 0, ok = true;
      for (var d = 45; d <= 120; d += 15) { var h = HARBOR_MODELS.heightAt(p.x + dx * d, p.z + dz * d); if (h > 0.4) ok = false; sum += h; }
      if (ok && sum < bestDepth) { bestDepth = sum; bestA = a; }
    }
    var cx = p.x + Math.sin(bestA) * 78, cz = p.z + Math.cos(bestA) * 78;
    var dev = 0; try { var ss = SIM && SIM.state(); dev = (ss && ss.buildings && ss.buildings.length) || 0; } catch (e) {}   // busier as the port develops
    var rng = mulberry(hash('amb:' + biomeId + ':' + Math.round(cx) + ':' + era));
    var nBoats = 2 + Math.min(9, era * 2 + (dev / 5 | 0)), nGulls = 4 + Math.min(12, era * 2 + (dev / 4 | 0)), boats = [], gulls = [], i;
    for (i = 0; i < nBoats; i++) {
      // Phase 16a/17b: ambient traffic is a fishing-ladder mix — most boats fly the owned tier's
      // sibling one below it, with the occasional bigger one flying the owned tier itself (the
      // 'big' flag; see ambientBoatClass() in drawAmbient/collectWakes, which resolves it against
      // the LIVE fishing fleet tier every frame — so the whole bay visibly modernises the moment
      // you commission a new class, with no need to rebuild the ambient scene).
      var big = rng() < 0.4;
      boats.push({ a0: rng() * 6.283, sp: (0.05 + rng() * 0.07) * (rng() < 0.5 ? 1 : -1), rx: 30 + rng() * 26, rz: 22 + rng() * 20,
        hull: rng() < 0.5 ? [0.45, 0.22, 0.14] : [0.5, 0.4, 0.28], big: big, sc: 0.92 + rng() * 0.22 });
    }
    // Phase 20b: a few gulls arc WAY out beyond the harbour and beyond the slab's own edge before
    // sweeping back — the far-out silhouette against the void sells the floating scale far better
    // than birds confined to a tight ring around the quay. `far` gulls breathe their radius between
    // the normal harbour ring and a distance past SLAB0.rx/rz (see drawAmbient) instead of holding
    // a fixed r; everyone else is untouched (same tight harbour-life wheeling as before).
    var nFar = Math.min(3, nGulls);
    for (i = 0; i < nGulls; i++) {
      var far = i < nFar;
      gulls.push({
        a0: rng() * 6.283, sp: 0.5 + rng() * 0.4, r: 12 + rng() * 24, h: 22 + rng() * 22, bob: rng() * 6.283,
        far: far, rFar: far ? Math.max(SLAB0.rx, SLAB0.rz) * (1.05 + rng() * 0.35) : 0
      });
    }
    // Phase 14b: quay life — 2..6 tiny dock workers (scaling with era, capped at 6), walking a
    // short back-and-forth lane along the harbour apron (jetty/beach at era0, quay apron once a
    // real quay exists) so the port feels staffed even before the fleet grows. Cap colour varies
    // per worker; a few carry a crate.
    var nWork = clamp(2 + era, 2, 6), workers = [];
    var wz0 = era >= 1 ? 14 : 20, wSpan = Math.min(58, 26 + era * 5);   // era>=1: the quay apron; era0: the beach strip between jetty and huts
    var CAP_HUES = [[0.70, 0.34, 0.30], [0.78, 0.66, 0.34], [0.38, 0.52, 0.68], [0.42, 0.58, 0.40], [0.76, 0.52, 0.32], [0.58, 0.42, 0.64]];   // 19a: felt caps, not candy
    for (i = 0; i < nWork; i++) {
      var lane = wz0 + ((i % 2) ? 3.2 : -3.2) + rng() * 2.4, mid = (rng() - 0.5) * wSpan * 0.7, half = 6 + rng() * 9;
      workers.push({ x0: mid - half, x1: mid + half, z: lane, spd: 0.30 + rng() * 0.22, ph: rng() * 6.283, bobPh: rng() * 6.283,
        cap: CAP_HUES[i % CAP_HUES.length], carry: rng() < 0.42 });
    }
    ambient = { boats: boats, gulls: gulls, workers: workers, cx: cx, cz: cz, dev: dev };
  }
  // Phase 10b wind: one shared breeze, per-boat phase. Sails wobble a few degrees around their
  // heading and 'billow' a few % — readable but calm. Chimney smoke drifts the same way (+x).
  // Phase 19b PAPER FLUTTER: retuned from a slow heavy-cloth wobble to a crisper, higher-frequency
  // flick with a smaller amplitude and an asymmetric SNAP (pow<1 on the sine spends less time near
  // the zero-crossing and lingers at the extremes) — reads as stiff folded card catching a gust,
  // not canvas billowing. Same signature/call sites (sails + the pennant flag below).
  function sailSway(ph) {
    var s = Math.sin(clock * 2.6 + ph), snap = Math.sign(s) * Math.pow(Math.abs(s), 0.6);
    return snap * 0.05 + Math.sin(clock * 4.3 + ph * 1.4) * 0.014;
  }   // was ±~5.5° slow cloth wobble (sin*1.7/0.53) — now a ±~3.6° crisp snap, higher frequency
  function sailBillow(ph) { return 1 + Math.sin(clock * 3.6 + ph * 1.9) * 0.028; }   // was ±4.5%@2.4 — now ±2.8%@3.6, crisper card flex
  // Phase 16a: draw one SHIPYARD ship — hull (tint-ready, uBase = hullC), trim (baked real
  // colours: keel/planks/gunwale/rudder/bowsprit/masts/rigging/cabin/pennant/props — one call
  // with uVCol toggled to 1 so its own vertex colours win over uBase), then each sail as its own
  // mesh billowing/swaying on phase (sd.phase + phaseBase) so a two-masted ship's sails never move
  // in lockstep. sailC may be a single colour (every sail) or an array indexed per sail.
  // Phase 20a: optional foldY/fadeXZ (both default 1) — the paper fold-out transform used when a
  // ship's path crosses the world boundary (see drawShipFolded/foldFactor above). foldY squashes
  // the vertical scale (mast/hull height) toward 0 like a book closing; fadeXZ shrinks the whole
  // hull footprint toward 0 alongside it, standing in for an alpha fade since this flat-colour
  // ship program carries no blend state.
  function drawShip(M, cls, x, y, z, yaw, scale, hullC, sailC, phaseBase, foldY, fadeXZ) {
    var S = getShip(cls); if (!S) return;
    var sY = scale * (foldY == null ? 1 : foldY), sXZ = scale * (fadeXZ == null ? 1 : fadeXZ);
    scale = sXZ;   // downstream billow/pennant scale math (unchanged) now rides the faded footprint scale
    y -= S.meta.draft * scale;                    // ride IN the water: waterline ~1/3 up the hull
    gl.uniform3fv(M.u.uBase, hullC);
    composeRYS(mModel, x, y, z, scale, sY, scale, yaw); gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, S.hull);
    gl.uniform1f(M.u.uVCol, 1); drawMesh(M, S.trim);
    for (var i = 0; i < S.sails.length; i++) {
      var sm = S.sails[i], ph = sm.phase + (phaseBase || 0), billow = scale * sailBillow(ph);
      gl.uniform1f(M.u.uVCol, 0);
      gl.uniform3fv(M.u.uBase, Array.isArray(sailC[0]) ? (sailC[i] || sailC[0]) : sailC);   // nested array = per-sail colours; flat [r,g,b] = every sail
      composeRYS(mModel, x, y, z, billow, scale, scale, yaw + sailSway(ph));
      gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, sm.mesh);
    }
    // Phase 19b: the pennant flag — same crisp paper-flutter sway as the sails (own fixed phase so
    // it never moves in lockstep with any sail), its own small vertex-coloured mesh.
    if (S.pennant) {
      gl.uniform1f(M.u.uVCol, 1);
      composeRYS(mModel, x, y, z, scale, scale, scale, yaw + sailSway(phaseBase ? phaseBase + 5.3 : 5.3));
      gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, S.pennant);
    }
    gl.uniform1f(M.u.uVCol, 0);
  }
  // Phase 17b: which fishing-ladder class an ambient boat flies right now — 'big' boats fly the
  // owned tier, the rest fly one tier below it (a live mix, not a fixed dinghy/sloop split), so
  // the whole bay reads as "one tier newer" the instant a fishing-fleet upgrade is bought.
  function ambientBoatClass(b) { var t = fleetTierOf('fishing'); return ladderClass('fishing', b.big ? t : Math.max(0, t - 1)); }
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
      var bob = Math.sin(clock * 1.3 + b.a0) * 0.3;
      drawShip(M, ambientBoatClass(b), x, bob, z, yaw, b.sc, b.hull, [0.94, 0.93, 0.90], b.a0);
    }
    gl.uniform3fv(M.u.uBase, [0.98, 0.98, 0.96]);
    for (i = 0; i < ambient.gulls.length; i++) {
      var g = ambient.gulls[i], ga = g.a0 + clock * g.sp;
      // far gulls breathe out from the tight harbour ring to well past the slab edge and back —
      // a slow independent sine so the out-and-back sweep never syncs with the wing-flap/wheel rate
      var farK = (Math.sin(clock * 0.07 + g.bob) + 1) * 0.5, gr = g.far ? (g.r + (g.rFar - g.r) * farK) : g.r;
      x = (p ? p.x : ambient.cx) + Math.cos(ga) * gr; z = (p ? p.z : ambient.cz) + Math.sin(ga) * gr;
      var gy = by + g.h + (g.far ? 30 : 0) + Math.sin(clock * 2 + g.bob) * 3;
      var flap = 0.7 + Math.sin(clock * 9 + g.bob) * 0.4;                  // wing-flap: stretch the little V
      composeRYS(mModel, x, gy, z, 1.9 * flap, 0.5, 0.7, ga + clock * 0.6); gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, gullMesh);
    }
  }
  // Phase 14b: tiny blocky dock workers — reuses the shared unit boxMesh (like crane parts /
  // founding beacons) for a body slab + a head/cap slab [+ a small carried crate], zero new static
  // geometry. Each walks a short lane back and forth (eased by a sine, so it settles at both ends
  // rather than bouncing off a hard wall) with a quick walking bob; the figure's THIN local axis is
  // pointed along its walking direction so it reads as a simple flat cartoon silhouette from any
  // angle, like the rest of the flat-colour prop kit. Assumes the same program state as
  // drawAmbient/crane parts (uVCol=0, uTexMix=0, uAlbedo=0).
  // one worker's current world position + ground height + heading — pure function of `clock`
  // (same pattern as cloudWorldPos), shared by drawWorkers and the __harbor.workers() hook.
  // Ground: era>=1 workers pace the CONCRETE QUAY DECK, whose top sits 2.2 above the port base
  // (concreteQuay's slab in models.js); era0 workers pace the beach strip on raw terrain.
  function workerWorldPos(w) {
    var p = scene.port, pc = Math.cos(p.yaw), psn = Math.sin(p.yaw), ang = clock * w.spd + w.ph;
    var t = (Math.sin(ang) + 1) / 2, lx = w.x0 + (w.x1 - w.x0) * t, lz = w.z;
    var facing = Math.cos(ang) >= 0 ? 1 : -1;
    var x = lx * pc + lz * psn + p.x, z = -lx * psn + lz * pc + p.z;
    var gy = scene.era >= 1 ? p.by + 2.2 : Math.max(HARBOR_MODELS.heightAt(x, z), p.by);
    return { x: x, z: z, y: gy, yaw: p.yaw + facing * Math.PI * 0.5 };
  }
  function drawWorkers(M) {
    if (!ambient || !ambient.workers || !ambient.workers.length || !scene.port) return;
    for (var i = 0; i < ambient.workers.length; i++) {
      var w = ambient.workers[i], pos = workerWorldPos(w);
      var wx = pos.x, wz = pos.z, yaw = pos.yaw;
      var bob = pos.y + Math.abs(Math.sin(clock * 7.5 + w.bobPh)) * 0.09;
      gl.uniform3fv(M.u.uBase, [0.32, 0.42, 0.56]);   // work-shirt blue-grey body
      composeRYS(mModel, wx, bob + 0.26, wz, 0.46, 0.52, 0.22, yaw); gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh);
      gl.uniform3fv(M.u.uBase, w.cap);                 // head + cap, one slab, cap's own colour
      composeRYS(mModel, wx, bob + 0.60, wz, 0.26, 0.24, 0.26, yaw); gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh);
      if (w.carry) {
        gl.uniform3fv(M.u.uBase, [0.62, 0.42, 0.24]);   // small carried crate, tucked at chest height
        composeRYS(mModel, wx + Math.sin(yaw) * 0.30, bob + 0.38, wz + Math.cos(yaw) * 0.30, 0.18, 0.16, 0.18, yaw);
        gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh);
      }
    }
  }

  // ---- Phase 9b: the living world — the meta systems made visible on the water ----
  // Expedition ships sail OUT for the first half of a voyage and BACK for the second, so a
  // ready-to-collect ship waits just off the harbour. Trade-route freighters shuttle between
  // the active port and the horizon on stable per-route headings (capped at 4). While a rival
  // race is on, Baron Krall's black-sailed ship patrols offshore. State is cached from the sim
  // ~1/sec (keyed per voyage seq / route id); the per-frame draw allocates nothing.
  // Phase 17c: fleet.navy — up to 2 owned navy ships (highest tier + one below it, if owned)
  // patrolling their own coastal lane, closer to shore and slower than the rival corsair's — see
  // navyPatrolPos()/refreshFleet() below.
  var fleet = { exp: [], routes: [], rival: null, navy: [], at: -1e9 };
  var FLEET_SAIL = [[0.82, 0.87, 0.92], [0.64, 0.80, 0.68], [0.88, 0.78, 0.52], [0.74, 0.62, 0.82]];  // sail tint per destination tier 1..4 (19a: dyed card, not neon)
  var FLEET_HULL = { fish: [0.54, 0.62, 0.70], timber: [0.5, 0.36, 0.22], goods: [0.74, 0.52, 0.30] };  // hull tint per route resource (19a matte)
  var EXP_HULL = [0.38, 0.26, 0.17], RTE_SAIL = [0.93, 0.91, 0.87],
      RVL_HULL = [0.15, 0.13, 0.18], RVL_SAIL = [0.06, 0.05, 0.08],
      NAVY_HULL = [0.92, 0.92, 0.90], NAVY_SAIL = [0.90, 0.89, 0.84];   // crisp white hull; the navy-blue/gold trim is baked into each class's own mesh
  // Phase 17b: route freighter class now follows the OWNED trade-fleet tier (Registry purchases),
  // not the era directly — supersedes 16a's era>=2 auto-swap to brig/steamer: a fleet only
  // modernises when the harbourmaster actually commissions a new class. fleetTierOf falls back to
  // tier 2 (brig) when SIM isn't ready, matching 16a's old pre-industrial default.
  function routeShipClass() { return ladderClass('trade', fleetTierOf('trade')); }
  function expeditionShipClass() { return ladderClass('expedition', fleetTierOf('expedition')); }
  // Phase 17c: current world position of a patrolling navy ship (n = one fleet.navy entry) — a
  // shared helper so drawFleet/collectWakes/the auto-defense repel FX all agree on where the ship
  // actually is right now. Slower (0.22 vs the corsair's 0.35) and a tighter arc (amplitude 30 vs
  // 46) than Baron Krall's patrol — lawful, unhurried, close to shore.
  function navyPatrolPos(n) {
    var pa = clock * 0.22 + (n.ph || 0), dir = Math.cos(pa) >= 0 ? 1 : -1;
    return { x: n.cx + n.px * Math.sin(pa) * 30, z: n.cz + n.pz * Math.sin(pa) * 30, yaw: Math.atan2(n.px * dir, n.pz * dir) };
  }
  // ---- Phase 14c: WORLD DRAMA — visible theatre for events already happening in sim state (no new
  // save fields, no fake state: every beat below is a pure function of SIM.state()/SIM.event() plus
  // a locally-smoothed draw timer). stormT/crashT ramp 0->1 on real hazard telegraph/crash and ease
  // back to 0 once it clears (strike or avert) — env()/clouds()/water read them for the paper storm
  // look; pirate tracks the raid event lifecycle for the corsair hold/exchange/depart beats;
  // theatre tracks the pop-up scaffold prelude that plays just before 19c's unfold.
  var DRAMA = {
    stormT: 0, crashT: 0,
    pirate: null,                      // {phase:'in'|'hold'|'fight'|'pay'|'winDepart'|'loseDepart', t, x, z}
    volleyN: 0, volleyT: 0,
    theatreT0: -10, theatreTestP: null, theatreNew: true,
    flashScaffold: 0,                  // brief 0.4s scaffold flash on upgrade
    castoff: {},                       // voyage seq -> clock at send (cast-off ramp window)
    boltT: 0, crashPulse: 0            // lightning-bolt overlay / crash vignette pulse (strike-triggered)
  };
  var THEATRE_DUR = 1.2, THEATRE_FLASH = 0.4;
  // new build → the full 1.2s prelude (scaffold + 2 hammering workers + dust + tick-tock), with the
  // 19c unfold pop CHAINED to fire only when the prelude ends (see updateDrama below) — the
  // building visibly gets BUILT before it pops up. Upgrade → just a 0.4s bare-scaffold flash, with
  // the pop immediate as before (upgrades are a tweak, not a construction site).
  function triggerTheatre(isNew) {
    DRAMA.theatreT0 = clock; DRAMA.theatreNew = isNew !== false; DRAMA.theatrePopped = !DRAMA.theatreNew;
    if (!DRAMA.theatreNew) DRAMA.flashScaffold = THEATRE_FLASH;
  }
  function theatreNow() { return DRAMA.theatreTestP != null ? DRAMA.theatreTestP * THEATRE_DUR : clock - DRAMA.theatreT0; }
  function theatreState() {
    var t = theatreNow();
    var active = DRAMA.theatreNew && t >= 0 && t < THEATRE_DUR;
    var p = active ? clamp(t / THEATRE_DUR, 0, 1) : 1;
    return {
      active: active, t: p, dur: THEATRE_DUR, flash: DRAMA.flashScaffold > 0,
      scaffold: active || DRAMA.flashScaffold > 0, workers: active ? 2 : 0,
      rise: active ? Math.min(1, p * 4) : 1,                        // scaffold pops up over the first ~0.3s
      fold: active ? (p > 0.85 ? (p - 0.85) / 0.15 : 0) : 0         // …and folds flat as the 19c unfold takes over
    };
  }
  // corsair hold point: ~40 units offshore of the port, along the same deep-water heading the
  // ambient fleet already uses (mirrors refreshFleet's ox/oz derivation so it reads as "the same
  // sea lane every ship uses", not a bespoke position).
  function pirateHoldPos() {
    var p = scene.port; if (!p) return { x: 0, z: 0, ox: 0, oz: 1 };
    var ox, oz;
    if (ambient && (ambient.cx !== p.x || ambient.cz !== p.z)) { var ol = Math.hypot(ambient.cx - p.x, ambient.cz - p.z) || 1; ox = (ambient.cx - p.x) / ol; oz = (ambient.cz - p.z) / ol; }
    else { var a0 = seaAz(p.x, p.z); ox = Math.sin(a0); oz = Math.cos(a0); }
    return { x: p.x + ox * 40, z: p.z + oz * 40, ox: ox, oz: oz };
  }
  function startPirate() {
    var hp = pirateHoldPos();
    DRAMA.pirate = { phase: 'in', t: 0, x: hp.x, z: hp.z, ox: hp.ox, oz: hp.oz };
  }
  function pirateResolve(kind) {   // 'pay' | 'winDepart' | 'loseDepart'
    if (!DRAMA.pirate) return;
    DRAMA.pirate.phase = kind; DRAMA.pirate.t = 0;
  }
  // 2-3 volleys of confetti fired back and forth between the quay and the holding corsair — reuses
  // the existing burstWorld/particle pipeline, tagged with a mixed-flecks style so it reads as
  // cannon-fire confetti rather than a celebration burst.
  function cannonVolley(atPirate) {
    if (!FX) return;
    var pw = portWorld(), hp = DRAMA.pirate ? { x: DRAMA.pirate.x, z: DRAMA.pirate.z } : pirateHoldPos();
    var from = atPirate ? hp : { x: pw.x, z: pw.z };
    var colors = ['#f2b35e', '#dfe6ea', '#ffe08a', '#c0392b'];
    burstWorld(from.x, pw.y + 3, from.z, { count: 20, colors: colors, speed: 170, life: 0.75, size: 4, gravity: 190, shape: 'rect' });
    shakeFX(4, 0.2); sfx('tap');
  }
  var theatreHammerT = 0;
  function updateDrama(dt) {
    if (DRAMA.flashScaffold > 0) DRAMA.flashScaffold = Math.max(0, DRAMA.flashScaffold - dt);
    var th = theatreState();
    if (th.active) {
      theatreHammerT += dt;
      if (theatreHammerT > 0.22) { theatreHammerT = 0; sfx('tap'); if (FX) { var pw = portWorld(); var sc = pw && worldToScreen(pw.x + (Math.random() - 0.5) * 14, pw.y + 3, pw.z + (Math.random() - 0.5) * 14); if (sc) FX.p.list.push({ x: sc.x, y: sc.y, vx: (Math.random() - 0.5) * 12, vy: -18 - Math.random() * 10, life: 0.5, max: 0.5, size: 3, color: 'rgba(220,214,198,0.6)', gravity: 30, shape: 'curl', rot: 0, vr: 2 }); } }
    } else theatreHammerT = 0;
    if (!simReady()) return;
    var s = SIM.state();
    var isCrashWarn = !!(s.hazard && s.hazard.phase === 'warn' && s.hazard.kind === 'Market Crash');
    var stormOn = !!(s.hazard && s.hazard.phase === 'warn' && !isCrashWarn);
    var crashOn = isCrashWarn || !!s.crash;
    var st = stormOn ? 1 : 0, ct = crashOn ? 1 : 0;
    DRAMA.stormT += (st - DRAMA.stormT) * Math.min(1, dt * 1.6); if (Math.abs(DRAMA.stormT - st) < 0.004) DRAMA.stormT = st;
    DRAMA.crashT += (ct - DRAMA.crashT) * Math.min(1, dt * 2.2); if (Math.abs(DRAMA.crashT - ct) < 0.004) DRAMA.crashT = ct;
    if (DRAMA.pirate) {
      var pr = DRAMA.pirate; pr.t += dt;
      if (pr.phase === 'in' && pr.t > 0.9) pr.phase = 'hold';
      else if ((pr.phase === 'pay' || pr.phase === 'winDepart' || pr.phase === 'loseDepart') && pr.t > 1.4) DRAMA.pirate = null;
      else if (pr.phase === 'fight') {
        DRAMA.volleyT += dt;
        if (DRAMA.volleyN < 3 && DRAMA.volleyT > 0.4) { DRAMA.volleyN++; DRAMA.volleyT = 0; cannonVolley(DRAMA.volleyN % 2 === 1); }
        else if (DRAMA.volleyN >= 3 && DRAMA.volleyT > 0.35) { pirateResolve(DRAMA._fightOut || 'loseDepart'); }
      }
    }
  }
  function refreshFleet() {
    fleet.at = clock; fleet.exp.length = 0; fleet.routes.length = 0; fleet.rival = null; fleet.navy.length = 0;
    var p = scene.port; if (!p || !simReady()) return;
    // offshore heading: reuse the deep-water lane the ambient boats found (fallback: downhill to the sea)
    var ox, oz;
    if (ambient && (ambient.cx !== p.x || ambient.cz !== p.z)) { var ol = Math.hypot(ambient.cx - p.x, ambient.cz - p.z) || 1; ox = (ambient.cx - p.x) / ol; oz = (ambient.cz - p.z) / ol; }
    else { var a0 = seaAz(p.x, p.z); ox = Math.sin(a0); oz = Math.cos(a0); }
    var i, k, ca, sa, dx, dz;
    var v = SIM.voyages();
    for (i = 0; i < v.active.length; i++) {
      var a = v.active[i], off = (((a.seq * 0.618034) % 1) - 0.5) * 1.1;   // stable fan-out per voyage
      ca = Math.cos(off); sa = Math.sin(off); dx = ox * ca + oz * sa; dz = oz * ca - ox * sa;
      fleet.exp.push({
        seq: a.seq, ready: a.ready,
        prog: a.ready ? 1 : clamp(1 - a.remaining / Math.max(1, a.total), 0, 1),
        dx: dx, dz: dz, yawOut: Math.atan2(dx, dz), ph: a.seq * 2.4,
        sail: FLEET_SAIL[clamp((a.tier || 1) - 1, 0, 3)]
      });
    }
    var net = SIM.network(), rCls = routeShipClass();
    for (i = 0, k = 0; i < net.routes.length && k < 4; i++) {
      var rt = net.routes[i]; if (rt.a !== biomeId && rt.b !== biomeId) continue;
      var h = hash('rt:' + rt.id), roff = ((h % 1000) / 1000 - 0.5) * 1.7;   // stable heading per route id
      ca = Math.cos(roff); sa = Math.sin(roff); dx = ox * ca + oz * sa; dz = oz * ca - ox * sa;
      var hull = FLEET_HULL[rt.res] || FLEET_HULL.goods;
      fleet.routes.push({ dx: dx, dz: dz, yawOut: Math.atan2(dx, dz), sp: 0.09 + (h % 7) * 0.008, ph: (h % 200) / 100, hull: hull, cargo: [hull[0] * 0.8, hull[1] * 0.8, hull[2] * 0.8], cls: rCls });
      k++;
    }
    var rr = rivalGet();
    if (rr && rr.race) fleet.rival = { cx: p.x + ox * 96, cz: p.z + oz * 96, px: oz, pz: -ox };   // patrol line runs along the coast
    // Phase 17c: navy patrol — a lane distinctly CLOSER to shore than the rival's (46-62 offshore
    // vs the corsair's 96), one ring per owned ship so a 2-ship navy doesn't overlap itself.
    var navyT = SIM.navyTier();
    if (navyT > 0) {
      var navyTiers = navyT >= 2 ? [navyT, navyT - 1] : [navyT];
      navyTiers.forEach(function (t, idx) {
        var cls = navyClass(t); if (!cls) return;
        var laneR = 46 + idx * 16;
        fleet.navy.push({ cls: cls, cx: p.x + ox * laneR, cz: p.z + oz * laneR, px: oz, pz: -ox, ph: idx * 2.1 });
      });
    }
  }
  // draw the meta fleet; assumes the same flat-colour program state as drawAmbient. Each kind maps
  // to a fleet-registry ladder class at the OWNED tier (Phase 17b — supersedes 16a's fixed classes):
  // expedition → expedition ladder (tier-tinted sails kept), route → trade ladder (resource-tinted
  // hull + kept deck cargo where the class still has a deck to keep it on), rival → corsair (off
  // every ladder, unchanged).
  // Phase 20a: ship departures at the world boundary now PAPER FOLD-OUT rather than simply
  // vanishing past a hidden edge — a pure draw-transform (no pathing rework: fleet.exp/routes'
  // existing dx/dz/prog paths are untouched). foldFactor(d) returns 1 well inside the pool, easing
  // to 0 over FOLD_START..FOLD_END (a scale-y "closing book" fold + an overall shrink standing in
  // for the alpha fade, since the flat-colour ship program has no blend state) — ~0.6s of travel
  // at typical fleet speeds. Symmetric outbound/inbound: same easing unfolds ships back in on return.
  var FOLD_START = 138, FOLD_END = 160;
  function foldFactor(d) { return 1 - smooth01(clamp((d - FOLD_START) / (FOLD_END - FOLD_START), 0, 1)); }
  function smooth01(t) { return t * t * (3 - 2 * t); }
  function drawShipFolded(M, cls, x, y, z, yaw, d, hullC, sailC, ph) {
    var f = foldFactor(d); if (f <= 0.01) return;
    drawShip(M, cls, x, y, z, yaw, 1.0, hullC, sailC, ph, f * f * f, f);   // scaleY-fold (cube-eased, "closing book") + overall fade-shrink
  }
  function drawFleet(M) {
    var p = scene.port; if (!p) return;
    if (clock - fleet.at > 1) refreshFleet();
    var i, x, z, yaw, bob, e, r, eCls = expeditionShipClass();
    for (i = 0; i < fleet.exp.length; i++) {                       // expedition ships: ladder class at the owned tier, tier-tinted sails
      e = fleet.exp[i];
      var f = e.prog < 0.5 ? e.prog * 2 : (1 - e.prog) * 2;        // out for the first half, home for the second
      var d = 28 + f * 132;                                        // ready ships wait just off the harbour
      // Phase 14c: cast-off — a freshly-sent voyage starts AT the quay (d≈4, not offshore) and
      // ramps out over ~0.9s, so the departure reads as a real launch rather than popping into
      // existence mid-lane. Only affects the brief cast-off window; normal transit is untouched.
      var co = DRAMA.castoff[e.seq];
      if (co != null) { var cT = clock - co; if (cT < 0.9) d = 4 + (d - 4) * smooth01(clamp(cT / 0.9, 0, 1)); else delete DRAMA.castoff[e.seq]; }
      x = p.x + e.dx * d; z = p.z + e.dz * d;
      yaw = e.prog < 0.5 ? e.yawOut : e.yawOut + Math.PI;
      bob = Math.sin(clock * 1.3 + e.ph) * 0.3;
      drawShipFolded(M, eCls, x, bob, z, yaw, d, EXP_HULL, e.sail, e.ph);
      // return-ready: hold at the harbour mouth with a gentle pale-gold glint pulse until collected
      if (e.ready) {
        var glint = 0.5 + 0.5 * Math.sin(clock * 2.6);
        gl.uniform3fv(M.u.uBase, [0.98, 0.90 + 0.06 * glint, 0.62 + 0.10 * glint]);
        composeRYS(mModel, x, bob + 5.2, z, 1.6 + glint * 0.4, 1.6 + glint * 0.4, 1.6 + glint * 0.4, clock * 0.6);
        gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh);
      }
    }
    for (i = 0; i < fleet.routes.length; i++) {                    // trade-route freighters: brig (+ kept deck cargo) or late-era steamer
      r = fleet.routes[i];
      var ph = (clock * r.sp + r.ph) % 2, ff = ph < 1 ? ph : 2 - ph;
      var dd = 24 + ff * 92;
      x = p.x + r.dx * dd; z = p.z + r.dz * dd;
      yaw = ph < 1 ? r.yawOut : r.yawOut + Math.PI;
      bob = Math.sin(clock * 1.3 + r.ph * 3) * 0.3;
      drawShipFolded(M, r.cls, x, bob, z, yaw, dd, r.hull, RTE_SAIL, r.ph * 3);
      if (r.cls === 'brig') {                                      // kept: a tinted cargo crate riding the deck (steamer bakes its own containers)
        gl.uniform3fv(M.u.uBase, r.cargo);
        composeRYS(mModel, x, 2.2 + bob, z, 1.7, 0.9, 1.1, yaw); gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh);   // brig deck y ≈ H*0.99 - draft + crate half-height
      }
    }
    if (fleet.rival) {                                             // Baron Krall's corsair patrols while the race is on
      var rv = fleet.rival, pa = clock * 0.35, dir = Math.cos(pa) >= 0 ? 1 : -1;
      x = rv.cx + rv.px * Math.sin(pa) * 46; z = rv.cz + rv.pz * Math.sin(pa) * 46;
      yaw = Math.atan2(rv.px * dir, rv.pz * dir);
      bob = Math.sin(clock * 1.3) * 0.3;
      drawShip(M, 'corsair', x, bob, z, yaw, 1.0, RVL_HULL, RVL_SAIL, 1.3);
    }
    for (i = 0; i < fleet.navy.length; i++) {                       // Phase 17c: the Navy patrols its own inshore lane — lawful, unhurried
      var nv = fleet.navy[i], pos = navyPatrolPos(nv);
      bob = Math.sin(clock * 1.3 + nv.ph) * 0.3;
      drawShip(M, nv.cls, pos.x, bob, pos.z, pos.yaw, 1.0, NAVY_HULL, NAVY_SAIL, nv.ph);
    }
  }
  // Phase 14c: the pirate corsair — folds IN at the world edge (reusing the existing FOLD_START/END
  // fold-out transform in reverse) to its ~40-unit holding point offshore of the raided port, holds
  // with a slow menace bob while the choice modal is open (or the navy fights it off), then folds
  // back out on resolve. Pure draw: DRAMA.pirate (updateDrama above) already carries the real phase.
  function drawPirate(M) {
    var pr = DRAMA.pirate; if (!pr) return;
    var d;
    if (pr.phase === 'in') d = Math.max(0, (FOLD_END + 24) * (1 - smooth01(clamp(pr.t / 0.9, 0, 1))));
    else if (pr.phase === 'hold' || pr.phase === 'fight') d = 0;
    else d = (FOLD_END + 24) * smooth01(clamp(pr.t / 1.3, 0, 1));   // pay / winDepart / loseDepart
    var bob = Math.sin(clock * 0.9) * 0.35;
    // listing/tilted departure on a won fight — reads as a bested ship limping off
    var listYaw = pr.phase === 'winDepart' ? 0.28 * smooth01(clamp(pr.t / 1.3, 0, 1)) : 0;
    var yaw = Math.atan2(-pr.ox, -pr.oz) + listYaw;
    drawShipFolded(M, 'corsair', pr.x, bob, pr.z, yaw, d, RVL_HULL, RVL_SAIL, 1.3);
  }
  // Phase 16a: test-only forced close-up ship (see __harbor.debugShip) — parked AT the camera
  // target in a 3/4 view regardless of founded/fleet state, so a screenshot can isolate one class
  // (camera dist frames it directly). Colours match each class's real in-game tints.
  var DEBUG_LOOK = { dinghy: [[0.5, 0.4, 0.28], [0.94, 0.93, 0.90]], sloop: [[0.45, 0.22, 0.14], [0.94, 0.93, 0.90]],
    brig: [[0.9, 0.52, 0.2], [0.93, 0.91, 0.87]], schooner: [[0.38, 0.26, 0.17], [1.0, 0.82, 0.34]],
    steamer: [[0.30, 0.34, 0.42], [0.9, 0.9, 0.9]], corsair: [[0.15, 0.13, 0.18], [0.06, 0.05, 0.08]],
    // Phase 17b: fleet-registry ladders — hull tint (uBase on the tint-ready hull) + sail tint
    raft: [[0.55, 0.40, 0.24], [1, 1, 1]], coracle: [[0.58, 0.44, 0.24], [1, 1, 1]],
    steam_trawler: [[0.34, 0.36, 0.40], [1, 1, 1]], modern_trawler: [[0.42, 0.44, 0.48], [1, 1, 1]],
    hydrofoil_skiff: [[0.70, 0.73, 0.78], [1, 1, 1]], solar_skimmer: [[0.20, 0.55, 0.85], [1, 1, 1]],
    log_barge: [[0.45, 0.32, 0.18], [1, 1, 1]], cog: [[0.55, 0.36, 0.20], [0.90, 0.86, 0.78]],
    clipper: [[0.42, 0.24, 0.14], [0.96, 0.94, 0.88]], paddle_steamer: [[0.86, 0.84, 0.78], [1, 1, 1]],
    container_ship: [[0.16, 0.18, 0.22], [1, 1, 1]], hover_freighter: [[0.55, 0.60, 0.66], [1, 1, 1]],
    outrigger: [[0.48, 0.34, 0.20], [0.92, 0.90, 0.85]], caravel: [[0.50, 0.32, 0.18], [0.94, 0.90, 0.80]],
    barque: [[0.38, 0.24, 0.15], [0.92, 0.88, 0.80]], steam_yacht: [[0.88, 0.86, 0.80], [1, 1, 1]],
    research_vessel: [[0.85, 0.42, 0.14], [1, 1, 1]], expedition_catamaran: [[0.90, 0.90, 0.87], [0.94, 0.93, 0.90]],
    solar_trimaran: [[0.24, 0.30, 0.40], [1, 1, 1]],
    // Phase 17c: the Navy — crisp white hull every rung (the navy-blue stripe + gold trim are baked
    // into each class's own mesh), matching NAVY_HULL/NAVY_SAIL above
    patrol_cutter: [[0.92, 0.92, 0.90], [0.90, 0.89, 0.84]], frigate: [[0.92, 0.92, 0.90], [0.90, 0.89, 0.84]],
    ironclad: [[0.92, 0.92, 0.90], [0.90, 0.89, 0.84]], destroyer: [[0.92, 0.92, 0.90], [0.90, 0.89, 0.84]],
    drone_screen: [[0.92, 0.92, 0.90], [0.90, 0.89, 0.84]] };
  function drawDebugShip(M) {
    var look = DEBUG_LOOK[DEBUG_SHIP] || DEBUG_LOOK.dinghy;
    drawShip(M, DEBUG_SHIP, C.tx, Math.sin(clock * 1.3) * 0.3, C.tz, C.az + 2.35, 1.0, look[0], look[1], 0);
  }

  // ---- Phase 19c: paper UNFOLD pop + page-flutter + per-frame building draw -------------------
  // The 18b squash-and-stretch SHAPE is replaced with a pop-up-book unfold: on build/upgrade the
  // building cluster rises as if folding up from flat — y-scale 0 -> ~1.10 overshoot -> exactly 1
  // on one easeOutBack curve, with a slight forward hinge (rotation about local X, like a pop-up
  // page still swinging upright) during the first 40% of the window. xz counter-scales a touch
  // (thin card conserving no real volume, just enough to read as a fold, not a stretch).
  // ALL 18b triggers + the deterministic popTestP/setPopProgress hook contract are kept verbatim:
  // popTestP pins progress (0..1) so the suite asserts EXACT curve values with zero sleeps.
  var POP_DUR = 0.45, popT0 = -10, popTestP = null;
  function triggerPop() { popT0 = clock; }
  function popNow() { return popTestP != null ? popTestP * POP_DUR : clock - popT0; }
  var UNFOLD_C1 = 1.70158, HINGE_MAX = 0.22, HINGE_END = 0.4;   // easeOutBack constant / max forward hinge (rad) / hinge dies at 40% of the window
  function popScaleFor() {
    var t = popNow();
    if (t < 0 || t >= POP_DUR) return { x: 1, y: 1, z: 1, hinge: 0 };
    var k = t / POP_DUR, c3 = UNFOLD_C1 + 1, u = k - 1;
    var f = 1 + c3 * u * u * u + UNFOLD_C1 * u * u;              // easeOutBack: 0 -> ~1.10 -> exactly 1
    var sy = f, sxz = 1 - 0.10 * (f - 1);                        // rise from flat; card counter-flex on the overshoot
    var hinge = k < HINGE_END ? HINGE_MAX * Math.sin(Math.PI * (k / HINGE_END)) : 0;   // early forward tip, settles before the overshoot peaks
    return { x: sxz, y: sy, z: sxz, hinge: hinge };
  }
  // Collect tap = page-flutter: a brief rotation wobble about the same local-X hinge (a page
  // riffled by a thumb), ~0.25s, three decaying half-waves, exactly 0 at both ends. No scale
  // change at all — collecting shouldn't re-play the "just built" unfold. Same deterministic
  // pinned-progress contract as the pop (flutTestP / setFlutterProgress).
  var FLUT_DUR = 0.25, FLUT_MAX = 0.10, flutT0 = -10, flutTestP = null;
  function triggerFlutter() { flutT0 = clock; }
  function flutNow() { return flutTestP != null ? flutTestP * FLUT_DUR : clock - flutT0; }
  function flutterAngleFor() {
    var t = flutNow();
    if (t < 0 || t >= FLUT_DUR) return 0;
    var k = t / FLUT_DUR;
    return FLUT_MAX * Math.sin(k * Math.PI * 3.0) * (1 - k);
  }
  // The buildings render with the SAME program state as the baked scene meshes (uVCol=1, toon sun)
  // — only the model matrix differs: composeRYS at the founded port frame (identical maths to the
  // addXform bake that placed them before 18b, so at scale 1 they land on exactly the same spot).
  function drawPortBuildings(M) {
    if (!scene.port || !meshBldgFlat) return;
    var p = scene.port, pk = popScaleFor();
    composeHingeRYS(mModel, p.x, p.by, p.z, pk.x, pk.y, pk.z, p.yaw, pk.hinge + flutterAngleFor());
    gl.uniformMatrix4fv(M.u.uModel, false, mModel);
    gl.uniform1f(M.u.uTexMix, 0); drawMesh(M, meshBldgFlat);
    gl.bindTexture(gl.TEXTURE_2D, gritTex); gl.uniform1f(M.u.uTexMix, 0.5); drawMesh(M, meshBldgGrit);
    gl.uniformMatrix4fv(M.u.uModel, false, mI);
  }

  // Phase 14a: revive the dormant PCF shadow path. A small directional-light ortho frustum,
  // RECENTRED ON THE CAMERA TARGET every frame (no cascades needed for a human-scale stylized
  // port — the target is always roughly where the player is looking), rendered into the
  // pre-existing shadowFB/shadowTex from gl.js. Only static building geometry + the modern
  // glTF skyline cast (cheap, and the soft contact-shadow blobs already cover boats/crane/gulls);
  // everything still RECEIVES shadows via vLP in V_MAIN regardless. Gated behind postEnabled().
  var SHADOW_R = 130, SHADOW_D = 220, SHADOW_NEAR = 1, SHADOW_FAR = 560;
  function renderShadowMap(target, sd) {
    // sd (sunDir) points FROM the surface TOWARD the sun — the light camera sits sunward of the target
    var lightEye = [target[0] + sd[0] * SHADOW_D, target[1] + sd[1] * SHADOW_D, target[2] + sd[2] * SHADOW_D];
    mat4.lookAt(mLV, lightEye, target, [0, 1, 0]);
    mat4.ortho(mLP, -SHADOW_R, SHADOW_R, -SHADOW_R, SHADOW_R, SHADOW_NEAR, SHADOW_FAR);
    mat4.mul(mLVP, mLP, mLV);
    gl.bindFramebuffer(gl.FRAMEBUFFER, E.shadowFB); gl.viewport(0, 0, E.SH, E.SH);
    gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    var Dp = E.P_depth; gl.useProgram(Dp.p); gl.uniformMatrix4fv(Dp.u.uLightVP, false, mLVP);
    gl.uniformMatrix4fv(Dp.u.uModel, false, mI);
    drawMesh(Dp, meshFlat); drawMesh(Dp, meshGrit); drawMesh(Dp, meshFac);
    // Phase 18b/19c: buildings cast shadows from their runtime transform (same composeHingeRYS as
    // the colour pass, so the shadow unfolds/flutters with the pop too)
    if (scene.port && meshBldgFlat) {
      var pk = popScaleFor();
      composeHingeRYS(mModel, scene.port.x, scene.port.by, scene.port.z, pk.x, pk.y, pk.z, scene.port.yaw, pk.hinge + flutterAngleFor());
      gl.uniformMatrix4fv(Dp.u.uModel, false, mModel);
      drawMesh(Dp, meshBldgFlat); drawMesh(Dp, meshBldgGrit);
      gl.uniformMatrix4fv(Dp.u.uModel, false, mI);
    }
    if (atlasTex && cityModels && scene.city.length) {
      for (var i = 0; i < scene.city.length; i++) {
        var c = scene.city[i], cm = cityModels[c.bi]; if (!cm) continue;
        composeRY(mModel, c.x, HARBOR_MODELS.heightAt(c.x, c.z) - 0.3, c.z, c.s, c.rot); gl.uniformMatrix4fv(Dp.u.uModel, false, mModel);
        for (var pi = 0; pi < cm.prims.length; pi++) drawMesh(Dp, cm.prims[pi].mesh);
      }
    }
  }

  // Phase 14a: cheap wake trails — alpha-quad decals (reusing the existing P_blob contact-shadow
  // pipeline, see wakeTexture() above) trailing every moving hull. Recomputing each vessel's
  // world position here (same formulas as drawAmbient/drawFleet) is far cheaper and more robust
  // in this hand-rolled engine than adding a second shader + a ship-position uniform array
  // plumbed into F_WATER — boat counts are tiny (a dozen-ish) and this reuses a battle-tested path.
  // Phase 17b: wake width now derives from the ACTUAL hull length of whatever class is sailing
  // (getShip(cls).meta.len — already cached by getShip) instead of a hard-coded per-class check, so
  // every one of the 25 fleet-registry classes gets a wake sized to its own silhouette with no
  // per-class list to maintain as the ladders grow.
  function wakeScaleFor(cls, fallback) { var S = getShip(cls); return (S && S.meta) ? clamp(S.meta.len / 16, 0.45, 2.0) : (fallback || 1); }
  function collectWakes() {
    var out = [], i;
    if (ambient) {
      for (i = 0; i < ambient.boats.length; i++) {
        var b = ambient.boats[i], ang = b.a0 + clock * b.sp;
        var x = ambient.cx + Math.cos(ang) * b.rx, z = ambient.cz + Math.sin(ang) * b.rz;
        var nx = -Math.sin(ang) * b.rx * (b.sp < 0 ? -1 : 1), nz = Math.cos(ang) * b.rz * (b.sp < 0 ? -1 : 1);
        out.push({ x: x, z: z, yaw: Math.atan2(nx, nz), sc: wakeScaleFor(ambientBoatClass(b), 0.55) * b.sc });
      }
    }
    var p = scene.port;
    if (p) {
      if (clock - fleet.at > 1) refreshFleet();
      var e, r, x2, z2, yaw2, f, d, eWake = wakeScaleFor(expeditionShipClass(), 1.5);
      for (i = 0; i < fleet.exp.length; i++) {
        e = fleet.exp[i]; f = e.prog < 0.5 ? e.prog * 2 : (1 - e.prog) * 2; d = 28 + f * 132;
        x2 = p.x + e.dx * d; z2 = p.z + e.dz * d; yaw2 = e.prog < 0.5 ? e.yawOut : e.yawOut + Math.PI;
        out.push({ x: x2, z: z2, yaw: yaw2, sc: eWake });                                 // expedition ladder: long hull, long wake
      }
      for (i = 0; i < fleet.routes.length; i++) {
        r = fleet.routes[i]; var ph = (clock * r.sp + r.ph) % 2, ff = ph < 1 ? ph : 2 - ph, dd = 24 + ff * 92;
        x2 = p.x + r.dx * dd; z2 = p.z + r.dz * dd; yaw2 = ph < 1 ? r.yawOut : r.yawOut + Math.PI;
        out.push({ x: x2, z: z2, yaw: yaw2, sc: wakeScaleFor(r.cls, 1.3) });               // trade ladder: churn tracks the owned hull
      }
      if (fleet.rival) {
        var rv = fleet.rival, pa = clock * 0.35, dir = Math.cos(pa) >= 0 ? 1 : -1;
        x2 = rv.cx + rv.px * Math.sin(pa) * 46; z2 = rv.cz + rv.pz * Math.sin(pa) * 46;
        out.push({ x: x2, z: z2, yaw: Math.atan2(rv.px * dir, rv.pz * dir), sc: 1.4 });   // corsair
      }
      for (i = 0; i < fleet.navy.length; i++) {                     // Phase 17c: navy patrol wakes track the owned hull, closer inshore
        var nv = fleet.navy[i], npos = navyPatrolPos(nv);
        out.push({ x: npos.x, z: npos.z, yaw: npos.yaw, sc: wakeScaleFor(nv.cls, 1.1) });
      }
    }
    return out;
  }
  function drawWakes(en) {
    var list = collectWakes(); if (!list.length || !wakeTex) return;
    var Bp = E.P_blob; gl.useProgram(Bp.p); gl.uniformMatrix4fv(Bp.u.uVP, false, mVP);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, wakeTex); gl.uniform1i(Bp.u.uTex, 1);
    gl.uniform3fv(Bp.u.uTint, [0.93, 0.97, 1.0]);   // white foam (P_blob's uTint is shared with drawBlobs' black shadows — always set explicitly)
    gl.uniform1f(Bp.u.uStr, 0.5 * (0.30 + 0.70 * en.day));   // matches the shoreline foam's ToD fade — no glowing wakes at night
    // depth-tested (no write) so hulls/land occlude wakes correctly; the quad floats just above
    // the wave crests (water surface tops out ~+0.015) so it never z-fights the animated sea.
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    for (var i = 0; i < list.length; i++) {
      var s = list[i], dx = Math.sin(s.yaw), dz = Math.cos(s.yaw), half = 7.5 * s.sc;
      var cx = s.x - dx * (half + 1.2 * s.sc), cz = s.z - dz * (half + 1.2 * s.sc);   // trail starts at the stern
      composeRYS(mModel, cx, 0.08, cz, 2.4 * s.sc, 1, half, s.yaw + Math.PI); gl.uniformMatrix4fv(Bp.u.uModel, false, mModel);
      drawMesh(Bp, E.blobQuad);
    }
    gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE);
  }

  function render() {
    if (!gl) return;
    if (scene.port && !ambient) buildAmbient();
    var en = env(), sd = sunDir(), ev = eye(), target = [C.tx, C.ty, C.tz];
    // Phase 20b: slab bob — shift eye+target by -bobY (camera moving down == whole world moving up
    // by the same amount, see bobY() note above) and roll the up vector a hair; this is the ONLY
    // place bob is applied, so picking (screenToGround, uses its own unbobbed eye()) is untouched.
    var bY = bobY(), bR = bobRoll();
    var evB = [ev[0], ev[1] - bY, ev[2]], targetB = [target[0], target[1] - bY, target[2]];
    var upB = [Math.sin(bR), Math.cos(bR), 0];
    var parts = scene.crane ? craneParts() : [];
    var quality = postEnabled();   // Phase 14a: single quality gate drives DoF/bloom + ink outlines + soft shadows
    // sun-height shadow strength (see uShadowOn note below); skip the whole depth pass when it can't bite
    var shadowStr = quality ? smoothstep01((sd[1] - 0.10) / 0.22) : 0;
    if (shadowStr > 0.01) renderShadowMap(targetB, sd);

    // main. Phase 10c/14a: when quality is on, the whole scene renders into an offscreen RT and
    // composites to screen at the end (tilt-shift DoF + bloom-lite + ink outlines, all one pass).
    var rt = quality ? ensurePostRT() : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt ? rt.fb : null); gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(en.bot[0], en.bot[1], en.bot[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    mat4.perspective(mProj, CAM_FOVY, canvas.width / canvas.height, CAM_NEAR, CAM_FAR); mat4.lookAt(mView, evB, targetB, upB); mat4.mul(mVP, mProj, mView);
    var i;

    // sky
    gl.depthMask(false); gl.disable(gl.CULL_FACE);
    var S = E.P_sky; gl.useProgram(S.p);
    gl.uniform3fv(S.u.uTop, en.top); gl.uniform3fv(S.u.uBot, en.bot); gl.uniform3fv(S.u.uSunCol, en.sun);
    gl.uniform3fv(S.u.uHorizon, en.horizon);                    // 3rd stop: authored horizon glow band
    // anchor the glow to the real sea horizon: project a far sea-level point along the view heading
    var hfl = Math.hypot(target[0] - ev[0], target[2] - ev[2]) || 1;
    var hpx = ev[0] + (target[0] - ev[0]) / hfl * 1400, hpz = ev[2] + (target[2] - ev[2]) / hfl * 1400;
    var hcy = mVP[1] * hpx + mVP[9] * hpz + mVP[13], hcw = mVP[3] * hpx + mVP[11] * hpz + mVP[15];
    gl.uniform1f(S.u.uHorizonY, clamp((hcy / (hcw || 1)) * 0.5 + 0.5, 0.04, 0.8));
    gl.uniform2fv(S.u.uSun, [0.5 + sd[0] * 0.42, 0.32 + sd[1] * 0.5]);
    var md = moonDir(); gl.uniform2fv(S.u.uMoon, [0.5 + md[0] * 0.42, 0.32 + md[1] * 0.5]);   // Phase 19b: crescent moon card
    gl.uniform1f(S.u.uNight, en.night); gl.uniform1f(S.u.uTime, clock);   // night starfield
    gl.uniform1f(S.u.uAspect, canvas.width / canvas.height);   // 19b: aspect-correct the sun/moon disc distance so they're circles, not ellipses
    gl.uniform1f(S.u.uGrain, GRAIN_SKY);   // paper-fibre grain (19a) — gentlest on the sky card
    drawMesh(S, E.quad); gl.depthMask(true); gl.enable(gl.CULL_FACE);

    // scene meshes
    var M = E.P_main; gl.useProgram(M.p);
    gl.uniformMatrix4fv(M.u.uVP, false, mVP);
    gl.uniform3fv(M.u.uSunDir, sd); gl.uniform3fv(M.u.uSunCol, en.sun);
    gl.uniform3fv(M.u.uAmbTop, en.ambTop);                      // authored ToD ambient (sky bounce)
    gl.uniform3fv(M.u.uAmbBot, en.ambBot);                      // authored ToD ambient (ground bounce)
    gl.uniform3fv(M.u.uShadowTint, biome.shadowTint || [0.58, 0.64, 1.08]); gl.uniform1f(M.u.uShadowK, en.shadowK);
    gl.uniform3fv(M.u.uCam, ev); gl.uniform3fv(M.u.uFog, en.fog); gl.uniform1f(M.u.uFogD, en.fogD);  // gentle authored distance fog
    gl.uniform3fv(M.u.uWin, [1.0, 0.82, 0.46]); gl.uniform1f(M.u.uNight, en.night); gl.uniform1f(M.u.uTime, clock);
    // Phase 19a papercraft grade: near-unity saturation + gentle crush (see gradeSat/gradeCrush
    // above) — the matte construction-paper palette in biomes.js/models.js carries the colour
    // now, the grade only breathes with ToD. Paper-fibre grain rides every pass.
    gl.uniform1f(M.u.uExposure, 1.30); gl.uniform1f(M.u.uSat, gradeSat(en));   // 19a: exposure cut 1.6->1.30 — ACES was bleaching card pigment to pastel
    gl.uniform1f(M.u.uCrush, gradeCrush(en));
    gl.uniform1f(M.u.uGrain, GRAIN_MAIN);
    // Phase 14a: revived PCF soft shadows — same directional light, recentred ortho frustum from
    // renderShadowMap() above, gated behind the same quality flag as the post pass. Strength
    // fades with sun height (see shadow() in gl.js): full at noon, gone by dusk — grazing light
    // over the coarse 5-unit terrain grid would mottle with self-shadow acne, and the blob
    // decals already stretch long/soft for the low-sun look.
    gl.uniformMatrix4fv(M.u.uLightVP, false, mLVP);
    gl.uniform1f(M.u.uShadowOn, shadowStr);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, shadowStr > 0.01 ? E.shadowTex : null); gl.uniform1i(M.u.uShadow, 2);
    gl.uniform1f(M.u.uToon, 1); gl.uniform1f(M.u.uVCol, 1); gl.uniform1f(M.u.uAlbedo, 0);
    gl.uniformMatrix4fv(M.u.uModel, false, mI);
    gl.activeTexture(gl.TEXTURE1); gl.uniform1i(M.u.uTex, 1);
    // flat (no tex), grit (grit tex), fac (window tex)
    gl.uniform1f(M.u.uTexMix, 0); drawMesh(M, meshFlat);
    gl.bindTexture(gl.TEXTURE_2D, gritTex); gl.uniform1f(M.u.uTexMix, 0.5); drawMesh(M, meshGrit);
    gl.bindTexture(gl.TEXTURE_2D, facTex); gl.uniform1f(M.u.uTexMix, 0.8); drawMesh(M, meshFac);
    // Phase 18b: port buildings — own meshes, per-frame transform (squash-stretch pop rides here)
    drawPortBuildings(M);
    // modern skyline (glTF assets)
    gl.uniform1f(M.u.uTexMix, 0); drawCity(M);
    // dynamic crane parts (flat colour) — transformed to the founded port frame
    gl.uniform1f(M.u.uVCol, 0); gl.uniform1f(M.u.uTexMix, 0); gl.uniform1f(M.u.uAlbedo, 0);
    // Phase 14b: drifting clouds — every biome/world, founded or wild, sky-layer only (no shadow,
    // no scene.blobs entry); same flat-colour program state the crane parts below reuse.
    drawClouds(M, en, ev);
    // Phase 20b: void paper flecks — every biome/world, founded or wild, same flat-colour program
    // state as the clouds above. Skipped during the era-ascension cinematic: the camera is pulled
    // in tight on the port for that beat (see updateCine()) so the far-void scatter is off-screen
    // anyway, and that cinematic's banner-reveal timing is real-wall-clock-bounded (see its own
    // comment in updateCine), so it's not worth even the handful of extra draw calls there.
    if (!cine) drawFlecks(M, en, ev);
    var pf = scene.port, pc = pf ? Math.cos(pf.yaw) : 1, psn = pf ? Math.sin(pf.yaw) : 0;
    for (i = 0; i < parts.length; i++) {
      var t = parts[i].t, lx = t[0], lz = t[2];
      var wx = pf ? lx * pc + lz * psn + pf.x : lx, wz = pf ? -lx * psn + lz * pc + pf.z : lz, wy = t[1] + (pf ? pf.by : 0);
      gl.uniform3fv(M.u.uBase, parts[i].c); composeRYS(mModel, wx, wy, wz, parts[i].s[0], parts[i].s[1], parts[i].s[2], pf ? pf.yaw : 0); gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh);
    }
    // living port: sailing boats + wheeling gulls + dock workers (flat-colour, same program state as crane parts)
    if (scene.port) { drawAmbient(M); drawFleet(M); drawPirate(M); drawWorkers(M); }
    if (DEBUG_SHIP) drawDebugShip(M);   // Phase 16a test-only: forced close-up ship (works founded or wild)

    // curated harbour beacons (highlight each candidate; the selected one taller, brighter, pulsing)
    if (foundMode() && sites.length) {
      for (var si = 0; si < sites.length; si++) {
        var s = sites[si], sy = HARBOR_MODELS.heightAt(s.x, s.z), on = si === selSite;
        var pulse = on ? 1 + 0.12 * Math.sin(clock * 4) : 1;
        gl.uniform3fv(M.u.uBase, on ? [1.7, 1.35, 0.25] : [0.35, 0.95, 1.25]);
        composeRYS(mModel, s.x, sy + 11 * pulse, s.z, on ? 1.7 : 1.2, 22 * pulse, on ? 1.7 : 1.2, 0); gl.uniformMatrix4fv(M.u.uModel, false, mModel); drawMesh(M, boxMesh);
      }
    }

    // CRITICAL (RTT feedback trap, doubled for Phase 14a — see gl.js createRT comment): shadowTex
    // is about to become shadowFB's attachment again at the TOP of next frame's render() (via
    // renderShadowMap). Unbind it from unit 2 now, while shadowFB is not the draw target, so it's
    // never simultaneously bound-as-sampler + bound-as-attachment (that's a silent feedback loop —
    // a GL warning, and the browser test suite fails on that warning).
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE1);

    // soft contact shadows
    drawBlobs(sd);
    // Phase 14b: warm night light pools under lampposts + lit windows (night-gated, no-op by day)
    drawNightPools(en);

    // water
    // Phase 14c: storm — F_WATER's uStorm uniform (0..1, eased from the real hazard-warn state in
    // updateDrama) whips the paper sea's band-slide up (spd*(1+2*uStorm)) and darkens it toward
    // slate; env() already cools uDeep/uShallow above. uTime stays the plain clock — the shader owns
    // the storm speed-up, so __harbor.water()'s waterBandPhase(k, clock) still mirrors the calm sea.
    var W = E.P_water; gl.useProgram(W.p); gl.uniformMatrix4fv(W.u.uVP, false, mVP); gl.uniform1f(W.u.uTime, clock);
    gl.uniform1f(W.u.uStorm, clamp(DRAMA.stormT, 0, 1));
    gl.uniform3fv(W.u.uCam, ev); gl.uniform3fv(W.u.uSunDir, sd); gl.uniform3fv(W.u.uSunCol, en.sun);
    gl.uniform3fv(W.u.uDeep, m3(biome.deep, en.water)); gl.uniform3fv(W.u.uShallow, m3(biome.shallow, en.water));   // ToD-lit water body
    gl.uniform3fv(W.u.uSky, lerp3(en.bot, en.horizon, 0.4)); gl.uniform3fv(W.u.uSkyTop, en.top);   // water mirrors the sky gradient incl. the horizon glow
    gl.uniform3fv(W.u.uFog, en.fog); gl.uniform1f(W.u.uFogD, en.fogD);
    // Phase 19a: sparkle is gone from F_WATER entirely (matte paper sea) — en.sparkle is now
    // authored 0 at every ToD key and no uniform ships it; foam/wakes carry the white life.
    gl.uniform1f(W.u.uFoam, 0.12 + 0.88 * en.day);   // Phase 14a: shoreline foam full by day, faint by night (never a glowing coast)
    gl.uniform1f(W.u.uExposure, 1.34); gl.uniform1f(W.u.uSat, 1.0); gl.uniform1f(W.u.uGrain, GRAIN_WATER);   // 19a: exposure trimmed — card sea, not glare
    gl.disable(gl.CULL_FACE); drawMesh(W, waterMesh); gl.enable(gl.CULL_FACE);

    // Phase 14a: wake trails, composited over the water (alpha decals — see drawWakes above)
    drawWakes(en);

    // Phase 10c/14a composite: tilt-shift miniature DoF + bloom-lite + ink outlines, one fullscreen kernel.
    // (The 2D cinematic/FX layers are DOM canvases ABOVE the WebGL canvas — untouched.)
    if (rt) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
      var PP = E.P_post; gl.useProgram(PP.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, rt.tex); gl.uniform1i(PP.u.uTex, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, rt.depthTex); gl.uniform1i(PP.u.uDepth, 1);
      gl.uniform2fv(PP.u.uTexel, [1 / rt.w, 1 / rt.h]);
      gl.uniform1f(PP.u.uFocusY, POST_FOCUS_Y); gl.uniform1f(PP.u.uFocusW, POST_FOCUS_W);
      gl.uniform1f(PP.u.uDofAmt, dofAmt());
      gl.uniform1f(PP.u.uBloomThresh, POST_BLOOM_T); gl.uniform1f(PP.u.uBloomAmt, POST_BLOOM_A);
      gl.uniform1f(PP.u.uNear, CAM_NEAR); gl.uniform1f(PP.u.uFar, CAM_FAR); gl.uniform1f(PP.u.uFovY, CAM_FOVY); gl.uniform1f(PP.u.uAspect, canvas.width / canvas.height);
      gl.uniform1f(PP.u.uOutlineOn, quality ? 1 : 0);
      gl.uniform1f(PP.u.uOutlineDepthT, OUTLINE_DEPTH_T); gl.uniform1f(PP.u.uOutlineNormT, OUTLINE_NORM_T);
      gl.uniform1f(PP.u.uOutlineFade, OUTLINE_FADE); gl.uniform1f(PP.u.uOutlineMaxDist, OUTLINE_MAXDIST);
      gl.uniform1f(PP.u.uOutlineWidth, OUTLINE_WIDTH); gl.uniform1f(PP.u.uOutlineWobble, OUTLINE_WOBBLE);
      gl.uniform3fv(PP.u.uOutlineTint, outlineTint(en));
      drawMesh(PP, E.quad);
      // CRITICAL (doubled for Phase 14a): unbind BOTH rt.tex (unit 0) and rt.depthTex (unit 1) —
      // they're about to become this same FBO's attachments again next frame; leaving either
      // bound as a sampler while its own FBO is the draw target is the feedback-loop trap.
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.enable(gl.CULL_FACE);
      gl.activeTexture(gl.TEXTURE1);   // scene passes bind their textures on unit 1 — restore
    }
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
      // Phase 15c: every colony after the first costs money — show it up front, ghosted when
      // the player can't yet afford it (reuses the same "Need £" language as Manage/Expeditions).
      var cost = SIM ? SIM.foundCost() : 0, can = SIM ? SIM.canFoundPort() : true;
      if (foundBtn) {
        foundBtn.textContent = cost > 0 ? (can ? 'Found colony — £' + fmt(cost) : 'Need £' + fmt(cost)) : 'Found village';
        foundBtn.classList.toggle('ghosted', !can);
        foundBtn.disabled = selSite < 0 || !can;
      }
      if (selSite < 0 && foundLabel) foundLabel.textContent = 'Choose your harbour';
    } else { foundPanel.classList.remove('show'); }
  }
  function autoFound() { var ss = sites.length ? sites : HARBOR_MODELS.sites(); if (ss[0]) foundHere(ss[0].x, ss[0].z, ss[0].yaw); }

  // ---- input: PAN-FIRST. 1 finger / left-drag = travel along the coast; pinch / wheel = zoom;
  // 2-finger twist (or right-drag / Shift+drag) = rotate; tap = scout; arrow keys / WASD pan. ----
  var ptrs = new Map(), pinchPrev = 0, panPrev = null, twistPrev = null, twistAcc = 0, lastTap = 0, downPt = null, moved = false, multi = false, orbitMode = false;
  function pxy(e) { var b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
  // Phase 20a: THE FLOATING DIORAMA reframe — default pitch lowered (0.5->0.42 founded, 0.56->0.46
  // wild) so the slab edge/skirt sits in frame instead of being cropped by the top of the screen,
  // and the wild "whole island" framing pulls back further (360->520) so the SLAB's far edge (and
  // its cliff-skirt) reads as an object's boundary, not a landscape fading off-screen.
  function defaultView() {
    if (founded[biomeId]) { C.azT = 2.42; C.elT = 0.42; C.distT = 150; C.txT = founded[biomeId].x; C.tzT = founded[biomeId].z; }
    else { C.azT = 2.42; C.elT = 0.46; C.distT = 520; C.txT = 0; C.tzT = 120; }   // frame the whole floating island
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
      if (!muted) startAmbient();                                 // start the harbour soundscape
      if (canvas.setPointerCapture) try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
      ptrs.set(e.pointerId, pxy(e)); C.vAz = C.vEl = C.vTx = C.vTz = 0;
      if (ptrs.size === 1) { downPt = pxy(e); moved = false; multi = false; orbitMode = (e.button === 2 || e.shiftKey); var now = Date.now(); if (now - lastTap < 300) defaultView(); lastTap = now; }
      else { multi = true; pinchPrev = 0; panPrev = null; twistPrev = null; twistAcc = 0; }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!ptrs.has(e.pointerId)) return;
      var p = pxy(e), prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, p);
      if (ptrs.size === 1) {
        var dx = p.x - prev.x, dy = p.y - prev.y;
        if (downPt && Math.hypot(p.x - downPt.x, p.y - downPt.y) > 8) { moved = true; if (hintEl) hintEl.classList.add('gone'); }
        if (orbitMode) { C.azT -= dx * 0.0045; C.elT = clamp(C.elT - dy * 0.0035, CAM_EL_MIN, 1.3); C.vAz = -dx * 0.0045; C.vEl = -dy * 0.0035; }
        else panDrag(prev.x, prev.y, p.x, p.y);              // pan-first: drag travels along the coast (natural)
      } else if (ptrs.size >= 2) {
        var pts = Array.from(ptrs.values()), a = pts[0], b = pts[1];
        var d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        // ZOOM: gentle + smooth (cap per-event change so fast pinches don't jump)
        if (pinchPrev) { var f = clamp(pinchPrev / d, 0.82, 1.22); C.distT = clamp(C.distT * f, CAM_DIST_MIN, CAM_DIST_MAX); }
        pinchPrev = d;
        // TWIST -> rotate, but only past a deadzone so a normal pinch never accidentally spins the camera
        var ang = Math.atan2(a.y - b.y, a.x - b.x);
        if (twistPrev != null) {
          var da = ang - twistPrev; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
          twistAcc += da;
          if (Math.abs(twistAcc) > 0.12) { var ap = twistAcc * 0.85; C.azT += ap; C.vAz = ap * 0.5; twistAcc = 0; }
        }
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
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); var f = clamp(1 + e.deltaY * 0.0012, 0.8, 1.25); C.distT = clamp(C.distT * f, CAM_DIST_MIN, CAM_DIST_MAX); }, { passive: false });
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
  var muted = !!(window.Retention && Retention.get(GAME, 'muted', false));
  var hapticsOff = !!(window.Retention && Retention.get(GAME, 'hapticsOff', false));
  var musicOff = !!(window.Retention && Retention.get(GAME, 'musicOff', false));
  var hudShownMoney = 0, prevMoney = 0, incomeTimer = 0, cine = null, ascendBanner = null;
  function sfx(name, a) { if (window.Juice && !muted) Juice.Audio.play(name, a); }
  function haptic(ms) { if (window.Juice && !hapticsOff) Juice.vibrate(ms); }
  function applyMuted(v) {
    muted = !!v; if (window.Juice) Juice.Audio.setMuted(muted); if (window.Retention) Retention.set(GAME, 'muted', muted);
    if (muteBtn) { muteBtn.textContent = muted ? '♪̸' : '♪'; muteBtn.classList.toggle('off', muted); }
    if (muted) stopAmbient(); else startAmbient();
    updateWashGain();   // Phase 20b: the wash target must reflect mute immediately, not on the next throttled tick
    if (settingsOpen) renderSettings();
  }
  function applyHaptics(off) { hapticsOff = !!off; if (window.Retention) Retention.set(GAME, 'hapticsOff', hapticsOff); if (settingsOpen) renderSettings(); }
  function applyMusicOff(v) {
    musicOff = !!v; if (window.Retention) Retention.set(GAME, 'musicOff', musicOff);
    applyMusicGain();
    if (settingsOpen) renderSettings();
  }

  // Ambient harbour soundscape (Phase 11c) — three layers hung off one master graph:
  //  · wave    — brown-noise bed + tidal LFO (existing), quieter/darker at night
  //  · night   — sparse cricket/owl chirps, day↔night gulls/crickets cross-fade over ~2s
  //  · weather — bandpass-filtered howl + low rumble one-shots, silent until a storm warns
  //  · music   — gentle pentatonic sequencer bed, low volume, off at night, ducked in storms
  // All gains ramp smoothly; the Sound toggle / tab-hidden / master mute stays authoritative
  // (amb.master gates everything). No audio assets — every layer is synthesized.
  var amb = null, ambGullT = null, ambCritT = null, ambMusicT = null;
  var ambMusicPhrase = null, ambMusicIdx = 0, ambTodT = 0, ambWasNight = null, stormActive = false;
  // last commanded target per ramped layer — the decision our code made, independent of how
  // fast the browser's audio thread actually gets there (exposed for deterministic testing;
  // WebAudio ramp convergence timing can't be reliably polled headless under swiftshader load).
  var ambTarget = { master: 0, wave: 0.5, night: 0, weather: 0, music: 0, wash: 0 };
  var ambWashT = 0;   // Phase 20b: throttle for the edge-proximity wash-gain recompute (cheap, but no need every frame)
  var MUSIC_SCALE = [220.00, 261.63, 293.66, 329.63, 392.00, 440.00];   // A3 C4 D4 E4 G4 A4 — pentatonic
  var MUSIC_PAD = 110.00;                                               // low pad note, A2
  var MUSIC_BASE = 0.085;                                               // bed volume — low, background only
  function startAmbient() {
    if (muted) return;
    if (!amb) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        var ctx = new AC();
        var master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);

        // wave bed: brown-ish noise -> lowpass -> gain, with a slow tidal swell LFO
        var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate), d = buf.getChannelData(0), last = 0;
        for (var i = 0; i < d.length; i++) { var w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }   // brown-ish noise
        var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 540; lp.Q.value = 0.4;
        var wave = ctx.createGain(); wave.gain.value = 0.5;
        src.connect(lp); lp.connect(wave); wave.connect(master);
        var lfo = ctx.createOscillator(); lfo.frequency.value = 0.09; var lfoG = ctx.createGain(); lfoG.gain.value = 0.22;
        lfo.connect(lfoG); lfoG.connect(wave.gain); lfo.start();                                   // slow tidal swell
        src.start();

        // night critter layer: silent by day, gulls hand off to crickets/owls after dusk
        var night = ctx.createGain(); night.gain.value = 0; night.connect(master);

        // weather layer: white-noise -> bandpass (slow LFO on centre freq = "howl") -> gain, silent
        // until a storm warns; strike moments add a separate low rumble one-shot into the same gain.
        var wbuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate), wd = wbuf.getChannelData(0);
        for (var j = 0; j < wd.length; j++) wd[j] = Math.random() * 2 - 1;
        var wsrc = ctx.createBufferSource(); wsrc.buffer = wbuf; wsrc.loop = true;
        var wbp = ctx.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 900; wbp.Q.value = 0.7;
        var weather = ctx.createGain(); weather.gain.value = 0;
        wsrc.connect(wbp); wbp.connect(weather); weather.connect(master);
        var wlfo = ctx.createOscillator(); wlfo.frequency.value = 0.13; var wlfoG = ctx.createGain(); wlfoG.gain.value = 380;
        wlfo.connect(wlfoG); wlfoG.connect(wbp.frequency); wlfo.start();
        wsrc.start();

        // generative music bed: its own low gain, sequenced notes connect in per-note
        var music = ctx.createGain(); music.gain.value = 0; music.connect(master);

        // Phase 20b: waterfall wash — a gentle continuous filtered-noise layer (the 48 paper
        // waterfall strips around the slab rim), silent-ish in the harbour bowl and swelling as the
        // camera nears the slab's edge (see updateWashGain below). Reuses the same noise-buffer +
        // biquad-filter + gain pattern as the wave/weather layers above; own gentle highpass (a
        // brighter, splashier band than the low wave rumble) so it reads as falling water, not surf.
        var washBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate), washD = washBuf.getChannelData(0);
        for (var wj = 0; wj < washD.length; wj++) washD[wj] = Math.random() * 2 - 1;
        var washSrc = ctx.createBufferSource(); washSrc.buffer = washBuf; washSrc.loop = true;
        var washHp = ctx.createBiquadFilter(); washHp.type = 'highpass'; washHp.frequency.value = 1400; washHp.Q.value = 0.5;
        var wash = ctx.createGain(); wash.gain.value = 0;
        washSrc.connect(washHp); washHp.connect(wash); wash.connect(master); washSrc.start();

        amb = { ctx: ctx, master: master, wave: wave, waveLP: lp, night: night, weather: weather, music: music, wash: wash };
        scheduleGull(); scheduleCritter(); scheduleMusic();
      } catch (e) { amb = null; return; }
    }
    if (amb.ctx.state === 'suspended') { try { amb.ctx.resume(); } catch (e) {} }
    var t = amb.ctx.currentTime;
    ambTarget.master = 0.16;
    amb.master.gain.cancelScheduledValues(t); amb.master.gain.setValueAtTime(amb.master.gain.value, t);
    amb.master.gain.linearRampToValueAtTime(0.16, t + 1.5);
  }
  function stopAmbient() {
    if (!amb) return;
    var t = amb.ctx.currentTime;
    ambTarget.master = 0;
    amb.master.gain.cancelScheduledValues(t); amb.master.gain.setValueAtTime(amb.master.gain.value, t);
    amb.master.gain.linearRampToValueAtTime(0, t + 0.6);
  }
  function gullCry() {
    if (!amb || muted) return;
    var ctx = amb.ctx, t0 = ctx.currentTime;
    for (var k = 0; k < 2; k++) {
      var o = ctx.createOscillator(), g = ctx.createGain(), st = t0 + k * 0.17;
      o.type = 'triangle';
      o.frequency.setValueAtTime(1250 + Math.random() * 320, st);
      o.frequency.exponentialRampToValueAtTime(700, st + 0.15);
      g.gain.setValueAtTime(0.0001, st); g.gain.linearRampToValueAtTime(0.05, st + 0.02); g.gain.exponentialRampToValueAtTime(0.0008, st + 0.2);
      o.connect(g); g.connect(amb.master); o.start(st); o.stop(st + 0.24);
    }
  }
  function scheduleGull() {
    clearTimeout(ambGullT);
    ambGullT = setTimeout(function () {
      if (amb && !muted && !document.hidden && scene && scene.port && env().night <= 0.5) gullCry();   // daylight only
      scheduleGull();
    }, 7000 + Math.random() * 13000);
  }
  // sparse cricket chirps (most nights) with an occasional soft owl hoot, very quiet — night only
  function critterChirp() {
    if (!amb) return;
    var ctx = amb.ctx, t0 = ctx.currentTime;
    if (Math.random() < 0.22) {
      for (var k = 0; k < 2; k++) {
        var o = ctx.createOscillator(), g = ctx.createGain(), st = t0 + k * 0.36;
        o.type = 'sine'; o.frequency.setValueAtTime(320 - k * 40, st);
        g.gain.setValueAtTime(0.0001, st); g.gain.linearRampToValueAtTime(0.045, st + 0.06); g.gain.exponentialRampToValueAtTime(0.0006, st + 0.5);
        o.connect(g); g.connect(amb.night); o.start(st); o.stop(st + 0.55);
      }
    } else {
      for (var k2 = 0; k2 < 3; k2++) {
        var o2 = ctx.createOscillator(), g2 = ctx.createGain(), st2 = t0 + k2 * 0.09;
        o2.type = 'square'; o2.frequency.setValueAtTime(2600 + Math.random() * 400, st2);
        g2.gain.setValueAtTime(0.0001, st2); g2.gain.linearRampToValueAtTime(0.02, st2 + 0.01); g2.gain.exponentialRampToValueAtTime(0.0004, st2 + 0.07);
        o2.connect(g2); g2.connect(amb.night); o2.start(st2); o2.stop(st2 + 0.09);
      }
    }
  }
  function scheduleCritter() {
    clearTimeout(ambCritT);
    ambCritT = setTimeout(function () {
      if (amb && !muted && !document.hidden && env().night > 0.5) critterChirp();
      scheduleCritter();
    }, 6000 + Math.random() * 9000);
  }
  // generative pentatonic music bed — soft plucks (+ occasional low pad), lots of rest,
  // ~56–66bpm, scheduled with a small lookahead against ctx.currentTime for clean timing.
  function buildMusicPhrase() {
    var len = 12 + Math.floor(Math.random() * 8), out = [];
    for (var i = 0; i < len; i++) {
      var r = Math.random();
      if (r < 0.46) out.push(null);                                                   // rest — calm, not chiptune-busy
      else if (r < 0.56) out.push({ pad: true });                                      // occasional low pad note
      else out.push({ note: MUSIC_SCALE[Math.floor(Math.random() * MUSIC_SCALE.length)] });
    }
    return out;
  }
  function playMusicNote(step) {
    if (!amb) return;
    var ctx = amb.ctx, t0 = ctx.currentTime + 0.05;                                    // small lookahead
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = step.pad ? 'sine' : 'triangle';
    o.frequency.setValueAtTime(step.pad ? MUSIC_PAD : step.note, t0);
    var peak = step.pad ? 0.55 : 1.0, dur = step.pad ? 2.6 : 1.2;                       // ~1.2s release on plucks
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(amb.music); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function scheduleMusic() {
    clearTimeout(ambMusicT);
    var bpm = 56 + Math.random() * 10;                                                 // 56–66 BPM, gently humanized
    ambMusicT = setTimeout(function () {
      if (amb && !muted && !document.hidden && !musicOff && env().night <= 0.5) {
        if (!ambMusicPhrase) ambMusicPhrase = buildMusicPhrase();                      // seeded once per session
        var step = ambMusicPhrase[ambMusicIdx % ambMusicPhrase.length]; ambMusicIdx++;
        if (step) playMusicNote(step);
      }
      scheduleMusic();
    }, 60000 / bpm);
  }
  // weather layer: ramps between silence and a moderate howl on hazard warn/idle; a strike
  // moment adds a short 40–60Hz rumble swell. Also ducks the music bed to ~30% during storms.
  function applyWeatherGain(active) {
    if (!amb) return;
    var t = amb.ctx.currentTime, target = active ? 0.14 : 0;
    ambTarget.weather = target;
    amb.weather.gain.cancelScheduledValues(t); amb.weather.gain.setValueAtTime(amb.weather.gain.value, t);
    amb.weather.gain.linearRampToValueAtTime(target, t + (active ? 1.2 : 1.8));
  }
  function applyMusicGain() {
    if (!amb) return;
    var t = amb.ctx.currentTime, night = env().night > 0.5;
    var target = (musicOff || night) ? 0 : (stormActive ? MUSIC_BASE * 0.3 : MUSIC_BASE);
    ambTarget.music = target;
    amb.music.gain.cancelScheduledValues(t); amb.music.gain.setValueAtTime(amb.music.gain.value, t);
    amb.music.gain.linearRampToValueAtTime(target, t + (stormActive ? 0.8 : 2));
  }
  // Phase 20b: how close the camera's focus is to the slab's own edge, 0 (harbour bowl) .. 1 (at/past
  // the rim) — normalised against the SLAB ellipse, same shape the pan clamp (PANX/PANZ0/PANZ1) uses.
  function edgeProximity() {
    var dx = (C.tx - SLAB0.cx) / SLAB0.rx, dz = (C.tz - SLAB0.cz) / SLAB0.rz;
    return clamp(Math.hypot(dx, dz), 0, 1);
  }
  // commanded wash-layer target: silent when muted (amb.master already gates it, but the TARGET
  // itself must also report 0 so a test can assert the decision independent of live ramp timing —
  // same "commanded, not live" contract as ambTarget.weather/music), otherwise scales with edge
  // proximity up to a gentle ceiling (never louder than the wave-bed floor).
  function updateWashGain() {
    if (!amb) return;
    var target = muted ? 0 : edgeProximity() * 0.11;
    ambTarget.wash = target;
    var t = amb.ctx.currentTime;
    amb.wash.gain.cancelScheduledValues(t); amb.wash.gain.setValueAtTime(amb.wash.gain.value, t);
    amb.wash.gain.linearRampToValueAtTime(target, t + 1.4);
  }
  function stormRumble() {
    if (!amb) return;
    var ctx = amb.ctx, t0 = ctx.currentTime;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(56, t0); o.frequency.exponentialRampToValueAtTime(40, t0 + 0.9);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.22, t0 + 0.12); g.gain.exponentialRampToValueAtTime(0.0008, t0 + 1.1);
    o.connect(g); g.connect(amb.master); o.start(t0); o.stop(t0 + 1.15);
  }
  // per-frame ToD watcher: crosses the day/night threshold at most once per state, ramping the
  // wave bed, night critters and music bed over ~2s — throttled, cheap even at 60fps.
  function updateAmbientToD(dt) {
    if (!amb) return;
    ambTodT += dt; if (ambTodT < 0.5) return; ambTodT = 0;
    var night = env().night > 0.5;
    if (night === ambWasNight) return;
    ambWasNight = night;
    var t = amb.ctx.currentTime;
    ambTarget.wave = night ? 0.32 : 0.5; ambTarget.night = night ? 1 : 0;
    amb.wave.gain.cancelScheduledValues(t); amb.wave.gain.setValueAtTime(amb.wave.gain.value, t);
    amb.wave.gain.linearRampToValueAtTime(ambTarget.wave, t + 2);
    amb.waveLP.frequency.cancelScheduledValues(t); amb.waveLP.frequency.setValueAtTime(amb.waveLP.frequency.value, t);
    amb.waveLP.frequency.linearRampToValueAtTime(night ? 320 : 540, t + 2);
    amb.night.gain.cancelScheduledValues(t); amb.night.gain.setValueAtTime(amb.night.gain.value, t);
    amb.night.gain.linearRampToValueAtTime(ambTarget.night, t + 2);
    applyMusicGain();
  }
  // force an immediate resync of every ramped layer to the current ToD/hazard/mute state,
  // bypassing the per-frame throttle and the "already applied" dedupe — useful after a long
  // background pause (visibility resume) and as a deterministic test/debug hook.
  function refreshAmbientNow() {
    if (!amb) return;
    ambWasNight = null; ambTodT = 0.5; updateAmbientToD(0);
    applyWeatherGain(stormActive); applyMusicGain(); updateWashGain();
  }
  // v89: PROPER PAUSE-ON-LEAVE. The economy/world tick + clock are gated on !awayPaused (see frame()),
  // so setAway(true) truly freezes progress — no idle income while the tab/window is left; setAway(false)
  // resumes exactly where it stopped (frame._l reset so the first frame's dt is ~0, no catch-up). We
  // pause on BOTH tab-hidden (visibilitychange) AND window blur, because rAF only pauses on tab-hidden
  // (and even then throttles rather than stops), and never on an app/window switch. Short player-started
  // timers (expeditions/races/fever) run on wall-clock and are intentionally left counting.
  function setAway(away) {
    away = !!away;
    if (awayPaused === away) return;
    awayPaused = away;
    if (away) {
      adsGameplayStop();                                   // portal gameplay bracket closes while away
      if (amb) stopAmbient();
    } else {
      frame._l = (window.performance && performance.now) ? performance.now() : 0;   // clean ~0 dt on resume
      if (SIM && SIM.raw() && SIM.raw().founded) adsGameplayStart();
      if (amb && !muted) { startAmbient(); refreshAmbientNow(); }
    }
  }
  document.addEventListener('visibilitychange', function () {
    metricsVisibility(document.hidden);   // Phase 13d: flush/persist accumulated playtime on hide, resume on foreground
    setAway(document.hidden);
  });
  window.addEventListener('blur', function () { setAway(true); });     // switching apps/windows (tab may stay "visible")
  window.addEventListener('focus', function () { if (!document.hidden) setAway(false); });
  function popWorld(wx, wy, wz, text, opts) { if (!FX) return; var s = worldToScreen(wx, wy, wz); if (s) FX.pop.add(s.x, s.y, text, opts); }
  function burstWorld(wx, wy, wz, opts) { if (!FX) return; var s = worldToScreen(wx, wy, wz); if (s) FX.p.burst(s.x, s.y, opts); }
  function shakeFX(m, d) { if (FX) FX.shake.add(m, d); }
  function portWorld() { var p = scene.port; return p ? { x: p.x, y: p.by + 4, z: p.z } : { x: C.tx, y: 4, z: C.tz }; }

  function confettiBurst() {
    if (!FX) return;
    for (var i = 0; i < 80; i++) FX.p.list.push({ x: Math.random() * CW, y: -12 - Math.random() * 70, vx: (Math.random() - 0.5) * 70, vy: 70 + Math.random() * 130, life: 2.0, max: 2.0, size: 5 + Math.random() * 4, color: ['#ff6b6b', '#ffd24a', '#4fd6c4', '#7fe0ff', '#c084fc', '#f2b35e'][(Math.random() * 6) | 0], gravity: 80, shape: 'rect' });
  }
  // chimney smoke: paper curls rising from the port, intensity scaling with how much you manufacture.
  // Phase 19b PAPERCRAFT: swapped from round grey puffs to small flat spiral/comma-shaped paper
  // curls (Juice.Particles' 'curl' shape — a stroked arc, not a filled disc) with a slow rotation
  // as they rise, so industry smoke reads as curling card rather than photographic smoke.
  var smokeT = 0;
  function spawnSmokeCurl(sc, sizeLo, sizeSpread, lifeLo, lifeSpread, vyBase, vySpread) {
    var g = 0.86 + Math.random() * 0.10;                   // pale paper-grey, not sooty
    var wind = 8 + Math.sin(clock * 0.53) * 4;              // steady drift in the same shared breeze that sways the sails (+x, gently gusting)
    FX.p.list.push({
      x: sc.x, y: sc.y, vx: wind + Math.random() * 6, vy: vyBase - Math.random() * vySpread,
      life: lifeLo + Math.random() * lifeSpread, max: lifeLo + lifeSpread,
      size: sizeLo + Math.random() * sizeSpread,
      color: 'rgba(' + ((g * 255) | 0) + ',' + ((g * 255) | 0) + ',' + ((g * 248) | 0) + ',0.55)',
      gravity: -6, shape: 'curl', rot: Math.random() * Math.PI * 2, vr: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.6)
    });
  }
  function emitSmoke(dt) {
    if (!FX || !simReady() || cine || tradeOpen) return;
    var s = SIM.state(), facs = (s.counts && (s.counts.factory || 0)) + ((s.counts && s.counts.sawmill || 0)) * 0.5;
    if (facs < 1) return;
    smokeT += dt; var every = Math.max(0.12, 0.5 / facs);
    while (smokeT >= every) {
      smokeT -= every;
      var pw = portWorld(); if (!pw) return; var sc = worldToScreen(pw.x - 18 + Math.random() * 36, pw.y + 8, pw.z - 4 + Math.random() * 8); if (!sc) continue;
      spawnSmokeCurl(sc, 5, 6, 1.6, 1.0, -22, 16);
    }
  }
  // Phase 16a: steamer funnel smoke — the same paper curls as the factory chimneys (above),
  // emitted from each SHIPYARD steamer's funnel top (meta.funnel local offset rotated by the
  // ship's current yaw, same position math as drawFleet). Gentle: one puff/sec per steamer.
  var funnelT = 0;
  function emitFunnelSmoke(dt) {
    if (!FX || cine || tradeOpen) return;
    var p = scene.port; if (!p || !fleet.routes.length) return;
    funnelT += dt; if (funnelT < 1.0) return;
    funnelT -= 1.0;
    var fun = SHIP.steamer && SHIP.steamer.meta.funnel; if (!fun) return;
    for (var i = 0; i < fleet.routes.length; i++) {
      var r = fleet.routes[i]; if (r.cls !== 'steamer') continue;
      var ph = (clock * r.sp + r.ph) % 2, ff = ph < 1 ? ph : 2 - ph, dd = 24 + ff * 92;
      var x = p.x + r.dx * dd, z = p.z + r.dz * dd, yaw = ph < 1 ? r.yawOut : r.yawOut + Math.PI;
      var c = Math.cos(yaw), s = Math.sin(yaw);
      var sc = worldToScreen(x + fun[0] * c + fun[2] * s, fun[1], z - fun[0] * s + fun[2] * c);
      if (!sc) continue;
      spawnSmokeCurl(sc, 4, 4, 1.4, 0.8, -16, 10);
    }
  }

  // Phase 14c: storm rain — thin paper-strip streamers falling at a slight angle over the affected
  // port while DRAMA.stormT is up (quality-gated + capped: skipped on the lightweight quality path,
  // like emitSmoke/emitFunnelSmoke above, and throttled to a modest per-second rate so it never
  // threatens the particle/geom budget even during a multi-hazard ToD sweep).
  var rainT = 0;
  function emitStormRain(dt) {
    if (!FX || cine || DRAMA.stormT < 0.15 || !postEnabled()) return;
    var s = SIM.state ? (simReady() ? SIM.state() : null) : null;
    if (!s || !s.hazard || s.hazard.port !== biomeId) return;         // rain only draws over the storm's own port
    rainT += dt; var every = 0.045;
    while (rainT >= every && FX.p.list.length < 220) {
      rainT -= every;
      var x = Math.random() * CW, y = -10 - Math.random() * 40;
      FX.p.list.push({ x: x, y: y, vx: 60 + Math.random() * 30, vy: 260 + Math.random() * 90, life: 0.9, max: 0.9,
        size: 3 + Math.random() * 1.6, color: 'rgba(210,228,240,' + (0.35 + DRAMA.stormT * 0.3) + ')', gravity: 30, shape: 'streak', streakLen: 3.2 });
    }
  }

  // ---- Era Ascension cinematic ----
  // Phase 12b: the one natural pause where a portal SDK gets to show a commercial break. It fires
  // BEFORE the cinematic itself starts (era/economy state was already advanced by the caller) so a
  // real ad interrupts nothing in progress — the player sees the break, then the reward cinematic
  // plays uninterrupted. The stub calls onDone() on the next tick, so this is invisible off-portal.
  function startAscension(toEra, eraName, unlocksText, bonus) {
    try {
      if (window.ADS && typeof window.ADS.commercialBreak === 'function') {
        window.ADS.commercialBreak(function () { beginAscension(toEra, eraName, unlocksText, bonus); });
        return;
      }
    } catch (e) {}
    beginAscension(toEra, eraName, unlocksText, bonus);
  }
  function beginAscension(toEra, eraName, unlocksText, bonus) {
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
    ascendBanner.innerHTML = '<div class="ab-sub">ERA ASCENSION</div><div class="ab-name">Welcome to the ' + name + ' age!</div>' + (unlocks ? '<div class="ab-unlock">Unlocked: ' + unlocks + '</div>' : '') + (bonus ? '<div class="ab-bonus">+ £' + fmt(bonus) + ' grant</div>' : '');
    ascendBanner.classList.remove('show'); void ascendBanner.offsetWidth; ascendBanner.classList.add('show');
    clearTimeout(showAscendBanner._t); showAscendBanner._t = setTimeout(function () { ascendBanner.classList.remove('show'); }, 2600);
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - (frame._l || now)) / 1000); frame._l = now;
    clock += dt; if (!paused && !awayPaused) tod = (tod + dt * todSpeed) % 1;   // v89: freeze the clock while away
    if (amb) updateAmbientToD(dt);                              // Phase 11c: day/night audio cross-fade
    if (amb) { ambWashT += dt; if (ambWashT > 0.4) { ambWashT = 0; updateWashGain(); } }   // Phase 20b: throttled edge-proximity wash recompute
    // Phase 10c frame-time probe: over the first ~5s with the post pass on, if the average
    // frame is > ~26ms (below ~38fps) auto-disable the miniature look for this device
    // (persisted, so weak devices don't re-probe every boot; Settings can re-arm it).
    if (postProbe.armed && !postProbe.done && postEnabled()) {
      if (postProbe.warm < 0.8) postProbe.warm += dt;                    // let shaders/JIT warm up first
      else {
        postProbe.t += dt; postProbe.n++;
        if (postProbe.t >= 5) {
          postProbe.done = true; postProbe.avgMs = postProbe.t / postProbe.n * 1000;
          if (postProbe.avgMs > 26) {
            postAutoOff = true; if (window.Retention) Retention.set(GAME, 'postAuto', true);
            showHint('✨ Miniature look off — keeping things smooth');
            if (settingsOpen) renderSettings();
          }
        }
      }
    }
    if (cine) updateCine(dt);
    if (welcomeFraming) C.azT += dt * 0.02;   // Phase 20b: slow orbit drift while the model-in-hand welcome framing is up
    if (ptrs.size === 0) {
      C.azT += C.vAz; C.elT = clamp(C.elT + C.vEl, 0.14, 1.3); C.vAz *= 0.92; C.vEl *= 0.92; if (Math.abs(C.vAz) < 1e-4) C.vAz = 0; if (Math.abs(C.vEl) < 1e-4) C.vEl = 0;
      C.txT = clamp(C.txT + C.vTx, -PANX, PANX); C.tzT = clamp(C.tzT + C.vTz, PANZ0, PANZ1); C.vTx *= 0.90; C.vTz *= 0.90; if (Math.abs(C.vTx) < 1e-3) C.vTx = 0; if (Math.abs(C.vTz) < 1e-3) C.vTz = 0;
    }
    var k = Math.min(1, dt * 11); C.az += (C.azT - C.az) * k; C.el += (C.elT - C.el) * k; C.dist += (C.distT - C.dist) * Math.min(1, dt * 9);
    C.tx += (C.txT - C.tx) * k; C.tz += (C.tzT - C.tz) * k;
    if (clockEl) { var hh = Math.floor(tod * 24), mm = Math.floor((tod * 24 % 1) * 60); var ap = hh < 12 ? 'AM' : 'PM', h12 = hh % 12 || 12; clockEl.textContent = '🕐 ' + h12 + ':' + ('0' + mm).slice(-2) + ' ' + ap; }   // v88: 12-hour + AM/PM so it clearly reads as a clock
    // economy tick (founded ports earn over time)
    if (!paused && !awayPaused && simReady()) {   // v89: awayPaused freezes the whole economy/world while the tab or window is left
      SIM.tick(dt); tickAutomation(dt);
      frame._hud = (frame._hud || 0) + dt; if (frame._hud > 0.2) { updateHUD(); frame._hud = 0; }
      frame._sv = (frame._sv || 0) + dt; if (frame._sv > 5) { SIM.mark(); frame._sv = 0; }
      frame._tip = (frame._tip || 0) + dt; if (frame._tip > 4) { tickTips(); frame._tip = 0; }   // Phase 15d: contextual hint check, ~4s cadence
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
    emitSmoke(dt);                                               // industry breathes: chimney smoke once you manufacture
    emitFunnelSmoke(dt);                                         // Phase 16a: steamers puff too
    updateDrama(dt); emitStormRain(dt);                          // Phase 14c: storm/pirate/theatre state + paper-streamer rain
    if (FX && fxCtx) {                                            // draw the 2D juice overlay (with screenshake)
      FX.p.update(dt); FX.pop.update(dt); var sh = FX.shake.update(dt);
      fxCtx.setTransform(1, 0, 0, 1, 0, 0); fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
      fxCtx.setTransform(DPR, 0, 0, DPR, sh.x * DPR, sh.y * DPR);
      drawCine(fxCtx);
      if (flashT > 0) { flashT -= dt; fxCtx.fillStyle = 'rgba(255,70,45,' + (0.32 * Math.max(0, flashT)) + ')'; fxCtx.fillRect(0, 0, fxCanvas.width, fxCanvas.height); }
      // Phase 14c: jagged paper-bolt flash on a storm strike (adds to, never replaces, flashT above)
      if (DRAMA.boltT > 0) {
        var bt = DRAMA.boltT; DRAMA.boltT = Math.max(0, DRAMA.boltT - dt * 2.4);
        fxCtx.save(); fxCtx.globalAlpha = Math.min(1, bt * 2.4); fxCtx.strokeStyle = '#ffffff'; fxCtx.lineWidth = 4; fxCtx.lineCap = 'round';
        var bx = CW * 0.5 + (CW * 0.18);
        fxCtx.beginPath(); fxCtx.moveTo(bx, 0);
        fxCtx.lineTo(bx - 26, CH * 0.28); fxCtx.lineTo(bx + 14, CH * 0.30); fxCtx.lineTo(bx - 32, CH * 0.62); fxCtx.lineTo(bx + 6, CH * 0.64); fxCtx.lineTo(bx - 20, CH);
        fxCtx.stroke(); fxCtx.restore();
      }
      // Phase 14c: construction theatre — a thin paper scaffold lattice pops around the plot for
      // the 1.2s prelude (new builds) or a brief 0.4s flash (upgrades), drawn screen-space over the
      // port so it needs no new GL geometry/shader (keeps geomStats untouched).
      var thd = theatreState();
      if ((thd.active && DRAMA.theatreNew) || DRAMA.flashScaffold > 0) {
        var tpw = portWorld(), tsc = tpw && worldToScreen(tpw.x, tpw.y, tpw.z);
        if (tsc) {
          var ta = DRAMA.flashScaffold > 0 ? DRAMA.flashScaffold / 0.4 : (1 - Math.abs(thd.t - 0.5) * 0.6);
          fxCtx.save(); fxCtx.globalAlpha = Math.min(1, ta); fxCtx.strokeStyle = 'rgba(255,255,255,0.85)'; fxCtx.lineWidth = 2;
          var sw2 = 46, sh2 = 60, sx = tsc.x - sw2 / 2, sy = tsc.y - sh2;
          fxCtx.strokeRect(sx, sy, sw2, sh2);
          fxCtx.beginPath(); fxCtx.moveTo(sx, sy); fxCtx.lineTo(sx + sw2, sy + sh2); fxCtx.moveTo(sx + sw2, sy); fxCtx.lineTo(sx, sy + sh2); fxCtx.stroke();
          fxCtx.restore();
        }
      }
      // crash vignette: brief red-crayon pulse around the frame edges
      if (DRAMA.crashPulse > 0) {
        DRAMA.crashPulse = Math.max(0, DRAMA.crashPulse - dt * 1.1);
        var vg = fxCtx.createRadialGradient(CW / 2, CH / 2, Math.min(CW, CH) * 0.35, CW / 2, CH / 2, Math.max(CW, CH) * 0.72);
        vg.addColorStop(0, 'rgba(229,73,58,0)'); vg.addColorStop(1, 'rgba(229,73,58,' + (0.38 * DRAMA.crashPulse) + ')');
        fxCtx.fillStyle = vg; fxCtx.fillRect(0, 0, CW, CH);
      }
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
  var tradeGuideEl = null;   // Phase 15a: "found a 2nd harbour" guide card, shown while <2 ports exist
  var NODES = { green: [0.24, 0.66], tropical: [0.40, 0.40], mountain: [0.58, 0.23], nordic: [0.70, 0.70], desert: [0.84, 0.46] };
  var RESCOL = { fish: '#57c7e0', timber: '#cf9a52', goods: '#b884f0' };
  function portFounded(id) { return !!(SIM && SIM.port && SIM.port(id)); }
  function tradeFoundedCount() { var n = 0; for (var id in NODES) if (portFounded(id)) n++; return n; }
  // Phase 15a: the trade map used to give zero feedback when there was nothing to connect yet
  // ("I can't set up a trade network, I can only click on one city" — first playtest). This card
  // makes the reason explicit and offers a one-tap way to go found a second harbour.
  // v85: the first unlocked world you haven't founded yet (in ladder order) — the "you already have
  // a harbour to found" case that the trade guidance must prefer over "go chart new waters".
  function firstUnfoundedUnlocked() {
    for (var i = 0; i < HARBOR_BIOME_ORDER.length; i++) { var id = HARBOR_BIOME_ORDER[i]; if (isUnlocked(id) && !portFounded(id)) return id; }
    return null;
  }
  function updateTradeGuide() {
    if (!tradeGuideEl) return;
    var show = tradeFoundedCount() < 2;
    tradeGuideEl.classList.toggle('show', show);
    if (!show) return;
    // v85: state-aware copy. If you've UNLOCKED a world but not FOUNDED it (the trap that reads as
    // "I have 3 harbours but can't trade"), point at founding it — NOT at Uncharted Waters.
    var t = tradeGuideEl.querySelector('.tmg-title'), b = tradeGuideEl.querySelector('.tmg-body'), uf = firstUnfoundedUnlocked();
    if (uf) {
      var fc = SIM && SIM.foundCost ? SIM.foundCost() : 0;
      if (t) t.textContent = 'Found your next harbour';
      if (b) b.innerHTML = 'A route links TWO <b>founded</b> harbours. You’ve unlocked <b>' + wname(uf) + '</b> but haven’t founded it yet — tap its dim node below to found it for <b>£' + fmt(fc) + '</b>, then link the two.';
    } else {
      if (t) t.textContent = 'You need a second harbour';
      if (b) b.innerHTML = 'A route links TWO of your harbours, so you need at least two founded. To open the next one: send an <b>Uncharted Waters</b> expedition (Expeditions), then <b>Found</b> the coast it discovers. Come back here and tap one harbour, then the other.';
    }
  }
  function tradeShowMe() {
    closeTrade();
    var target = null;
    for (var i = 0; i < HARBOR_BIOME_ORDER.length; i++) {
      var id = HARBOR_BIOME_ORDER[i];
      if (isUnlocked(id) && !portFounded(id)) { target = id; break; }
    }
    if (target) {
      // reuse the existing world-switch path (same as tapping the biome bar) — the founding UI
      // (site chips + "Found village") appears automatically once the world isn't founded yet.
      buildBiome(target); if (buildSelector._set) buildSelector._set(); defaultView();
      showHint('⚓ Tap the glowing harbour, then “Found village”');
      return;
    }
    // Phase 15c: no unlocked-but-unfounded world — with era-unlock gone, the next best move is
    // usually an Uncharted Waters expedition, so point straight at it when one's available.
    var uTarget = unchartedTarget();
    if (uTarget) {
      if (!expOpen) toggleExp();
      showHint('🧭 Send an expedition to Uncharted Waters to discover ' + wname(uTarget));
    } else {
      // no world is even reachable yet — nudge toward the era climb, rather than promising a jump
      // that isn't there.
      var bar = document.getElementById('biomebar');
      if (bar) { bar.classList.add('nudge'); setTimeout(function () { bar.classList.remove('nudge'); }, 1900); }
      showHint('Grow your port to unlock a new coast to found');
    }
  }
  function ensureTradeMap() {
    if (tradeMap) return;
    tradeMap = document.createElement('div'); tradeMap.id = 'trademap';
    tradeMap.innerHTML = '<div class="tm-top"><span class="tm-title">Trade Network</span><span class="tm-lvl" id="tm-lvl"></span><button class="tm-close" id="tm-close">✕</button></div>' +
      '<div class="tm-xp"><i id="tm-xpfill"></i></div>' +
      '<div class="tm-guide" id="tm-guide"><div class="tmg-ic">🧭</div><div class="tmg-title">You need a second harbour</div>' +
      '<div class="tmg-body">A route links TWO of your harbours, so you need at least two founded. To open the next one: send an <b>Uncharted Waters</b> expedition (Expeditions), then <b>Found</b> the coast it discovers. Come back here and tap one harbour, then the other.</div>' +
      '<button class="tmg-btn" id="tmg-show">Show me how</button></div>' +
      '<canvas id="tradecanvas"></canvas>' +
      '<div class="tm-act" id="tm-act"></div>';
    wrap.appendChild(tradeMap);
    tradeCanvas = tradeMap.querySelector('#tradecanvas'); tradeCtx = tradeCanvas.getContext('2d');
    tradeAct = tradeMap.querySelector('#tm-act'); tradeBar = tradeMap.querySelector('#tm-xpfill');
    tradeGuideEl = tradeMap.querySelector('#tm-guide');
    tradeMap.querySelector('#tm-close').addEventListener('click', closeTrade);
    tradeMap.querySelector('#tmg-show').addEventListener('click', tradeShowMe);
    tradeCanvas.addEventListener('pointerdown', function (e) { var r = tradeCanvas.getBoundingClientRect(); tradeTap(e.clientX - r.left, e.clientY - r.top); });
    sizeTrade();
  }
  function sizeTrade() {
    if (!tradeCanvas) return;
    // v85: size the backing store from the CANVAS's own box (CSS flex:1 controls its display size),
    // NOT the whole #trademap container (top bar + xp + action panel included) — the old version did
    // the latter and also hard-set style.width/height, so the backing store never matched the drawn
    // canvas. That desync moved as the layout changed (e.g. founding a colony rebuilds the world),
    // throwing off BOTH node drawing and tap hit-testing (taps landed on the wrong harbour). Only
    // touch the backing store, and only when it actually changed, so per-frame calls don't clear it.
    var r = tradeCanvas.getBoundingClientRect();
    var w = Math.max(2, Math.round(r.width * DPR)), h = Math.max(2, Math.round(r.height * DPR));
    if (tradeCanvas.width !== w) tradeCanvas.width = w;
    if (tradeCanvas.height !== h) tradeCanvas.height = h;
  }
  function openTrade() {
    if (!SIM || !SIM.raw()) return;
    ensureTradeMap(); tradeOpen = true; tradeSel = { node: null, route: null };
    tradeMap.classList.add('show'); sizeTrade(); updateTradeGuide(); renderTradeAct(); sfx('tap'); haptic(10);
  }
  function closeTrade() { tradeOpen = false; if (tradeMap) tradeMap.classList.remove('show'); }
  function nodeXY(id) { var p = NODES[id] || [0.5, 0.5], w = tradeCanvas.width, h = tradeCanvas.height; return [p[0] * w, p[1] * h]; }
  function tradeTap(sx, sy) {
    // NOTE: do NOT sizeTrade() here — drawTradeMap() re-syncs the backing store every frame, so by the
    // time a real pointer tap arrives the canvas already matches its box. Resizing mid-tap would also
    // desync callers that pre-compute node pixels from the current canvas size (the tradeTapNode hook).
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
      if (!portFounded(hitN)) {
        // v85: an unlocked-but-unfounded world is the #1 trade-network snag ("3 harbours but can't
        // link them" = 3 UNLOCKED, 1 FOUNDED). Instead of a dead "found it first" note, offer to
        // found it right here (renderTradeAct → foundWorldFromTrade). Locked coasts must be charted first.
        if (isUnlocked(hitN)) { tradeSel = { node: null, dest: null, route: null, found: hitN }; sfx('tap'); }
        else { tradeSel = { node: null, dest: null, route: null, found: null }; renderTradeAct(); showHint('🔒 Chart this coast first — send an Uncharted Waters expedition'); return; }
      }
      else { tradeSel.found = null;
        if (!tradeSel.node) { tradeSel.node = hitN; sfx('tap'); }
        else if (tradeSel.node === hitN) { tradeSel.node = null; }
        else { tradeSel.dest = hitN; renderTradeAct(); sfx('tap'); return; }   // src+dest chosen -> builder
      }
    } else if (hitR) {
      tradeSel.node = null; tradeSel.dest = null; tradeSel.route = hitR.id; tradeSel.found = null; sfx('tap');
    } else { tradeSel.node = null; tradeSel.dest = null; tradeSel.route = null; tradeSel.found = null; }
    renderTradeAct();
  }
  function showTradeMsg(m) { if (tradeAct) { tradeAct.innerHTML = '<div class="ta-msg">' + m + '</div>'; } }
  // v85: found an unlocked world straight from the trade map — reuses the proven world-switch +
  // auto-site found path (buildBiome computes that coast's candidate sites; autoFound places the
  // port at the first one), so SIM.ports[id] and the local `founded` site map stay in lockstep. On
  // success the fresh node is auto-selected so the very next tap links a route. Leaves the player
  // viewing the new colony (same as founding it the normal way) — the trade overlay stays open on top.
  function foundWorldFromTrade(id) {
    if (!SIM || portFounded(id) || !isUnlocked(id)) return false;
    if (SIM.canFoundPort && !SIM.canFoundPort()) { sfx('lose'); return false; }
    buildBiome(id); autoFound();
    if (!portFounded(id)) { sfx('lose'); return false; }   // founding refused (e.g. money changed) — bail cleanly
    tradeSel = { node: id, dest: null, route: null, found: null };
    sfx('merge'); haptic(18); renderTradeAct(); updateTradeGuide();
    return true;
  }
  function wname(id) { return (window.HARBOR_BIOMES[id] && HARBOR_BIOMES[id].name) || id; }
  function renderTradeAct() {
    if (!tradeAct) return;
    updateTradeGuide();
    var net = SIM.network();
    var lvlEl = document.getElementById('tm-lvl'); if (lvlEl) lvlEl.textContent = 'Lv ' + net.level + ' · ' + net.routes.length + '/' + net.maxRoutes + ' routes' + (net.insurance ? ' · insured' : '');
    if (tradeBar) tradeBar.style.width = Math.round(100 * net.xp / Math.max(1, net.need)) + '%';
    // building a route (source + dest selected)
    if (tradeSel.node && tradeSel.dest) {
      var a = tradeSel.node, b = tradeSel.dest, html = '<div class="ta-head">Ship from <b>' + wname(a) + '</b> → <b>' + wname(b) + '</b></div><div class="ta-res">';
      var money = SIM.raw() ? SIM.raw().money : 0, atMax = net.routes.length >= net.maxRoutes;
      ['fish', 'timber', 'goods'].forEach(function (res) {
        var can = SIM.canAddRoute(a, b, res), cost = net.routeCreateCost;
        // show WHY a resource can't be shipped rather than a silent disabled button
        var label = can ? ('£' + fmt(cost)) : (SIM.hasRoute && SIM.hasRoute(a, b, res) ? 'linked' : atMax ? 'route cap' : money < cost ? 'Need £' + fmt(cost) : '£' + fmt(cost));
        html += '<button class="ta-rbtn" data-res="' + res + '"' + (can ? '' : ' disabled') + ' style="border-color:' + RESCOL_(res) + '"><span>' + res + '</span><span class="ta-cost">' + label + '</span></button>';
      });
      html += '</div><button class="ta-cancel" data-cancel="1">Cancel</button>';
      tradeAct.innerHTML = html;
      tradeAct.querySelectorAll('[data-res]').forEach(function (el) { el.addEventListener('click', function () { var res = el.getAttribute('data-res'); if (SIM.addRoute(a, b, res)) { tradeSel = { node: null, route: null }; sfx('merge'); haptic(18); renderTradeAct(); } else sfx('lose'); }); });
      tradeAct.querySelector('[data-cancel]').addEventListener('click', function () { tradeSel = { node: null, route: null }; renderTradeAct(); });
      return;
    }
    // v85: founding an unlocked-but-unfounded world inline (tapped a dim node)
    if (tradeSel.found) {
      var fid = tradeSel.found, fc = SIM.foundCost ? SIM.foundCost() : 0, canF = SIM.canFoundPort ? SIM.canFoundPort() : true;
      tradeAct.innerHTML = '<div class="ta-head">🏝️ Found <b>' + wname(fid) + '</b></div>' +
        '<div class="ta-msg">Unlocked, but not a harbour yet — found a colony here to trade with it.</div>' +
        '<div class="ta-res"><button class="ta-rbtn" data-found="1"' + (canF ? '' : ' disabled') + ' style="border-color:#ffd56a;grid-column:1/-1' + (canF ? '' : ';opacity:.5') + '"><span>' + (canF ? 'Found colony' : 'Need £' + fmt(fc)) + '</span>' + (canF ? '<span class="ta-cost">£' + fmt(fc) + '</span>' : '') + '</button></div>' +
        '<button class="ta-cancel" data-cancel="1">Cancel</button>';
      var fbtn = tradeAct.querySelector('[data-found]');
      if (fbtn) fbtn.addEventListener('click', function () { if (!foundWorldFromTrade(fid)) sfx('lose'); });
      tradeAct.querySelector('[data-cancel]').addEventListener('click', function () { tradeSel = { node: null, dest: null, route: null, found: null }; renderTradeAct(); });
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
    var founded = tradeFoundedCount();
    var perk = 'Network Lv ' + net.level + ' — +' + net.capPct + '% capacity, +' + net.tariffPct + '% tariffs' + (net.insurance ? ', storm insurance' : ', insurance at Lv 3');
    // a selected node always gets its "tap another" hint (the guide card above already covers the
    // <2-founded case, so this stays true to what the player just did rather than re-explaining that)
    var hint = tradeSel.node ? 'Now tap another harbour to link a route' : (founded < 2 ? 'Only ' + founded + ' harbour founded — a route needs two. Discover & found another (Uncharted Waters), then link them here.' : 'Tap a harbour, then another, to build a route.');
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
    sizeTrade();          // v85: keep the backing store matched to the (flex-sized) canvas every frame —
                          // idempotent, so it only actually resizes when the layout changed. Guarantees
                          // drawn node positions and tap hit-testing use identical dimensions.
    updateTradeGuide();   // cheap per-frame safety net (also updated on tap/open) — never goes stale
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
    // Phase 15a: selection feedback — a pulsing sonar ring around the tapped node (in addition to
    // the soft halo below) so "you picked this one, now pick another" reads instantly.
    if (tradeSel.node) {
      var c0 = nodeXY(tradeSel.node), pulse = 0.5 + 0.5 * Math.sin(t * 3.4);
      ctx.beginPath(); ctx.arc(c0[0], c0[1], (28 + pulse * 10) * DPR, 0, 6.283);
      ctx.strokeStyle = 'rgba(255,213,106,' + (0.9 - pulse * 0.55).toFixed(2) + ')'; ctx.lineWidth = (2.5 + pulse * 1.5) * DPR; ctx.stroke();
      ctx.fillStyle = 'rgba(255,220,120,.9)'; ctx.beginPath(); ctx.arc(c0[0], c0[1], 34 * DPR, 0, 6.283); ctx.globalAlpha = 0.16 + 0.05 * Math.sin(t * 4); ctx.fill(); ctx.globalAlpha = 1;
    }
    // nodes — founded (route-capable) ports get a bright, glowing treatment; unfounded ones render
    // clearly ghosted (dim fill, thin faded stroke, muted label) so what's tappable is obvious.
    for (var id in NODES) {
      var c = nodeXY(id), fnd = portFounded(id), unl = isUnlocked(id);
      ctx.save();
      if (fnd) { ctx.shadowColor = 'rgba(124,224,214,.65)'; ctx.shadowBlur = 16 * DPR; }
      ctx.globalAlpha = fnd ? 1 : (unl ? 0.55 : 0.32);
      ctx.beginPath(); ctx.arc(c[0], c[1], 22 * DPR, 0, 6.283);
      ctx.fillStyle = fnd ? '#1d4d61' : 'rgba(20,40,52,.42)';
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.lineWidth = (tradeSel.node === id ? 4 : (fnd ? 2.5 : 1.5)) * DPR;
      ctx.strokeStyle = fnd ? (tradeSel.node === id ? '#ffd56a' : '#7fe0d6') : 'rgba(150,175,190,.3)';
      ctx.stroke();
      // label
      ctx.fillStyle = fnd ? '#eaf4f7' : 'rgba(190,205,214,.55)';
      ctx.font = '700 ' + (12 * DPR) + 'px Fredoka, system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(wname(id), c[0], c[1] - 30 * DPR);
      if (!unl) { ctx.fillStyle = 'rgba(190,205,214,.6)'; ctx.font = (15 * DPR) + 'px system-ui'; ctx.fillText('🔒', c[0], c[1] + 5 * DPR); }
      else if (!fnd) { ctx.fillStyle = 'rgba(190,205,214,.55)'; ctx.font = (10 * DPR) + 'px Fredoka, sans-serif'; ctx.fillText('unfounded', c[0], c[1] + 4 * DPR); }
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
  // Phase 15c: discovery replaces era auto-unlock — worlds now open one at a time, strictly in
  // HARBOR_BIOME_ORDER, via a paid Uncharted Waters expedition (see renderExp). Visible/startable
  // only once the empire era has actually reached that world's unlockEra (so it still reads as
  // "you've grown enough to reach this coast", just gated behind a deliberate expedition now
  // instead of firing automatically the moment doAdvance() lands on that era).
  function unchartedTarget() {
    for (var i = 0; i < HARBOR_BIOME_ORDER.length; i++) {
      var id = HARBOR_BIOME_ORDER[i];
      if (!isUnlocked(id)) {
        var b = HARBOR_BIOMES[id], eraNow = (SIM && SIM.state) ? (SIM.state().empireEra || 0) : 0;   // per-port era: discovery gates on your MOST-ADVANCED harbour, not the one you're viewing
        return (b && eraNow >= b.unlockEra) ? id : null;
      }
    }
    return null;   // every world already discovered
  }
  // celebratory pulse on the newly-discovered world's biome-bar entry — same nudge language as the
  // trade-map "Show me" fallback, just on the specific button instead of the whole bar.
  function pulseDiscoveredBiome(id) {
    var bar = document.getElementById('biomebar'); if (!bar) return;
    var btn = bar.querySelector('[data-world="' + id + '"]'); if (!btn) return;
    btn.classList.add('discover-pulse');
    setTimeout(function () { btn.classList.remove('discover-pulse'); }, 2600);
  }
  function showHint(msg) { if (!hintEl) return; hintEl.textContent = msg; hintEl.classList.remove('gone'); clearTimeout(showHint._t); showHint._t = setTimeout(function () { hintEl.classList.add('gone'); }, 1900); }

  // ---- Phase 11b: feature-unlock announcements — a one-time (ever, persisted) celebratory nudge
  // the first moment a system becomes relevant, so ~15 systems don't just silently appear. Reuses
  // the hint toast for a quick line, plus a small dismissible card (never a full-screen blocker,
  // never stacks — a second announce queues behind the first). ----
  function seenMap() { return (window.Retention && Retention.get(GAME, 'seen2', {})) || {}; }
  function hasSeenFeature(id) { return !!seenMap()[id]; }
  function markSeenFeature(id) { var m = seenMap(); if (m[id]) return false; m[id] = 1; if (window.Retention) Retention.set(GAME, 'seen2', m); return true; }
  var announceQueue = [], announceBusy = false, announceCard = null, announceT = null;
  function ensureAnnounceCard() {
    if (announceCard) return;
    announceCard = document.createElement('div'); announceCard.id = 'announcecard';
    announceCard.innerHTML = '<div class="an-ic"></div><div class="an-copy"><div class="an-title"></div><div class="an-txt"></div></div>';
    wrap.appendChild(announceCard);
    announceCard.addEventListener('click', function () { dismissAnnounce(); });
  }
  // don't pop the card over a modal that owns input (event/rival choice, welcome, crate reveal) —
  // it stays queued and is retried on the next updateHUD tick instead.
  function announceBlocked() {
    return (eventModal && eventModal.classList.contains('show')) || (rivalModal && rivalModal.classList.contains('show')) ||
      (document.getElementById('welcomemodal')) || (crateModal && crateModal.classList.contains('show'));
  }
  function dismissAnnounce() {
    if (!announceCard) return;
    announceCard.classList.remove('show'); clearTimeout(announceT); announceBusy = false;
    setTimeout(pumpAnnounceQueue, 260);
  }
  function pumpAnnounceQueue() {
    // a blocking modal (event/rival/welcome/crate) opened *while* the card was already showing —
    // get out of the way immediately rather than overlap it. The message already landed once
    // (seen2 is set on fire, not on dismiss), so nothing is lost — it just stops being shown.
    if (announceBusy && announceCard && announceCard.classList.contains('show') && announceBlocked()) {
      announceCard.classList.remove('show'); clearTimeout(announceT); announceBusy = false; return;
    }
    if (announceBusy || !announceQueue.length || announceBlocked()) return;
    var item = announceQueue.shift();
    ensureAnnounceCard(); announceBusy = true;
    announceCard.querySelector('.an-ic').textContent = item.icon;
    announceCard.querySelector('.an-title').textContent = item.title;
    announceCard.querySelector('.an-txt').textContent = item.body || '';
    announceCard.classList.add('show'); sfx('score'); haptic(14);
    clearTimeout(announceT); announceT = setTimeout(dismissAnnounce, 6000);
  }
  // fires (once per id, ever) the moment a system first becomes relevant. hintOnly skips the card
  // (used for fever, which is self-explanatory and timed — a toast is enough).
  function announceFeature(id, icon, title, body, hintOnly) {
    if (!markSeenFeature(id)) return;
    if (hintOnly) { showHint(icon + ' ' + title + (body ? ' — ' + body : '')); return; }
    showHint(icon + ' ' + title);
    announceQueue.push({ icon: icon, title: title, body: body });
    pumpAnnounceQueue();
  }

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
  var setBtn = null, settingsPanel = null, settingsOpen = false, resetArm = false;
  var expBtn = null, expPanel = null, expOpen = false;
  var registryBtn = null, registryPanel = null, registryOpen = false;   // Phase 17b: fleet registry
  var timelinePanel = null, timelineStrip = null, timelineOpen = false;   // Phase 17a: age timeline strip
  var SIM = window.HARBOR_SIM || null;
  function simReady() { return !!(SIM && SIM.port && SIM.port()); }   // active world's port exists

  // ---- Phase 15b: pace — playtest feedback ("feels quite fast / stressful") asked for a slower
  // default without touching the economy itself, so this only scales two things: the day/night
  // cycle length (todSpeed, purely cosmetic pacing) and SIM's hazard/event gap rolls (setPace,
  // sim.js-side — production/sales/voyages are untouched there, see sim.js for the full rationale).
  // Relaxed is the default for everyone (new AND existing players — no prior Retention key existed
  // before this phase, so this reads the same 'relaxed' default for both); Lively restores the
  // pre-15b feel for anyone who preferred it. A device preference, not a save-blob field.
  var PACE_OPTIONS = { relaxed: { mul: 1.6, day: 256 }, lively: { mul: 1, day: 160 } };
  var paceMode = (window.Retention && PACE_OPTIONS[Retention.get(GAME, 'pace', 'relaxed')]) ? Retention.get(GAME, 'pace', 'relaxed') : 'relaxed';
  todSpeed = 1 / PACE_OPTIONS[paceMode].day;   // cosmetic day-length applied immediately; SIM.setPace() happens in boot() once SIM exists
  function applyPace(mode) {
    if (!PACE_OPTIONS[mode] || mode === paceMode) return;
    paceMode = mode; todSpeed = 1 / PACE_OPTIONS[mode].day;
    if (SIM && SIM.setPace) SIM.setPace(PACE_OPTIONS[mode].mul);
    if (window.Retention) Retention.set(GAME, 'pace', paceMode);
    if (settingsOpen) renderSettings();
  }
  // Difficulty (Easy→Extreme): applies immediately + persists. prestigeGain() reads the CURRENT tier,
  // so dropping difficulty to dodge a storm also cuts your Legacy payout — self-balancing anti-cheese.
  var DIFF_IDS = ['easy', 'hard', 'brutal', 'extreme'];
  var diffMode = (window.Retention && DIFF_IDS.indexOf(Retention.get(GAME, 'difficulty', 'easy')) >= 0) ? Retention.get(GAME, 'difficulty', 'easy') : 'easy';
  function applyDifficulty(mode) {
    if (DIFF_IDS.indexOf(mode) < 0 || mode === diffMode) return;
    diffMode = mode;
    if (SIM && SIM.setDifficulty) SIM.setDifficulty(mode);
    if (window.Retention) Retention.set(GAME, 'difficulty', diffMode);
    if (settingsOpen) renderSettings();
    updateHUD();
  }
  // ---- Phase 15d: Harbourmaster's Tips — quiet, situational hints that read the player's live
  // state and nudge toward whatever system they seem to be missing. Deliberately quieter than both
  // the storm banner (urgent) and the announce card (celebratory) — this is ambient guidance, not
  // an interruption. tickTips() is driven off a slow wall-clock accumulator in frame() (~every 4s,
  // see frame._tip below) and no-ops entirely while a modal/panel owns the screen or fever is
  // running (tipsBlocked()) — never talk over an active moment. At most one rule fires per check
  // (first match in TIPS, top to bottom), each gated by: its own "once ever" flag (Retention
  // 'tipsSeen', survives reload), an in-memory per-rule cooldown (cooldowns don't need to survive
  // reload — a fresh session earning the same nudge again immediately is fine), and a single global
  // rate limit (>=45s since the last tip of ANY kind) so tips never pile up even when several
  // conditions are true at once. A Settings toggle (Retention 'tips', default ON) hard-disables the
  // whole system with no other state changes.
  function tipsEnabled() { return !(window.Retention && Retention.get(GAME, 'tips', true) === false); }
  function setTipsEnabled(v) { if (window.Retention) Retention.set(GAME, 'tips', !!v); }
  function tipsSeenMap() { return (window.Retention && Retention.get(GAME, 'tipsSeen', {})) || {}; }
  function hasTipSeen(id) { return !!tipsSeenMap()[id]; }
  function markTipSeen(id) { var m = tipsSeenMap(); if (m[id]) return false; m[id] = 1; if (window.Retention) Retention.set(GAME, 'tipsSeen', m); return true; }

  // cheapest building upgrade on the active port right now — used by the "idle gold" rule, and
  // named in its copy so the nudge points at something concrete instead of "spend money somewhere".
  function cheapestUpgrade(s) {
    if (!s.buildings || !s.buildings.length) return null;
    var best = null;
    for (var i = 0; i < s.buildings.length; i++) {
      var b = s.buildings[i];
      if (!b.up) continue;
      if (!best || b.up < best.cost) best = { cost: b.up, name: b.name };
    }
    return best;
  }

  var idleGoldSince = 0;   // sustained-state tracker for "idleGold" — resets the instant the condition drops, so a
                            // momentary cash spike right after a big sale doesn't trip it; only a genuine stretch of
                            // sitting on 5x+ the cheapest upgrade (~20s) does.
  var TIPS = [
    // fires once, ever, the first time the tip system has anything to say — introduces itself so a
    // lone toast later doesn't feel like it came from nowhere.
    { id: 'intro', once: true, cooldown: 0,
      when: function (s) { return s.portFounded; },
      text: '👋 I’m your Harbourmaster — I’ll drop a tip when I spot something (mute me in Settings).' },
    // time-sensitive: a telegraphed storm/crash can still be cancelled outright while affordable —
    // checked first so it never loses out to a lower-urgency rule underneath it.
    { id: 'hazardAvert', cooldown: 240,
      when: function (s) { return !!(s.hazard && s.hazard.phase === 'warn' && s.hazard.avertCost > 0 && s.money >= s.hazard.avertCost); },
      text: 'You can avert this storm before it hits — tap the warning banner' },
    // storage overflowing, and a Warehouse is still buildable (era-gated, and not already at its own cap)
    { id: 'storageFull', cooldown: 240,
      when: function (s) {
        if (!s.caps || !s.res || !s.counts) return false;
        var wt = SIM.BT.warehouse;
        if (s.era < wt.era || (s.counts.warehouse || 0) >= wt.max) return false;
        return ['fish', 'timber', 'goods'].some(function (r) { return s.caps[r] > 0 && s.res[r] >= s.caps[r] * 0.9; });
      },
      text: 'Your stores are overflowing — build a Warehouse to keep production flowing' },
    // a standing harbour Order can be fulfilled right now
    { id: 'orderReady', cooldown: 240,
      when: function (s) { return !!(s.contracts && s.contracts.some(function (c) { return c.can; })); },
      text: 'You can fulfil a harbour Order right now — check Orders in Manage' },
    // Uncharted Waters is discovered AND affordable, not just theoretically unlockable at this era
    { id: 'unchartedReady', cooldown: 240,
      when: function () {
        var id = unchartedTarget(); if (!id) return false;
        return !!SIM.canStartUncharted(HARBOR_BIOMES[id].unlockEra);
      },
      text: function () { var id = unchartedTarget(); return '🧭 The horizon calls — chart Uncharted Waters to discover ' + wname(id); } },
    // era-up requirements (cash + building minimums) are fully met
    { id: 'eraReady', cooldown: 240,
      when: function (s) { return !!s.canAdvance; },
      text: 'Your port is ready — tap Advance to reach the next era' },
    // no room left for more buildings, and the era-up that would raise the ceiling isn't affordable yet
    { id: 'portCapped', cooldown: 240,
      when: function (s) { return !!(s.portFounded && s.slotCap > 0 && s.slotsUsed >= s.slotCap && !s.canAdvance); },
      text: 'Port at capacity — grow your earnings to advance the era' },
    // a voyage slot sits empty and at least one destination is affordable right now
    { id: 'voyageIdle', cooldown: 240,
      when: function (s) { return !!(s.voyages && s.voyages.used < s.voyages.slots && s.voyages.dests.some(function (d) { return d.can; })); },
      text: 'A ship sits idle — send an expedition, they pay out even offline' },
    // cash has piled up well past what the cheapest upgrade costs, and stayed that way for a
    // stretch — not just a momentary blip right after a big sale (see idleGoldSince above)
    { id: 'idleGold', cooldown: 240,
      when: function (s) {
        var u = cheapestUpgrade(s);
        if (!u || !(s.money > u.cost * 5)) { idleGoldSince = 0; return false; }
        if (!idleGoldSince) idleGoldSince = Date.now();
        return (Date.now() - idleGoldSince) > 20000;
      },
      text: function (s) { var u = cheapestUpgrade(s); return 'Idle gold, captain — upgrading your ' + (u ? u.name : 'port') + ' pays for itself'; } },
    // the active port has grown a little (3+ buildings) but never had a specialisation picked
    { id: 'noFocus', cooldown: 240,
      when: function (s) { return !!(s.portFounded && s.focus === 'none' && (s.buildings || []).length >= 3); },
      text: 'Set a Port Focus in Manage — specialists out-earn generalists' },
    // v84: only ONE harbour founded and Uncharted Waters is reachable — answers "how do I make a trade
    // route?" (you need a second harbour first) rather than leaving the player tapping one coast.
    { id: 'tradeNeedsSecond', cooldown: 300,
      when: function (s) {
        if (!((s.ports || []).length === 1)) return false;
        if (firstUnfoundedUnlocked()) return true;   // v85: you already have an unlocked world to found — that's the fix, not a new discovery
        var id = unchartedTarget(); if (!id) return false;
        return !!SIM.canStartUncharted(HARBOR_BIOMES[id].unlockEra);
      },
      text: function () {
        var uf = firstUnfoundedUnlocked();
        return uf ? 'Trade routes need a second harbour — you’ve already unlocked ' + wname(uf) + ', so found it (in the Trade Network, tap its dim node), then link them'
                  : 'Trade routes need a second harbour — chart Uncharted Waters, found the new coast, then link them';
      } },
    // 2+ harbours founded but never linked into a trade route
    { id: 'tradeNetwork', cooldown: 240,
      when: function (s) { return !!((s.ports || []).length >= 2 && s.network && s.network.routes.length === 0); },
      text: 'Link your harbours in the Trade Network for passive income' },
    // Legacy currency sitting unspent (from prestige, crates, or relics)
    { id: 'legacyUnspent', cooldown: 240,
      when: function () { return legacyBal() > 0; },
      text: function () { return 'Spend your Legacy ' + (legacyBal() === 1 ? 'point' : 'points') + ' — permanent upgrades survive prestige'; } },
    // a salvage crate is sitting unopened
    { id: 'crateWaiting', cooldown: 240,
      when: function () { return crateCount() > 0; },
      text: 'You have an unopened crate — treasure inside!' },
    // Phase 17b: any fleet ladder sitting 2+ ages behind the current era — the rubber-band's -5%/age
    // floor is starting to bite, and there's a concrete fix (Registry) to point at.
    { id: 'fleetBehind', cooldown: 240,
      when: function (s) { var f = s.fleet, e = (s.empireEra != null ? s.empireEra : s.era); return !!(f && SIM.FLEET_ROLES.some(function (r) { return (e - f[r].tier) >= 2; })); },   // v84: fleet is empire-wide → measure "behind" against your most advanced harbour, not the port you're viewing
      text: 'Your fleet is falling behind the times — commission modern ships in the Registry' },
    // Phase 17c: a manual raid that wasn't won (tribute paid, or a fight lost) with a navy tier
    // affordable right now — the concrete "here's the fix" nudge toward the Navy section.
    { id: 'navyReminder', cooldown: 240,
      when: function (s) { return raidLostRecently && !!(s.navy && s.navy.can); },
      text: 'Raiders again? Commission a Navy in the Registry — they’ll fight for you' }
  ];
  // Dropped: a "fever/festival ready or being ignored" rule was scoped but isn't shippable — Festival
  // is a random ambient event with no meter/threshold that reads as "ready" (just a randomised gap
  // roll), and tickTips already has to skip entirely while fever IS active (a hard requirement — it
  // must never talk over the tap-frenzy it would be pointing at), so there is no reliable window
  // left in which to fire it.

  var tipToastEl = null, tipToastT = null, tipLastShownAt = 0, tipLastId = null;
  var tipRuleLastShown = {};
  var TIP_GLOBAL_COOLDOWN_MS = 45000;
  function ensureTipToast() {
    if (tipToastEl) return;
    tipToastEl = document.createElement('div'); tipToastEl.id = 'tiptoast';
    tipToastEl.innerHTML = '<span class="tip-ic">💡</span><span class="tip-txt"></span>';
    wrap.appendChild(tipToastEl);
    tipToastEl.addEventListener('click', hideTip);
  }
  function hideTip() { if (tipToastEl) tipToastEl.classList.remove('show'); clearTimeout(tipToastT); }
  function showTip(rule, s) {
    var text = typeof rule.text === 'function' ? rule.text(s) : rule.text;
    ensureTipToast();
    tipToastEl.querySelector('.tip-txt').textContent = text;
    tipToastEl.classList.add('show');
    clearTimeout(tipToastT); tipToastT = setTimeout(hideTip, 8000);
    tipLastShownAt = Date.now(); tipLastId = rule.id; tipRuleLastShown[rule.id] = Date.now();
    if (rule.once) markTipSeen(rule.id);
  }
  // any surface that currently owns input — tips stay silent rather than talk over it
  function tipsBlocked() {
    return settingsOpen || manageOpen || expOpen || registryOpen || tradeOpen || legacyOpen || timelineOpen || feverActive() ||
      (eventModal && eventModal.classList.contains('show')) ||
      (rivalModal && rivalModal.classList.contains('show')) ||
      !!document.getElementById('welcomemodal') ||
      (crateModal && crateModal.classList.contains('show')) ||
      (bonusModal && bonusModal.classList.contains('show')) ||
      (fortuneModal && fortuneModal.classList.contains('show')) ||
      (announceCard && announceCard.classList.contains('show'));
  }
  function tickTips() {
    if (!tipsEnabled() || !simReady() || tipsBlocked()) return;
    if (tipToastEl && tipToastEl.classList.contains('show')) return;   // never stacks
    if (Date.now() - tipLastShownAt < TIP_GLOBAL_COOLDOWN_MS) return;
    var s = SIM.state(); if (!s) return;
    for (var i = 0; i < TIPS.length; i++) {
      var rule = TIPS[i];
      if (rule.once && hasTipSeen(rule.id)) continue;
      if (!rule.once && (Date.now() - (tipRuleLastShown[rule.id] || 0)) < rule.cooldown * 1000) continue;
      var match = false;
      try { match = !!rule.when(s); } catch (e) { match = false; }
      if (!match) continue;
      showTip(rule, s);
      return;
    }
  }

  // idle number notation: 1.2k, 3.40M, 5.7B … Td, then scientific. Stays readable as numbers explode.
  var NUM_SUF = ['', 'k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td'];
  function fmt(n) {
    n = +n || 0; var neg = n < 0; n = Math.abs(n);
    if (n < 1000) return (neg ? '-' : '') + Math.round(n);
    var tier = Math.floor(Math.log10(n) / 3);
    if (tier < NUM_SUF.length) { var s = n / Math.pow(10, tier * 3); return (neg ? '-' : '') + (s < 10 ? s.toFixed(2) : s < 100 ? s.toFixed(1) : Math.round(s)) + NUM_SUF[tier]; }
    return (neg ? '-' : '') + n.toExponential(2).replace('e+', 'e');
  }

  var eraBar = null, muteBtn = null, goalBanner = null, legacyBtn = null, actionBar = null;
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
    { t: 'Found all five harbours', ok: function (s) { return (s.ports || []).length >= 5; }, r: 8000 },
    // Phase 11b: appended (not inserted mid-ladder) — goalIdx is persisted by array index (Retention
    // 'goal' {i}), so any existing save already sitting at an index below this point resolves to the
    // exact same goal it always did. These three exist to *surface* systems a player may have missed
    // (crates, expeditions, the rival) rather than gate progress, so they're deliberately easy/late —
    // a returning player who already did all three just breezes through them for a small bonus before
    // rejoining the endless genGoal() tail (which now starts 3 slots later; harmless, since it's
    // procedurally generated off whatever idx it's asked for).
    { t: 'Open a salvage crate', ok: function () { return crateOpenedFlag(); }, r: 250 },
    { t: 'Send your first expedition', ok: function () { return achOwned('voy1'); }, r: 350 },
    { t: 'Beat Baron Krall in a race', ok: function () { return (rivalGet().wins || 0) >= 1; }, r: 500 }
  ];
  var goalIdx = 0;
  function mgrTotal(s) { var n = 0, m = s.managers || {}; for (var k in m) n += m[k].lvl || 0; return n; }
  // endless goal stream: past the curated ladder, generate escalating objectives forever
  function genGoal(idx) {
    var k = idx - GOALS.length, tier = Math.floor(k / 3), mod = k % 3;
    if (mod === 0) { var target = 5e6 * Math.pow(8, tier); return { t: 'Bank £' + fmt(target) + ' lifetime', ok: function (s) { return s.lifetimeMoney >= target; }, r: Math.round(2000 * Math.pow(3, tier)) }; }
    if (mod === 1) { var era = 6 + tier; return { t: 'Reach ' + (SIM ? SIM.eraName(era) : 'era ' + era), ok: function (s) { return s.era >= era; }, r: Math.round(3000 * Math.pow(3, tier)) }; }
    var pc = tier + 1; return { t: 'Prestige ' + pc + (pc === 1 ? ' time' : ' times'), ok: function () { return chartersCount() >= pc; }, r: Math.round(2500 * Math.pow(3, tier)) };
  }
  function curGoal() { return goalIdx < GOALS.length ? GOALS[goalIdx] : genGoal(goalIdx); }
  function loadGoal() { var g = window.Retention && Retention.get(GAME, 'goal', null); goalIdx = (g && typeof g.i === 'number') ? g.i : 0; }
  function saveGoal() { if (window.Retention) Retention.set(GAME, 'goal', { i: goalIdx }); }
  function setGoalText(s) {
    if (!goalBanner) return;
    var g = curGoal();
    goalBanner.querySelector('.gb-text').textContent = g.t;
    goalBanner.querySelector('.gb-rew').textContent = '+£' + fmt(g.r);
  }
  function checkGoals(s) {
    if (!goalBanner || !s) return;
    goalBanner.classList.toggle('show', simReady() && !cine);
    var g = curGoal();
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
    stormAlert.innerHTML = '<div class="sa-row"><span class="sa-ic">⚠</span><span class="sa-txt"></span><span class="sa-cd"></span></div><button class="sa-avert" style="display:none"></button>';
    wrap.appendChild(stormAlert);
    // Phase 15b: avert — pay to cancel the telegraphed hazard/crash outright, while it's still
    // warning (never once it's struck — repair/rebuild stays the only path after the fact).
    stormAlert.querySelector('.sa-avert').addEventListener('click', function (e) {
      e.stopPropagation();
      var isCrash = this.getAttribute('data-crash') === '1';
      var ok = isCrash ? SIM.avertCrash() : SIM.avertHazard();
      if (!ok) { sfx('tap'); haptic(6); return; }
      sfx('score'); haptic(16); shakeFX(2, 0.15);
      var pw = portWorld(); burstWorld(pw.x, pw.y, pw.z, { count: 16, colors: ['#bfe9ff', '#9ef0b0', '#fff3c4'], speed: 160, life: 0.9 });
      showHint(isCrash ? '⚓ Markets steadied — crash averted' : '⚓ The fleet shelters — storm averted');
      if (achUnlock('avert1')) popAch('Storm Whisperer!', true);
      stormAlert.classList.remove('show');
      updateHUD();
    });
  }
  function handleHazard(s) {
    var hz = s.hazard || { phase: 'idle', strikeId: 0 };
    ensureStormAlert();
    var abtn = stormAlert.querySelector('.sa-avert');
    // Phase 11c: weather audio layer follows the warn/idle lifecycle — howl up on warn, back
    // down once it clears; also ducks the music bed to ~30% for the duration.
    var warnNow = hz.phase === 'warn' && !!hz.port;
    if (warnNow !== stormActive) { stormActive = warnNow; applyWeatherGain(warnNow); applyMusicGain(); }
    if (hz.phase === 'warn' && hz.port) {
      var isCrash = hz.kind === 'Market Crash';
      stormAlert.classList.toggle('crash', isCrash);
      stormAlert.querySelector('.sa-txt').textContent = (hz.kind || 'Storm') + ' approaching ' + wname(hz.port);
      stormAlert.querySelector('.sa-cd').textContent = hz.in + 's';
      stormAlert.classList.add('show');
      // Phase 15b: Avert £X / Stabilise £X — ghosted + "Need £X" when unaffordable (15a pattern)
      var cost = hz.avertCost || 0, canPay = SIM.raw().money >= cost;
      abtn.style.display = ''; abtn.setAttribute('data-crash', isCrash ? '1' : '0');
      abtn.textContent = canPay ? (isCrash ? 'Stabilise £' : 'Avert £') + fmt(cost) : 'Need £' + fmt(cost);
      abtn.classList.toggle('ghosted', !canPay); abtn.disabled = !canPay;
      announceFeature('storm', '⚠️', 'Storm incoming!', 'Sea Walls and Lighthouses protect your port — or spend to avert it outright.');
    } else if (s.crash) {
      stormAlert.classList.add('crash');
      stormAlert.querySelector('.sa-txt').textContent = 'Market crash — ' + s.crash.res + ' prices slump';
      stormAlert.querySelector('.sa-cd').textContent = s.crash.t + 's';
      stormAlert.classList.add('show');
      abtn.style.display = 'none';   // already struck — too late to avert, only warn-phase is avert-able
    } else { stormAlert.classList.remove('show'); abtn.style.display = 'none'; }
    // a fresh strike fired in the sim — react with juice
    if (hz.strikeId && hz.strikeId !== lastStrikeId) {
      lastStrikeId = hz.strikeId; var last = hz.last;
      stormRumble();
      shakeFX(11, 0.7); flashT = 0.85; sfx('lose'); haptic([10, 50, 20]); bumpDaily('storm');
      if (Math.random() < 0.35) { grantCrate(1); showHint('Salvage washed ashore — a crate! 🎁'); }   // storms occasionally drop salvage
      if (last && last.crash) {
        showHint('Market crash — ' + last.res + ' prices slump');
        DRAMA.crashPulse = 1.0;                                     // Phase 14c: red-crayon vignette pulse + a falling price-tag glyph
        var cpw = portWorld(); if (cpw) popWorld(cpw.x, cpw.y + 10, cpw.z, '🏷️ ' + last.res, { color: '#e5493a', size: 20, life: 1.3, vy: 34 });
      }
      else if (last) {
        showHint((last.kind || 'Storm') + ' hit ' + wname(last.port) + '! ' + last.damaged + ' building' + (last.damaged === 1 ? '' : 's') + ' damaged');
        if (last.port === biomeId) { var pw = portWorld(); burstWorld(pw.x, pw.y, pw.z, { count: 32, colors: ['#9aa6ad', '#cdd6da', '#ffd24a', '#88b0c0'], speed: 230, life: 1.1, size: 5, gravity: 240 }); DRAMA.boltT = 0.35; }
      }
    }
  }

  // ---- dynamic events (Phase 7a): ambient surprises via the hint toast, choices via a modal ----
  var eventModal = null, shownEvtSeq = 0;
  function evIcon(id) { return ({ goldrush: '💰', festival: '🎆', castaway: '🛟', raid: '🏴‍☠️', gamble: '🎲', commission: '👑', smuggler: '🦜' })[id] || '⚓'; }
  function evDesc(ev) {
    var d = ev.data || {};
    if (ev.id === 'castaway') return 'A castaway raft drifts toward your harbour — haul it in for salvage?';
    if (ev.id === 'raid') return 'Pirates threaten the port! Pay them off, or fight them off and risk damage for loot.';
    if (ev.id === 'gamble') return 'A merchant offers a risky venture: wager £' + fmt(d.wager) + ' for a ' + Math.round(d.odds * 100) + '% shot to double it.';
    if (ev.id === 'commission') return 'The Crown will pay £' + fmt(d.reward) + ' for ' + fmt(d.amt) + ' ' + d.res + ' delivered right now.';
    if (ev.id === 'smuggler') return 'A smuggler offers ' + fmt(d.amt) + ' ' + d.res + ' for £' + fmt(d.cost) + ' — well below market. No questions asked.';
    return '';
  }
  function evButtons(ev) {
    var d = ev.data || {};
    if (ev.id === 'castaway') return [{ t: 'Haul it in 🛟', i: 0, cls: 'primary' }];
    if (ev.id === 'raid') return [{ t: 'Pay £' + fmt(d.tribute), i: 0 }, { t: 'Fight! ⚔ ' + Math.round(d.winOdds * 100) + '%', i: 1, cls: 'primary' }];
    if (ev.id === 'gamble') return [{ t: 'Decline', i: 1 }, { t: 'Gamble £' + fmt(d.wager), i: 0, cls: 'primary' }];
    if (ev.id === 'commission') { var s = SIM.state(); var can = ((s.res && s.res[d.res]) || 0) >= d.amt; return [{ t: 'Decline', i: 1 }, { t: 'Fulfil · ' + fmt(d.amt) + ' ' + d.res, i: 0, cls: 'primary', dis: !can }]; }
    if (ev.id === 'smuggler') { var afford = (SIM.state().money || 0) >= d.cost; return [{ t: 'Decline', i: 1 }, { t: 'Buy £' + fmt(d.cost), i: 0, cls: 'primary', dis: !afford }]; }
    return [{ t: 'OK', i: 1 }];
  }
  function ensureEventModal() {
    if (eventModal) return;
    eventModal = document.createElement('div'); eventModal.id = 'eventmodal'; eventModal.className = 'evm';
    eventModal.innerHTML = '<div class="ev-card"><div class="ev-ic" id="ev-ic">⚓</div><div class="ev-name" id="ev-name"></div><div class="ev-desc" id="ev-desc"></div><div class="ev-btns" id="ev-btns"></div></div>';
    wrap.appendChild(eventModal);
  }
  function showEventModal(ev) {
    ensureEventModal();
    eventModal.querySelector('#ev-ic').textContent = evIcon(ev.id);
    eventModal.querySelector('#ev-name').textContent = ev.name;
    eventModal.querySelector('#ev-desc').textContent = evDesc(ev);
    var bw = eventModal.querySelector('#ev-btns'); bw.innerHTML = '';
    evButtons(ev).forEach(function (b) {
      var el = document.createElement('button'); el.className = 'ev-btn' + (b.cls ? ' ' + b.cls : ''); el.textContent = b.t; if (b.dis) el.disabled = true;
      el.addEventListener('click', function () { onEventChoice(b.i); });
      bw.appendChild(el);
    });
    eventModal.classList.add('show'); sfx('score'); haptic(12);
  }
  function onEventChoice(i) {
    var wasRaid = eventModal && SIM.event() && SIM.event().id === 'raid';
    var out = SIM.resolveEvent(i); if (eventModal) eventModal.classList.remove('show');
    if (!out) return;
    if (!out.ok) { showHint(out.text || 'Cannot do that yet.'); sfx('lose'); return; }
    // Phase 14c: resolve the visible corsair to match the real outcome — pay sails it off quietly,
    // fight opens a confetti cannon exchange (see updateDrama's 'fight' phase) that lands on win/lose.
    if (out.id === 'raid' && DRAMA.pirate) {
      if (i === 0) pirateResolve('pay');
      else { DRAMA.pirate.phase = 'fight'; DRAMA.pirate.t = 0; DRAMA.volleyN = 0; DRAMA.volleyT = 0.4; DRAMA._fightOut = out.win ? 'winDepart' : 'loseDepart'; }
    }
    if (out.crate) grantCrate(out.crate);
    // Phase 17c: 15d tips rule "navyReminder" — a raid that wasn't WON (tribute paid, or a fight
    // lost) with the navy affordable is the moment to point at the Registry. Manual raids only —
    // an auto-defended raid never opens this modal at all (see handleNavyRepel below).
    if (out.id === 'raid' && out.win !== true) raidLostRecently = true;
    var pw = portWorld();
    if (out.cash > 0) {
      if (pw) { popWorld(pw.x, pw.y + 7, pw.z, '+£' + fmt(out.cash), { color: '#ffe08a', size: 22, life: 1.4, vy: -56 }); burstWorld(pw.x, pw.y, pw.z, { count: out.win ? 36 : 24, colors: ['#ffe08a', '#fff3c4', '#ffd24a'], speed: 210, life: 1.1, size: 5 }); }
      sfx('win'); haptic(24); if (out.win) confettiBurst();
    } else if (out.cash < 0) { sfx('lose'); haptic(16); }
    else sfx('tap');
    if (out.cash > 0) seasonAdd(12);
    if (out.text) showHint(out.text);
    updateHUD();
  }
  function handleEvent(s) {
    var ev = s.event;
    if (!ev) { if (eventModal) eventModal.classList.remove('show'); return; }
    if (ev.seq === shownEvtSeq) return;                                // already surfaced this one
    shownEvtSeq = ev.seq;
    if (ev.kind === 'ambient') {                                       // gold rush / festival — a felt boost, toast + sparkle
      showHint(evIcon(ev.id) + ' ' + ev.name + '! +' + Math.round((ev.data.mult - 1) * 100) + '% output');
      var pw = portWorld(); if (pw) burstWorld(pw.x, pw.y, pw.z, { count: 24, colors: ['#ffe08a', '#fff3c4', '#ffd24a'], speed: 200, life: 1.1, size: 5 });
      sfx('win'); haptic(18);
      if (ev.id === 'festival') startFever();                          // Festival kicks off the active tap-frenzy
    } else {
      if (ev.id === 'raid') startPirate();                             // Phase 14c: the corsair folds in and holds while the modal is open
      showEventModal(ev);                                              // choice / collect — a decision modal
    }
  }
  // ---- Phase 17c: navy auto-defense — a raid that never even opened a modal (sim.js's fireEvent
  // resolved it instantly once navyPower() caught up to raidStrength()). Watched by seq (like
  // shownEvtSeq above) off s.navyRepel; fires a brief cannon-puff particle exchange at the lead
  // patrol ship, a storm-banner-styled (but celebratory) auto-dismissing banner, and a sting.
  var navyBanner = null, shownNavySeq = 0, raidLostRecently = false;
  function ensureNavyBanner() {
    if (navyBanner) return;
    navyBanner = document.createElement('div'); navyBanner.id = 'navybanner';
    navyBanner.innerHTML = '<div class="nb-row"><span class="nb-ic">⚓</span><span class="nb-txt"></span></div>';
    wrap.appendChild(navyBanner);
  }
  function showNavyBanner(text) {
    ensureNavyBanner();
    navyBanner.querySelector('.nb-txt').textContent = text;
    navyBanner.classList.add('show');
    clearTimeout(navyBanner._hideT); navyBanner._hideT = setTimeout(function () { navyBanner.classList.remove('show'); }, 3600);
  }
  function handleNavyRepel(s) {
    var nr = s.navyRepel;
    if (!nr || nr.seq === shownNavySeq) return;
    shownNavySeq = nr.seq;
    if (clock - fleet.at > 1) refreshFleet();                          // make sure fleet.navy is current so the FX lands on a real patrol ship
    var pos = fleet.navy.length ? navyPatrolPos(fleet.navy[0]) : null;
    var by = scene.port ? scene.port.by : 0;
    var wx = pos ? pos.x : portWorld().x, wy = by + 4, wz = pos ? pos.z : portWorld().z;
    burstWorld(wx, wy, wz, { count: 22, colors: ['#dfe6ea', '#9aa6ad', '#fff3c4'], speed: 190, life: 0.8, size: 5, gravity: 60 });   // cannon-puff exchange
    popWorld(wx, wy + 5, wz, '+£' + fmt(nr.loot), { color: '#ffe08a', size: 18, life: 1.2, vy: -46 });
    showNavyBanner('⚓ The Navy repelled the raiders! +£' + fmt(nr.loot) + ' loot');
    sfx('win'); haptic(20);
    // Phase 14c: the corsair still shows up for an auto-repel — folds in, one confetti exchange
    // with the patrol ship, then retreats — same visible beat as a manually-fought raid, just fast.
    startPirate(); DRAMA.pirate.phase = 'fight'; DRAMA.pirate.t = 0.9; DRAMA.volleyN = 2; DRAMA.volleyT = 0.4; DRAMA._fightOut = 'loseDepart';
  }

  // ---- expeditions (Phase 7b): send ships on timed voyages (resolve offline), collect rewards ----
  function toggleExp() {
    expOpen = !expOpen;
    if (expOpen) { if (manageOpen) { manageOpen = false; managePanel.classList.remove('show'); } if (settingsOpen) { settingsOpen = false; settingsPanel.classList.remove('show'); } if (registryOpen) { registryOpen = false; registryPanel.classList.remove('show'); } }
    expPanel.classList.toggle('show', expOpen);
    if (expOpen) { renderExp(); sfx('tap'); haptic(8); }
  }
  function tierStars(t) { return new Array(t + 1).join('★'); }
  function mmss(s) { var m = Math.floor(s / 60), ss = s % 60; return (m > 0 ? m + 'm ' : '') + ss + 's'; }
  function renderExp() {
    if (!simReady()) { expPanel.classList.remove('show'); expOpen = false; return; }
    var v = SIM.voyages();
    var h = '<div class="mp-head">Expeditions <span class="ex-slots">' + v.used + '/' + v.slots + '</span><button id="ex-close">✕</button></div>';
    // Phase 15c: Uncharted Waters — a pinned, visually distinct entry that discovers the next
    // locked world (see unchartedTarget()). Hidden once a discovery voyage is already at sea (only
    // one target at a time, so a second one would just double-book the same coast).
    var uTarget = unchartedTarget();
    var uActive = v.active.filter(function (a) { return a.uncharted; });
    if (uTarget && !uActive.length) {
      var ub = HARBOR_BIOMES[uTarget], uCost = SIM.unchartedCost(ub.unlockEra), uSecs = SIM.unchartedSecs(), uCan = SIM.canStartUncharted(ub.unlockEra);
      h += '<div class="mp-sec">Chart a new coast</div><div class="mp-grid">';
      h += '<button class="mp-item ex-uncharted' + (uCan ? '' : ' ghosted') + '" data-uncharted="1"' + (uCan ? '' : ' disabled') + '>' +
        '<span class="mi-n">⛵ Uncharted Waters</span><span class="mi-d">' + mmss(uSecs) + ' voyage · discovers ' + ub.name + '</span>' +
        '<span class="mi-c">' + (uCan ? '£' + fmt(uCost) : 'Need £' + fmt(uCost)) + '</span></button>';
      h += '</div>';
    }
    if (v.active.length) {
      h += '<div class="mp-sec">At sea</div><div class="mp-grid">';
      v.active.forEach(function (a) {
        var cls = 'mp-item ex-go' + (a.uncharted ? ' ex-uncharted' : '');
        var label = a.uncharted ? '⛵ Uncharted Waters' : (a.name + ' ' + tierStars(a.tier));
        if (a.ready) h += '<button class="' + cls + ' ready" data-collect="' + a.seq + '"><span class="mi-n">' + label + '</span><span class="mi-c">Collect 🎁</span></button>';
        else { var pct = Math.round(100 * (1 - a.remaining / a.total)); h += '<div class="' + cls + '"><span class="mi-n">' + label + '</span><span class="mi-c">' + mmss(a.remaining) + '</span><div class="ex-bar"><i style="width:' + pct + '%"></i></div></div>'; }
      });
      h += '</div>';
    }
    h += '<div class="mp-sec">Send a ship</div><div class="mp-grid">';
    v.dests.forEach(function (d) {
      h += '<button class="mp-item ex-send" data-send="' + d.id + '"' + (d.can ? '' : ' disabled') + '><span class="mi-n">' + d.name + ' ' + tierStars(d.tier) + '</span><span class="mi-d">' + mmss(d.secs) + ' voyage</span><span class="mi-c">£' + fmt(d.cost) + '</span></button>';
    });
    h += '</div>';
    if (v.used >= v.slots) h += '<div class="ex-note">All ships are at sea — collect a voyage, or grow your empire for more berths.</div>';
    expPanel.innerHTML = h;
    expPanel.querySelector('#ex-close').addEventListener('click', toggleExp);
    expPanel.querySelectorAll('[data-send]').forEach(function (el) { el.addEventListener('click', function () {
      var destId = el.getAttribute('data-send'), destName = null;
      var vBefore = SIM.voyages(); vBefore.dests.forEach(function (d) { if (d.id === destId) destName = d.name; });
      if (SIM.startVoyage(destId)) {
        sfx('move'); haptic(14);
        // Phase 14c: send-off salience — horn + toast, and mark this voyage's cast-off so drawFleet
        // starts its ship at the quay (not offshore) with a visible wake for the first beat.
        var vAfter = SIM.voyages(), maxSeq = 0; vAfter.active.forEach(function (a) { if (a.seq > maxSeq) maxSeq = a.seq; });
        if (maxSeq) DRAMA.castoff[maxSeq] = clock;
        sfx('score'); showHint('⛵ ' + (destName || 'Expedition') + ' expedition sets sail');
        var pw = portWorld(); if (pw) burstWorld(pw.x, pw.y, pw.z, { count: 14, colors: ['#cfe8ff', '#ffffff', '#7fe0d6'], speed: 150, life: 0.8, size: 4 });
        renderExp(); updateHUD();
      } else sfx('lose');
    }); });
    expPanel.querySelectorAll('[data-uncharted]').forEach(function (el) { el.addEventListener('click', function () {
      var id = unchartedTarget(); if (!id) { sfx('lose'); return; }
      var b = HARBOR_BIOMES[id];
      if (SIM.startUncharted(b.unlockEra)) { sfx('move'); haptic(16); var pw = portWorld(); if (pw) burstWorld(pw.x, pw.y, pw.z, { count: 20, colors: ['#ffd56a', '#cfe8ff', '#7fe0d6'], speed: 170, life: 0.9, size: 5 }); renderExp(); updateHUD(); } else sfx('lose');
    }); });
    expPanel.querySelectorAll('[data-collect]').forEach(function (el) { el.addEventListener('click', function () { collectVoyageUI(+el.getAttribute('data-collect')); }); });
  }
  function collectVoyageUI(seq) {
    var out = SIM.collectVoyage(seq); if (!out) return;
    triggerFlutter();   // Phase 19c: collect tap — a brief page-flutter riffle, not the full build unfold
    // Phase 15c: a discovery voyage doesn't pay cash/res — it unlocks the next coast. Handle it as
    // its own celebration path rather than folding it into the normal reward-collect flow below.
    if (out.discover) {
      var id = unchartedTarget();   // still locked at this instant (collectVoyage hasn't unlocked it) — recompute the target it was chasing
      if (id) {
        unlockWorld(id);
        pulseDiscoveredBiome(id);
        if (achUnlock('discover1')) popAch('Pathfinder!', true);
        announceFeature('discover_' + id, '🧭', 'New coast discovered!', wname(id) + ' — sail the world bar to found a colony');
        showHint('🧭 Uncharted Waters returned — ' + wname(id) + ' discovered!');
      } else showHint('🧭 Uncharted Waters returned!');
      confettiBurst(); shakeFX(6, 0.4); sfx('win'); haptic([10, 40, 20, 40]);
      var pwD = portWorld(); if (pwD) burstWorld(pwD.x, pwD.y, pwD.z, { count: 40, colors: ['#ffe08a', '#7fe0d6', '#fff3c4'], speed: 230, life: 1.3, size: 6 });
      renderExp(); updateHUD();
      return;
    }
    metricsMilestone('firstVoyage');
    if (out.crate) grantCrate(out.crate);
    var rel = out.relic ? grantRandomRelic() : null;
    var pw = portWorld();
    if (pw) { popWorld(pw.x, pw.y + 7, pw.z, '+£' + fmt(out.cash), { color: '#ffe08a', size: 22, life: 1.4, vy: -56 }); burstWorld(pw.x, pw.y, pw.z, { count: 30, colors: ['#7fe0d6', '#ffe08a', '#fff3c4'], speed: 210, life: 1.1, size: 5 }); }
    var extra = out.res ? (' + ' + Object.keys(out.res).map(function (k) { return fmt(out.res[k]) + ' ' + k; }).join(', ')) : '';
    showHint('⛵ ' + out.name + ' returned! +£' + fmt(out.cash) + extra + (out.crate ? ' + a crate 🎁' : ''));
    sfx('win'); haptic(26); confettiBurst();
    if (rel) announceRelic(rel);
    seasonAdd(8 * (out.tier || 1));
    if (achUnlock('voy1')) popAch('First Expedition!', true);
    renderExp(); updateHUD();
  }

  // ---- the Rival: Baron Krall (Phase 7d) — recurring antagonist with taunts + head-to-head races ----
  var RIVAL_NAME = 'Baron Krall';
  var RIVAL_TAUNTS = [
    'You call that a harbour? Let me show you how a real magnate trades.',
    'Beginner’s luck. I’ll bury you in cargo.',
    'Still here? Persistent little barnacle. Try THIS.',
    'You’re becoming a nuisance. Let’s settle this on the water.',
    'Impossible… how are you keeping pace with me?!'
  ];
  var RIVAL_LOSE = ['“Pathetic. The sea favours the bold — and that’s me.”', '“Was that your best? My grandmother ships faster.”', '“Run home, harbourmaster.”'];
  var RIVAL_WIN = ['“You… beat me? Bah! A fluke!”', '“Impossible! I’ll have my revenge, Port Boss.”', '“Enjoy your trophy. It won’t happen again.”'];
  var rivalModal = null, rivalPending = false, raceBanner = null;
  function rivalGet() { var d = { stage: 0, wins: 0, losses: 0, race: null }; return (window.Retention && Retention.get(GAME, 'rival', d)) || d; }
  function rivalSet(r) { if (window.Retention) Retention.set(GAME, 'rival', r); }
  function rivalThreshold(stage) { return 2 + stage * 2; }                       // era at which the next challenge appears
  function raceCounter(kind) { var s = SIM.state(); return kind === 'ship' ? ((s.stats && s.stats.shipped) || 0) : (s.lifetimeMoney || 0); }
  function rivalTarget(kind, era, stage) {
    if (kind === 'ship') return Math.round(40 * (1 + era * 0.7) * (1 + stage * 0.4));
    return Math.round(Math.max(800, (SIM.state().lifetimeMoney || 0) * 0.03 + 500 * Math.pow(1.8, era)) * (1 + stage * 0.25));
  }
  function ensureRivalModal() {
    if (rivalModal) return;
    rivalModal = document.createElement('div'); rivalModal.id = 'rivalmodal'; rivalModal.className = 'evm';
    rivalModal.innerHTML = '<div class="ev-card rival"><div class="ev-ic">🎩</div><div class="ev-name" id="rv-name"></div><div class="ev-desc" id="rv-desc"></div><div class="ev-btns" id="rv-btns"></div></div>';
    wrap.appendChild(rivalModal);
  }
  function rvButtons(list) { var bw = rivalModal.querySelector('#rv-btns'); bw.innerHTML = ''; list.forEach(function (b) { var el = document.createElement('button'); el.className = 'ev-btn' + (b.cls ? ' ' + b.cls : ''); el.textContent = b.t; el.addEventListener('click', b.fn); bw.appendChild(el); }); }
  function showRivalChallenge() {
    var r = rivalGet(), s = SIM.state(), kind = (r.stage % 2 === 0) ? 'earn' : 'ship', target = rivalTarget(kind, s.era, r.stage);
    ensureRivalModal();
    rivalModal.querySelector('#rv-name').textContent = RIVAL_NAME;
    var goal = kind === 'ship' ? ('ship ' + fmt(target) + ' cargo') : ('earn £' + fmt(target));
    rivalModal.querySelector('#rv-desc').textContent = '“' + RIVAL_TAUNTS[Math.min(r.stage, RIVAL_TAUNTS.length - 1)] + '” — Race him: ' + goal + ' within 3 minutes.';
    rvButtons([
      { t: 'Back down', fn: function () { declineRival(); rivalModal.classList.remove('show'); } },
      { t: 'Accept ⚔', cls: 'primary', fn: function () { startRace(kind, target, 180); rivalModal.classList.remove('show'); } }
    ]);
    rivalModal.classList.add('show'); sfx('score'); haptic(14);
  }
  function startRace(kind, target, secs) { var r = rivalGet(); r.race = { kind: kind, target: target, base: raceCounter(kind), endsAt: Date.now() + secs * 1000 }; rivalPending = false; rivalSet(r); showHint('🏁 Race on! Beat ' + RIVAL_NAME + '!'); updateHUD(); }
  function declineRival() { var r = rivalGet(); r.losses = (r.losses || 0) + 1; r.stage = (r.stage || 0) + 1; rivalPending = false; rivalSet(r); showHint(RIVAL_LOSE[Math.floor(Math.random() * RIVAL_LOSE.length)]); }
  function resolveRace(win) {
    var r = rivalGet(); r.race = null; r.stage = (r.stage || 0) + 1;
    if (win) {
      r.wins = (r.wins || 0) + 1; rivalSet(r);
      var prize = Math.round(Math.max(1000, (SIM.state().lifetimeMoney || 0) * 0.03));
      if (SIM.raw()) { SIM.raw().money += prize; SIM.raw().lifetimeMoney = (SIM.raw().lifetimeMoney || 0) + prize; }
      var rel = grantRandomRelic(); seasonAdd(40); if (achUnlock('rival1')) popAch('Bested Baron Krall!', true); showRivalResult(true, prize, rel);
    } else { r.losses = (r.losses || 0) + 1; rivalSet(r); showRivalResult(false, 0, null); }
    updateHUD();
  }
  function showRivalResult(win, prize, rel) {
    ensureRivalModal();
    rivalModal.querySelector('#rv-name').textContent = win ? (RIVAL_NAME + ' — defeated!') : (RIVAL_NAME + ' wins this round');
    rivalModal.querySelector('#rv-desc').textContent = win ? ((RIVAL_WIN[Math.floor(Math.random() * RIVAL_WIN.length)]) + ' You won £' + fmt(prize) + (rel ? ' and a relic — ' + rel.name + '!' : '!')) : RIVAL_LOSE[Math.floor(Math.random() * RIVAL_LOSE.length)];
    rvButtons([{ t: win ? 'Victory! 🏆' : 'Hmph.', cls: 'primary', fn: function () { rivalModal.classList.remove('show'); } }]);
    rivalModal.classList.add('show');
    if (win) { sfx('win'); haptic([10, 40, 20, 40]); confettiBurst(); if (rel && rel.completed) announceRelic(rel); } else { sfx('lose'); haptic(20); }
  }
  function maybeTriggerRival(s) {
    if (rivalPending) return; var r = rivalGet();
    if (r.race) return;
    if (eventModal && eventModal.classList.contains('show')) return;             // don't collide with an event modal
    if (s.era >= rivalThreshold(r.stage || 0)) { rivalPending = true; showRivalChallenge(); }
  }
  function updateRaceBanner() {
    if (!raceBanner) return; var r = rivalGet();
    if (r.race) {
      var prog = raceCounter(r.race.kind) - r.race.base, rem = Math.ceil((r.race.endsAt - Date.now()) / 1000);
      if (prog >= r.race.target) { resolveRace(true); return; }
      if (rem <= 0) { resolveRace(false); return; }
      var label = r.race.kind === 'ship' ? (fmt(Math.max(0, Math.floor(prog))) + '/' + fmt(r.race.target) + ' cargo') : ('£' + fmt(Math.max(0, Math.floor(prog))) + ' / £' + fmt(r.race.target));
      raceBanner.querySelector('.rb-txt').textContent = '🏁 vs ' + RIVAL_NAME + ': ' + label;
      raceBanner.querySelector('.rb-cd').textContent = rem + 's';
      raceBanner.classList.add('show');
    } else raceBanner.classList.remove('show');
  }

  // ---- active Fever (Phase 7e): a Festival opens a tap-frenzy — coins rain over the harbour, a
  // combo meter rewards rapid taps. Pure upside; ignoring it just means normal idle play. ----
  var feverEnd = 0, feverSpawnT = null, feverLoopT = null, combo = 0, comboT = 0, feverLayer = null, comboEl = null;
  function ensureFeverUI() {
    if (feverLayer) return;
    feverLayer = document.createElement('div'); feverLayer.id = 'fever'; wrap.appendChild(feverLayer);
    comboEl = document.createElement('div'); comboEl.id = 'combo'; comboEl.innerHTML = '<span class="cb-x"></span><div class="cb-bar"><i></i></div>'; wrap.appendChild(comboEl);
  }
  function feverActive() { return Date.now() < feverEnd; }
  function comboMult() { return 1 + Math.min(combo * 0.12, 4); }
  function startFever(secs) {
    ensureFeverUI(); secs = secs || 14; feverEnd = Date.now() + secs * 1000; combo = 0; comboT = 0;
    if (!hasSeenFeature('fever')) announceFeature('fever', '🎆', 'FEVER!', 'Tap the coins before they sink!', true);
    else showHint('🎆 FEVER! Tap the coins!');
    sfx('win'); haptic(20);
    spawnLoop(); clearTimeout(feverLoopT); feverTick();
  }
  function spawnLoop() {
    clearTimeout(feverSpawnT); if (!feverActive()) return;
    spawnCoin(); feverSpawnT = setTimeout(spawnLoop, 380 + Math.random() * 340);
  }
  function spawnCoin() {
    ensureFeverUI();
    var gem = Math.random() < 0.25;
    var c = document.createElement('button'); c.className = 'coin'; c.textContent = gem ? '💎' : '🪙'; c.dataset.gem = gem ? '1' : '';
    var x = 28 + Math.random() * (Math.max(120, CW) - 56), y = (CH || 700) * 0.34 + Math.random() * ((CH || 700) * 0.4);
    c.style.left = x + 'px'; c.style.top = y + 'px';
    c.addEventListener('click', function (e) { e.stopPropagation(); collectCoin(c); });
    feverLayer.appendChild(c);
    setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 2600);
  }
  function collectCoin(c) {
    if (!feverActive()) { if (c.parentNode) c.parentNode.removeChild(c); return; }
    combo++; comboT = 1.6;
    var era = SIM.state().era || 0, mult = comboMult() * (c.dataset.gem ? 3 : 1);
    var base = Math.max(20, Math.round((SIM.state().lifetimeMoney || 0) * 0.0008) + 28 * Math.pow(1.6, era));
    var gain = Math.round(base * mult);
    if (SIM.raw()) { SIM.raw().money += gain; SIM.raw().lifetimeMoney = (SIM.raw().lifetimeMoney || 0) + gain; }
    var r = c.getBoundingClientRect();
    if (FX) { FX.pop.add(r.left + r.width / 2, r.top, '+£' + fmt(gain), { color: c.dataset.gem ? '#bfe9ff' : '#ffe08a', size: 16, life: 1.0, vy: -50 }); FX.p.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 8, colors: ['#ffe08a', '#fff3c4'], speed: 140, life: 0.7, size: 4 }); }
    sfx('score'); haptic(7); seasonAdd(1);
    if (combo >= 10 && achUnlock('combo')) popAch('Fever Pitch — 10 combo!', true);
    if (c.parentNode) c.parentNode.removeChild(c);
    updateComboUI();
  }
  function updateComboUI() {
    if (!comboEl) return;
    if (combo > 1 && feverActive()) { comboEl.classList.add('show'); comboEl.querySelector('.cb-x').textContent = '×' + comboMult().toFixed(1) + ' COMBO'; comboEl.querySelector('.cb-bar i').style.width = Math.min(100, comboT / 1.6 * 100) + '%'; }
    else comboEl.classList.remove('show');
  }
  function feverTick() {
    if (!feverActive()) { combo = 0; if (comboEl) comboEl.classList.remove('show'); if (feverLayer) feverLayer.innerHTML = ''; updateHUD(); return; }
    comboT -= 0.1; if (comboT <= 0) combo = 0;
    updateComboUI();
    feverLoopT = setTimeout(feverTick, 100);
  }

  // ---- seasons & the free Harbour Pass (Phase 7f): a rotating themed season; earn season points
  // from everything you do and claim a free milestone reward track. Ethical: no paid tier, no
  // punishing expiry — rewards are applied the moment you claim them and are yours forever. ----
  var SEASON_EPOCH = Date.UTC(2026, 0, 1), SEASON_LEN = 14 * 24 * 3600 * 1000;
  var SEASON_THEMES = ['Tides of Fortune', 'Monsoon Trade Winds', 'The Gold Run', 'Harvest of the Sea', 'Lanterns & Lighthouses', 'Stormwatch Season', 'The Great Regatta', 'Frostwater Passage'];
  var PASS_TIERS = [
    { at: 60, reward: { crate: 1 }, label: 'Salvage crate' },
    { at: 150, reward: { legacy: 3 }, label: '+3 ✦ Legacy' },
    { at: 320, reward: { crate: 2 }, label: '2 crates' },
    { at: 560, reward: { relic: 1 }, label: 'A relic' },
    { at: 880, reward: { legacy: 8 }, label: '+8 ✦ Legacy' },
    { at: 1300, reward: { crate: 3 }, label: '3 crates' },
    { at: 1850, reward: { relic: 1 }, label: 'A relic' },
    { at: 2600, reward: { legacy: 20 }, label: '+20 ✦ Legacy' },
    { at: 3600, reward: { crate: 5 }, label: '5 crates' },
    { at: 5000, reward: { relic: 1, legacy: 30 }, label: 'Relic + 30 ✦ Legacy' }
  ];
  function seasonId() { return Math.floor((Date.now() - SEASON_EPOCH) / SEASON_LEN); }
  function seasonTheme() { var i = seasonId() % SEASON_THEMES.length; return SEASON_THEMES[(i + SEASON_THEMES.length) % SEASON_THEMES.length]; }
  function seasonGet() { var s = window.Retention && Retention.get(GAME, 'season', null), id = seasonId(); if (!s || s.id !== id) { s = { id: id, points: 0, claimed: [] }; if (window.Retention) Retention.set(GAME, 'season', s); } return s; }
  function seasonSet(s) { if (window.Retention) Retention.set(GAME, 'season', s); }
  function seasonAdd(n) { if (!n) return; var s = seasonGet(); var was0 = !s.points; s.points = (s.points || 0) + n; seasonSet(s); if (was0 && s.points > 0) announceFeature('season', '🎟️', 'Harbour Pass', 'Everything you do earns season rewards. Claim them in Legacy.'); }
  function seasonDaysLeft() { return Math.max(1, Math.ceil((SEASON_EPOCH + (seasonId() + 1) * SEASON_LEN - Date.now()) / (24 * 3600 * 1000))); }
  function passClaimable(i) { var s = seasonGet(); return (s.points || 0) >= PASS_TIERS[i].at && s.claimed.indexOf(i) < 0; }
  function claimPass(i) {
    if (!passClaimable(i)) return false;
    var rw = PASS_TIERS[i].reward, s = seasonGet(); s.claimed.push(i); seasonSet(s);
    if (rw.crate) grantCrate(rw.crate);
    if (rw.legacy) setLegacyBal(legacyBal() + rw.legacy);
    if (rw.relic) { var rel = grantRandomRelic(); if (rel) announceRelic(rel); }
    sfx('win'); haptic(26); confettiBurst();
    if (achUnlock('pass1')) popAch('Season Sailor!', true);
    showHint('🎟️ Harbour Pass: ' + PASS_TIERS[i].label + ' claimed!');
    computeMeta(); updateHUD();
    return true;
  }

  // ---- Legacy / Prestige: meta progression persisted across runs (via Retention, survives a wipe) ----
  var LEGACY_TREE = [
    { id: 'prod', name: 'Master Shipwrights', desc: '+25% global production / lvl', base: 3, mul: 1.6, per: 0.25, max: 30, meta: 'prodMul' },
    { id: 'sell', name: 'Trade Barons', desc: '+25% global sales / lvl', base: 3, mul: 1.6, per: 0.25, max: 30, meta: 'sellMul' },
    { id: 'start', name: 'Inheritance', desc: '+£1k starting money / lvl', base: 2, mul: 1.5, per: 1000, max: 25, meta: 'startMoney' },
    { id: 'offline', name: 'Standing Orders', desc: '+2h offline earnings / lvl', base: 5, mul: 1.8, per: 2, max: 8, meta: 'offlineHours' },
    { id: 'cost', name: 'Bulk Charters', desc: '−4% build costs / lvl', base: 4, mul: 1.7, per: 0.04, max: 15, meta: 'costMul' },
    { id: 'hazard', name: 'Storm Wardens', desc: '+6% storm resistance / lvl', base: 3, mul: 1.6, per: 0.06, max: 12, meta: 'hazardResist' },
    { id: 'route', name: 'Trade Winds', desc: '+20% route capacity / lvl', base: 4, mul: 1.6, per: 0.20, max: 15, meta: 'routeMul' },
    { id: 'auto_repair', name: 'Repair Crews', desc: 'Unlocks auto-repair of storm damage', base: 8, mul: 1, per: 0, max: 1, meta: 'auto' },
    { id: 'auto_buy', name: 'Port Authority', desc: 'Unlocks auto-buy of cheapest upgrades', base: 14, mul: 1, per: 0, max: 1, meta: 'auto' }
  ];
  function ln(id) { for (var i = 0; i < LEGACY_TREE.length; i++) if (LEGACY_TREE[i].id === id) return LEGACY_TREE[i]; return null; }
  function legacyBal() { return (window.Retention ? (Retention.get(GAME, 'legacyBal', 0) | 0) : 0); }
  function chartersCount() { return window.Retention ? (Retention.get(GAME, 'charters', 0) | 0) : 0; }
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
  // ---- relics & collection sets (Phase 7c): permanent set-bonuses; stored in Retention so they
  // survive prestige. Relics drop from expeditions, rare events, and Legendary crates. ----
  var RELIC_SETS = [
    { id: 'carto', name: 'Cartographer’s Cache', bonus: '+1 expedition ship', meta: 'voyageSlots', amt: 1, relics: ['Brass Astrolabe', 'Tattered Sea Chart', 'Star Compass'] },
    { id: 'smug', name: 'Smuggler’s Hoard', bonus: '+25% faster voyages', meta: 'voyageSpeed', amt: 0.25, relics: ['Black Pearl', 'Forged Ledger', 'Hidden Cove Key'] },
    { id: 'salt', name: 'Old Salt’s Charms', bonus: '+15% storm resistance', meta: 'hazardResist', amt: 0.15, relics: ['Whale-bone Talisman', 'Mermaid’s Tear', 'Storm Glass'] },
    { id: 'prince', name: 'Merchant Prince’s Regalia', bonus: '+30% production', meta: 'prodMul', amt: 0.30, relics: ['Gilded Sextant', 'Ivory Abacus', 'Royal Seal'] }
  ];
  function ownedRelics() { return (window.Retention && Retention.get(GAME, 'relics', {})) || {}; }
  function hasRelic(id) { return !!ownedRelics()[id]; }
  function setById(id) { for (var i = 0; i < RELIC_SETS.length; i++) if (RELIC_SETS[i].id === id) return RELIC_SETS[i]; return null; }
  function setComplete(set) { for (var i = 0; i < set.relics.length; i++) if (!hasRelic(set.id + i)) return false; return true; }
  function relicCount() { var o = ownedRelics(), n = 0; for (var k in o) if (o[k]) n++; return n; }
  function totalRelics() { var n = 0; RELIC_SETS.forEach(function (s) { n += s.relics.length; }); return n; }
  function allRelicIds() { var a = []; RELIC_SETS.forEach(function (s) { s.relics.forEach(function (_, ri) { a.push(s.id + ri); }); }); return a; }
  function unownedRelicIds() { var o = ownedRelics(); return allRelicIds().filter(function (id) { return !o[id]; }); }
  function relicInfo(id) { var setId = id.replace(/[0-9]+$/, ''), ri = +id.slice(setId.length), s = setById(setId); return s ? { name: s.relics[ri], set: s.name, setId: setId } : null; }
  function grantRelicById(id) {
    if (!window.Retention || hasRelic(id)) return null;
    var o = ownedRelics(); o[id] = true; Retention.set(GAME, 'relics', o); computeMeta();
    var info = relicInfo(id); if (info) { var s = setById(info.setId); info.completed = s ? setComplete(s) : false; info.bonus = s ? s.bonus : ''; }
    return info;
  }
  function grantRandomRelic() { var pool = unownedRelicIds(); if (!pool.length) return null; return grantRelicById(pool[Math.floor(Math.random() * pool.length)]); }

  // ---- Phase 9c: Doctrines — a mutually-exclusive branch pick on top of the flat Legacy tree.
  // Unlocks at ≥3 charters; pick costs ✦, respec swaps the branch for a higher ✦ fee (no refunds).
  // Each branch has one capstone (max 1); a bought capstone stays owned but only counts while
  // its branch is the active pick, so respecing back re-activates it. Survives prestige. ----
  var DOCTRINE_UNLOCK = 3, DOCTRINE_PICK_COST = 25, DOCTRINE_RESPEC_COST = 50;
  var DOCTRINES = [
    { id: 'merchant', icon: '⚖️', name: 'Merchant Doctrine', desc: '+20% sales · +10% route capacity',
      cap: { name: 'Monopoly', desc: '+1 permanent contract slot', cost: 120 } },
    { id: 'explorer', icon: '🧭', name: 'Explorer Doctrine', desc: '+35% voyage speed · +1 voyage slot',
      cap: { name: 'Flagship', desc: '+40% voyage rewards', cost: 120 } }
  ];
  function doctrineDef(id) { for (var i = 0; i < DOCTRINES.length; i++) if (DOCTRINES[i].id === id) return DOCTRINES[i]; return null; }
  function doctrineGet() { var d = (window.Retention && Retention.get(GAME, 'doctrine', null)) || {}; return { pick: d.pick || null, caps: d.caps || {} }; }
  function doctrineSet(d) { if (window.Retention) Retention.set(GAME, 'doctrine', d); }
  function doctrineUnlocked() { return chartersCount() >= DOCTRINE_UNLOCK; }
  function doctrinePickCost() { return doctrineGet().pick ? DOCTRINE_RESPEC_COST : DOCTRINE_PICK_COST; }
  function pickDoctrine(id) {
    if (!doctrineUnlocked() || !doctrineDef(id)) return false;
    var d = doctrineGet(); if (d.pick === id) return false;              // already on this path
    var cost = doctrinePickCost(); if (legacyBal() < cost) return false;
    setLegacyBal(legacyBal() - cost); d.pick = id; doctrineSet(d);
    computeMeta(); return true;
  }
  function buyCapstone() {
    var d = doctrineGet(), def = d.pick && doctrineDef(d.pick);
    if (!def || d.caps[d.pick]) return false;                            // needs a pick; max 1 per branch
    if (legacyBal() < def.cap.cost) return false;
    setLegacyBal(legacyBal() - def.cap.cost); d.caps[d.pick] = true; doctrineSet(d);
    computeMeta(); return true;
  }

  // ---- Phase 9c: Relic loadout — equip up to 3 owned relics (4th slot at ≥9 relics owned) for a
  // small INDIVIDUAL bonus per relic by set family, on top of the set-completion passives. ----
  var LOADOUT_BONUS = {
    carto: { meta: 'voyageSpeed', amt: 0.06, label: '+6% voyage speed' },
    smug: { meta: 'sellMul', amt: 0.04, label: '+4% sales' },
    salt: { meta: 'hazardResist', amt: 0.05, label: '+5% storm resist' },
    prince: { meta: 'prodMul', amt: 0.06, label: '+6% production' }
  };
  var LOADOUT_CAP = 0.25;                                                // each bonus type ≤ +25% from the loadout
  function loadoutSlots() { return 3 + (relicCount() >= 9 ? 1 : 0); }
  function loadoutGet() {                                                // sanitised: owned, unique, within slots
    var raw = (window.Retention && Retention.get(GAME, 'loadout', [])) || [];
    if (!Array.isArray(raw)) raw = [];
    var seen = {}, out = [];
    for (var i = 0; i < raw.length && out.length < loadoutSlots(); i++) { var id = raw[i]; if (typeof id === 'string' && hasRelic(id) && !seen[id]) { seen[id] = 1; out.push(id); } }
    return out;
  }
  function loadoutSet(a) { if (window.Retention) Retention.set(GAME, 'loadout', a); }
  function equipped(id) { return loadoutGet().indexOf(id) >= 0; }
  function equipRelic(id) {                                              // tap-to-toggle; false when full/unowned
    var lo = loadoutGet(), i = lo.indexOf(id);
    if (i >= 0) lo.splice(i, 1);
    else { if (!hasRelic(id) || lo.length >= loadoutSlots()) return false; lo.push(id); }
    loadoutSet(lo); computeMeta(); return true;
  }
  function announceRelic(rel) {
    if (!rel) return;
    if (rel.completed) { showHint('🏺 ' + rel.name + ' — ' + rel.set + ' COMPLETE! ' + rel.bonus); confettiBurst(); sfx('win'); haptic([10, 40, 20, 40]); if (achUnlock('relset')) popAch('Relic Set Complete!', true); }
    else { showHint('🏺 Relic found: ' + rel.name + ' · ' + rel.set); sfx('score'); haptic(20); }
  }

  function computeMeta() {
    var tr = legacyTreeMap(), M = { prodMul: 1, sellMul: 1, costMul: 1, startMoney: 0, offlineHours: 8, hazardResist: 0, routeMul: 1, voyageSpeed: 1, voyageSlots: 0, contractSlots: 0, voyageYield: 0 };
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
    // completed relic sets stack permanent passives on top (Phase 7c)
    RELIC_SETS.forEach(function (set) {
      if (!setComplete(set)) return;
      if (set.meta === 'prodMul') M.prodMul += set.amt;
      else if (set.meta === 'hazardResist') M.hazardResist += set.amt;
      else if (set.meta === 'voyageSpeed') M.voyageSpeed += set.amt;
      else if (set.meta === 'voyageSlots') M.voyageSlots += set.amt;
    });
    // Phase 9c: active doctrine branch (+ its capstone, only while that branch is picked)
    var doc = doctrineGet();
    if (doc.pick === 'merchant') {
      M.sellMul += 0.20; M.routeMul += 0.10;   // Phase 11a: was +0.35 — sales compound (income→builds→income); autoplay hit 2.5–2.7× vanilla lifetime vs the 2.5× cap; +0.20 lands ≈2.0×
      if (doc.caps.merchant) M.contractSlots += 1;                       // Monopoly
    } else if (doc.pick === 'explorer') {
      M.voyageSpeed += 0.35; M.voyageSlots += 1;
      if (doc.caps.explorer) M.voyageYield += 0.40;                      // Flagship
    }
    // Phase 9c: relic loadout — small per-relic bonuses, capped per bonus type
    var loAcc = {};
    loadoutGet().forEach(function (id) {
      var fam = LOADOUT_BONUS[id.replace(/[0-9]+$/, '')]; if (!fam) return;
      loAcc[fam.meta] = Math.min(LOADOUT_CAP, (loAcc[fam.meta] || 0) + fam.amt);
    });
    for (var lk in loAcc) M[lk] += loAcc[lk];
    if (SIM && SIM.applyMeta) SIM.applyMeta(M);
    return M;
  }
  function doPrestige() {
    if (!SIM || !SIM.canPrestige() || cine) { sfx('lose'); return; }
    metricsMilestone('firstPrestige');
    var gain = SIM.prestigeGain();
    if (window.Retention) Retention.submitScore(GAME, Math.floor(SIM.raw().lifetimeMoney));   // banked peak net worth
    setLegacyBal(legacyBal() + gain);
    if (window.Progress) Progress.addPrestige(GAME, gain);          // lifetime Legacy total (stat)
    if (window.Retention) Retention.set(GAME, 'charters', chartersCount() + 1);   // count of prestiges
    var homeBiome = isUnlocked(biomeId) ? biomeId : 'green';        // stay on the world the player was on, not forced back to green
    computeMeta();                                                  // META now includes any newly-bought-able bonuses
    SIM.resetRun();                                                 // wipe the run; fresh() applies META start bonuses
    founded = {}; saveFounded(); era = 0; if (window.Retention) Retention.set(GAME, 'era', 0);
    closeLegacy();
    buildBiome(homeBiome); if (buildSelector._set) buildSelector._set();
    autoFound();                                                   // re-found the current world so play continues immediately
    updateHUD();
    flashT = 0.9; shakeFX(6, 0.5); sfx('win'); haptic([10, 40, 20, 40]); confettiBurst();
    showHint('New Charter signed — +' + fmt(gain) + ' Legacy banked. Multipliers are permanent!');
  }
  // Prestige is destructive (wipes every harbour's buildings/cash/age), so gate it behind an explicit
  // confirmation that spells out the trade — never wipe on a single click. Reuses the .evm event-modal
  // styling so it matches the rest of the game's dialogs.
  var prestigeConfirmEl = null;
  function confirmPrestige() {
    if (!SIM || !SIM.canPrestige() || cine) { sfx('lose'); return; }
    var gain = SIM.prestigeGain();
    if (!prestigeConfirmEl) {
      prestigeConfirmEl = document.createElement('div'); prestigeConfirmEl.className = 'evm'; prestigeConfirmEl.id = 'prestigeConfirm';
      prestigeConfirmEl.innerHTML = '<div class="ev-card"><div class="ev-ic">📜</div><div class="ev-name">Sign a New Charter?</div>' +
        '<div class="ev-desc" id="pc-desc"></div><div class="ev-btns">' +
        '<button class="ev-btn" id="pc-cancel">Not yet</button><button class="ev-btn primary" id="pc-go"></button></div></div>';
      wrap.appendChild(prestigeConfirmEl);
      var close = function () { prestigeConfirmEl.classList.remove('show'); };
      prestigeConfirmEl.addEventListener('click', function (e) { if (e.target === prestigeConfirmEl) close(); });
      prestigeConfirmEl.querySelector('#pc-cancel').addEventListener('click', function () { close(); sfx('move'); });
      prestigeConfirmEl.querySelector('#pc-go').addEventListener('click', function () { close(); doPrestige(); renderLegacy(); });
    }
    prestigeConfirmEl.querySelector('#pc-desc').innerHTML =
      'This <b>restarts every harbour</b> — all buildings, cash and ages reset to the beginning. ' +
      'In return you bank <b>+' + fmt(gain) + ' ✦ Legacy</b> for <b>permanent</b> multipliers that make every future run faster.' +
      '<br><br>You <b>keep</b>: discovered worlds, all ✦ Legacy, relics, doctrines and achievements.';
    prestigeConfirmEl.querySelector('#pc-go').textContent = 'Sign · +' + fmt(gain) + ' ✦';
    prestigeConfirmEl.classList.add('show'); sfx('score');
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
  function sCell(label, val) { return '<div class="lg-stat"><span class="ls-v">' + val + '</span><span class="ls-l">' + label + '</span></div>'; }
  function renderLegacy() {
    if (!legacyPanel || !SIM) return;
    var p = SIM.state().prestige || { gain: 0, can: false };
    legacyPanel.querySelector('#lg-bal').textContent = '✦ ' + fmt(legacyBal()) + ' Legacy';
    var pres = legacyPanel.querySelector('#lg-prestige');
    var best = (window.Retention ? Retention.best(GAME) : 0) | 0, pc = chartersCount();
    pres.innerHTML = '<div class="lg-pdesc">Cash your empire\'s lifetime earnings into <b>Legacy</b> — a permanent multiplier on every future run.</div>' +
      '<button class="lg-pbtn" id="lg-pbtn"' + (p.can ? '' : ' disabled') + '>' + (p.can ? 'Sign a New Charter  ·  +' + fmt(p.gain) + ' ✦' : 'Reach £' + fmt(p.threshold || 250000) + ' lifetime to prestige') + '</button>' +
      '<div class="lg-stats">Charters signed: ' + pc + (best > 0 ? '  ·  Best empire: £' + fmt(best) : '') + '</div>';
    var tree = legacyPanel.querySelector('#lg-tree'), html = '';
    // Harbour Pass — the free seasonal reward track
    var ss = seasonGet(), maxAt = PASS_TIERS[PASS_TIERS.length - 1].at;
    html += '<div class="lg-sec">🎟️ Harbour Pass · ' + seasonTheme() + ' · ' + seasonDaysLeft() + 'd left</div>';
    html += '<div class="lg-passbar"><i style="width:' + Math.min(100, Math.round((ss.points / maxAt) * 100)) + '%"></i></div>';
    html += '<div class="lg-passpts">' + fmt(ss.points) + ' season points</div>';
    html += '<div class="lg-pass">';
    PASS_TIERS.forEach(function (t, ti) {
      var claimed = ss.claimed.indexOf(ti) >= 0, can = passClaimable(ti);
      html += '<div class="pass-tier' + (claimed ? ' done' : '') + (can ? ' can' : '') + '"' + (can ? ' data-pass="' + ti + '"' : '') + '><span class="pt-at">' + fmt(t.at) + '</span><span class="pt-l">' + t.label + '</span><span class="pt-s">' + (claimed ? '✓' : can ? 'CLAIM' : '') + '</span></div>';
    });
    html += '</div>';
    // ---- Phase 9c: Doctrine — a choose-a-path branch (unlocks at ≥3 charters) ----
    if (doctrineUnlocked()) {
      var doc = doctrineGet(), pcost = doctrinePickCost();
      html += '<div class="lg-sec">Doctrine — choose your path</div><div class="lg-doct">';
      DOCTRINES.forEach(function (d) {
        var on = doc.pick === d.id, canPick = !on && legacyBal() >= pcost;
        html += '<div class="lg-doc' + (on ? ' on' : '') + '"><span class="ld-i">' + d.icon + '</span><span class="ld-n">' + d.name + '</span><span class="ld-d">' + d.desc + '</span>' +
          (on ? '<span class="ld-tag">ACTIVE ✓</span>'
              : '<button class="ld-btn" data-doct="' + d.id + '"' + (canPick ? '' : ' disabled') + '>' + (doc.pick ? 'Respec' : 'Pick') + ' · ✦ ' + pcost + '</button>') +
          '</div>';
      });
      html += '</div>';
      if (doc.pick) {                                                    // capstone row for the active branch
        var dd = doctrineDef(doc.pick), owned9c = !!doc.caps[doc.pick], canCap = !owned9c && legacyBal() >= dd.cap.cost;
        html += '<button class="lg-node lg-cap" data-cap="1"' + ((canCap) ? '' : ' disabled') + '>' +
          '<span class="ln-n">👑 ' + dd.cap.name + (owned9c ? ' <i>OWNED</i>' : '') + '</span><span class="ln-d">' + dd.cap.desc + ' — ' + dd.name + ' capstone</span>' +
          '<span class="ln-c">' + (owned9c ? '✓' : '✦ ' + dd.cap.cost) + '</span></button>';
      }
    }
    html += '<div class="lg-sec">Permanent upgrades</div>';
    LEGACY_TREE.forEach(function (nd) {
      var lv = legacyLvl(nd.id), maxed = lv >= nd.max, can = canBuyLegacy(nd), dis = maxed || !can;
      html += '<button class="lg-node' + (dis ? ' ghosted' : '') + '" data-leg="' + nd.id + '"' + (dis ? ' disabled' : '') + '>' +
        '<span class="ln-n">' + nd.name + ' <i>L' + lv + '</i></span><span class="ln-d">' + nd.desc + '</span>' +
        '<span class="ln-c">' + (maxed ? 'MAX' : (can ? '✦ ' + fmt(legacyNodeCost(nd)) : 'Need ✦' + fmt(legacyNodeCost(nd)))) + '</span></button>';
    });
    // ---- Almanac: stats, blueprint collection, achievements ----
    var st = SIM.state(), stat = st.stats || { storms: 0, shipped: 0, ports: 0 };
    html += '<div class="lg-sec">Empire almanac</div><div class="lg-statgrid">' +
      sCell('Lifetime earned', '£' + fmt(st.lifetimeMoney || 0)) + sCell('Charters signed', '' + pc) +
      sCell('Best empire', best > 0 ? '£' + fmt(best) : '—') + sCell('Ports founded', '' + stat.ports) +
      sCell('Storms survived', '' + (stat.storms || 0)) + sCell('Cargo shipped', fmt(stat.shipped || 0)) +
      sCell('Hazards averted', '' + (stat.averted || 0)) +
      '</div>';
    var owned = ownedBlueprints().length;
    html += '<div class="lg-sec">Blueprints (' + owned + '/' + BLUEPRINTS.length + ')</div>';
    BLUEPRINTS.forEach(function (bp) { var has = window.Progress && Progress.unlocked(GAME, bp.id); html += '<div class="lg-bp' + (has ? '' : ' locked') + '"><span class="bp-n">' + (has ? '📜 ' + bp.name : '🔒 ???') + '</span><span class="bp-d">' + (has ? bp.desc : 'Find in a Legendary crate') + '</span></div>'; });
    var lo = loadoutGet(), loMax = loadoutSlots();
    html += '<div class="lg-sec">Relics (' + relicCount() + '/' + totalRelics() + ') · Loadout ' + lo.length + '/' + loMax + '</div>';
    if (relicCount() > 0) html += '<div class="lg-lohint">Tap an owned relic to equip it — each equipped relic adds its family bonus' + (relicCount() >= 9 ? '' : ' (own 9 relics for a 4th slot)') + '.</div>';
    RELIC_SETS.forEach(function (set) {
      var done = setComplete(set), fam = LOADOUT_BONUS[set.id];
      html += '<div class="lg-relset' + (done ? ' done' : '') + '"><div class="rs-head"><span class="rs-n">' + set.name + '</span><span class="rs-b">' + set.bonus + (done ? ' ✓' : '') + '</span></div>' +
        (fam ? '<div class="rs-each">Equip: ' + fam.label + ' each</div>' : '') + '<div class="rs-dots">';
      set.relics.forEach(function (rn, ri) {
        var id = set.id + ri, has = hasRelic(id), eq = has && lo.indexOf(id) >= 0;
        if (has) html += '<button class="rs-dot on chip' + (eq ? ' eq' : '') + '" data-relic="' + id + '">' + (eq ? '◈ ' : '◆ ') + rn + (eq ? ' ✓' : '') + '</button>';
        else html += '<span class="rs-dot">◇ ???</span>';
      });
      html += '</div></div>';
    });
    var got = 0; ACHIEVEMENTS.forEach(function (a) { if (achOwned(a.id)) got++; });
    html += '<div class="lg-sec">Achievements (' + got + '/' + ACHIEVEMENTS.length + ')</div><div class="lg-achgrid">';
    ACHIEVEMENTS.forEach(function (a) { var has = achOwned(a.id); html += '<div class="lg-ach' + (has ? '' : ' locked') + '">' + (has ? '🏆' : '🔒') + '<span>' + (has ? a.name : '???') + '</span></div>'; });
    html += '</div>';
    tree.innerHTML = html;
    pres.querySelector('#lg-pbtn').addEventListener('click', function () { confirmPrestige(); });
    tree.querySelectorAll('[data-leg]').forEach(function (el) { el.addEventListener('click', function () { if (buyLegacy(el.getAttribute('data-leg'))) { sfx('merge'); haptic(16); renderLegacy(); updateHUD(); } else sfx('lose'); }); });
    tree.querySelectorAll('[data-pass]').forEach(function (el) { el.addEventListener('click', function () { if (claimPass(+el.getAttribute('data-pass'))) renderLegacy(); }); });
    tree.querySelectorAll('[data-doct]').forEach(function (el) { el.addEventListener('click', function () { if (pickDoctrine(el.getAttribute('data-doct'))) { sfx('win'); haptic(22); renderLegacy(); updateHUD(); } else sfx('lose'); }); });
    tree.querySelectorAll('[data-cap]').forEach(function (el) { el.addEventListener('click', function () { if (buyCapstone()) { sfx('win'); haptic([10, 30, 20]); confettiBurst(); renderLegacy(); updateHUD(); } else sfx('lose'); }); });
    tree.querySelectorAll('[data-relic]').forEach(function (el) { el.addEventListener('click', function () { if (equipRelic(el.getAttribute('data-relic'))) { sfx('tap'); haptic(12); renderLegacy(); updateHUD(); } else sfx('lose'); }); });
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
    var today = Retention.todayStr();
    var st = Retention.touchStreak(GAME);                              // advance / read the login streak
    if (Retention.get(GAME, 'fortuneDay', null) !== today && st > 0) showFortune(st);   // claim-gated daily draw
    else showHint('Today: ' + todayTide().name + ' — ' + todayTide().desc);
  }

  // ---- Daily Fortune (Phase 8a): a free once-per-day draw, escalating with the login streak.
  // Ethical: free, generous, claim-gated (not lost if you don't open it), feeds the whole economy. ----
  var fortuneModal = null;
  function ensureFortuneModal() {
    if (fortuneModal) return;
    fortuneModal = document.createElement('div'); fortuneModal.id = 'fortunemodal'; fortuneModal.className = 'evm';
    fortuneModal.innerHTML = '<div class="ev-card"><div class="ev-ic" id="ft-ic">🧭</div><div class="ev-name" id="ft-name"></div><div class="ev-desc" id="ft-desc"></div><div class="ev-btns" id="ft-btns"></div></div>';
    wrap.appendChild(fortuneModal);
  }
  function rollFortune(streak) {
    var s = SIM.state(), r = Math.random(), sb = 1 + Math.min(streak, 14) * 0.15;
    if (r < 0.45) { var cash = Math.round(Math.max(200, (s.lifetimeMoney || 0) * 0.02) * sb); if (SIM.raw()) { SIM.raw().money += cash; SIM.raw().lifetimeMoney = (SIM.raw().lifetimeMoney || 0) + cash; } return { icon: '💰', title: '+£' + fmt(cash), sub: 'Treasury windfall' }; }
    if (r < 0.72) { var lg = Math.max(2, Math.round(streak * 0.7)); setLegacyBal(legacyBal() + lg); computeMeta(); return { icon: '✦', title: '+' + lg + ' Legacy', sub: 'Fortune favours you' }; }
    if (r < 0.90) { var n = streak >= 7 ? 2 : 1; grantCrate(n); return { icon: '🎁', title: n + ' crate' + (n > 1 ? 's' : ''), sub: 'Salvage delivered' }; }
    if (r < 0.97) { seasonAdd(60); return { icon: '🎟️', title: '+60 season points', sub: 'Harbour Pass progress' }; }
    var rel = grantRandomRelic(); if (rel) return { icon: '🏺', title: rel.name, sub: rel.set + (rel.completed ? ' — set complete!' : ''), rel: rel }; var lg2 = 12; setLegacyBal(legacyBal() + lg2); computeMeta(); return { icon: '✦', title: '+' + lg2 + ' Legacy', sub: 'Rare fortune' };
  }
  function showFortune(streak) {
    ensureFortuneModal();
    fortuneModal.querySelector('#ft-ic').textContent = '🧭';
    fortuneModal.querySelector('#ft-name').textContent = 'Daily Fortune';
    fortuneModal.querySelector('#ft-desc').textContent = '🔥 Day ' + streak + ' streak — draw your daily reward!';
    var bw = fortuneModal.querySelector('#ft-btns'); bw.innerHTML = '';
    var draw = document.createElement('button'); draw.className = 'ev-btn primary'; draw.textContent = 'Draw 🎰';
    draw.addEventListener('click', function () { drawFortune(streak); });
    bw.appendChild(draw);
    fortuneModal.classList.add('show'); sfx('score'); haptic(12);
  }
  function drawFortune(streak) {
    if (window.Retention) Retention.set(GAME, 'fortuneDay', Retention.todayStr());
    var rew = rollFortune(streak);
    fortuneModal.querySelector('#ft-ic').textContent = rew.icon;
    fortuneModal.querySelector('#ft-name').textContent = rew.title;
    fortuneModal.querySelector('#ft-desc').textContent = rew.sub;
    var bw = fortuneModal.querySelector('#ft-btns'); bw.innerHTML = '';
    var ok = document.createElement('button'); ok.className = 'ev-btn primary'; ok.textContent = 'Collect';
    ok.addEventListener('click', function () { fortuneModal.classList.remove('show'); }); bw.appendChild(ok);
    sfx('win'); haptic(24); confettiBurst(); var pw = portWorld(); if (pw) burstWorld(pw.x, pw.y, pw.z, { count: 30, colors: ['#ffe08a', '#9ef0b0', '#d9b8ff'], speed: 210, life: 1.1, size: 5 });
    updateHUD();
  }

  // ---- Automation (idle comfort, unlocked via the Legacy tree) ----
  function autoOn(key) { return window.Retention ? !!Retention.get(GAME, key, false) : false; }
  function setAuto(key, v) { if (window.Retention) Retention.set(GAME, key, !!v); }
  var autoT = 0;
  function tickAutomation(dt) {
    if (!simReady()) return; autoT += dt; if (autoT < 1.2) return; autoT = 0;
    if (legacyLvl('auto_repair') > 0 && autoOn('autoRepair')) {     // repair the cheapest affordable damage
      var s = SIM.state(), best = -1, bc = Infinity;
      s.buildings.forEach(function (b) { if (b.hp < 100 && b.rep > 0 && b.rep < bc && s.money >= b.rep) { bc = b.rep; best = b.i; } });
      if (best >= 0) { SIM.repair(best); if (manageOpen) renderManage(); }
    }
    if (legacyLvl('auto_buy') > 0 && autoOn('autoBuy')) {           // buy cheapest upgrade, keeping a 40% reserve
      var s2 = SIM.state(), bi = -1, mc = Infinity, reserve = s2.money * 0.4;
      s2.buildings.forEach(function (b) { if (SIM.canUpgrade(b.i) && b.up < mc && b.up <= reserve) { mc = b.up; bi = b.i; } });
      if (bi >= 0) { SIM.upgrade(bi); if (manageOpen) renderManage(); updateHUD(); }
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
  function crateOpenedFlag() { return !!(window.Retention && Retention.get(GAME, 'crateOpened', false)); }
  function setCrates(n) { if (window.Retention) Retention.set(GAME, 'crates', Math.max(0, n | 0)); }
  function grantCrate(n) { n = n || 1; setCrates(crateCount() + n); metricsMilestone('firstCrate'); if (crateBtn) crateBtn.classList.add('bump'); setTimeout(function () { crateBtn && crateBtn.classList.remove('bump'); }, 400); announceFeature('crate', '🎁', 'Salvage Crate!', 'Tap 🎁 in the bottom bar to open it.'); }
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
      else { var rel = grantRandomRelic(); if (rel) { title = '🏺 ' + rel.name; sub = rel.set + (rel.completed ? ' — set complete!' : ''); } else { var jp = 15 + Math.floor(Math.random() * 25); setLegacyBal(legacyBal() + jp); title = '+' + jp + ' ✦ Legacy'; sub = 'Jackpot!'; } }
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
      if (window.Retention && !Retention.get(GAME, 'crateOpened', false)) Retention.set(GAME, 'crateOpened', true);
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

  // ---- Captain's Bonus (Phase 12a): opt-in rewarded boost via the pluggable window.ADS provider.
  // Ethics are hard requirements — opt-in only (never auto-opens), never gates progress, declining
  // changes nothing, no nagging (button just quietly hides once the daily cap is hit). The stub
  // provider (ads.js) grants it free with a short charm delay; a future portal adapter swaps in a
  // real rewarded ad behind the exact same showRewarded() call — zero changes here. ----
  var BONUS_MULT = 2, BONUS_SECS = 600, BONUS_MAX_SECS = 900;   // 2× for 10 min; stacked durations cap at 15 min
  var bonusModal = null, bonusBusy = false, bonusChipActive = false, adsReady = false, bonusBtn = null, bonusChip = null, bonusWasActive = false;
  function initAds() {
    try {
      if (window.ADS && typeof window.ADS.init === 'function') window.ADS.init(function () { adsReady = true; updateHUD(); });
    } catch (e) { adsReady = false; }
  }
  function adsAvailable() {
    try { return !!(adsReady && window.ADS && typeof window.ADS.rewardedAvailable === 'function' && window.ADS.rewardedAvailable()); }
    catch (e) { return false; }
  }
  function bonusEligible() { return simReady() && adsAvailable() && SIM.boostT() <= 0; }
  function bonusUsedToday() { var d = window.Retention && Retention.get(GAME, 'bonusDay', null), t = window.Retention && Retention.todayStr(); return (d && d.date === t) ? (d.count | 0) : 0; }
  function clockFmt(s) { s = Math.max(0, Math.ceil(s)); var m = Math.floor(s / 60), ss = s % 60; return m + ':' + (ss < 10 ? '0' : '') + ss; }
  function ensureBonusModal() {
    if (bonusModal) return;
    bonusModal = document.createElement('div'); bonusModal.id = 'bonusmodal'; bonusModal.className = 'evm';
    bonusModal.innerHTML = '<div class="ev-card"><div class="ev-ic">⚓</div><div class="ev-name">Captain’s Bonus</div><div class="ev-desc" id="bn-desc"></div><div class="ev-btns" id="bn-btns"></div></div>';
    wrap.appendChild(bonusModal);
  }
  function resetBonusCard() {
    bonusBusy = false;
    bonusModal.querySelector('#bn-desc').textContent = 'Captain’s Bonus — 2× production for 10 minutes.';
    var bw = bonusModal.querySelector('#bn-btns'); bw.innerHTML = '';
    var no = document.createElement('button'); no.className = 'ev-btn'; no.textContent = 'No thanks'; no.setAttribute('data-bonus', 'decline');
    no.addEventListener('click', declineBonus);
    var yes = document.createElement('button'); yes.className = 'ev-btn primary'; yes.textContent = 'Claim ⚓'; yes.setAttribute('data-bonus', 'claim');
    yes.addEventListener('click', claimBonusFlow);
    bw.appendChild(no); bw.appendChild(yes);
  }
  function openBonusCard() {
    if (!bonusEligible()) return;   // never auto-opens; only reachable via the button, only when eligible
    ensureBonusModal(); resetBonusCard();
    bonusModal.classList.add('show'); sfx('tap'); haptic(8);
  }
  function closeBonusCard() { if (bonusModal) bonusModal.classList.remove('show'); }
  function declineBonus() { closeBonusCard(); }   // opt-out: no penalty, nothing changes, nothing persisted
  function claimBonusFlow() {
    if (bonusBusy || !bonusModal) return;
    bonusBusy = true;
    var bw = bonusModal.querySelector('#bn-btns'), yes = bw.querySelector('[data-bonus="claim"]'), no = bw.querySelector('[data-bonus="decline"]');
    if (yes) { yes.disabled = true; yes.textContent = 'Loading…'; }
    if (no) no.disabled = true;
    try { window.ADS.showRewarded(onBonusReward, onBonusFail); }
    catch (e) { onBonusFail(); }
  }
  function onBonusReward() {
    bonusBusy = false;
    metricsMilestone('firstBonus');
    // stacking policy: if a boost is already running (e.g. a crate-surge ambient event fired while
    // the reward was in flight), take the higher multiplier and extend the duration, capped at 15 min,
    // rather than clobbering whichever one happened to land first.
    var mult = Math.max(SIM.boostMul(), BONUS_MULT), secs = Math.min(BONUS_MAX_SECS, SIM.boostT() + BONUS_SECS);
    SIM.setBoost(mult, secs);
    bonusChipActive = true;
    bonusWasActive = true;   // v89: mark so updateHUD can announce "ready again" when the boost later expires
    if (bonusBtn) bonusBtn.style.display = 'none';   // v89: hide the ⚓ Bonus button THE INSTANT it's claimed (don't wait for the next updateHUD)
    closeBonusCard();
    var pw = portWorld(); if (pw) { popWorld(pw.x, pw.y + 7, pw.z, '⚓ 2× production!', { color: '#7fe0d6', size: 18, life: 1.6, vy: -50 }); burstWorld(pw.x, pw.y, pw.z, { count: 30, colors: ['#7fe0d6', '#ffe08a', '#ffffff'], speed: 210, life: 1.1, size: 5 }); }
    sfx('win'); haptic(24); confettiBurst();
    showHint('⚓ Captain’s Bonus CLAIMED — ' + Math.round(mult) + '× production for ' + clockFmt(secs) + '!');   // v89: unambiguous "claimed" wording + live duration
    updateHUD();
  }
  function onBonusFail() { bonusBusy = false; closeBonusCard(); }   // decline / no-fill / cap race — state left exactly as before

  // ---- Phase 17a: Empire Timeline — tapping the era pill opens a compact horizontal age ribbon:
  // one node per curated age (icon + name), filled once reached, the current age pulsing, future
  // ages ghosted with a one-line teaser, and a trailing "∞" node for the endless roman-numeral tail
  // past Neon Horizon. Reached nodes just say "Reached" (no per-era timestamp is persisted, so this
  // is the "otherwise just state" fallback) — the current node is called out separately. Full-screen
  // backdrop like #cratemodal so a tap outside the card closes it, same as ✕.
  var ERA_META = [
    { icon: '🎣', teaser: 'Nets and driftwood docks — where every empire starts.' },
    { icon: '⚓', teaser: 'The first market stalls open along the quay.' },
    { icon: '🏭', teaser: 'Steam, sawdust and the first cargo cranes.' },
    { icon: '🏙️', teaser: 'A skyline rises over the harbour.' },
    { icon: '🚢', teaser: 'Container giants dock round the clock.' },
    { icon: '🌐', teaser: 'Trade routes span the whole map.' },
    { icon: '🤖', teaser: 'Robots run the docks — you run the empire.' },
    { icon: '🌆', teaser: 'Glass, light and fusion power — the harbour of tomorrow.' }
  ];
  function timelineNodeHtml(i, cur) {
    var meta = ERA_META[i] || { icon: '❔', teaser: '' }, name = SIM.eraName(i);
    var state = i < cur ? 'reached' : i === cur ? 'current' : 'future';
    var sub = state === 'current' ? 'Current age' : state === 'reached' ? 'Reached' : meta.teaser;
    return '<div class="tl-node ' + state + '"><div class="tl-ic">' + meta.icon + '</div><div class="tl-name">' + name + '</div><div class="tl-sub">' + sub + '</div></div>';
  }
  function renderTimeline() {
    if (!timelineStrip || !SIM || !SIM.raw()) return;
    var cur = SIM.raw().era, total = SIM.ERAS.length, html = '';
    for (var i = 0; i < total; i++) html += timelineNodeHtml(i, cur);
    var pastLadder = cur >= total;   // in the endless roman-numeral tail past Neon Horizon
    html += '<div class="tl-node tl-tail ' + (pastLadder ? 'current' : 'future') + '"><div class="tl-ic">∞</div>' +
      '<div class="tl-name">' + (pastLadder ? SIM.eraName(cur) : 'Beyond') + '</div>' +
      '<div class="tl-sub">The climb continues, forever.</div></div>';
    timelineStrip.innerHTML = html;
    var live = timelineStrip.querySelector('.tl-node.current'); if (live && live.scrollIntoView) live.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  function ensureTimelinePanel() {
    if (timelinePanel) return;
    timelinePanel = document.createElement('div'); timelinePanel.id = 'timelinepanel';
    timelinePanel.innerHTML = '<div class="tl-card"><div class="tl-head"><span class="tl-title">Empire Timeline</span><button class="tl-close" id="tl-close">✕</button></div><div class="tl-strip" id="tl-strip"></div></div>';
    wrap.appendChild(timelinePanel);
    timelineStrip = timelinePanel.querySelector('#tl-strip');
    timelinePanel.addEventListener('click', function (e) { if (e.target === timelinePanel) closeTimeline(); });
    timelinePanel.querySelector('#tl-close').addEventListener('click', closeTimeline);
  }
  function openTimeline() {
    if (!simReady()) return;
    ensureTimelinePanel(); timelineOpen = true; timelinePanel.classList.add('show'); renderTimeline(); sfx('tap'); haptic(10);
    announceFeature('timeline', '🕰️', 'Empire Timeline', 'Tap the era pill anytime to see how far you’ve come — and what’s next.');
  }
  function closeTimeline() { timelineOpen = false; if (timelinePanel) timelinePanel.classList.remove('show'); }
  function toggleTimeline() { if (timelineOpen) closeTimeline(); else openTimeline(); }

  function buildEconUI() {
    econHud = document.createElement('div'); econHud.id = 'econhud';
    function chip(id, icon) { var s = document.createElement('span'); s.className = 'estat'; s.innerHTML = '<b>' + icon + '</b><i id="' + id + '">0</i>'; econHud.appendChild(s); return s.querySelector('i'); }
    hudMoney = chip('e-money', '£'); hudFish = chip('e-fish', 'Fish'); hudPop = chip('e-pop', 'Crew');
    var eraPill = document.getElementById('era-pill'); if (eraPill) eraPill.addEventListener('click', toggleTimeline);   // Phase 17a: era pill opens the age timeline
    muteBtn = document.createElement('button'); muteBtn.id = 'mutebtn'; muteBtn.textContent = muted ? '♪̸' : '♪'; muteBtn.title = 'Sound'; muteBtn.classList.toggle('off', muted);
    muteBtn.addEventListener('click', function () { applyMuted(!muted); sfx('tap'); });
    if (window.Juice) Juice.Audio.setMuted(muted);
    setBtn = document.createElement('button'); setBtn.id = 'setbtn'; setBtn.textContent = '⚙'; setBtn.title = 'Settings';
    setBtn.addEventListener('click', toggleSettings);
    var mBtn = document.createElement('button'); mBtn.id = 'managebtn'; mBtn.textContent = 'Manage port'; mBtn.addEventListener('click', toggleManage);
    var nBtn = document.createElement('button'); nBtn.id = 'netbtn'; nBtn.textContent = 'Trade network'; nBtn.addEventListener('click', openTrade);
    legacyBtn = document.createElement('button'); legacyBtn.id = 'legacybtn'; legacyBtn.textContent = '✦ Legacy'; legacyBtn.style.display = 'none'; legacyBtn.addEventListener('click', openLegacy);
    crateBtn = document.createElement('button'); crateBtn.id = 'cratebtn'; crateBtn.textContent = '🎁'; crateBtn.style.display = 'none'; crateBtn.addEventListener('click', openCrate);
    expBtn = document.createElement('button'); expBtn.id = 'expbtn'; expBtn.textContent = '⛵ Expeditions'; expBtn.addEventListener('click', toggleExp);
    registryBtn = document.createElement('button'); registryBtn.id = 'registrybtn'; registryBtn.textContent = '🚢 Registry'; registryBtn.style.display = 'none'; registryBtn.addEventListener('click', toggleRegistry);
    advBtn = document.createElement('button'); advBtn.id = 'advbtn'; advBtn.textContent = 'Advance era'; advBtn.style.display = 'none'; advBtn.addEventListener('click', doAdvance);
    bonusBtn = document.createElement('button'); bonusBtn.id = 'bonusbtn'; bonusBtn.textContent = '⚓ Bonus'; bonusBtn.style.display = 'none'; bonusBtn.addEventListener('click', openBonusCard);
    // top row: resource chips + a live countdown chip (while active) + mute + settings, keeps it short
    bonusChip = document.createElement('span'); bonusChip.className = 'estat bonuschip'; bonusChip.id = 'bonuschip'; bonusChip.style.display = 'none';
    econHud.appendChild(bonusChip);
    econHud.appendChild(muteBtn); econHud.appendChild(setBtn);
    wrap.appendChild(econHud);
    // bottom action bar: the primary buttons, thumb-reachable, so the top never overflows
    actionBar = document.createElement('div'); actionBar.id = 'actionbar';
    actionBar.appendChild(advBtn); actionBar.appendChild(nBtn); actionBar.appendChild(expBtn); actionBar.appendChild(registryBtn); actionBar.appendChild(legacyBtn); actionBar.appendChild(crateBtn); actionBar.appendChild(bonusBtn); actionBar.appendChild(mBtn);
    wrap.appendChild(actionBar);

    // always-visible era progress bar (goal-gradient carrot)
    eraBar = document.createElement('div'); eraBar.id = 'erabar';
    eraBar.innerHTML = '<div class="eb-fill"></div><div class="eb-label"></div><div class="eb-need"></div>';
    wrap.appendChild(eraBar);

    // guided objective banner — the "what next" carrot that makes early progress legible
    goalBanner = document.createElement('div'); goalBanner.id = 'goalbar';
    goalBanner.innerHTML = '<span class="gb-tick">◎</span><span class="gb-text"></span><span class="gb-rew"></span>';
    wrap.appendChild(goalBanner);

    raceBanner = document.createElement('div'); raceBanner.id = 'racebar';
    raceBanner.innerHTML = '<span class="rb-txt"></span><span class="rb-cd"></span>';
    wrap.appendChild(raceBanner);

    managePanel = document.createElement('div'); managePanel.id = 'managepanel';
    wrap.appendChild(managePanel);

    settingsPanel = document.createElement('div'); settingsPanel.id = 'settingspanel';
    wrap.appendChild(settingsPanel);

    expPanel = document.createElement('div'); expPanel.id = 'exppanel';
    wrap.appendChild(expPanel);

    registryPanel = document.createElement('div'); registryPanel.id = 'registrypanel';
    wrap.appendChild(registryPanel);
    updateHUD();
  }

  var BUILD_TAG = 'v84';

  // ---- Phase 12b: error capture — a small ring buffer (last 20) of uncaught errors and
  // unhandled promise rejections, persisted write-through to localStorage so a real bug report
  // can quote it. Every path here is try/catch-guarded and must never itself throw. The listeners
  // are installed only after boot() has fully succeeded (see the end of boot()) so we never catch
  // the test harness's own intentional in-page throws during earlier init/setup. ----
  var ERRLOG_KEY = 'gf:' + GAME + ':errlog', ERRLOG_MAX = 20;
  var errLog = [];
  function loadErrLog() {
    try {
      var raw = localStorage.getItem(ERRLOG_KEY), arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) errLog = arr;
    } catch (e) {}
  }
  function saveErrLog() { try { localStorage.setItem(ERRLOG_KEY, JSON.stringify(errLog)); } catch (e) {} }
  function logError(msg, src, line) {
    try {
      errLog.push({ t: Date.now(), msg: String(msg == null ? '' : msg).slice(0, 500), src: String(src == null ? '' : src).slice(0, 300), line: line | 0 });
      if (errLog.length > ERRLOG_MAX) errLog.splice(0, errLog.length - ERRLOG_MAX);
      saveErrLog();
      if (settingsOpen) renderSettings();
    } catch (e) {}
  }
  function copyAndClearErrLog() {
    try {
      var txt = JSON.stringify(errLog);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).catch(function () {});
    } catch (e) {}
    errLog = [];
    try { localStorage.removeItem(ERRLOG_KEY); } catch (e) {}
    renderSettings();
  }
  function installErrorCapture() {
    try {
      loadErrLog();
      window.addEventListener('error', function (e) {
        try { logError(e && e.message, e && e.filename, e && e.lineno); } catch (x) {}
      });
      window.addEventListener('unhandledrejection', function (e) {
        try {
          var r = e && e.reason, msg = (r && r.message) ? r.message : String(r);
          logError(msg, '', 0);
        } catch (x) {}
      });
    } catch (e) {}
  }

  // ---- Phase 12b: portal lifecycle events — thin, always-guarded wrappers over the optional
  // window.ADS.{loadingFinished,gameplayStart,gameplayStop} hooks so callers never need their own
  // try/catch. No-ops (beyond bookkeeping) in the stub provider; a real portal adapter maps these
  // onto its SDK's loading/gameplay brackets. ----
  function adsLoadingFinished() { try { if (window.ADS && typeof window.ADS.loadingFinished === 'function') window.ADS.loadingFinished(); } catch (e) {} }
  function adsGameplayStart() { try { if (window.ADS && typeof window.ADS.gameplayStart === 'function') window.ADS.gameplayStart(); } catch (e) {} }
  function adsGameplayStop() { try { if (window.ADS && typeof window.ADS.gameplayStop === 'function') window.ADS.gameplayStop(); } catch (e) {} }

  function toggleSettings() {
    settingsOpen = !settingsOpen;
    if (settingsOpen) { if (manageOpen) { manageOpen = false; managePanel.classList.remove('show'); } if (expOpen) { expOpen = false; expPanel.classList.remove('show'); } if (registryOpen) { registryOpen = false; registryPanel.classList.remove('show'); } }
    settingsPanel.classList.toggle('show', settingsOpen);
    resetArm = false;
    if (settingsOpen) { renderSettings(); sfx('tap'); haptic(8); }
  }
  function renderSettings() {
    if (!settingsPanel) return;
    var streak = (window.Retention && Retention.streak) ? Retention.streak(GAME) : 0;
    var charters = chartersCount(), leg = legacyBal();
    var h = '<div class="mp-head">Settings<button id="set-close">✕</button></div>';
    h += '<div class="mp-sec">Audio & feedback</div><div class="mp-grid">';
    h += '<button class="mp-item auto' + (!muted ? ' on' : '') + '" data-set="sound"><span class="mi-n">Sound</span><span class="mi-c">' + (muted ? 'OFF' : 'ON') + '</span></button>';
    h += '<button class="mp-item auto' + (!musicOff ? ' on' : '') + '" data-set="music"><span class="mi-n">Music</span><span class="mi-c">' + (musicOff ? 'OFF' : 'ON') + '</span></button>';
    h += '<button class="mp-item auto' + (!hapticsOff ? ' on' : '') + '" data-set="haptics"><span class="mi-n">Vibration</span><span class="mi-c">' + (hapticsOff ? 'OFF' : 'ON') + '</span></button>';
    h += '<button class="mp-item auto' + (postEnabled() ? ' on' : '') + '" data-set="post"><span class="mi-n">✂️ Papercraft</span><span class="mi-c">' + (postEnabled() ? 'ON' : 'OFF') + '</span></button>';
    h += '</div>';
    // Phase 15b: pace — Relaxed (default) spaces storms/events further apart; Lively is the original feel.
    h += '<div class="mp-sec">Pace</div><div class="mp-grid">';
    h += '<button class="mp-item auto' + (paceMode === 'relaxed' ? ' on' : '') + '" data-set="pace-relaxed"><span class="mi-n">🌤 Relaxed</span><span class="mi-c">' + (paceMode === 'relaxed' ? 'ON' : 'Pick') + '</span></button>';
    h += '<button class="mp-item auto' + (paceMode === 'lively' ? ' on' : '') + '" data-set="pace-lively"><span class="mi-n">⚡ Lively</span><span class="mi-c">' + (paceMode === 'lively' ? 'ON' : 'Pick') + '</span></button>';
    h += '</div><div class="set-help">Relaxed spreads out storms and events. Economy speed is unchanged.</div>';
    // Difficulty (Easy→Extreme): harder tiers slow income + ramp storms/raids so idling can't keep up
    // and active defense/economy play becomes necessary; harder banks more Legacy on prestige.
    h += '<div class="mp-sec">Difficulty</div><div class="mp-grid">';
    (SIM && SIM.difficulty ? SIM.difficulty().tiers : []).forEach(function (d) {
      var on = d.id === diffMode;
      h += '<button class="mp-item auto' + (on ? ' on' : '') + '" data-set="diff-' + d.id + '"><span class="mi-n">' + d.name + '</span><span class="mi-d">' + d.desc + '</span><span class="mi-c">' + (on ? 'ON' : (d.prestigeMul > 1 ? '+' + Math.round((d.prestigeMul - 1) * 100) + '% ✦' : 'Pick')) + '</span></button>';
    });
    h += '</div><div class="set-help">Harder tiers slow income and bring more storms &amp; raids — you’ll lean on sea walls, a navy and trade routes to survive — and bank more ✦ Legacy when you sign a charter. Best chosen at the start of a run.</div>';
    // Phase 15d: Harbourmaster's Tips — a single ON/OFF toggle (default ON), following the Pace
    // section immediately above it. OFF makes tickTips() a hard no-op (no other state changes).
    h += '<div class="mp-sec">Tips</div><div class="mp-grid">';
    h += '<button class="mp-item auto' + (tipsEnabled() ? ' on' : '') + '" data-set="tips"><span class="mi-n">💡 Harbourmaster tips</span><span class="mi-c">' + (tipsEnabled() ? 'ON' : 'OFF') + '</span></button>';
    h += '</div><div class="set-help">Occasional contextual nudges when something needs attention — mute anytime.</div>';
    h += '<div class="mp-sec">How to play</div>';
    h += '<div class="set-help">⚓ Tap the glowing harbour, then <b>Found village</b>.<br>' +
         '🏗️ <b>Manage port</b> to build &amp; upgrade — huts catch fish, cottages house crew, markets sell.<br>' +
         '📈 Fill the <b>era bar</b> (cash + required buildings) to <b>Advance</b> to bigger eras.<br>' +
         '🚢 <b>Trade network</b> links your ports into routes for passive income.<br>' +
         '⛵ <b>Expeditions</b> send ships on timed voyages — they pay out even while you’re away.<br>' +
         '🧭 <b>Uncharted Waters</b> (in Expeditions) discovers new coasts to found — founding a colony after your first costs a fee.<br>' +
         '🏺 <b>Relics</b> drop from crates &amp; voyages — equip a <b>Loadout</b> in Legacy for permanent perks.<br>' +
         '🌊 Storms damage buildings — repair them in Manage.<br>' +
         '🏴‍☠️ <b>Baron Krall</b> challenges you to races — beat him for prizes &amp; bragging rights.<br>' +
         '🎟️ The <b>Harbour Pass</b> earns free season rewards from everything you do.<br>' +
         '✦ When growth slows, <b>Legacy</b> lets you prestige for permanent multipliers.<br>' +
         '🧭 At 3+ charters, pick a <b>Doctrine</b> in Legacy to specialise your run.<br>' +
         '🖐️ <b>PC:</b> drag to pan · scroll wheel to zoom · right-drag (or Shift+drag) to rotate.<br>' +
         '📱 <b>Mobile:</b> drag to pan · pinch to zoom · two-finger twist to rotate.</div>';
    h += '<div class="mp-sec">About</div>';
    h += '<div class="set-about">Port Boss · build ' + BUILD_TAG +
         (streak > 1 ? ' · 🔥 ' + streak + '-day streak' : '') +
         (charters > 0 ? ' · ' + charters + ' charter' + (charters > 1 ? 's' : '') : '') +
         (leg > 0 ? ' · ✦' + fmt(leg) + ' Legacy' : '') + '</div>';
    // Phase 13d: one muted line — players like seeing it, and it doubles as our local debug view
    var metricsLine = metricsAboutLine();
    if (metricsLine) h += '<div class="set-about">' + metricsLine + '</div>';
    // Phase 12b: portal builds get no external links and no PWA install prompt (both disallowed
    // by portal hosts) — just a plain version line instead of the privacy/install row.
    if (PORTAL_MODE) {
      h += '<div class="set-about set-portal-ver">Port Boss ' + BUILD_TAG + '</div>';
    } else {
      h += '<div class="mp-grid"><a class="mp-item set-link" href="../../privacy.html" target="_blank" rel="noopener"><span class="mi-n">Privacy policy</span><span class="mi-c">↗</span></a>' +
           '<button class="mp-item set-link" data-set="install"><span class="mi-n">Add to home screen</span><span class="mi-c">⤓</span></button></div>';
    }
    // Phase 12b: error capture — only a nudge when something's actually been logged, one tap
    // copies the JSON to the clipboard and clears the buffer (no separate viewer needed).
    if (errLog.length > 0) {
      h += '<div class="mp-grid"><button class="mp-item set-link" data-set="errlog"><span class="mi-n">⚠ ' +
           errLog.length + ' issue' + (errLog.length > 1 ? 's' : '') + ' logged</span><span class="mi-c">tap to copy</span></button></div>';
    }
    h += '<div class="mp-sec">Danger zone</div>';
    h += '<button class="mp-item set-reset' + (resetArm ? ' arm' : '') + '" data-set="reset"><span class="mi-n">' +
         (resetArm ? 'Tap again to wipe everything' : 'Reset all progress') + '</span><span class="mi-c">' + (resetArm ? '⚠' : '↺') + '</span></button>';
    settingsPanel.innerHTML = h;
    settingsPanel.querySelector('#set-close').addEventListener('click', toggleSettings);
    settingsPanel.querySelectorAll('[data-set]').forEach(function (el) {
      el.addEventListener('click', function () {
        var a = el.getAttribute('data-set');
        if (a === 'sound') { applyMuted(!muted); sfx('tap'); haptic(8); }
        else if (a === 'music') { applyMusicOff(!musicOff); sfx('tap'); haptic(8); renderSettings(); }
        else if (a === 'haptics') { applyHaptics(!hapticsOff); haptic(12); renderSettings(); }
        else if (a === 'post') { setPost(!postEnabled(), true); sfx('tap'); haptic(8); }
        else if (a === 'pace-relaxed') { applyPace('relaxed'); sfx('tap'); haptic(8); }
        else if (a === 'pace-lively') { applyPace('lively'); sfx('tap'); haptic(8); }
        else if (a.indexOf('diff-') === 0) { applyDifficulty(a.slice(5)); sfx('tap'); haptic(10); renderSettings(); }
        else if (a === 'tips') { setTipsEnabled(!tipsEnabled()); sfx('tap'); haptic(8); renderSettings(); }
        else if (a === 'install') { promptInstall(); }
        else if (a === 'errlog') { copyAndClearErrLog(); sfx('tap'); haptic(8); }
        else if (a === 'reset') {
          if (!resetArm) { resetArm = true; haptic(20); renderSettings(); setTimeout(function () { resetArm = false; if (settingsOpen) renderSettings(); }, 4000); }
          else { resetProgress(); }
        }
      });
    });
  }
  function resetProgress() {
    try {
      var rm = [], pre = 'gf:' + GAME + ':';
      for (var i = 0; i < localStorage.length; i++) { var key = localStorage.key(i); if (key && key.indexOf(pre) === 0) rm.push(key); }
      rm.forEach(function (key) { localStorage.removeItem(key); });
    } catch (e) {}
    try { if (window.Juice) Juice.Audio.play('lose'); } catch (e) {}
    location.reload();
  }
  // PWA install: use the captured beforeinstallprompt event when available. Suppressed entirely
  // in portal mode — portals disallow PWA install prompts inside their embed (Phase 12b).
  var deferredPrompt = null;
  if (!PORTAL_MODE) {
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; });
  }
  function promptInstall() {
    if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.finally(function () { deferredPrompt = null; }); }
    else { showHint('Use your browser menu → “Add to Home Screen” to install Port Boss'); }
  }

  // ---- Phase 13d: local fun-funnel metrics — a tiny, privacy-safe launch-analytics instrument.
  // Zero network, zero PII: one record in the existing Retention store per device (never leaves
  // it — see LAUNCH-KPIS.md for why local-only is fine for the funnel half of the scorecard).
  // Tracks: sessions (once per boot), totalPlayMs (accumulated only while the tab is visible —
  // hooked off the existing visibilitychange listener, persisted every ~30s and on hide), and
  // first-time milestone timestamps (ms since this device's first-ever session) for the funnel:
  // firstBuild, firstEra, firstCrate, firstVoyage, firstPrestige, firstBonus. Every entry point
  // is try/catch-guarded — a metrics bug must never throw into gameplay — and writes are
  // throttled via a dirty flag + min interval so we're not hammering localStorage every frame.
  var METRICS_KEY = 'metrics', METRICS_SAVE_MS = 30000;
  var metrics = null, metricsDirty = false, metricsLastSave = 0, metricsVisibleSince = null;
  function metricsDefaults() {
    return { sessions: 0, totalPlayMs: 0, firstSeen: null, firstBuild: null, firstEra: null, firstCrate: null, firstVoyage: null, firstPrestige: null, firstBonus: null };
  }
  function metricsSave(force) {
    try {
      if (!metrics || !window.Retention) return;
      var now = Date.now();
      if (!force && (!metricsDirty || now - metricsLastSave < METRICS_SAVE_MS)) return;
      Retention.set(GAME, METRICS_KEY, metrics);
      metricsLastSave = now; metricsDirty = false;
    } catch (e) {}
  }
  function metricsFlushPlaytime() {
    try {
      if (!metrics || metricsVisibleSince == null) return;
      var now = Date.now(), dt = now - metricsVisibleSince;
      metricsVisibleSince = now;
      if (dt > 0) { metrics.totalPlayMs = (metrics.totalPlayMs || 0) + dt; metricsDirty = true; }
    } catch (e) {}
  }
  function metricsInit() {
    try {
      if (!window.Retention) return;
      var m = Retention.get(GAME, METRICS_KEY, null);
      if (!m || typeof m !== 'object') m = {};
      var d = metricsDefaults(); for (var k in d) if (!(k in m)) m[k] = d[k];   // future-proof: fill any missing keys
      metrics = m;
      metrics.sessions = (metrics.sessions | 0) + 1;
      if (!metrics.firstSeen) metrics.firstSeen = Date.now();
      metricsVisibleSince = (typeof document !== 'undefined' && document.hidden) ? null : Date.now();
      metricsDirty = true; metricsSave(true);
      setInterval(function () { metricsFlushPlaytime(); metricsSave(false); }, METRICS_SAVE_MS);   // periodic ~30s flush while open
    } catch (e) {}
  }
  function metricsVisibility(hidden) {
    try {
      if (!metrics) return;
      if (hidden) { metricsFlushPlaytime(); metricsVisibleSince = null; metricsSave(true); }   // persist on hide
      else metricsVisibleSince = Date.now();
    } catch (e) {}
  }
  function metricsMilestone(key) {
    try {
      if (!metrics || metrics[key]) return;   // first-time-only latch
      metrics[key] = Date.now() - (metrics.firstSeen || Date.now());
      metricsDirty = true; metricsSave(true);
    } catch (e) {}
  }
  function metricsSnapshot() {
    try {
      if (!metrics) return null;
      metricsFlushPlaytime();
      var out = {}; for (var k in metrics) out[k] = metrics[k];
      out.avgSessionMin = metrics.sessions > 0 ? Math.round((metrics.totalPlayMs / 60000 / metrics.sessions) * 10) / 10 : 0;
      return out;
    } catch (e) { return null; }
  }
  function metricsAboutLine() {   // one muted Settings/About line — also doubles as our debug view
    try {
      var snap = metricsSnapshot(); if (!snap) return null;
      var mins = Math.floor(snap.totalPlayMs / 60000), h = Math.floor(mins / 60), m = mins % 60;
      return 'Sessions: ' + snap.sessions + ' · playtime: ' + h + 'h ' + m + 'm';
    } catch (e) { return null; }
  }

  function updateHUD() {
    if (!econHud) return;
    var on = simReady();
    econHud.classList.toggle('show', on); if (actionBar) actionBar.classList.toggle('show', on && !cine);
    if (eraBar) eraBar.classList.toggle('show', on && !cine);
    if (!on) { if (managePanel) managePanel.classList.remove('show'); if (settingsPanel) { settingsPanel.classList.remove('show'); settingsOpen = false; } if (expPanel) { expPanel.classList.remove('show'); expOpen = false; } if (registryPanel) { registryPanel.classList.remove('show'); registryOpen = false; } if (raceBanner) raceBanner.classList.remove('show'); return; }
    // a founded port is the moment Expeditions become relevant — the button already exists (in actionBar)
    announceFeature('exp', '⛵', 'Expeditions', 'Send ships on voyages; they return even while you’re away.');
    if (chartersCount() >= DOCTRINE_UNLOCK) announceFeature('doctrine', '🧭', 'Doctrines', 'Pick a path in the Legacy panel.');
    pumpAnnounceQueue();   // retry any announce that was deferred while a modal owned input
    var s = SIM.state();
    hudFish.textContent = fmt(s.res.fish); hudPop.textContent = fmt(s.pop);
    if (hudFish.parentNode) hudFish.parentNode.classList.toggle('full', s.res.fish >= s.caps.fish * 0.98);  // storage-full nudge
    var pill = document.getElementById('era-pill'); if (pill) pill.textContent = s.eraName;
    advBtn.style.display = s.canAdvance ? '' : 'none';
    advBtn.textContent = s.nextEra ? 'Advance → ' + s.nextEra : 'Advance era';
    // era progress bar — eraReq() (not the raw ERA_REQ table) so the endless tail past the curated
    // ladder still shows real progress instead of a premature "Max era" once you outrun ERA_REQ.length
    // (this was already silently true from Global Hub onward before Phase 17a; now it'd misfire one
    // age later at Neon Horizon — fixed here rather than pushed further down the road).
    var req = SIM.eraReq(s.era);
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
    handleEvent(s);
    handleNavyRepel(s);
    updateRaceBanner();
    maybeTriggerRival(s);
    checkAchievements(s);
    trackDaily(s);
    if (scene.port && ambient && Math.abs((s.buildings ? s.buildings.length : 0) - (ambient.dev || 0)) >= 3) ambient = null;   // refresh harbour traffic as you grow
    // reveal the Legacy button once prestige is relevant; pulse when a prestige is available
    if (legacyBtn) { var lp = s.prestige || { can: false }; var show = lp.can || legacyBal() > 0; legacyBtn.style.display = show ? '' : 'none'; legacyBtn.classList.toggle('ready', lp.can && !legacyOpen); if (lp.can) announceFeature('prestige', '✦', 'Legacy', 'Sign a new charter to restart stronger, forever.'); }
    if (crateBtn) { var nc = crateCount(); crateBtn.style.display = nc > 0 ? '' : 'none'; crateBtn.setAttribute('data-n', nc); }
    if (expBtn) { var rd = (s.voyages && s.voyages.ready) || 0; expBtn.classList.toggle('hasready', rd > 0); expBtn.setAttribute('data-n', rd); }
    // Phase 17b: Registry becomes relevant once there's a tier worth buying — era 1+ (tier0 is
    // free and every ladder needs era>=1 for its first upgrade) — announced once, same pattern as
    // Legacy/Captain's Bonus above.
    if (registryBtn) {
      var regShow = s.era >= 1;
      registryBtn.style.display = regShow ? '' : 'none';
      if (regShow) announceFeature('registry', '🚢', 'Harbour Registry', 'Buy modern ships as the ages turn — commission upgrades in the Registry.');
      // Phase 17c: the Navy becomes commissionable the same moment the Registry itself does
      // (tier1 needs era>=1, same gate) — announced separately since it's a distinct system (defense, not production).
      if (regShow) announceFeature('navy', '⚓', 'The Navy', 'Commission a navy in the Registry — they defend your harbour and fight off raiders.');
      if (registryOpen) renderRegistry();
    }
    // Captain's Bonus (Phase 12a): opt-in rewarded boost — button only when eligible (available,
    // no boost already running, port founded), never nags once the daily cap hides it.
    if (bonusBtn) {
      var bElig = bonusEligible();
      bonusBtn.style.display = bElig ? '' : 'none';
      if (bElig) {
        announceFeature('bonus', '⚓', 'Captain’s Bonus', 'Double production, on the house.');
        // v89: the button has RETURNED after a claimed boost expired — tell the player it's back.
        if (bonusWasActive) { bonusWasActive = false; showHint('⚓ Captain’s Bonus is ready again!'); }
      }
    }
    if (bonusChip) {
      var bt = SIM.boostT();
      // v89: prominent, clearly-labelled ACTIVE-BUFF pill (was a tiny "⚓2× 9:59" stat) so it's obvious
      // the bonus is running and for how long — which is also why the ⚓ Bonus button is gone.
      if (bonusChipActive && bt > 0) { bonusChip.classList.add('active'); bonusChip.textContent = '⚡ ' + Math.round(SIM.boostMul()) + '× BONUS · ' + clockFmt(bt); bonusChip.style.display = ''; }
      else { bonusChip.style.display = 'none'; bonusChip.classList.remove('active'); bonusChipActive = false; }
    }
    if (legacyOpen) renderLegacy();
    if (manageOpen) renderManage();
    if (expOpen) renderExp();
  }
  function toggleManage() { manageOpen = !manageOpen; if (manageOpen) { if (settingsOpen) { settingsOpen = false; settingsPanel.classList.remove('show'); } if (expOpen) { expOpen = false; expPanel.classList.remove('show'); } if (registryOpen) { registryOpen = false; registryPanel.classList.remove('show'); } } managePanel.classList.toggle('show', manageOpen); if (manageOpen) renderManage(); }
  // Phase 17b: Harbour Registry — commission fleet-tier upgrades (sim.js buyShip/fleetTier), same
  // house panel pattern as Manage/Expeditions (mp-head/mp-sec/mp-grid/mp-item + the 15a ghosted/
  // "Need £X" convention). One card per role (fishing/trade/expedition): a real mesh PORTRAIT of the
  // currently-owned class (paintShipPortrait — renders the actual ship, not a placeholder icon),
  // its name + age label + live yield bonus, and a Commission button.
  function toggleRegistry() {
    registryOpen = !registryOpen;
    if (registryOpen) { if (manageOpen) { manageOpen = false; managePanel.classList.remove('show'); } if (expOpen) { expOpen = false; expPanel.classList.remove('show'); } if (settingsOpen) { settingsOpen = false; settingsPanel.classList.remove('show'); } }
    registryPanel.classList.toggle('show', registryOpen);
    if (registryOpen) { renderRegistry(); sfx('tap'); haptic(8); }
  }
  var REGISTRY_ROLE_LABEL = { fishing: '🎣 Fishing fleet', trade: '⚓ Trade fleet', expedition: '⛵ Expedition fleet' };
  function renderRegistry() {
    if (!simReady()) { registryPanel.classList.remove('show'); registryOpen = false; return; }
    var s = SIM.state(), fv = s.fleet, nv = s.navy;
    var h = '<div class="mp-head">🚢 Harbour Registry<button id="reg-close">✕</button></div>';
    SIM.FLEET_ROLES.forEach(function (role) {
      var f = fv[role], cls = ladderClass(role, f.tier), name = FLEET_NAMES[cls] || cls, age = SIM.eraName(f.tier);
      h += '<div class="mp-sec">' + REGISTRY_ROLE_LABEL[role] + '</div>';
      h += '<div class="reg-card"><canvas class="reg-portrait" width="' + PORTRAIT_SIZE + '" height="' + PORTRAIT_SIZE + '" data-cls="' + cls + '"></canvas>';
      h += '<div class="reg-info"><div class="reg-name">' + name + '</div><div class="reg-age">' + age + ' · ' + (f.mul >= 1 ? '+' : '') + Math.round((f.mul - 1) * 100) + '% yield</div>';
      if (f.maxed) h += '<div class="reg-max">Fleet complete ✓</div>';
      else {
        var nextCls = ladderClass(role, f.tier + 1), nextName = FLEET_NAMES[nextCls] || nextCls, ghosted = false, label;
        if (f.eraGated) { label = 'Requires ' + f.nextEra; ghosted = true; }
        else if (!f.can) { label = 'Need £' + fmt(f.cost); ghosted = true; }
        else label = 'Commission ' + nextName + ' — £' + fmt(f.cost);
        h += '<button class="mp-item reg-buy' + (ghosted ? ' ghosted' : '') + '" data-buy="' + role + '"' + (ghosted ? ' disabled' : '') + '>' + label + '</button>';
      }
      h += '</div></div>';
    });
    // Phase 17c: the Navy — a fourth card, same row pattern (portrait + name/age + Commission
    // button), but a DEFENSE ladder not a production role: shows "Defense power N" instead of a
    // yield %, and previews the tier1 class (ghosted) before anything is ever commissioned.
    var nCls = navyClass(nv.tier) || navyClass(1), nName = FLEET_NAMES[nCls] || nCls;
    h += '<div class="mp-sec">⚓ Navy</div>';
    h += '<div class="reg-card"><canvas class="reg-portrait' + (nv.tier ? '' : ' unowned') + '" width="' + PORTRAIT_SIZE + '" height="' + PORTRAIT_SIZE + '" data-cls="' + nCls + '"></canvas>';
    h += '<div class="reg-info"><div class="reg-name">' + (nv.tier ? nName : 'No navy commissioned') + '</div>' +
      '<div class="reg-age">' + (nv.tier ? ('Defense power ' + nv.power) : 'Raiders sail unopposed') + '</div>';
    if (nv.maxed) h += '<div class="reg-max">Fleet complete ✓</div>';
    else {
      var nextNCls = navyClass(nv.tier + 1), nextNName = FLEET_NAMES[nextNCls] || nextNCls, nghosted = false, nlabel;
      if (nv.eraGated) { nlabel = 'Requires ' + nv.nextEra; nghosted = true; }
      else if (!nv.can) { nlabel = 'Need £' + fmt(nv.cost); nghosted = true; }
      else nlabel = 'Commission ' + nextNName + ' — £' + fmt(nv.cost);
      h += '<button class="mp-item reg-buy' + (nghosted ? ' ghosted' : '') + '" data-buy-navy="1"' + (nghosted ? ' disabled' : '') + '>' + nlabel + '</button>';
    }
    h += '</div></div>';
    registryPanel.innerHTML = h;
    registryPanel.querySelector('#reg-close').addEventListener('click', toggleRegistry);
    registryPanel.querySelectorAll('canvas.reg-portrait').forEach(function (cv) { paintShipPortrait(cv, cv.getAttribute('data-cls')); });
    registryPanel.querySelectorAll('[data-buy]').forEach(function (el) { el.addEventListener('click', function () {
      var role = el.getAttribute('data-buy');
      if (SIM.buyShip(role)) {
        sfx('merge'); haptic(18);
        if (achUnlock('ship1')) popAch(achName('ship1'), true);
        var pw = portWorld(); if (pw) burstWorld(pw.x, pw.y, pw.z, { count: 20, colors: ['#cfe8ff', '#ffffff', '#7fe0d6'], speed: 160, life: 0.9, size: 5 });
        ambient = null;   // Phase 17b: rebuild ambient traffic so newly-commissioned classes get lazily built + shown right away
        renderRegistry(); updateHUD();
      } else sfx('lose');
    }); });
    registryPanel.querySelectorAll('[data-buy-navy]').forEach(function (el) { el.addEventListener('click', function () {
      if (SIM.buyNavy()) {
        sfx('merge'); haptic(18);
        if (achUnlock('admiral1')) popAch(achName('admiral1'), true);
        var pw = portWorld(); if (pw) burstWorld(pw.x, pw.y, pw.z, { count: 20, colors: ['#bcd8ff', '#ffffff', '#ffe08a'], speed: 160, life: 0.9, size: 5 });
        renderRegistry(); updateHUD();
      } else sfx('lose');
    }); });
  }
  // ---- Phase 17b: ship-registry mesh portraits — a real render of the mesh (not a placeholder
  // icon), reusing the main GL context + compiled program (E.P_main) + the already-cached ship
  // meshes (getShip). One small offscreen framebuffer for the whole game (E.createRT, the same
  // helper the post-processing pass uses); render one class, readPixels it back, blit into the
  // panel's plain 2D <canvas> via putImageData (GL is bottom-up, so the row copy flips it). A
  // per-class ImageData cache — a class's silhouette never changes once built — means this only
  // ever costs real GPU work the first time each class is shown.
  var portraitFB = null, PORTRAIT_SIZE = 168, portraitCache = {};
  function ensurePortraitFB() { if (!portraitFB && gl && E) portraitFB = E.createRT(PORTRAIT_SIZE, PORTRAIT_SIZE); return portraitFB; }
  function paintShipPortrait(canvasEl, cls) {
    var ctx = canvasEl.getContext('2d'); if (!ctx) return;
    if (portraitCache[cls]) { ctx.putImageData(portraitCache[cls], 0, 0); return; }
    if (!gl || !E) return;
    var S = getShip(cls); if (!S) return;
    var rt = ensurePortraitFB(); if (!rt) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
    gl.viewport(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
    gl.clearColor(0.055, 0.09, 0.13, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.disable(gl.BLEND);
    var M = E.P_main; gl.useProgram(M.p);
    var len = (S.meta && S.meta.len) || 12, dist = len * 1.15 + 7, eyeP = [dist * 0.60, dist * 0.46, dist * 0.72];
    var pP = mat4.create(), pV = mat4.create(), pVP = mat4.create();
    mat4.perspective(pP, 0.6, 1, 0.5, dist * 5);
    mat4.lookAt(pV, eyeP, [0, len * 0.05, 0], [0, 1, 0]);
    mat4.mul(pVP, pP, pV);
    gl.uniformMatrix4fv(M.u.uVP, false, pVP);
    gl.uniform3fv(M.u.uSunDir, [0.42, 0.80, 0.32]); gl.uniform3fv(M.u.uSunCol, [1.5, 1.42, 1.28]);
    gl.uniform3fv(M.u.uAmbTop, [0.56, 0.60, 0.70]); gl.uniform3fv(M.u.uAmbBot, [0.28, 0.27, 0.29]);
    gl.uniform3fv(M.u.uShadowTint, [0.62, 0.61, 0.72]); gl.uniform1f(M.u.uShadowK, 0.5);   // 19a: neutral paper shadow
    gl.uniform3fv(M.u.uCam, eyeP); gl.uniform3fv(M.u.uFog, [0.055, 0.09, 0.13]); gl.uniform1f(M.u.uFogD, 0);
    gl.uniform3fv(M.u.uWin, [1, 1, 1]); gl.uniform1f(M.u.uNight, 0); gl.uniform1f(M.u.uTime, 0);
    gl.uniform1f(M.u.uExposure, 1.6); gl.uniform1f(M.u.uSat, 1.02); gl.uniform1f(M.u.uCrush, 0.05);   // 19a: papercraft grade
    gl.uniform1f(M.u.uShadowOn, 0);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null); gl.uniform1i(M.u.uShadow, 2);
    gl.uniform1f(M.u.uToon, 1); gl.uniform1f(M.u.uAlbedo, 0); gl.uniform1f(M.u.uTexMix, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, facTex || null); gl.uniform1i(M.u.uTex, 1);
    var look = DEBUG_LOOK[cls] || DEBUG_LOOK.dinghy;
    drawShip(M, cls, 0, 0, 0, 0.68, 1, look[0], look[1], 0);
    var px = new Uint8Array(PORTRAIT_SIZE * PORTRAIT_SIZE * 4);
    gl.readPixels(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    var img = ctx.createImageData(PORTRAIT_SIZE, PORTRAIT_SIZE), row = PORTRAIT_SIZE * 4;
    for (var y = 0; y < PORTRAIT_SIZE; y++) { var sy = PORTRAIT_SIZE - 1 - y; img.data.set(px.subarray(sy * row, sy * row + row), y * row); }
    portraitCache[cls] = img;
    ctx.putImageData(img, 0, 0);
  }
  function renderManage() {
    if (!simReady()) { managePanel.classList.remove('show'); manageOpen = false; return; }
    var s = SIM.state(), BT = SIM.BT;
    // Phase 15c: per-port building-slot ceiling (8 + 4×era, defenses exempt) — shown right in the
    // header so "why can't I build more?" has an immediate, always-visible answer.
    var atCap = s.portFounded && s.slotCap && s.slotsUsed >= s.slotCap;
    var slotsTxt = s.portFounded ? '<span class="mp-slots' + (atCap ? ' full' : '') + '">Buildings ' + s.slotsUsed + '/' + s.slotCap + '</span>' : '';
    var html = '<div class="mp-head">Build & upgrade' + slotsTxt + '<button id="mp-close">✕</button></div>';
    // Per-world specialty — surface WHY each biome plays differently (what it produces richly, and
    // what it can't produce at all and must import) so choosing a map reads as strategy, not flavour.
    if (s.portFounded && s.spec) {
      var sp = s.spec, rich = [], nogo = [];
      ['fish', 'timber', 'goods'].forEach(function (r) {
        var lbl = r.charAt(0).toUpperCase() + r.slice(1);
        if (sp[r] === 0) nogo.push(lbl); else if (sp[r] >= 1.3) rich.push(lbl);
      });
      var ws = '🌍 <b>' + wname(s.world || biomeId) + '</b> — ' + (s.worldHint || sp.hint || '');
      if (rich.length) ws += '<br>💪 Rich in <b>' + rich.join(', ') + '</b>';
      if (nogo.length) ws += '<br>🚫 No <b>' + nogo.join(', ') + '</b> here — import it via trade routes';
      html += '<div style="margin:4px 10px 2px;padding:8px 11px;border-radius:9px;background:rgba(255,214,106,.10);border:1px solid rgba(255,214,106,.22);font-size:12px;line-height:1.55">' + ws + '</div>';
    }
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
    // automation toggles (once unlocked via the Legacy tree)
    if (legacyLvl('auto_repair') > 0 || legacyLvl('auto_buy') > 0) {
      html += '<div class="mp-sec">Automation</div><div class="mp-grid">';
      if (legacyLvl('auto_repair') > 0) html += '<button class="mp-item auto' + (autoOn('autoRepair') ? ' on' : '') + '" data-auto="autoRepair"><span class="mi-n">Auto-repair damage</span><span class="mi-c">' + (autoOn('autoRepair') ? 'ON' : 'OFF') + '</span></button>';
      if (legacyLvl('auto_buy') > 0) html += '<button class="mp-item auto' + (autoOn('autoBuy') ? ' on' : '') + '" data-auto="autoBuy"><span class="mi-n">Auto-buy upgrades</span><span class="mi-c">' + (autoOn('autoBuy') ? 'ON' : 'OFF') + '</span></button>';
      html += '</div>';
    }
    // orders: active delivery goals paying a premium — listed first so they grab attention
    if (s.contracts && s.contracts.length) {
      html += '<div class="mp-sec">Orders</div><div class="mp-grid">';
      s.contracts.forEach(function (c) {
        var unit = c.res.charAt(0).toUpperCase() + c.res.slice(1);
        html += '<button class="mp-item order' + (c.can ? ' ready' : ' ghosted') + '" data-order="' + c.id + '"' + (c.can ? '' : ' disabled') + '>' +
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
        html += '<button class="mp-item repair' + (can ? '' : ' ghosted') + '" data-repair="' + b.i + '"' + (can ? '' : ' disabled') + '><span class="mi-n">' + b.name + ' <i class="mi-hp">' + b.hp + '%</i></span><span class="mi-c">' + (can ? 'Repair £' + fmt(b.rep) : 'Need £' + fmt(b.rep)) + '</span></button>';
      });
      html += '</div>';
    }
    html += '<div class="mp-sec">New buildings</div>';
    // Phase 15c: once the port's non-defense slots are full, explain why rather than just greying
    // every row out — defenses (Sea Wall/Lighthouse) keep their own separate caps, so this only
    // fires when the SHARED slot pool (not a per-type cap) is what's blocking new builds.
    if (atCap) html += '<div class="mp-teaser mp-full">⛴ Port at capacity — advance the era for more ground</div>';
    html += '<div class="mp-grid">';
    Object.keys(BT).forEach(function (id) {
      var t = BT[id]; if (s.era < t.era) return;                    // hide future-era types
      if (SIM.blocked && SIM.blocked(id)) return;                   // hide buildings this world can't run (e.g. desert sawmill)
      var cost = SIM.buildCost(id), can = SIM.canBuild(id);
      var full = !can && t.cat !== 'defense' && atCap;               // slot-capped, not just unaffordable
      html += '<button class="mp-item' + (can ? '' : ' ghosted') + '" data-build="' + id + '"' + (can ? '' : ' disabled') + '><span class="mi-n">' + t.name + '</span><span class="mi-c">' + (can ? '£' + fmt(cost) : (full ? 'Full' : 'Need £' + fmt(cost))) + '</span></button>';
    });
    html += '</div>';
    // Phase 15a: buildings are correctly hidden until their era arrives (keeps the grid readable),
    // but that used to look like a dead end — a one-line teaser keeps the climb visible.
    var teaserNames = [];
    Object.keys(BT).forEach(function (id) { var t = BT[id]; if (t.era === s.era + 1 && !(SIM.blocked && SIM.blocked(id))) teaserNames.push(t.name); });
    if (teaserNames.length) html += '<div class="mp-teaser">⛵ Next era unlocks: ' + teaserNames.join(' · ') + '</div>';
    if (s.buildings.length) {
      html += '<div class="mp-sec">Your port (' + s.buildings.length + ')</div><div class="mp-grid">';
      s.buildings.forEach(function (b) {
        var t = SIM.BT[b.type], maxed = t.cat === 'defense' && b.level >= t.max, can = SIM.canUpgrade(b.i);
        var hp = (b.hp != null && b.hp < 100) ? ' <i class="mi-hp">' + b.hp + '%</i>' : '';
        html += '<button class="mp-item up' + (b.hp != null && b.hp < 100 ? ' hurt' : '') + ((can && !maxed) ? '' : ' ghosted') + '" data-up="' + b.i + '"' + (can ? '' : ' disabled') + '>' +
          '<span class="mi-n">' + b.name + ' L' + b.level + hp + '</span><span class="mi-c">' + (maxed ? 'MAX' : (can ? '↑£' + fmt(b.up) : 'Need £' + fmt(b.up))) + '</span></button>';
      });
      html += '</div>';
    }
    // Phase 9a: composition synergies readout — shows which building combos are firing right now
    if (s.portFounded && s.synergies && s.synergies.length) {
      html += '<div class="mp-sec">Synergies</div><div class="mp-grid">';
      s.synergies.forEach(function (sy) {
        html += '<div class="mp-item syn' + (sy.active ? ' on' : '') + '"><span class="mi-n">' + sy.name + (sy.active ? ' ✓' : '') + '</span><span class="mi-c">' + sy.effect + '</span></div>';
      });
      html += '</div>';
    }
    // Phase 9a: port focus / specialisation — a strategic tradeoff, one active per port
    if (s.portFounded && SIM.FOCUS_DEFS) {
      html += '<div class="mp-sec">Port focus</div><div class="mp-grid">';
      SIM.FOCUS_DEFS.forEach(function (f) {
        html += '<button class="mp-item focus' + (s.focus === f.id ? ' on' : '') + '" data-focus="' + f.id + '"><span class="mi-n">' + f.name + '</span><span class="mi-d">' + f.effect + '</span></button>';
      });
      html += '</div>';
    }
    // managers: permanent multipliers — a real money sink that defines your port's strengths
    if (s.managers) {
      html += '<div class="mp-sec">Managers</div><div class="mp-grid">';
      Object.keys(s.managers).forEach(function (k) {
        var m = s.managers[k], maxed = m.lvl >= m.max, dis = maxed || !m.can;
        html += '<button class="mp-item mgr' + (dis ? ' ghosted' : '') + '" data-mgr="' + k + '"' + (dis ? ' disabled' : '') + '>' +
          '<span class="mi-n">' + m.name + ' <i class="mi-lv">L' + m.lvl + '</i></span>' +
          '<span class="mi-d">' + m.desc + '</span>' +
          '<span class="mi-c">' + (maxed ? 'MAX' : (m.can ? '£' + fmt(m.cost) : 'Need £' + fmt(m.cost))) + '</span></button>';
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
    managePanel.querySelectorAll('[data-build]').forEach(function (el) { el.addEventListener('click', function () { var id = el.getAttribute('data-build'); var t = SIM.BT[id]; if (SIM.build(id)) { plopFeedback(t ? t.era + 1 : 1, t ? t.name : 'Built'); triggerTheatre(true); triggerPop(); checkMilestones(); bumpDaily('build'); metricsMilestone('firstBuild'); updateHUD(); renderManage(); } else sfx('lose'); }); });
    managePanel.querySelectorAll('[data-up]').forEach(function (el) { el.addEventListener('click', function () { var i = +el.getAttribute('data-up'); if (SIM.canUpgrade(i)) { var lv = SIM.port().buildings[i].level; SIM.upgrade(i); plopFeedback(lv + 1, 'Upgraded'); triggerTheatre(false); triggerPop(); bumpDaily('upgrade'); updateHUD(); renderManage(); } else sfx('lose'); }); });
    managePanel.querySelectorAll('[data-mgr]').forEach(function (el) { el.addEventListener('click', function () { var k = el.getAttribute('data-mgr'); if (SIM.buyManager(k)) { plopFeedback(2, 'Hired!'); sfx('merge'); haptic(20); bumpDaily('manager'); updateHUD(); renderManage(); } else sfx('lose'); }); });
    managePanel.querySelectorAll('[data-repair]').forEach(function (el) { el.addEventListener('click', function () { var i = +el.getAttribute('data-repair'); if (SIM.repair(i)) { plopFeedback(2, 'Repaired'); sfx('merge'); haptic(16); updateHUD(); renderManage(); } else sfx('lose'); }); });
    managePanel.querySelectorAll('[data-auto]').forEach(function (el) { el.addEventListener('click', function () { var k = el.getAttribute('data-auto'); setAuto(k, !autoOn(k)); sfx('tap'); haptic(10); renderManage(); }); });
    managePanel.querySelectorAll('[data-focus]').forEach(function (el) { el.addEventListener('click', function () { var f = el.getAttribute('data-focus'); if (s.focus === f) { sfx('tap'); return; } if (SIM.setFocus(null, f)) { plopFeedback(2, 'Focus set'); sfx('merge'); haptic(16); updateHUD(); renderManage(); } else sfx('lose'); }); });
    managePanel.querySelectorAll('[data-order]').forEach(function (el) { el.addEventListener('click', function () { var id = el.getAttribute('data-order'); var paid = SIM.fulfillContract(id); if (paid > 0) { statFlags.orders++; bumpDaily('order'); seasonAdd(15); var pw = portWorld(); if (pw) { popWorld(pw.x, pw.y + 7, pw.z, '+£' + fmt(paid), { color: '#ffe08a', size: 22, life: 1.4, vy: -56 }); burstWorld(pw.x, pw.y, pw.z, { count: 30, colors: ['#ffe08a', '#fff3c4', '#ffd24a'], speed: 200, life: 1.0, size: 5 }); } shakeFX(5, 0.3); sfx('win'); haptic(30); confettiBurst(); updateHUD(); renderManage(); } else sfx('lose'); }); });
  }
  // build/upgrade "plop": shake + dust burst + ascending pitch + haptic + popup at the port
  function plopFeedback(tier, label) {
    var pw = portWorld();
    burstWorld(pw.x, pw.y, pw.z, { count: 16, colors: ['#ffe27a', '#fff3c4', '#cdeafe'], speed: 150, life: 0.6, size: 4, gravity: 320 });
    popWorld(pw.x, pw.y + 5, pw.z, label, { color: '#bfe9ff', size: 15, life: 0.9 });
    shakeFX(3.5, 0.22); sfx('merge', tier); haptic(14);
  }
  // achievements live in PERMANENT (meta) storage so they survive prestige wipes
  var ACHIEVEMENTS = [
    { id: 'hut', name: 'First Fishing Hut' }, { id: 'market', name: 'Market Opened' },
    { id: 'factory', name: 'Industrialist' }, { id: 'dock', name: 'Cargo Dock' }, { id: '1k', name: '£1,000 Banked' },
    { id: 'lm100k', name: '£100k Earned' }, { id: 'lm1m', name: 'Millionaire Baron' }, { id: 'lm10m', name: '£10M Empire' },
    { id: 'p3', name: 'Three Harbours' }, { id: 'p5', name: 'Master of Five Seas' },
    { id: 'r1', name: 'First Trade Route' }, { id: 'nl3', name: 'Network Insured' }, { id: 'nl5', name: 'Network Lv 5' },
    { id: 's1', name: 'First Storm Survived' }, { id: 's10', name: 'Storm-Hardened' },
    { id: 'pr1', name: 'First Charter Signed' }, { id: 'pr10', name: 'Ten Charters' }, { id: 'bpall', name: 'Blueprint Collector' },
    { id: 'voy1', name: 'First Expedition' }, { id: 'rival1', name: 'Bested Baron Krall' }, { id: 'relset', name: 'Relic Set Complete' },
    { id: 'combo', name: 'Fever Pitch' }, { id: 'pass1', name: 'Season Sailor' },
    { id: 'avert1', name: 'Storm Whisperer' }, { id: 'discover1', name: 'Pathfinder' },
    { id: 'ship1', name: 'First Commission' },  // Phase 17b: first fleet-registry ship bought
    { id: 'admiral1', name: 'Admiral' }         // Phase 17c: first navy ship commissioned
  ];
  function achName(id) { for (var i = 0; i < ACHIEVEMENTS.length; i++) if (ACHIEVEMENTS[i].id === id) return ACHIEVEMENTS[i].name; return id; }
  function achOwned(id) { return window.Retention ? !!(Retention.get(GAME, 'ach', {})[id]) : false; }
  function achUnlock(id) { if (!window.Retention) return false; var a = Retention.get(GAME, 'ach', {}); if (a[id]) return false; a[id] = 1; Retention.set(GAME, 'ach', a); return true; }
  function popAch(txt, gold) { var pw = portWorld(); popWorld(pw.x, pw.y + (gold ? 11 : 9), pw.z, (gold ? '🏆 ' : '') + txt, { color: gold ? '#ffe08a' : '#ffd24a', size: gold ? 18 : 19, life: gold ? 2.0 : 1.6 }); burstWorld(pw.x, pw.y, pw.z, { count: gold ? 30 : 26, colors: gold ? ['#ffe08a', '#fff3c4', '#9ef0b0'] : ['#ffd24a', '#fff3c4'], speed: 195, life: 1.05 }); sfx(gold ? 'win' : 'score'); if (gold) haptic(20); }
  function checkMilestones() {
    if (!SIM.raw()) return;
    var c = SIM.state().counts || {};
    if (c.fishing_hut && achUnlock('hut')) popAch('First Fishing Hut!');
    if (c.market && achUnlock('market')) popAch('Market opened!');
    if (c.factory && achUnlock('factory')) popAch('Goods Factory — industry!');
    if (c.dock && achUnlock('dock')) popAch('Cargo Dock built!');
    if (SIM.raw().money >= 1000 && achUnlock('1k')) popAch('£1,000 banked!');
  }
  // empire-scale achievements — checked every HUD tick (conditions change outside building)
  function checkAchievements(s) {
    if (!SIM.raw() || !s) return;
    function ach(key) { if (achUnlock(key)) popAch(achName(key), true); }
    var np = (s.ports || []).length, nl = s.network ? s.network.level : 1, st = s.stats ? s.stats.storms : 0, lm = s.lifetimeMoney || 0;
    var pc = chartersCount();
    if (lm >= 100000) ach('lm100k'); if (lm >= 1000000) ach('lm1m'); if (lm >= 10000000) ach('lm10m');
    if (np >= 3) ach('p3'); if (np >= 5) ach('p5');
    if (s.network && s.network.routes.length >= 1) ach('r1');
    if (nl >= 3) ach('nl3'); if (nl >= 5) ach('nl5');
    if (st >= 1) ach('s1'); if (st >= 10) ach('s10');
    if (pc >= 1) ach('pr1'); if (pc >= 10) ach('pr10');
    if (ownedBlueprints().length >= BLUEPRINTS.length) ach('bpall');
  }
  function doAdvance() {
    if (!SIM.canAdvance() || cine) return;
    metricsMilestone('firstEra');
    var req = SIM.eraReq(SIM.raw().era), bonus = req ? Math.round(req.money * 0.1) : 0;   // 10% era-threshold grant
    SIM.advanceEra(); var toEra = SIM.raw().era;
    // Phase 15c: worlds no longer auto-unlock on era-up — discovery now happens through a paid
    // Uncharted Waters expedition (see unchartedTarget()/renderExp). If this era-up is what makes
    // the next coast reachable, tease that instead of silently unlocking it for free.
    var name = SIM.eraName(toEra), newBuilds = [];
    for (var bk in SIM.BT) if (SIM.BT[bk].era === toEra) newBuilds.push(SIM.BT[bk].name);
    var uReady = unchartedTarget();
    if (uReady && HARBOR_BIOMES[uReady].unlockEra === toEra) newBuilds.push('⛵ Uncharted Waters expedition');
    var unlockTxt = newBuilds.slice(0, 4).join(' · ');
    grantCrate(1);                                                  // every era-up drops a salvage crate
    seasonAdd(30);                                                  // era-ups award season points
    if (window.Juice) Juice.Audio.unlock();
    startAscension(toEra, name, unlockTxt, bonus);                  // cinematic does buildBiome + bonus at the bloom
  }

  function boot() {
    metricsInit();   // Phase 13d: local fun-funnel metrics — one row per boot, never blocks/throws
    // Portal SDK: start init() now (its detect() runs synchronously, so Portal.available is set for
    // initAds below), but DON'T open the loading bracket yet. The CrazyGames SDK ignores any game.*
    // call made before its init() promise RESOLVES — so a sdkGameLoadingStart() fired here would be
    // dropped and the later unpaired stop ignored, leaving both loading events grey in QA (and
    // "Load size/time: waiting…"). So the whole loadingStart()→loadingStop() bracket is opened inside
    // portalReady.then() below, AFTER init has resolved. Non-portal builds: init() resolves at once
    // with no vendor, so the bracket calls are harmless no-ops.
    var portalReady = window.Portal ? Portal.init() : null;
    initAds();   // Phase 12a: async provider setup — never blocks boot; bonus button stays hidden until (if) it resolves
    if (!gl) { if (loader) loader.innerHTML = '<div style="color:#fff;font-family:sans-serif;padding:20px;text-align:center">WebGL2 is required to play Port Boss.</div>'; return; }
    E = HGL.createEngine(gl); ensureFX();
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    boxMesh = E.mesh(new HGL.Builder().box(0, 0, 0, 1, 1, 1, [1, 1, 1]).data());
    gullMesh = E.mesh(new HGL.Builder().cyl(0, 0, 0, 1, 0.25, 3, [1, 1, 1], 1).data());
    buildClouds();   // Phase 14b: sky-layer clouds — built once, independent of biome/founding
    buildFlecks();   // Phase 20b: void paper flecks — built once, independent of biome/founding
    // Phase 16a/17b: SHIPYARD — 25 real ship-class meshes across three fleet-tier ladders (see
    // HARBOR_MODELS.SHIPYARD.LADDERS); built LAZILY via getShip() above (first actual use uploads +
    // caches), so shipStats starts empty and fills in as classes are actually drawn.
    shipStats = { classes: {}, total: 0, oldShipBaseline: 78 };   // 78 = legacy hullMesh(61)+sailMesh(17) unit primitives
    facTex = E.texture(facadeTexture()); gritTex = E.texture(gritTexture()); blobTex = E.texture(blobTexture()); wakeTex = E.texture(wakeTexture());   // waterMesh is (re)built per-biome in buildBiome() → buildWaterMesh() (Phase 14a: bakes shore-foam heights)
    loadAssets();
    loadUnlocked(); loadFounded(); loadGoal();
    if (SIM && SIM.setPace) SIM.setPace(PACE_OPTIONS[paceMode].mul);  // Phase 15b: apply saved/default pace BEFORE any tick (incl. offline catch-up below)
    if (SIM && SIM.setDifficulty) SIM.setDifficulty(diffMode);        // apply saved difficulty BEFORE any tick (offline earnings honour the tier's cap)
    if (SIM) { computeMeta(); applyTide(); }                          // Legacy multipliers + today's market tide before offline accrual
    dailyList();                                                     // materialise today's missions so event hooks can bump them
    // v86: offline/idle earnings REMOVED — returning to the game no longer hands you passive cash
    // (playtest: it made coming back "too easy"). We still resume a founded save as active gameplay.
    if (SIM) { SIM.load(); if (SIM.raw().founded) { era = SIM.raw().era; adsGameplayStart(); } }
    if (SIM && SIM.raw()) { hudShownMoney = prevMoney = SIM.raw().money; }
    if (!(SIM && SIM.raw() && SIM.raw().founded)) era = (window.Retention && Retention.get(GAME, 'era', 0) | 0) || 0;
    var saved = window.Retention && Retention.get(GAME, 'biome', null);
    if (saved && !isUnlocked(saved)) saved = null;
    buildBiome(saved || 'green');
    resize(); defaultView(); C.dist = C.distT; C.tx = C.txT; C.tz = C.tzT; buildSelector(); buildFoundUI(); buildEconUI();
    // Phase 20b: model-in-hand welcome framing — a brand-new player's very first frame should be
    // the whole floating diorama at max zoom-out (like turning a model over in your hand), not the
    // ordinary play framing defaultView() just computed above. Only a FRESH boot (welcome not yet
    // seen) gets this: returning players keep whatever defaultView() gave them, unchanged. The
    // camera snaps to it instantly (nothing has drawn yet) then eases back down to play zoom once
    // the welcome card is dismissed (see showWelcome() below); a slow orbit drift while the card is
    // up (see frame()) keeps the "presented object" feel alive instead of a static screenshot.
    if (window.Retention && !Retention.get(GAME, 'seen', false)) { welcomeFraming = true; C.dist = C.distT = CAM_DIST_MAX; }
    // Debug/dev query-param overrides (jump era/biome, auto-found, pose the camera, freeze). Gated
    // OFF in portal builds so a reviewer can't append ?found / ?era=5 and skip the intended first-run
    // onboarding — a "testing artifact" a portal's QA can flag. On our own site (PORTAL_MODE false)
    // they stay for dev + screenshot tooling. (window.__harbor stays regardless — it's invisible and
    // our own verify-portal-build.js drives the build through it.)
    if (!PORTAL_MODE) try { var q = window.location.search; var m;
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
    var welcomed = showWelcome();                                    // first-ever load: premise card
    if (!welcomed) setTimeout(showStreak, 1400);                     // else once-per-day login streak + today's tide
    if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);
    window.addEventListener('resize', resize);
    requestAnimationFrame(frame);
    // v87: hide the boot loader as soon as the FIRST frame renders — NEVER gate the visible loader on
    // the portal SDK. A portal SDK's init() can hang off its own domain (e.g. the CrazyGames SDK on
    // Kongregate waits for a parent handshake that never comes), which previously left this full-screen
    // loader covering a fully-rendered game forever — the "only text, no graphics, stuck loading"
    // rejection. The portal loading BRACKET (loadingStart/Stop) still runs in portalReady.then below.
    requestAnimationFrame(function () { if (loader) loader.classList.add('hidden'); });
    if (portalReady) portalReady.then(function () {
      // init() has resolved — NOW the CrazyGames SDK honors game.* calls. Open the loading bracket
      // here and pair it one frame later, so both sdkGameLoadingStart + sdkGameLoadingStop register
      // in order (greening the QA checklist + populating Load size/time). Heavy asset loading already
      // ran synchronously above, un-gated on init, so a slow/flaky SDK can never block the game.
      if (window.Portal) Portal.loadingStart();
      requestAnimationFrame(function () {
        if (window.Portal) Portal.loadingStop(); if (loader) loader.classList.add('hidden');
        adsLoadingFinished();      // Phase 12b: boot fully succeeded, loader is hidden — tell the ad provider
        // Gameplay bracket flows through adsGameplayStart/Stop (→ window.ADS → the portal SDK) — the same
        // choke point the founding/resume/visibility paths already use — so it opens on ACTUAL gameplay,
        // never merely at boot. A resumed founded save is already "playing" the instant the SDK is ready,
        // so open it here (AFTER loadingStop, preserving the required loading→gameplay order); a brand-new
        // player opens it when they found their first port instead.
        if (SIM && SIM.raw() && SIM.raw().founded) adsGameplayStart();
        installErrorCapture();     // …and only now start listening for real runtime errors
      });
    });
  }
  function showOffline(gain, sec) {
    var h = Math.floor(sec / 3600), mn = Math.floor((sec % 3600) / 60), ago = (h ? h + 'h ' : '') + mn + 'm';
    var ov = document.createElement('div'); ov.id = 'offlineModal';
    ov.innerHTML = '<div class="om-card"><div class="om-title">Welcome back!</div><div class="om-body">While you were away (' + ago + ') your port earned</div><div class="om-amt">£' + fmt(gain) + '</div><button class="om-btn">Collect</button></div>';
    wrap.appendChild(ov); requestAnimationFrame(function () { ov.classList.add('show'); });
    sfx('score');
    ov.querySelector('.om-btn').addEventListener('click', function () { ov.classList.remove('show'); sfx('merge', 4); var pw = portWorld(); burstWorld(pw.x, pw.y, pw.z, { count: 30, colors: ['#ffe27a', '#ffd24a'], speed: 200, life: 1.1 }); setTimeout(function () { ov.remove(); }, 300); });
  }

  // first-ever-load welcome: the premise in one card, so a cold newcomer knows what to do
  function showWelcome() {
    if (!window.Retention || Retention.get(GAME, 'seen', false)) return false;
    Retention.set(GAME, 'seen', true);
    var ov = document.createElement('div'); ov.id = 'welcomemodal';
    ov.innerHTML = '<div class="wm-card"><div class="wm-logo">Port Boss</div>' +
      '<div class="wm-body">Found a harbour on the glowing coast, then grow a humble fishing village into a global trade empire.</div>' +
      '<div class="wm-feat">⚓ Build &amp; trade · ⛵ Expeditions &amp; relics · 🏴‍☠️ race a rival · 🎟️ seasons &amp; ✦ prestige <i>forever</i></div>' +
      '<button class="wm-btn">Begin ⚓</button></div>';
    wrap.appendChild(ov); requestAnimationFrame(function () { ov.classList.add('show'); }); sfx('score');
    ov.querySelector('.wm-btn').addEventListener('click', function () {
      ov.classList.remove('show'); sfx('tap'); if (window.Juice) Juice.Audio.unlock(); showHint('Tap the glowing harbour, then “Found village”'); setTimeout(function () { ov.remove(); }, 320);
      // Phase 20b: dismissing the card ends the model-in-hand framing and eases the camera back
      // down to ordinary play zoom (defaultView()'s target) — the existing per-frame camera lerp
      // in frame() does the actual easing, this just re-arms the normal target and stops the orbit drift.
      welcomeFraming = false; defaultView();
    });
    return true;
  }

  window.__harbor = {
    state: function () { return { biome: biomeId, era: era, founded: !!founded[biomeId], port: founded[biomeId] || null, sites: sites.length, sel: selSite, worlds: HARBOR_BIOME_ORDER.slice(), unlocked: unlocked.slice(), city: scene.city.length, crane: scene.crane, assets: !!(cityModels && atlasTex), tod: Math.round(tod * 1000) / 1000, cam: { az: +C.az.toFixed(2), el: +C.el.toFixed(2), dist: Math.round(C.dist), tx: Math.round(C.tx), tz: Math.round(C.tz) }, webgl: !!gl, phase: 'world-4.3' }; },
    setBiome: function (id) { if (E) buildBiome(id); }, setTod: function (t) { tod = t % 1; }, pause: function (p) { paused = !!p; },
    stepClock: function (dt) { clock += (dt == null ? 0.5 : +dt); return clock; },   // 19b: deterministic time-step (no wall-clock sleeps) for water-band-slide/flutter tests
    // Phase 14c: deterministic drama time-step. The storm/crash ease + pirate phase timers + volley
    // cadence all advance inside updateDrama on the clamped per-frame dt (max 0.05s, see frame()) —
    // under swiftshader's slow software RAF a wall-clock sleep() advances that far LESS than its
    // duration, so drama-timing tests drive the state here in fixed sub-steps instead. Same discipline
    // as stepClock/setPopProgress/setBuildTheatreProgress (no sleep()-based timing anywhere in the suite).
    stepDrama: function (secs, step) {
      var total = secs == null ? 1 : Math.max(0, +secs), h = step == null ? 0.1 : Math.max(0.001, +step), acc = 0;
      while (acc < total - 1e-9) { var d = Math.min(h, total - acc); updateDrama(d); acc += d; }
      return { storm: window.__harbor.storm(), pirate: window.__harbor.pirate(), volleys: DRAMA.volleyN };
    },

    env: function () { return biome ? env() : null; },   // debug: current ToD colour script values
    post: function () { return { on: postEnabled(), probed: postProbe.done, avgMs: Math.round(postProbe.avgMs * 100) / 100, armed: postProbe.armed, auto: postAutoOff, fail: postFail, outlines: postEnabled(), shadow: postEnabled() }; },   // Phase 14a: outlines + soft shadows ride the same quality gate — see render()
    // Phase 16b: vibrant-storybook debug hook — the live ToD-lit deep/shallow water colours + the
    // shore-band count F_WATER's gradient quantizes into, and the tuned outline width/threshold
    // (see OUTLINE_* above / F_POST in gl.js) so tests can assert the new look is actually wired.
    // Phase 19b: paperBands/bandPhase document the layered-paper-sea rebuild — bandPhase[k] is the
    // lateral slide phase of boundary k (mirrors F_WATER's per-band uTime*spd term, see
    // waterBandPhase() above), sampled live off `clock` so a test can call stepClock() between two
    // reads and assert the phases actually advance (deterministic, no wall-clock sleep needed).
    water: function () { var en = env(); return { deep: m3(biome.deep, en.water), shallow: m3(biome.shallow, en.water), shoreBands: WATER_SHORE_BANDS, gradientOn: true, paperBands: true, bandFarFade: true, bandPhase: [0, 1, 2, 3].map(function (k) { return waterBandPhase(k, clock); }), bounded: WATER_STATS ? WATER_STATS.bounded : false, waterfallSegs: WATER_STATS ? WATER_STATS.waterfallSegs : 0, rimLip: WATER_STATS ? WATER_STATS.rimLip : false, poolVerts: WATER_STATS ? WATER_STATS.poolVerts : 0, waterfallScroll: fallScrollPhase(clock) }; },
    // Phase 14c: WORLD DRAMA test/debug hooks — every field is a pure read of DRAMA (itself a pure
    // function of real SIM.state()/event() plus a locally-smoothed draw timer; see updateDrama).
    storm: function () {
      return {
        rainOn: DRAMA.stormT >= 0.15 && postEnabled(), cloudStorm: DRAMA.stormT > 0.001, waterStorm: waterStormMul(),
        stormT: +DRAMA.stormT.toFixed(3), crashVignette: DRAMA.crashPulse > 0, crashT: +DRAMA.crashT.toFixed(3), boltOn: DRAMA.boltT > 0
      };
    },
    pirate: function () {
      var pr = DRAMA.pirate;
      return pr ? { present: true, phase: pr.phase, confetti: pr.phase === 'fight', x: Math.round(pr.x), z: Math.round(pr.z), holdDist: Math.round(Math.hypot(pr.x - (scene.port ? scene.port.x : 0), pr.z - (scene.port ? scene.port.z : 0))) } : { present: false };
    },
    forcePirate: function (phase) { startPirate(); if (phase) { DRAMA.pirate.phase = phase; DRAMA.pirate.t = phase === 'hold' ? 1 : 0; if (phase === 'fight') { DRAMA.volleyN = 0; DRAMA.volleyT = 0.4; DRAMA._fightOut = 'winDepart'; } } return window.__harbor.pirate(); },   // test-only: skip the modal, park the corsair directly (fight primes the volley cadence like the real raid path)
    resolvePirate: function (kind) { pirateResolve(kind || 'pay'); return window.__harbor.pirate(); },
    volleyCount: function () { return DRAMA.volleyN; },
    theatre: function () { return theatreState(); },
    forceTheatre: function (isNew) { triggerTheatre(isNew !== false); return window.__harbor.theatre(); },
    setBuildTheatreProgress: function (p) { DRAMA.theatreTestP = p == null ? null : Math.max(0, Math.min(1, +p)); return window.__harbor.theatre(); },
    voyageDrama: function () {
      var seqs = Object.keys(DRAMA.castoff);
      return { castoffSeqs: seqs.map(Number), castoffOn: seqs.length > 0 };
    },
    // Phase 20a: camera-bounds + world-slab telemetry (test/debug hooks)
    camBounds: function () { return { distMin: CAM_DIST_MIN, distMax: CAM_DIST_MAX, elMin: CAM_EL_MIN, panX: PANX, panZ0: PANZ0, panZ1: PANZ1 }; },
    slab: function () { return HARBOR_MODELS ? HARBOR_MODELS.SLAB : null; },
    // departure fold-out (test/debug hook): foldFactor(d) at a given path-distance-from-port; a
    // forced 155 sits inside FOLD_START..FOLD_END so a test can assert 0<factor<1 without needing
    // a real voyage to be mid-flight at exactly the right moment.
    departureFold: function (d) { return foldFactor(d == null ? 155 : +d); },
    // Phase 19b: sun/moon screen-space UV tracks (F_SKY's uSun/uMoon uniforms mirror these exactly)
    // + flags documenting the paper-sky rebuild (crisp cut-paper discs, static-size no-twinkle stars).
    sky: function () { var en = env(), sd = sunDir(), md = moonDir(); return { sunUV: [0.5 + sd[0] * 0.42, 0.32 + sd[1] * 0.5], moonUV: [0.5 + md[0] * 0.42, 0.32 + md[1] * 0.5], night: en.night, cutPaperSun: true, starTwinkleOff: true }; },
    outlineTuning: function () { return { depthT: OUTLINE_DEPTH_T, normT: OUTLINE_NORM_T, width: OUTLINE_WIDTH, wobble: OUTLINE_WOBBLE, tint: outlineTint(env()) }; },
    // Phase 19a: papercraft debug hook — the live grade + the matte-flip contract in one place:
    // white rim tint, 2-step banding, per-pass fibre-grain amplitudes, sparkle authored 0, and
    // specular/rim-sheen gone from F_MAIN (glossOff documents the shader-side removal).
    paper: function () { var en = env(); return { rim: outlineTint(en), width: OUTLINE_WIDTH, wobble: OUTLINE_WOBBLE, bands: TOON_BANDS, grain: { main: GRAIN_MAIN, water: GRAIN_WATER, sky: GRAIN_SKY }, sparkle: en.sparkle, glossOff: true, sat: gradeSat(en), crush: gradeCrush(en) }; },
    setPost: function (v) { setPost(!!v, false); return postEnabled(); },   // forced state: disarms the probe (deterministic for tests)
    geomStats: function () { return geomStats; },        // static-scene vertex/index counts (budget guard; .bldg = 18b building meshes)
    terrainStats: function () { return HARBOR_MODELS ? HARBOR_MODELS.terrainStats() : null; },   // Phase 18a: faceted-terrain verts + per-biome dressing + founded-port-only apron/dock/path/fence/props counts
    // Phase 18b: building remodel (test/debug hooks) — per-type vert counts, squash-stretch pop
    // state, and a smoke-emitter sanity check (industry smoke keys off factory/sawmill counts).
    buildingStats: function (kind, biome) { return HARBOR_MODELS && HARBOR_MODELS.buildingStats ? HARBOR_MODELS.buildingStats(kind, biome) : null; },
    buildingKinds: function () { return HARBOR_MODELS && HARBOR_MODELS.BLDG_KINDS ? HARBOR_MODELS.BLDG_KINDS.slice() : []; },
    pop: function () { var t = popNow(); var s = popScaleFor(); return { active: t >= 0 && t < POP_DUR, scale: { x: s.x, y: s.y, z: s.z }, hinge: s.hinge, style: 'unfold', dur: POP_DUR }; },
    forcePop: function () { triggerPop(); return window.__harbor.pop(); },
    setPopProgress: function (p) { popTestP = p == null ? null : Math.max(0, Math.min(1, +p)); return window.__harbor.pop(); },   // deterministic pop sampling: pin progress (null = live clock)
    // Phase 19c: page-flutter on collect — same deterministic pinned-progress contract as the pop
    collectFlutter: function () { var t = flutNow(); return { active: t >= 0 && t < FLUT_DUR, angle: flutterAngleFor(), style: 'page-flutter', dur: FLUT_DUR }; },
    forceFlutter: function () { triggerFlutter(); return window.__harbor.collectFlutter(); },
    setFlutterProgress: function (p) { flutTestP = p == null ? null : Math.max(0, Math.min(1, +p)); return window.__harbor.collectFlutter(); },
    smokeActive: function () { var s = SIM ? SIM.state() : null; var facs = s ? ((s.counts && s.counts.factory || 0) + (s.counts && s.counts.sawmill || 0) * 0.5) : 0; return facs >= 1; },
    // Phase 19b: paper-curl smoke (test/debug hooks) — smokeStyle documents the shape swap away
    // from round puffs; forceSmoke deterministically spawns curls without waiting on the real
    // factory-count/timer gate (for tests + the before/after screenshot loop).
    smokeStyle: function () { return 'curl'; },
    forceSmoke: function (n) {
      if (!FX) return 0; var pw = portWorld(); if (!pw) return 0;
      var sc = worldToScreen(pw.x, pw.y + 14, pw.z); if (!sc) return 0;   // above the crane clutter, against open sky
      for (var i = 0; i < (n || 6); i++) spawnSmokeCurl({ x: sc.x + (Math.random() - 0.5) * 44, y: sc.y + (Math.random() - 0.5) * 18 }, 6, 5, 2.2, 1.2, -22, 18);
      return FX.p.list.length;
    },
    treeSample: function () { return HARBOR_MODELS ? HARBOR_MODELS.treeSample() : null; },   // 19b: first placed tree's world pos (screenshot/test close-up framing)
    flutter: function (ph) { return { sway: sailSway(ph || 0), billow: sailBillow(ph || 0) }; },   // 19b: crisp paper-flutter tuning (test hook)
    shipStats: function () { return shipStats; },        // Phase 16a: per-SHIPYARD-class vertex counts + old-ship baseline (budget guard)
    debugShip: function (cls) { DEBUG_SHIP = (cls && getShip(cls)) ? cls : null; return DEBUG_SHIP; },   // test-only: park one forced ship class in front of the camera (null/invalid clears); lazy-builds it if never seen before
    setEra: function (n) { era = Math.max(0, n | 0); if (SIM && SIM.raw() && SIM.raw().founded) SIM.setEra(era); if (window.Retention) Retention.set(GAME, 'era', era); if (E) { buildBiome(biomeId); updateHUD(); } },
    econ: function () { return SIM ? SIM.state() : null; },
    setFocus: function (f, id) { var r = SIM ? SIM.setFocus(id == null ? null : id, f) : false; if (r) { updateHUD(); if (manageOpen) renderManage(); } return r; },
    synergies: function (id) { return SIM ? SIM.synergies(id) : []; },
    foundPort: function (x, z) { if (E) foundHere(x, z); }, autoFound: function () { if (E) autoFound(); }, rate: function (x, z) { return HARBOR_MODELS.rate(x, z); },
    sites: function () { return sites.slice(); }, selectSite: function (i) { if (E) selectSite(i); }, groundAt: function (sx, sy) { return screenToGround(sx, sy); },
    unlockWorld: function (id) { unlockWorld(id); },
    ambient: function () { if (scene.port && !ambient) buildAmbient(); return ambient ? { boats: ambient.boats.length, gulls: ambient.gulls.length, cx: Math.round(ambient.cx), cz: Math.round(ambient.cz), seaH: Math.round(HARBOR_MODELS.heightAt(ambient.cx, ambient.cz) * 10) / 10 } : null; },
    // Phase 14b: atmosphere (test/debug hooks) — drifting clouds, quay dock workers, night light pools
    clouds: function () { return CLOUDS ? { count: CLOUDS.length, verts: CLOUD_MESH_VERTS, pos: CLOUDS.map(function (c) { return cloudWorldPos(c); }), tint: cloudTint(env()), flat: true } : { count: 0, verts: 0, pos: [], flat: true }; },
    workers: function () { if (scene.port && !ambient) buildAmbient(); var ws = (ambient && ambient.workers && scene.port) ? ambient.workers : []; return { count: ws.length, era: era, pos: ws.map(function (w) { var p = workerWorldPos(w); return [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]; }) }; },
    pools: function () { var en = env(); var on = en.night >= 0.05 && scene.lamps && scene.lamps.length > 0; return { count: on ? scene.lamps.length : 0, night: +en.night.toFixed(3) }; },
    goal: function () { return { i: goalIdx, total: GOALS.length, text: curGoal().t, shown: goalBanner ? goalBanner.classList.contains('show') : false }; },
    goalAt: function (i) { return (i < GOALS.length ? GOALS[i] : genGoal(i)).t; },
    goalOkAt: function (i) { return !!(i < GOALS.length ? GOALS[i] : genGoal(i)).ok(SIM.state()); },   // test hook: evaluate any ladder goal's ok() without needing goalIdx to be there yet
    tickAuto: function () { autoT = 10; tickAutomation(2); },
    lookAt: function (x, z, dist, el, az, ty) { C.txT = C.tx = x; C.tzT = C.tz = z; if (dist) { C.distT = C.dist = dist; } if (el) { C.elT = C.el = el; } if (az != null) { C.azT = C.az = az; } if (ty != null) { C.ty = ty; } },   // Phase 16a: optional ty for debug-ship close-up framing
    boatPos: function () { if (!ambient || !ambient.boats.length) return null; var b = ambient.boats[0], ang = b.a0 + clock * b.sp; return { x: ambient.cx + Math.cos(ang) * b.rx, z: ambient.cz + Math.sin(ang) * b.rz }; },
    openTrade: function () { openTrade(); }, closeTrade: function () { closeTrade(); },
    // Phase 17a: Empire Timeline strip (test/debug hooks)
    openTimeline: function () { openTimeline(); }, closeTimeline: function () { closeTimeline(); },
    tapEraPill: function () { var el = document.getElementById('era-pill'); if (el) el.click(); },
    timelineState: function () {
      var cur = timelineStrip ? timelineStrip.querySelector('.tl-node.current') : null;
      return {
        open: timelineOpen, shown: timelinePanel ? timelinePanel.classList.contains('show') : false,
        nodes: timelineStrip ? timelineStrip.querySelectorAll('.tl-node').length : 0,
        currentName: cur ? cur.querySelector('.tl-name').textContent : null
      };
    },
    tradeState: function () { var nv = SIM.network(); return { open: tradeOpen, shown: tradeMap ? tradeMap.classList.contains('show') : false, routes: nv.routes.length, level: nv.level, guide: !!(tradeGuideEl && tradeGuideEl.classList.contains('show')), founded: tradeFoundedCount(), sel: tradeSel.node, found: tradeSel.found || null, msg: tradeAct ? tradeAct.textContent : '' }; },
    tradeTapNode: function (id) { if (!tradeOpen) openTrade(); var c = nodeXY(id); tradeTap(c[0] / DPR, c[1] / DPR); return { sel: tradeSel.node, dest: tradeSel.dest }; },
    forceHUD: function () { updateHUD(); return Object.keys((SIM.raw() && SIM.raw()._ms) || {}); },
    openLegacy: function () { openLegacy(); }, prestige: function () { doPrestige(); },
    legacy: function () { return { bal: legacyBal(), tree: legacyTreeMap(), meta: SIM.meta(), gain: SIM.prestigeGain(), can: SIM.canPrestige() }; },
    buyLegacy: function (id) { return buyLegacy(id); }, fmt: function (n) { return fmt(n); }, fxCount: function () { return FX ? FX.p.list.length : 0; },
    grantCrate: function (n) { grantCrate(n || 1); return crateCount(); }, crates: function () { return crateCount(); }, openCrate: function () { openCrate(); },
    rollCrate: function () { return rollCrate(); }, blueprints: function () { return ownedBlueprints().map(function (b) { return b.id; }); },
    unlockAll: function () { HARBOR_BIOME_ORDER.forEach(function (id) { if (unlocked.indexOf(id) < 0) unlocked.push(id); }); saveUnlocked(); if (buildSelector._set) buildSelector._set(); },
    startAmbient: function () { startAmbient(); }, ambient_audio: function () { return amb ? { state: amb.ctx.state, gain: +amb.master.gain.value.toFixed(3) } : null; },
    // Phase 20b: diorama presentation polish — test/debug hooks
    bob: function () { return { y: bobY(), roll: bobRoll(), period: BOB_PERIOD, amp: BOB_AMP }; },   // slab bob, pure fn of clock (stepClock-driven)
    flecks: function () { return FLECKS ? { count: FLECKS.length, pos: FLECKS.map(fleckWorldPos) } : null; },   // void paper flecks
    welcome: function () { return { framing: welcomeFraming, dist: C.dist, distT: C.distT, camMax: CAM_DIST_MAX }; },   // model-in-hand welcome framing state
    gullFar: function () { return ambient ? ambient.gulls.filter(function (g) { return g.far; }).map(function (g) { return { r: g.r, rFar: g.rFar }; }) : []; },
    setMuted: function (v) { applyMuted(!!v); },
    refreshAmbient: function () { refreshAmbientNow(); },   // force an immediate resync of every ramped layer to current ToD/hazard/mute state
    // Phase 11c: layered audio state — the eyeball-equivalent for sound (can't screenshot audio)
    audio: function () {
      if (!amb) return null;
      return {
        state: amb.ctx.state, master: +amb.master.gain.value.toFixed(3), wave: +amb.wave.gain.value.toFixed(3),
        weather: +amb.weather.gain.value.toFixed(3), music: +amb.music.gain.value.toFixed(3), night: +amb.night.gain.value.toFixed(3),
        wash: +amb.wash.gain.value.toFixed(3),
        muted: muted, musicOff: musicOff, stormActive: stormActive, envNight: +env().night.toFixed(3),
        target: { master: ambTarget.master, wave: ambTarget.wave, night: ambTarget.night, weather: ambTarget.weather, music: ambTarget.music, wash: ambTarget.wash }   // last commanded value per layer — deterministic, independent of audio-thread ramp timing
      };
    },
    setWeather: function (phase) {   // test-only: force the storm audio state without waiting on the sim's real timer
      if (phase === 'warn') { stormActive = true; applyWeatherGain(true); applyMusicGain(); }
      else if (phase === 'strike') { stormRumble(); }
      else { stormActive = false; applyWeatherGain(false); applyMusicGain(); }
      return amb ? { weather: +amb.weather.gain.value.toFixed(3), music: +amb.music.gain.value.toFixed(3) } : null;
    },
    // Phase 15b: pace + avert (test/debug hooks)
    pace: function () { return { mode: paceMode, mul: SIM ? SIM.pace() : 1, day: Math.round(1 / todSpeed) }; },
    setPace: function (mode) { applyPace(mode); return paceMode; },
    difficulty: function () { return { mode: diffMode, sim: SIM && SIM.difficulty ? SIM.difficulty() : null }; },
    setDifficulty: function (mode) { applyDifficulty(mode); return diffMode; },
    forceWarn: function (portId, crash) { var hz = SIM ? SIM.forceWarn(portId, crash) : null; updateHUD(); return hz; },   // test-only: skip the random wait, land straight in the avert-able warn phase
    avertHazard: function () { var ok = SIM ? SIM.avertHazard() : false; if (ok) updateHUD(); return ok; },
    avertCrash: function () { var ok = SIM ? SIM.avertCrash() : false; if (ok) updateHUD(); return ok; },
    fireEvent: function (id) { var ev = SIM.fireEvent(id); if (ev) { updateHUD(); } return ev; },
    chooseEvent: function (i) { return onEventChoice(i); },
    event: function () { return SIM.event(); },
    voyages: function () { return SIM.voyages(); },
    startVoyage: function (id) { var r = SIM.startVoyage(id); if (r) { updateHUD(); if (expOpen) renderExp(); } return r; },
    collectVoyage: function (seq) { return collectVoyageUI(seq); },
    openExp: function () { if (!expOpen) toggleExp(); },
    // Phase 15c: Uncharted Waters discovery expeditions (test/debug hooks)
    unchartedTarget: function () { return unchartedTarget(); },
    startUncharted: function () { var id = unchartedTarget(); if (!id) return false; var r = SIM.startUncharted(HARBOR_BIOMES[id].unlockEra); if (r) { updateHUD(); if (expOpen) renderExp(); } return r; },
    slots: function () { return { cap: SIM.slotCap(), used: SIM.slotsUsed() }; },
    foundInfo: function () { return { cost: SIM.foundCost(), can: SIM.canFoundPort() }; },
    relics: function () { return { count: relicCount(), total: totalRelics(), owned: ownedRelics(), meta: SIM.meta() }; },
    doctrine: function () { var d = doctrineGet(); return { pick: d.pick, caps: d.caps, unlocked: doctrineUnlocked(), pickCost: doctrinePickCost(), meta: SIM.meta() }; },
    pickDoctrine: function (id) { var r = pickDoctrine(id); if (r && legacyOpen) renderLegacy(); return r; },
    buyCapstone: function () { var r = buyCapstone(); if (r && legacyOpen) renderLegacy(); return r; },
    loadout: function () { return { equipped: loadoutGet(), slots: loadoutSlots(), meta: SIM.meta() }; },
    equipRelic: function (id) { var r = equipRelic(id); if (r && legacyOpen) renderLegacy(); return r; },
    grantRelic: function (id) { var r = id ? grantRelicById(id) : grantRandomRelic(); if (r) { announceRelic(r); updateHUD(); } return r; },
    rival: function () { return rivalGet(); },
    triggerRival: function () { rivalPending = false; var r = rivalGet(); r.race = null; rivalSet(r); showRivalChallenge(); },
    raceProgress: function () { var r = rivalGet(); return r.race ? { kind: r.race.kind, prog: raceCounter(r.race.kind) - r.race.base, target: r.race.target } : null; },
    fleet: function () { refreshFleet(); return { expedition: fleet.exp.length, route: fleet.routes.length, rival: fleet.rival ? 1 : 0, navy: fleet.navy.length,
      expClass: fleet.exp.length ? expeditionShipClass() : null, routeClass: fleet.routes.length ? fleet.routes[0].cls : null, rivalClass: fleet.rival ? 'corsair' : null,
      navyClass: fleet.navy.length ? fleet.navy[0].cls : null }; },   // Phase 17b/17c: kind→owned-tier ladder class mapping
    // Phase 17b: fleet registry (test/debug hooks)
    fleetTier: function (role) { return SIM ? SIM.fleetTier(role) : 0; },
    fleetShipCost: function (role) { return SIM ? SIM.fleetShipCost(role) : null; },
    buyShip: function (role) { var r = SIM ? SIM.buyShip(role) : false; if (r) { updateHUD(); if (registryOpen) renderRegistry(); } return r; },
    fleetView: function () { return SIM ? SIM.fleet() : null; },
    // Phase 17c: the Navy (test/debug hooks)
    navyTier: function () { return SIM ? SIM.navyTier() : 0; },
    buyNavy: function () { var r = SIM ? SIM.buyNavy() : false; if (r) { updateHUD(); if (registryOpen) renderRegistry(); } return r; },
    navyClass: function (tier) { return navyClass(tier); },
    ladderClass: function (role, tier) { return ladderClass(role, tier); },
    openRegistry: function () { if (!registryOpen) toggleRegistry(); else renderRegistry(); }, closeRegistry: function () { if (registryOpen) toggleRegistry(); },
    startFever: function (secs) { startFever(secs); }, fever: function () { return { active: feverActive(), combo: combo, mult: +comboMult().toFixed(2), coins: feverLayer ? feverLayer.querySelectorAll('.coin').length : 0 }; }, collectCoins: function () { if (feverLayer) feverLayer.querySelectorAll('.coin').forEach(function (c) { collectCoin(c); }); },
    season: function () { return { id: seasonId(), theme: seasonTheme(), points: seasonGet().points, claimed: seasonGet().claimed.slice(), daysLeft: seasonDaysLeft(), tiers: PASS_TIERS.length }; }, addSeasonPoints: function (n) { seasonAdd(n); updateHUD(); }, claimPass: function (i) { return claimPass(i); },
    fortune: function () { if (window.Retention) Retention.set(GAME, 'fortuneDay', null); showStreak(); return !!(fortuneModal && fortuneModal.classList.contains('show')); }, drawFortune: function () { var b = fortuneModal && fortuneModal.querySelector('#ft-btns .ev-btn'); if (b) b.click(); },
    // Phase 11b: onboarding — feature-unlock announce (test/debug hooks)
    announce: function (id, icon, title, body, hintOnly) { announceFeature(id, icon, title, body, hintOnly); },
    announceState: function () { return { queueLen: announceQueue.length, busy: announceBusy, showing: !!(announceCard && announceCard.classList.contains('show')), title: announceCard ? announceCard.querySelector('.an-title').textContent : null }; },
    seenFeature: function (id) { return hasSeenFeature(id); },
    dismissAnnounce: function () { dismissAnnounce(); },
    resetAnnounce: function () { announceQueue.length = 0; clearTimeout(announceT); announceBusy = false; if (announceCard) announceCard.classList.remove('show'); },   // test-only: hard-clear any real (already-seen) announce still in flight, for a clean test slate
    crateOpened: function () { return crateOpenedFlag(); },
    // Phase 12a: Captain's Bonus + pluggable AdProvider (test/debug hooks)
    bonus: function () { return { available: bonusEligible(), active: bonusChipActive && SIM.boostT() > 0, mult: SIM.boostMul(), remaining: SIM.boostT(), usedToday: bonusUsedToday() }; },
    claimBonus: function () { openBonusCard(); var b = bonusModal && bonusModal.querySelector('[data-bonus="claim"]'); if (b) { b.click(); return true; } return false; },
    reinitAds: function () { adsReady = false; initAds(); },  // test-only: re-run provider init after swapping window.ADS in-page, to exercise the resilience path
    // Phase 12b: production hardening (test/debug hooks)
    errors: function () { return errLog.slice(); },           // ring buffer copy — last 20 {t,msg,src,line}
    clearErrors: function () { errLog = []; try { localStorage.removeItem(ERRLOG_KEY); } catch (e) {} if (settingsOpen) renderSettings(); },
    portalMode: function () { return PORTAL_MODE; },
    advance: function () { doAdvance(); return !!cine; },      // test-only: drive the real era-advance path (incl. the commercialBreak hook) without needing to grind the money/building gate live
    // Phase 13d: local fun-funnel metrics (full record + derived avgSessionMin) — also our debug view
    metrics: function () { return metricsSnapshot(); },
    // Phase 15d: Harbourmaster's Tips (test/debug hooks)
    tips: function () {
      return {
        enabled: tipsEnabled(), lastId: tipLastId, shownAt: tipLastShownAt, seen: tipsSeenMap(),
        showing: !!(tipToastEl && tipToastEl.classList.contains('show')),
        text: tipToastEl ? tipToastEl.querySelector('.tip-txt').textContent : null
      };
    },
    forceTipCheck: function () { tickTips(); return window.__harbor.tips(); },   // test-only: run one tickTips() pass synchronously, bypassing the wall-clock frame accumulator
    setTipsEnabled: function (v) { setTipsEnabled(!!v); if (settingsOpen) renderSettings(); return tipsEnabled(); },
    resetTipRateLimit: function () { tipLastShownAt = 0; tipRuleLastShown = {}; },   // test-only: zero the global + per-rule cooldowns
    dismissTip: function () { hideTip(); }
  };

  if (canvas && canvas.getContext) boot();
})();
