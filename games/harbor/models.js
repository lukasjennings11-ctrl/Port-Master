/* HARBOR — detailed parametric model builders. window.HARBOR_MODELS
 * Populates three merged Builders: fac (window-facade texture), grit (concrete/steel
 * texture), flat (vertex-colour, no texture). Static scene only; animated crane parts are
 * drawn separately by game.js. All procedural — no art assets.
 */
(function (g) {
  var TAU = Math.PI * 2;
  function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  function jit(c, k, rng) { return [c[0] + (rng() - 0.5) * k, c[1] + (rng() - 0.5) * k, c[2] + (rng() - 0.5) * k]; }
  var CONT = [[0.92, 0.30, 0.24], [0.20, 0.58, 0.80], [1.0, 0.76, 0.22], [0.26, 0.72, 0.46], [0.62, 0.40, 0.78], [0.96, 0.52, 0.62], [0.95, 0.95, 0.97]];

  // ---- vegetation ----
  function tree(flat, x, z, rng, kind) {
    var hy = 0.6;
    if (kind === 'palm') {
      var th = 5 + rng() * 3; flat.cyl(x, hy, z, 0.35, th, 6, [0.45, 0.34, 0.22], 0.7);
      for (var f = 0; f < 6; f++) flat.box(x, hy + th, z, 4.2, 0.3, 1.0, [0.20, 0.5, 0.22], f / 6 * TAU, 0.32);
    } else if (kind === 'pine') {
      flat.cyl(x, hy, z, 0.5, 2, 6, [0.40, 0.30, 0.20], 1);
      for (var c = 0; c < 3; c++) flat.cyl(x, hy + 1.5 + c * 2.2, z, 3 - c * 0.8, 2.6, 6, [0.14, 0.34, 0.2], 0.04);
    } else {
      flat.cyl(x, hy, z, 0.6, 2.4, 6, [0.42, 0.31, 0.2], 1);
      flat.cyl(x, hy + 2.2, z, 3.0, 4.2, 7, [0.20, 0.46, 0.22], 0.25);
    }
  }

  // ---- distant landforms (big, hazed by fog) ----
  function landforms(flat, b, rng) {
    var n = 16;
    for (var i = 0; i < n; i++) {
      var ang = -1.1 + (i / (n - 1)) * 2.2;          // arc across the back
      var dist = 120 + rng() * 90;
      var x = Math.sin(ang) * dist, z = 60 + Math.cos(ang) * dist * 0.5 + rng() * 40;
      var s = 0.7 + rng() * 1.0, col = jit(b.hill, 0.05, rng);
      if (b.hillType === 'mountain') {
        var h = (40 + rng() * 50) * s; flat.cyl(x, 0, z, (26 + rng() * 16) * s, h, 5, col, 0.02);
        if (b.snow) flat.cyl(x, h * 0.62, z, (26 + rng() * 16) * s * 0.42, h * 0.42, 5, [0.95, 0.96, 1.0], 0.02);
      } else if (b.hillType === 'mesa') {
        flat.cyl(x, 0, z, (24 + rng() * 18) * s, (16 + rng() * 14) * s, 6, col, 0.78);
      } else if (b.hillType === 'cliff') {
        var ch = (28 + rng() * 34) * s; flat.box(x, ch / 2, z, (30 + rng() * 30) * s, ch, (24 + rng() * 20) * s, col, rng() * 0.5);
        if (b.snow) flat.box(x, ch + 1, z, (30 + rng() * 30) * s, 2, (24 + rng() * 20) * s, [0.92, 0.94, 1.0], 0);
      } else {
        flat.cyl(x, -2, z, (30 + rng() * 26) * s, (12 + rng() * 18) * s, 8, col, 0.5);
      }
    }
  }

  // ---- a windowed building ----
  function building(fac, x, z, w, h, d, rng) {
    var tone = 0.5 + rng() * 0.35, col = [tone * 0.9, tone * 0.93, tone];
    var tiles = Math.max(2, Math.round(h / 4));
    fac.box(x, h / 2, z, w, h, d, col, 0, 0, tiles);
    fac.box(x, h + 0.4, z, w * 1.03, 0.9, d * 1.03, mul(col, 0.55), 0, 0, 1);   // parapet
    // rooftop units
    fac.box(x - w * 0.22, h + 1.3, z, w * 0.26, 1.8, d * 0.4, [0.3, 0.32, 0.34], 0, 0, 1);
    fac.box(x + w * 0.2, h + 1.0, z, w * 0.16, 1.2, d * 0.3, [0.34, 0.36, 0.4], 0, 0, 1);
  }

  // ---- warehouse (ribbed shed) ----
  function warehouse(grit, flat, x, z, w, d, rng) {
    var h = 8 + rng() * 3, col = jit([0.6, 0.62, 0.66], 0.1, rng);
    grit.box(x, h / 2, z, w, h, d, col, 0, 0, 2);
    grit.box(x, h + 0.5, z, w + 1.2, 1.2, d + 1.2, [0.32, 0.34, 0.36], 0, 0, 1);   // roof
    // roller doors
    var dn = Math.max(2, Math.round(w / 7));
    for (var i = 0; i < dn; i++) flat.box(x - w / 2 + (i + 0.5) * w / dn, 2.6, z + d / 2 + 0.05, w / dn * 0.7, 5, 0.4, [0.22, 0.23, 0.26], 0);
  }

  // ---- container ship ----
  function ship(grit, flat, sx, z, rng) {
    var L = 64, B = 16, deck = 2.2, hb = -3.6;
    // hull: mid + tapered bow/stern
    grit.box(sx, hb + 2.9, z, L * 0.74, 5.8, B, [0.16, 0.20, 0.27], 0, 0, 3);
    grit.box(sx - L * 0.42, hb + 2.9, z, L * 0.14, 5.8, B * 0.7, [0.16, 0.20, 0.27], 0.18);   // bow
    grit.box(sx + L * 0.42, hb + 2.9, z, L * 0.14, 5.8, B * 0.85, [0.16, 0.20, 0.27], -0.12);  // stern
    flat.box(sx, hb + 0.5, z, L * 0.92, 0.9, B + 0.2, [0.86, 0.22, 0.18], 0);                   // boot stripe
    flat.box(sx, deck + 0.05, z, L * 0.9, 0.3, B - 0.4, [0.20, 0.22, 0.26], 0);                 // deck
    // railings
    for (var rr = -1; rr <= 1; rr += 2) flat.box(sx, deck + 0.7, z + rr * (B / 2 - 0.3), L * 0.9, 0.12, 0.12, [0.8, 0.82, 0.85], 0);
    // containers — two rows, varied stacks
    var ci = 0;
    for (var cx = -26; cx <= 22; cx += 5.4) {
      for (var row = -1; row <= 1; row += 2) {
        var stk = 1 + (rng() * 3 | 0);
        for (var r = 0; r < stk; r++) flat.box(sx + cx, deck + 0.4 + r * 2.4, z + row * 3.6, 5.0, 2.3, 6.6, CONT[(ci + r) % CONT.length], 0);
        ci++;
      }
    }
    // superstructure (stern) with windows + funnel
    var bx = sx + L * 0.4;
    grit.box(bx, deck + 4, z, 7, 8, B * 0.8, [0.92, 0.93, 0.95], 0, 0, 2);
    for (var wy = 0; wy < 3; wy++) flat.box(bx - 3.6, deck + 2.4 + wy * 2.2, z, 0.3, 1.2, B * 0.7, [0.12, 0.16, 0.22], 0);
    flat.cyl(bx + 1.5, deck + 8, z, 2, 4.5, 10, [0.20, 0.22, 0.25], 1);
    flat.box(bx + 1.5, deck + 11.5, z, 4.2, 1.4, 4.2, [0.86, 0.22, 0.18], 0);
  }

  // ---- gantry crane: static frame into grit (animated trolley drawn by game.js) ----
  function craneStatic(grit, baseX, z) {
    var col = [0.95, 0.74, 0.16], h = 32, lx = [baseX - 11, baseX + 11], lz = [z + 9, z - 9];
    for (var a = 0; a < 2; a++) for (var bI = 0; bI < 2; bI++) {
      grit.box(lx[a], h / 2, lz[bI], 2.2, h, 2.2, col);
      // diagonal brace (rotateZ)
      grit.box(lx[a], h * 0.5, lz[bI], 1.1, h * 0.9, 1.1, mul(col, 0.92), 0, (a ? -0.5 : 0.5));
    }
    grit.box(lx[0], h, z, 2.4, 2.4, 20, col); grit.box(lx[1], h, z, 2.4, 2.4, 20, col); // sill beams
    grit.box(baseX, h, lz[0], 24, 2.4, 2.6, col); grit.box(baseX, h, lz[1], 24, 2.4, 2.6, col);
    grit.box(baseX, h * 0.55, lz[0], 24, 1.4, 1.4, col); grit.box(baseX, h * 0.55, lz[1], 24, 1.4, 1.4, col);
    grit.box(baseX, h + 2.1, z - 14, 30, 2.6, 3.0, col); grit.box(baseX, h + 2.1, z + 5, 30, 2.6, 3.0, col); // booms
    grit.box(baseX - 7, h + 2.6, z, 7, 4.8, 9, [0.22, 0.24, 0.28]); // machinery house
  }

  // ---- props: quay light masts + container yard + a truck ----
  function props(grit, flat, rng) {
    for (var mx = -56; mx <= 56; mx += 28) { grit.cyl(mx, 0, 12, 0.4, 12, 6, [0.3, 0.31, 0.33], 1); flat.box(mx, 12, 12, 2.4, 0.5, 0.8, [1.0, 0.95, 0.7], 0); }
    // bollards
    for (var bx = -60; bx <= 60; bx += 10) grit.cyl(bx, 0, 5, 0.5, 1.4, 6, [0.16, 0.17, 0.19], 0.8);
    // a container yard on the quay
    var ci = 0;
    for (var yx = 28; yx <= 52; yx += 5.4) for (var yz = 16; yz <= 22; yz += 5.6) { var stk = 1 + (rng() * 2 | 0); for (var r = 0; r < stk; r++) flat.box(yx, 0.4 + r * 2.4, yz, 5, 2.3, 5, CONT[(ci + r) % CONT.length], 0); ci++; }
    // truck
    flat.box(-30, 1.2, 12, 6, 2, 2.6, [0.8, 0.3, 0.25], 0); flat.box(-33, 2.0, 12, 2.4, 2.4, 2.6, [0.85, 0.85, 0.88], 0);
  }

  // ---- terrain plate + quay ----
  function terrain(flat, grit, b, rng) {
    flat.box(0, -0.2, 130, 460, 0.6, 240, b.ground, 0);        // big land plate behind quay
    // gentle ground colour variation patches
    for (var i = 0; i < 26; i++) { var x = -180 + rng() * 360, z = 30 + rng() * 150; flat.box(x, 0.12, z, 12 + rng() * 20, 0.3, 12 + rng() * 20, jit(b.ground, 0.06, rng), rng() * 1.5); }
    // quay
    grit.box(0, 1.1, 15, 152, 2.2, 22, [0.62, 0.62, 0.64], 0, 0, 6);
    grit.box(0, 1.0, 4.4, 152, 1.8, 1.2, [0.5, 0.5, 0.52], 0);
  }

  // lighthouse
  function lighthouse(grit, flat, x, z) {
    grit.cyl(x, 0, z, 5, 2.5, 8, [0.3, 0.31, 0.33], 0.9);
    for (var i = 0; i < 5; i++) grit.cyl(x, 2.5 + i * 4, z, 2.6 - i * 0.28, 4, 10, i % 2 ? [0.9, 0.9, 0.92] : [0.85, 0.22, 0.18], 0.92);
    grit.box(x, 22.5, z, 3.4, 2.8, 3.4, [0.15, 0.16, 0.18]);
    flat.box(x, 23, z, 1.8, 1.8, 1.8, [1.4, 1.2, 0.6]);
  }

  function buildStatic(B, biome, rng) {
    terrain(B.flat, B.grit, biome, rng);
    landforms(B.flat, biome, rng);
    if (biome.veg !== 'none') for (var v = 0; v < biome.vegN; v++) { var x = -160 + rng() * 320, z = 30 + rng() * 120; if (Math.abs(x) < 80 && z < 50) continue; tree(B.flat, x, z, rng, biome.veg); }
    lighthouse(B.grit, B.flat, -70, 8);
    // warehouses + buildings inland
    var wh = [-52, -26, 0, 26, 52];
    for (var i = 0; i < wh.length; i++) warehouse(B.grit, B.flat, wh[i], 24, 18, 13, rng);
    for (i = 0; i < 16; i++) { var bx = -78 + i * 10.5 + rng() * 3; if (Math.abs(bx) > 120) continue; building(B.fac, bx, 44 + rng() * 14, 7 + rng() * 2, 12 + rng() * 26, 8 + rng() * 3, rng); }
    ship(B.grit, B.flat, 0, -6, rng);
    craneStatic(B.grit, 0, -6);
    props(B.grit, B.flat, rng);
  }

  g.HARBOR_MODELS = { buildStatic: buildStatic, CONT: CONT };
})(window);
