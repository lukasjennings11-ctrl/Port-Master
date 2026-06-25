/* HARBOR — parametric model builders + era-aware scene assembly. window.HARBOR_MODELS
 * Bold-cartoon diorama. Distant landforms are COMPOSITES of faceted primitives (clustered peaks,
 * stepped cliffs, banded mesas, rolling domes). The port EVOLVES by era: era 0 = a tiny primitive
 * fishing village (wooden huts, jetty, little fishing boats, no crane); later eras add concrete
 * quays, warehouses, gantry cranes, big container ships and a modern skyline (glTF buildings,
 * placed by game.js). buildStatic() fills the merged Builders and returns a scene descriptor
 * (glTF building placements + flags) for game.js. All procedural except the city blocks.
 */
(function (g) {
  var TAU = Math.PI * 2;
  function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  function jit(c, k, rng) { return [c[0] + (rng() - 0.5) * k, c[1] + (rng() - 0.5) * k, c[2] + (rng() - 0.5) * k]; }
  function pick(a, rng) { return a[(rng() * a.length) | 0]; }
  var CONT = [[0.95, 0.32, 0.26], [0.20, 0.62, 0.86], [1.0, 0.78, 0.24], [0.28, 0.76, 0.48], [0.64, 0.42, 0.82], [0.98, 0.54, 0.64], [0.96, 0.96, 0.98]];

  function peak(flat, x, z, r, h, col, seg) { flat.cyl(x, 0, z, r, h, seg || 5, col, 0.04); }
  function dome(flat, x, y, z, r, h, col, seg) { flat.cyl(x, y, z, r, h, seg || 7, col, 0.34); }

  // ---- vegetation ----
  function tree(flat, x, z, rng, kind) {
    var hy = 0.6;
    if (kind === 'palm') {
      var th = 5 + rng() * 3; flat.cyl(x, hy, z, 0.35, th, 6, [0.45, 0.34, 0.22], 0.7);
      for (var f = 0; f < 6; f++) flat.box(x, hy + th, z, 4.2, 0.3, 1.0, [0.22, 0.62, 0.26], f / 6 * TAU, 0.32);
    } else if (kind === 'pine') {
      flat.cyl(x, hy, z, 0.5, 2, 6, [0.40, 0.30, 0.20], 1);
      for (var c = 0; c < 3; c++) flat.cyl(x, hy + 1.5 + c * 2.2, z, 3 - c * 0.8, 2.6, 6, [0.16, 0.44, 0.26], 0.04);
    } else {
      flat.cyl(x, hy, z, 0.6, 2.4, 6, [0.42, 0.31, 0.2], 1);
      flat.cyl(x, hy + 2.2, z, 3.0, 4.2, 7, [0.26, 0.60, 0.30], 0.25);
    }
  }

  // ---- one composite landform ----
  function landform(flat, b, cx, cz, s, rng) {
    if (b.hillType === 'mountain') {
      var rock = jit(b.hill, 0.05, rng), dark = mul(rock, 0.7), peaks = 2 + (rng() * 3 | 0), spread = (20 + rng() * 16) * s;
      for (var p = 0; p < peaks; p++) {
        var px = cx + (rng() - 0.5) * spread, pz = cz + (rng() - 0.5) * spread * 0.6;
        var h = (44 + rng() * 50) * s * (0.7 + 0.5 * rng()), r = (16 + rng() * 12) * s;
        flat.cyl(px, 0, pz, r * 1.15, h * 0.34, 6, dark, 0.55);
        flat.cyl(px, h * 0.30, pz, r, h * 0.7, 5, rock, 0.04);
        if (b.snow) flat.cyl(px, h * 0.60, pz, r * 0.5, h * 0.44, 5, [0.97, 0.98, 1.0], 0.05);
      }
      for (var f = 0; f < 2; f++) dome(flat, cx + (rng() - 0.5) * spread, -2, cz - 18 - rng() * 22, (16 + rng() * 12) * s, (8 + rng() * 6) * s, mul(rock, 0.92));
    } else if (b.hillType === 'cliff') {
      var crock = jit(b.hill, 0.04, rng), steps = 4 + (rng() * 3 | 0), bw = (40 + rng() * 30) * s, bd = (26 + rng() * 18) * s, sh = (12 + rng() * 9) * s, y = 0;
      for (var st = 0; st < steps; st++) { var t = st / steps, w = bw * (1 - t * 0.55), d = bd * (1 - t * 0.55); flat.box(cx, y + sh / 2, cz, w, sh, d, mul(crock, st % 2 ? 0.98 : 0.84), rng() * 0.25); y += sh; }
      flat.box(cx, y + 0.6, cz, bw * 0.5, 1.2, bd * 0.5, b.snow ? [0.93, 0.95, 1.0] : mul(b.ground, 1.1), 0);
      flat.cyl(cx, -2, cz, bw * 0.65, sh * 0.7, 7, mul(crock, 0.78), 0.6);
    } else if (b.hillType === 'mesa') {
      var sand = jit(b.hill, 0.05, rng), layers = 4 + (rng() * 2 | 0), br = (24 + rng() * 16) * s, lh = (10 + rng() * 7) * s, my = 0;
      for (var l = 0; l < layers; l++) { var lt = l / layers; flat.cyl(cx, my, cz, br * (1 - lt * 0.45), lh, 6, mul(sand, l % 2 ? 1.0 : 0.84), 0.92); my += lh; }
      for (var dn = 0; dn < 3; dn++) dome(flat, cx + (rng() - 0.5) * br * 2.4, -2, cz - 16 - rng() * 22, (18 + rng() * 14) * s, (6 + rng() * 5) * s, jit(b.ground, 0.05, rng));
      if (rng() < 0.5) peak(flat, cx + (rng() - 0.5) * br, cz, (4 + rng() * 3) * s, (24 + rng() * 16) * s, mul(sand, 0.9));
    } else {
      var grass = jit(b.hill, 0.05, rng), mounds = 2 + (rng() * 3 | 0), msp = (24 + rng() * 18) * s;
      for (var m = 0; m < mounds; m++) dome(flat, cx + (rng() - 0.5) * msp, -2, cz + (rng() - 0.5) * msp * 0.6, (20 + rng() * 18) * s, (12 + rng() * 16) * s, jit(grass, 0.04, rng));
    }
  }

  // ---- distant landforms — wider, further arc (bigger-map feel), two depth rings ----
  function landforms(flat, b, rng) {
    var rings = [{ n: 9, d0: 96, dr: 70, cz: 70, s0: 0.95, sr: 0.9 }, { n: 7, d0: 200, dr: 90, cz: 150, s0: 1.3, sr: 1.1 }];
    rings.forEach(function (R) {
      for (var i = 0; i < R.n; i++) {
        var ang = -1.35 + (i / (R.n - 1)) * 2.7, dist = R.d0 + rng() * R.dr;
        var cx = Math.sin(ang) * dist, cz = R.cz + Math.cos(ang) * dist * 0.4 + rng() * 36, s = R.s0 + rng() * R.sr;
        landform(flat, b, cx, cz, s, rng);
      }
    });
  }

  // ---- primitive fishing-village hut (era 0): wooden box + gable roof ----
  function hut(flat, x, z, rng, b) {
    var wood = pick([[0.55, 0.40, 0.26], [0.62, 0.46, 0.30], [0.48, 0.34, 0.22], [0.66, 0.54, 0.40]], rng);
    var w = 4 + rng() * 2, h = 3 + rng() * 1.5, d = 4 + rng() * 2, rot = (rng() - 0.5) * 0.6;
    flat.box(x, h / 2, z, w, h, d, wood, rot);
    flat.box(x - w * 0.26, h + 1.0, z, w * 0.62, 0.5, d * 1.08, mul(b.build ? b.build.roof : [0.4, 0.2, 0.15], 1), rot, 0.7);
    flat.box(x + w * 0.26, h + 1.0, z, w * 0.62, 0.5, d * 1.08, mul(b.build ? b.build.roof : [0.4, 0.2, 0.15], 1), rot, -0.7);
    flat.box(x, h * 0.4, z + d * 0.5 + 0.05, w * 0.3, h * 0.5, 0.3, [0.2, 0.14, 0.1], rot); // door
  }
  // net-drying rack + barrels
  function villageProps(flat, x, z, rng) {
    flat.box(x, 1.6, z, 0.3, 3.2, 0.3, [0.4, 0.3, 0.2], 0); flat.box(x + 4, 1.6, z, 0.3, 3.2, 0.3, [0.4, 0.3, 0.2], 0);
    flat.box(x + 2, 3.0, z, 4.4, 0.2, 0.2, [0.4, 0.3, 0.2], 0); flat.box(x + 2, 2.0, z, 4.0, 1.2, 0.1, [0.3, 0.45, 0.4], 0); // hung net
    for (var i = 0; i < 3; i++) flat.cyl(x - 2 - i * 1.4, 0, z + 2, 0.7, 1.6, 7, [0.5, 0.36, 0.24], 0.92);
  }

  // ---- waterfront ----
  function woodenJetty(grit, flat, rng) {
    // a few plank piers on stilts (primitive)
    for (var jx = -30; jx <= 30; jx += 30) {
      flat.box(jx, 1.0, 8, 7, 0.5, 18, [0.52, 0.4, 0.27], 0);
      for (var sx = -2; sx <= 2; sx += 2) for (var sz = 1; sz <= 15; sz += 7) flat.cyl(jx + sx, -2, sz, 0.45, 3.4, 6, [0.36, 0.26, 0.17], 1);
    }
  }
  function concreteQuay(grit, flat, era) {
    var w = 150 + era * 18;
    grit.box(0, 1.1, 15, w, 2.2, 24, [0.64, 0.64, 0.66], 0, 0, 7);
    grit.box(0, 1.0, 3.6, w, 1.8, 1.4, [0.5, 0.5, 0.52], 0);
    for (var bx = -w / 2 + 6; bx <= w / 2 - 6; bx += 12) grit.cyl(bx, 0, 4.4, 0.5, 1.5, 6, [0.16, 0.17, 0.19], 0.8); // bollards
  }

  // ---- boats by tier ----
  function dinghy(flat, x, z, rng) { // small wooden fishing boat
    var rot = (rng() - 0.5) * 0.8, wood = pick([[0.62, 0.44, 0.28], [0.7, 0.5, 0.32], [0.8, 0.78, 0.74]], rng);
    flat.box(x, -0.2, z, 6, 1.4, 2.2, wood, rot);
    flat.box(x - 2.6, -0.2, z, 1.6, 1.4, 1.6, wood, rot + 0.2); flat.box(x + 2.6, -0.2, z, 1.6, 1.4, 1.6, wood, rot - 0.2);
    flat.box(x, 0.7, z, 1.6, 0.3, 1.8, mul(wood, 0.8), rot); // thwart
    flat.box(x + 0.5, 2.0, z, 0.18, 3.0, 0.18, [0.4, 0.3, 0.2], rot); // little mast
  }
  function freighter(grit, flat, x, z, rng) { // mid-tier
    var L = 38, B = 11, deck = 1.8, hb = -2.6, hull = [0.30, 0.34, 0.42];
    grit.box(x, hb + 2.2, z, L * 0.76, 4.4, B, hull, 0, 0, 3);
    grit.box(x - L * 0.42, hb + 2.2, z, L * 0.14, 4.4, B * 0.66, hull, 0.2);
    grit.box(x + L * 0.42, hb + 2.2, z, L * 0.14, 4.4, B * 0.82, hull, -0.13);
    flat.box(x, hb + 0.4, z, L * 0.9, 0.7, B + 0.2, [0.82, 0.26, 0.2], 0);
    var ci = 0; for (var cx = -10; cx <= 8; cx += 4.6) { var stk = 1 + (rng() * 2 | 0); for (var r = 0; r < stk; r++) flat.box(x + cx, deck + 0.9 + r * 2.0, z, 4.2, 1.9, B - 1.5, CONT[(ci + r) % CONT.length], 0); ci++; }
    grit.box(x + L * 0.36, deck + 3.0, z, 5, 5.5, B * 0.8, [0.9, 0.92, 0.95], 0, 0, 2);
    flat.cyl(x + L * 0.36 + 1.5, deck + 6, z, 1.3, 3.2, 9, [0.2, 0.22, 0.26], 1);
  }
  function containerShip(grit, flat, x, z, rng, scale) { // advanced hero ship; scale ~1..1.5
    var s = scale || 1, L = 72 * s, B = 18 * s, deck = 2.4, hb = -4.0, hull = [0.12, 0.16, 0.24], accent = [0.90, 0.24, 0.18];
    // hull: mid + tapered bow/stern + bulbous bow below water
    grit.box(x, hb + 3.2, z, L * 0.72, 6.4, B, hull, 0, 0, 3);
    grit.box(x - L * 0.41, hb + 3.4, z, L * 0.16, 6.0, B * 0.66, hull, 0.2);
    grit.box(x + L * 0.42, hb + 3.2, z, L * 0.14, 6.4, B * 0.86, hull, -0.12);
    flat.cyl(x - L * 0.5, hb + 1.0, z, 1.8, B * 0.5, 8, mul(hull, 1.2), 0.5); // bulbous bow (laid on side via taper-ish)
    flat.box(x, hb + 0.6, z, L * 0.94, 1.0, B + 0.3, accent, 0);                // boot stripe
    flat.box(x, deck + 0.05, z, L * 0.9, 0.3, B - 0.5, [0.18, 0.2, 0.24], 0);   // deck
    for (var rr = -1; rr <= 1; rr += 2) flat.box(x, deck + 0.8, z + rr * (B / 2 - 0.3), L * 0.9, 0.12, 0.12, [0.85, 0.87, 0.9], 0); // rails
    // tall colourful container bays
    var ci = 0;
    for (var cx = -L * 0.36; cx <= L * 0.28; cx += 5.6 * s) {
      for (var row = -1; row <= 1; row++) {
        var stk = 2 + (rng() * 4 | 0);
        for (var r = 0; r < stk; r++) flat.box(x + cx, deck + 0.6 + r * 2.5, z + row * 4.2 * s, 5.2 * s, 2.4, 3.8 * s, CONT[(ci + r) % CONT.length], 0);
        ci++;
      }
    }
    // aft superstructure: tall white bridge with window rows + funnel + radar mast
    var bx = x + L * 0.40;
    grit.box(bx, deck + 6, z, 8 * s, 12, B * 0.82, [0.93, 0.94, 0.96], 0, 0, 2);
    for (var wy = 0; wy < 4; wy++) flat.box(bx - 4.1 * s, deck + 3 + wy * 2.4, z, 0.3, 1.2, B * 0.74, [0.10, 0.16, 0.26], 0);
    flat.box(bx + 1.6, deck + 13.5, z, 4.4 * s, 3.0, 4.4 * s, accent, 0);       // funnel
    flat.cyl(bx + 1.6, deck + 12, z, 2.0, 2.0, 10, [0.18, 0.2, 0.24], 1);
    flat.cyl(bx - 2, deck + 12, z, 0.2, 6, 6, [0.7, 0.72, 0.75], 1);            // radar mast
    flat.box(bx - 2, deck + 18, z, 3.2, 0.3, 0.3, [0.7, 0.72, 0.75], 0);
  }

  // ---- warehouse (biome roof accent) ----
  function warehouse(grit, flat, x, z, w, d, rng, b) {
    var h = 8 + rng() * 3, col = jit([0.64, 0.66, 0.70], 0.1, rng);
    grit.box(x, h / 2, z, w, h, d, col, 0, 0, 2);
    grit.box(x, h + 0.5, z, w + 1.2, 1.2, d + 1.2, mul(b.build ? b.build.roof : [0.4, 0.3, 0.3], 0.9), 0, 0, 1);
    var dn = Math.max(2, Math.round(w / 7));
    for (var i = 0; i < dn; i++) flat.box(x - w / 2 + (i + 0.5) * w / dn, 2.6, z + d / 2 + 0.05, w / dn * 0.7, 5, 0.4, [0.22, 0.23, 0.26], 0);
  }

  // ---- gantry crane frame (animated trolley drawn by game.js) ----
  function craneStatic(grit, baseX, z) {
    var col = [0.98, 0.80, 0.20], h = 32, lx = [baseX - 11, baseX + 11], lz = [z + 9, z - 9];
    for (var a = 0; a < 2; a++) for (var bI = 0; bI < 2; bI++) {
      grit.box(lx[a], h / 2, lz[bI], 2.2, h, 2.2, col);
      grit.box(lx[a], h * 0.5, lz[bI], 1.1, h * 0.9, 1.1, mul(col, 0.92), 0, (a ? -0.5 : 0.5));
    }
    grit.box(lx[0], h, z, 2.4, 2.4, 20, col); grit.box(lx[1], h, z, 2.4, 2.4, 20, col);
    grit.box(baseX, h, lz[0], 24, 2.4, 2.6, col); grit.box(baseX, h, lz[1], 24, 2.4, 2.6, col);
    grit.box(baseX, h * 0.55, lz[0], 24, 1.4, 1.4, col); grit.box(baseX, h * 0.55, lz[1], 24, 1.4, 1.4, col);
    grit.box(baseX, h + 2.1, z - 14, 30, 2.6, 3.0, col); grit.box(baseX, h + 2.1, z + 5, 30, 2.6, 3.0, col);
    grit.box(baseX - 7, h + 2.6, z, 7, 4.8, 9, [0.22, 0.24, 0.28]);
  }

  // ---- quay props: light masts + container yard ----
  function props(grit, flat, rng, era) {
    for (var mx = -56; mx <= 56; mx += 28) { grit.cyl(mx, 0, 12, 0.4, 12, 6, [0.3, 0.31, 0.33], 1); flat.box(mx, 12, 12, 2.4, 0.5, 0.8, [1.0, 0.95, 0.7], 0); }
    var ci = 0;
    for (var yx = 28; yx <= 28 + era * 8; yx += 5.4) for (var yz = 16; yz <= 22; yz += 5.6) { var stk = 1 + (rng() * 2 | 0); for (var r = 0; r < stk; r++) flat.box(yx, 0.4 + r * 2.4, yz, 5, 2.3, 5, CONT[(ci + r) % CONT.length], 0); ci++; }
  }

  // ---- terrain plate + contoured shore + (big) ----
  function terrain(flat, grit, b, rng) {
    flat.box(0, -0.2, 150, 720, 0.6, 320, b.ground, 0);
    var shore = b.hillType === 'mesa' ? mul(b.ground, 1.08) : (b.snow ? [0.62, 0.66, 0.70] : mul(b.ground, 0.9));
    flat.box(0, 0.05, 30, 520, 0.4, 12, shore, 0);
    for (var i = 0; i < 40; i++) { var x = -260 + rng() * 520, z = 42 + rng() * 220; flat.box(x, 0.12, z, 14 + rng() * 26, 0.3, 14 + rng() * 26, jit(b.ground, 0.06, rng), rng() * 1.5); }
    for (i = 0; i < 16; i++) { var mx = -260 + rng() * 520, mz = 80 + rng() * 200; if (Math.abs(mx) < 80) continue; dome(flat, mx, -1, mz, 16 + rng() * 22, 3 + rng() * 6, jit(b.ground, 0.05, rng)); }
    if (b.hillType === 'mesa') { flat.box(-150, 1.4, 28, 90, 3, 8, mul(b.ground, 1.05), 0); flat.box(150, 1.4, 28, 90, 3, 8, mul(b.ground, 1.05), 0); }
    if (b.snow) { flat.box(-150, 1.6, 26, 80, 4, 7, [0.55, 0.58, 0.62], 0); flat.box(150, 1.6, 26, 80, 4, 7, [0.55, 0.58, 0.62], 0); }
  }

  function lighthouse(grit, flat, x, z) {
    grit.cyl(x, 0, z, 5, 2.5, 8, [0.3, 0.31, 0.33], 0.9);
    for (var i = 0; i < 5; i++) grit.cyl(x, 2.5 + i * 4, z, 2.6 - i * 0.28, 4, 10, i % 2 ? [0.95, 0.95, 0.97] : [0.92, 0.26, 0.22], 0.92);
    grit.box(x, 22.5, z, 3.4, 2.8, 3.4, [0.15, 0.16, 0.18]);
    flat.box(x, 23, z, 1.8, 1.8, 1.8, [1.5, 1.3, 0.6]);
  }

  // ---- era-aware scene assembly ----
  // returns { city:[{x,z,s,rot,bi,tint}], crane:bool, era } ; city blocks are glTF (drawn by game.js)
  function buildStatic(B, biome, rng, era) {
    era = era | 0;
    var scene = { city: [], crane: era >= 2, era: era };
    terrain(B.flat, B.grit, biome, rng);
    landforms(B.flat, biome, rng);
    var vegN = biome.vegN + (era === 0 ? 8 : 0);
    if (biome.veg !== 'none') for (var v = 0; v < vegN; v++) { var x = -200 + rng() * 400, z = 34 + rng() * 200; if (Math.abs(x) < 84 && z < 56) continue; tree(B.flat, x, z, rng, biome.veg); }

    if (era === 0) {
      // ---- primitive fishing village ----
      woodenJetty(B.grit, B.flat, rng);
      var huts = 5 + (rng() * 3 | 0);
      for (var hI = 0; hI < huts; hI++) { var hx = -40 + rng() * 80, hz = 30 + rng() * 26; hut(B.flat, hx, hz, rng, biome); }
      villageProps(B.flat, -22, 26, rng); villageProps(B.flat, 26, 28, rng);
      lighthouse(B.grit, B.flat, -64, 10);
      for (var d = 0; d < 4; d++) dinghy(B.flat, -26 + d * 17 + rng() * 4, -2 + rng() * 3, rng);
    } else {
      // ---- developed port ----
      concreteQuay(B.grit, B.flat, era);
      lighthouse(B.grit, B.flat, -70, 8);
      var whN = Math.min(6, 1 + era);
      for (var w = 0; w < whN; w++) warehouse(B.grit, B.flat, -52 + w * 22, 26, 18, 13, rng, biome);
      // modern skyline (glTF) — more + spread with era
      var cityN = Math.min(16, 3 + era * 3);
      for (var cI = 0; cI < cityN; cI++) {
        var bx = -110 + rng() * 220; if (Math.abs(bx) > 150) continue;
        scene.city.push({ x: bx, z: 50 + rng() * 60, s: 6.5 + rng() * 3.5, rot: (rng() * 4 | 0) * (Math.PI / 2), bi: (rng() * 8) | 0, tint: [1, 1, 1] });
      }
      // boats by era tier
      if (era === 1) freighter(B.grit, B.flat, 0, -6, rng);
      else containerShip(B.grit, B.flat, 0, -6, rng, 1 + Math.min(0.5, (era - 2) * 0.18));
      if (era >= 2) craneStatic(B.grit, 0, -6);
      props(B.grit, B.flat, rng, era);
      // a couple of fishing boats still bob about for life
      dinghy(B.flat, -52 + rng() * 8, 2, rng);
    }
    return scene;
  }

  g.HARBOR_MODELS = { buildStatic: buildStatic, CONT: CONT };
})(window);
