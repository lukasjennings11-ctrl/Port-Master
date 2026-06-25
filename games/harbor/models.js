/* HARBOR — detailed parametric model builders. window.HARBOR_MODELS
 * Bold-cartoon diorama: distant landforms are COMPOSITES of faceted primitives (clustered
 * peaks, stepped cliffs, banded mesas, rolling domes) — never single shapes. Buildings match
 * the biome's climate (`biome.build`). Populates three merged Builders: fac (window-facade
 * texture), grit (concrete/steel texture), flat (vertex-colour). All procedural — no art assets.
 */
(function (g) {
  var TAU = Math.PI * 2;
  function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  function jit(c, k, rng) { return [c[0] + (rng() - 0.5) * k, c[1] + (rng() - 0.5) * k, c[2] + (rng() - 0.5) * k]; }
  function pick(arr, rng) { return arr[(rng() * arr.length) | 0]; }
  var CONT = [[0.95, 0.32, 0.26], [0.20, 0.62, 0.86], [1.0, 0.78, 0.24], [0.28, 0.76, 0.48], [0.64, 0.42, 0.82], [0.98, 0.54, 0.64], [0.96, 0.96, 0.98]];

  // faceted low-poly building blocks for cartoon scenery
  function peak(flat, x, z, r, h, col, seg) { flat.cyl(x, 0, z, r, h, seg || 5, col, 0.04); }
  function dome(flat, x, y, z, r, h, col, seg) { flat.cyl(x, y, z, r, h, seg || 7, col, 0.34); }

  // ---- vegetation ----
  function tree(flat, x, z, rng, kind) {
    var hy = 0.6;
    if (kind === 'palm') {
      var th = 5 + rng() * 3; flat.cyl(x, hy, z, 0.35, th, 6, [0.45, 0.34, 0.22], 0.7);
      for (var f = 0; f < 6; f++) flat.box(x, hy + th, z, 4.2, 0.3, 1.0, [0.22, 0.56, 0.24], f / 6 * TAU, 0.32);
    } else if (kind === 'pine') {
      flat.cyl(x, hy, z, 0.5, 2, 6, [0.40, 0.30, 0.20], 1);
      for (var c = 0; c < 3; c++) flat.cyl(x, hy + 1.5 + c * 2.2, z, 3 - c * 0.8, 2.6, 6, [0.16, 0.40, 0.24], 0.04);
    } else {
      flat.cyl(x, hy, z, 0.6, 2.4, 6, [0.42, 0.31, 0.2], 1);
      flat.cyl(x, hy + 2.2, z, 3.0, 4.2, 7, [0.24, 0.54, 0.26], 0.25);
    }
  }

  // ---- one composite landform at (cx,cz), scale s ----
  function landform(flat, b, cx, cz, s, rng) {
    if (b.hillType === 'mountain') {
      var rock = jit(b.hill, 0.05, rng), dark = mul(rock, 0.7), peaks = 2 + (rng() * 3 | 0), spread = (20 + rng() * 16) * s;
      for (var p = 0; p < peaks; p++) {
        var px = cx + (rng() - 0.5) * spread, pz = cz + (rng() - 0.5) * spread * 0.6;
        var h = (42 + rng() * 46) * s * (0.7 + 0.5 * rng()), r = (16 + rng() * 12) * s;
        flat.cyl(px, 0, pz, r * 1.15, h * 0.34, 6, dark, 0.55);       // rock band low
        flat.cyl(px, h * 0.30, pz, r, h * 0.7, 5, rock, 0.04);         // faceted summit
        if (b.snow) flat.cyl(px, h * 0.60, pz, r * 0.5, h * 0.44, 5, [0.96, 0.97, 1.0], 0.05); // snow cap
      }
      for (var f = 0; f < 2; f++) dome(flat, cx + (rng() - 0.5) * spread, -2, cz - 18 - rng() * 22, (16 + rng() * 12) * s, (8 + rng() * 6) * s, mul(rock, 0.92));
    } else if (b.hillType === 'cliff') {
      var crock = jit(b.hill, 0.04, rng), steps = 4 + (rng() * 3 | 0), bw = (40 + rng() * 30) * s, bd = (26 + rng() * 18) * s, sh = (12 + rng() * 9) * s, y = 0;
      for (var st = 0; st < steps; st++) {                            // stepped strata
        var t = st / steps, w = bw * (1 - t * 0.55), d = bd * (1 - t * 0.55), band = mul(crock, st % 2 ? 0.98 : 0.84);
        flat.box(cx, y + sh / 2, cz, w, sh, d, band, rng() * 0.25); y += sh;
      }
      flat.box(cx, y + 0.6, cz, bw * 0.5, 1.2, bd * 0.5, b.snow ? [0.92, 0.94, 1.0] : mul(b.ground, 1.1), 0); // cap slab
      flat.cyl(cx, -2, cz, bw * 0.65, sh * 0.7, 7, mul(crock, 0.78), 0.6); // talus skirt
    } else if (b.hillType === 'mesa') {
      var sand = jit(b.hill, 0.05, rng), layers = 4 + (rng() * 2 | 0), br = (24 + rng() * 16) * s, lh = (10 + rng() * 7) * s, my = 0;
      for (var l = 0; l < layers; l++) {                              // banded plateaus
        var lt = l / layers; flat.cyl(cx, my, cz, br * (1 - lt * 0.45), lh, 6, mul(sand, l % 2 ? 1.0 : 0.84), 0.92); my += lh;
      }
      for (var dn = 0; dn < 3; dn++) dome(flat, cx + (rng() - 0.5) * br * 2.4, -2, cz - 16 - rng() * 22, (18 + rng() * 14) * s, (6 + rng() * 5) * s, jit(b.ground, 0.05, rng));
      if (rng() < 0.5) peak(flat, cx + (rng() - 0.5) * br, cz, (4 + rng() * 3) * s, (24 + rng() * 16) * s, mul(sand, 0.9)); // spire
    } else {                                                          // rolling hills
      var grass = jit(b.hill, 0.05, rng), mounds = 2 + (rng() * 3 | 0), msp = (24 + rng() * 18) * s;
      for (var m = 0; m < mounds; m++) dome(flat, cx + (rng() - 0.5) * msp, -2, cz + (rng() - 0.5) * msp * 0.6, (20 + rng() * 18) * s, (12 + rng() * 16) * s, jit(grass, 0.04, rng));
    }
  }

  // ---- distant landforms arc across the back ----
  function landforms(flat, b, rng) {
    var n = 9;
    for (var i = 0; i < n; i++) {
      var ang = -1.2 + (i / (n - 1)) * 2.4, dist = 92 + rng() * 80;
      var cx = Math.sin(ang) * dist, cz = 56 + Math.cos(ang) * dist * 0.5 + rng() * 34, s = 0.9 + rng() * 1.15;
      landform(flat, b, cx, cz, s, rng);
    }
  }

  // ---- a climate-matched building (walls + roof) ----
  function building(fac, flat, x, z, w, h, d, rng, b) {
    var bs = b.build, col = pick(bs.wall, rng), tiles = Math.max(2, Math.round(h / 4));
    fac.box(x, h / 2, z, w, h, d, col, 0, 0, tiles);
    if (bs.roofStyle === 'pitch') {
      var rh = Math.min(5.5, w * 0.55);                               // gable /\
      flat.box(x - w * 0.26, h + rh * 0.5, z, w * 0.64, 0.7, d * 1.05, bs.roof, 0, 0.7);
      flat.box(x + w * 0.26, h + rh * 0.5, z, w * 0.64, 0.7, d * 1.05, bs.roof, 0, -0.7);
    } else if (bs.roofStyle === 'hip') {
      flat.cyl(x, h, z, w * 0.62, 3.0, 4, bs.roof, 0.04);             // short pyramid
    } else {                                                          // flat
      fac.box(x, h + 0.4, z, w * 1.03, 0.9, d * 1.03, mul(col, 0.7), 0, 0, 1); // parapet
      if (rng() < 0.35) flat.cyl(x, h + 0.7, z, w * 0.3, 2.2, 8, bs.roof, 0.55); // dome variant
    }
    flat.box(x + w * 0.2, h + 1.0, z, w * 0.16, 1.4, d * 0.3, bs.trim, 0, 0, 1); // rooftop/chimney accent
  }

  // ---- warehouse (ribbed shed, biome roof accent) ----
  function warehouse(grit, flat, x, z, w, d, rng, b) {
    var h = 8 + rng() * 3, col = jit([0.62, 0.64, 0.68], 0.1, rng);
    grit.box(x, h / 2, z, w, h, d, col, 0, 0, 2);
    grit.box(x, h + 0.5, z, w + 1.2, 1.2, d + 1.2, mul(b.build.roof, 0.9), 0, 0, 1);  // roof tinted to climate
    var dn = Math.max(2, Math.round(w / 7));
    for (var i = 0; i < dn; i++) flat.box(x - w / 2 + (i + 0.5) * w / dn, 2.6, z + d / 2 + 0.05, w / dn * 0.7, 5, 0.4, [0.22, 0.23, 0.26], 0);
  }

  // ---- container ship ----
  function ship(grit, flat, sx, z, rng) {
    var L = 64, B = 16, deck = 2.2, hb = -3.6;
    grit.box(sx, hb + 2.9, z, L * 0.74, 5.8, B, [0.16, 0.20, 0.27], 0, 0, 3);
    grit.box(sx - L * 0.42, hb + 2.9, z, L * 0.14, 5.8, B * 0.7, [0.16, 0.20, 0.27], 0.18);
    grit.box(sx + L * 0.42, hb + 2.9, z, L * 0.14, 5.8, B * 0.85, [0.16, 0.20, 0.27], -0.12);
    flat.box(sx, hb + 0.5, z, L * 0.92, 0.9, B + 0.2, [0.86, 0.22, 0.18], 0);
    flat.box(sx, deck + 0.05, z, L * 0.9, 0.3, B - 0.4, [0.20, 0.22, 0.26], 0);
    for (var rr = -1; rr <= 1; rr += 2) flat.box(sx, deck + 0.7, z + rr * (B / 2 - 0.3), L * 0.9, 0.12, 0.12, [0.8, 0.82, 0.85], 0);
    var ci = 0;
    for (var cx = -26; cx <= 22; cx += 5.4) {
      for (var row = -1; row <= 1; row += 2) {
        var stk = 1 + (rng() * 3 | 0);
        for (var r = 0; r < stk; r++) flat.box(sx + cx, deck + 0.4 + r * 2.4, z + row * 3.6, 5.0, 2.3, 6.6, CONT[(ci + r) % CONT.length], 0);
        ci++;
      }
    }
    var bx = sx + L * 0.4;
    grit.box(bx, deck + 4, z, 7, 8, B * 0.8, [0.92, 0.93, 0.95], 0, 0, 2);
    for (var wy = 0; wy < 3; wy++) flat.box(bx - 3.6, deck + 2.4 + wy * 2.2, z, 0.3, 1.2, B * 0.7, [0.12, 0.16, 0.22], 0);
    flat.cyl(bx + 1.5, deck + 8, z, 2, 4.5, 10, [0.20, 0.22, 0.25], 1);
    flat.box(bx + 1.5, deck + 11.5, z, 4.2, 1.4, 4.2, [0.86, 0.22, 0.18], 0);
  }

  // ---- gantry crane: static frame into grit (animated trolley drawn by game.js) ----
  function craneStatic(grit, baseX, z) {
    var col = [0.97, 0.78, 0.18], h = 32, lx = [baseX - 11, baseX + 11], lz = [z + 9, z - 9];
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

  // ---- props: quay light masts + container yard + a truck ----
  function props(grit, flat, rng) {
    for (var mx = -56; mx <= 56; mx += 28) { grit.cyl(mx, 0, 12, 0.4, 12, 6, [0.3, 0.31, 0.33], 1); flat.box(mx, 12, 12, 2.4, 0.5, 0.8, [1.0, 0.95, 0.7], 0); }
    for (var bx = -60; bx <= 60; bx += 10) grit.cyl(bx, 0, 5, 0.5, 1.4, 6, [0.16, 0.17, 0.19], 0.8);
    var ci = 0;
    for (var yx = 28; yx <= 52; yx += 5.4) for (var yz = 16; yz <= 22; yz += 5.6) { var stk = 1 + (rng() * 2 | 0); for (var r = 0; r < stk; r++) flat.box(yx, 0.4 + r * 2.4, yz, 5, 2.3, 5, CONT[(ci + r) % CONT.length], 0); ci++; }
    flat.box(-30, 1.2, 12, 6, 2, 2.6, [0.8, 0.3, 0.25], 0); flat.box(-33, 2.0, 12, 2.4, 2.4, 2.6, [0.85, 0.85, 0.88], 0);
  }

  // ---- terrain plate + contoured shore + quay ----
  function terrain(flat, grit, b, rng) {
    flat.box(0, -0.2, 130, 460, 0.6, 240, b.ground, 0);              // base land plate
    var shore = b.hillType === 'mesa' ? mul(b.ground, 1.08) : (b.snow ? [0.62, 0.66, 0.70] : mul(b.ground, 0.9));
    flat.box(0, 0.05, 30, 330, 0.4, 10, shore, 0);                  // beach/shore strip
    for (var i = 0; i < 26; i++) { var x = -180 + rng() * 360, z = 42 + rng() * 138; flat.box(x, 0.12, z, 12 + rng() * 20, 0.3, 12 + rng() * 20, jit(b.ground, 0.06, rng), rng() * 1.5); }
    for (i = 0; i < 10; i++) { var mx = -180 + rng() * 360, mz = 72 + rng() * 116; if (Math.abs(mx) < 70) continue; dome(flat, mx, -1, mz, 14 + rng() * 18, 3 + rng() * 5, jit(b.ground, 0.05, rng)); } // rolling inland
    if (b.hillType === 'mesa') { flat.box(-118, 1.4, 28, 78, 3, 8, mul(b.ground, 1.05), 0); flat.box(118, 1.4, 28, 78, 3, 8, mul(b.ground, 1.05), 0); }      // sandy berms
    if (b.snow) { flat.box(-118, 1.6, 26, 70, 4, 7, [0.55, 0.58, 0.62], 0); flat.box(118, 1.6, 26, 70, 4, 7, [0.55, 0.58, 0.62], 0); }                       // rocky shelves
    grit.box(0, 1.1, 15, 152, 2.2, 22, [0.62, 0.62, 0.64], 0, 0, 6);
    grit.box(0, 1.0, 4.4, 152, 1.8, 1.2, [0.5, 0.5, 0.52], 0);
  }

  // lighthouse
  function lighthouse(grit, flat, x, z) {
    grit.cyl(x, 0, z, 5, 2.5, 8, [0.3, 0.31, 0.33], 0.9);
    for (var i = 0; i < 5; i++) grit.cyl(x, 2.5 + i * 4, z, 2.6 - i * 0.28, 4, 10, i % 2 ? [0.9, 0.9, 0.92] : [0.9, 0.24, 0.20], 0.92);
    grit.box(x, 22.5, z, 3.4, 2.8, 3.4, [0.15, 0.16, 0.18]);
    flat.box(x, 23, z, 1.8, 1.8, 1.8, [1.4, 1.2, 0.6]);
  }

  function buildStatic(B, biome, rng) {
    terrain(B.flat, B.grit, biome, rng);
    landforms(B.flat, biome, rng);
    if (biome.veg !== 'none') for (var v = 0; v < biome.vegN; v++) { var x = -160 + rng() * 320, z = 30 + rng() * 120; if (Math.abs(x) < 80 && z < 50) continue; tree(B.flat, x, z, rng, biome.veg); }
    lighthouse(B.grit, B.flat, -70, 8);
    var wh = [-52, -26, 0, 26, 52];
    for (var i = 0; i < wh.length; i++) warehouse(B.grit, B.flat, wh[i], 24, 18, 13, rng, biome);
    for (i = 0; i < 13; i++) { var bx = -82 + i * 13 + rng() * 4; if (Math.abs(bx) > 120) continue; building(B.fac, B.flat, bx, 44 + rng() * 12, 7 + rng() * 2.5, 9 + rng() * 15, 8 + rng() * 3, rng, biome); }
    ship(B.grit, B.flat, 0, -6, rng);
    craneStatic(B.grit, 0, -6);
    props(B.grit, B.flat, rng);
  }

  g.HARBOR_MODELS = { buildStatic: buildStatic, CONT: CONT };
})(window);
