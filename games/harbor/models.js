/* HARBOR — world generation + era-aware port assembly. window.HARBOR_MODELS
 * The world is a NOISE HEIGHTFIELD: undulating land whose coastline is wherever the field crosses
 * sea level → naturally curved coast, bays and headlands (no flat plate, no straight edge). The
 * player founds a port anywhere on the coast; port structures are built at a LOCAL origin and
 * baked to the chosen harbour frame {x,z,yaw} via Builder.addXform. era 0 = a primitive wild
 * village (shacks + jetty + dinghy); later eras add quay, warehouses, gantry crane, big ships and
 * a modern glTF skyline. Distant composite landforms remain the horizon backdrop. Procedural
 * except the glTF city blocks. heightAt()/rate() expose the field for founding + grounding.
 */
(function (g) {
  var TAU = Math.PI * 2;
  function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function jit(c, k, rng) { return [c[0] + (rng() - 0.5) * k, c[1] + (rng() - 0.5) * k, c[2] + (rng() - 0.5) * k]; }
  function pick(a, rng) { return a[(rng() * a.length) | 0]; }
  function hashStr(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var CONT = [[0.95, 0.32, 0.26], [0.20, 0.62, 0.86], [1.0, 0.78, 0.24], [0.28, 0.76, 0.48], [0.64, 0.42, 0.82], [0.98, 0.54, 0.64], [0.96, 0.96, 0.98]];

  // ---------------- value-noise heightfield ----------------
  var WORLD = { W: 2400, z0: -130, z1: 430, cell: 5 };
  var FIELD = null;
  function h2(ix, iz) { var n = (ix * 374761393 + iz * 668265263) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, z) {
    var x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0;
    var sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    var a = h2(x0, z0), b = h2(x0 + 1, z0), c = h2(x0, z0 + 1), d = h2(x0 + 1, z0 + 1);
    return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
  }
  function fbm(x, z) { var s = 0, a = 0.5, f = 1; for (var i = 0; i < 4; i++) { s += a * vnoise(x * f, z * f); f *= 2; a *= 0.5; } return s; }

  // a rugged ISLAND surrounded by water: high interior dropping below sea level all around, with a
  // FRACTAL (multi-octave) coastline + carved coves/inlets that read as real natural harbours
  // (Portsmouth/Falmouth-style indentations cutting into the land).
  var ISLAND = { cx: 0, cz: 150, ax: 560, az: 270 };
  var BAY = { x: 30, z: -55, r: 175, depth: 1.0 };                            // the one big, obvious natural harbour (front)
  var PLAIN = { x: 30, z: 45, ax: 340, az: 185, h: 3.2 };                     // flat, buildable apron behind the bay (room to expand huge)
  var MTN = { x: 0, z: 205, ax: 0.50, az: 0.46, h: 66 };                      // central snow-capped massif (pushed back to clear the harbour plain)
  var RIVERS = null;
  function isleCoves(seed) {
    var coves = [[BAY.x, BAY.z, BAY.r, BAY.depth]];                           // big harbour bay first
    for (var c = 0; c < 2; c++) {                                            // a couple of smaller natural coves
      var a = c * 2.7 + seed * 1.7 + 1.7;
      var rr = 0.80 + (fbm(c * 3.3 + seed, 1.1) - 0.5) * 0.14;
      coves.push([ISLAND.cx + Math.cos(a) * ISLAND.ax * rr, ISLAND.cz + Math.sin(a) * ISLAND.az * rr, 52 + fbm(c * 1.7 + seed, 2.2) * 48, 0.5 + fbm(c + seed, 4.0) * 0.35]);
    }
    return coves;
  }
  function genRivers(seed) {                                                  // rivers from the FOOTHILLS, winding AROUND the massif to the sea
    var rivers = [], n = 2;
    for (var r = 0; r < n; r++) {
      var ang = r * 2.7 + seed * 0.9 + 0.7, dirx = Math.cos(ang), dirz = Math.sin(ang), pts = [];
      for (var t = 0; t <= 11; t++) {
        var f = 0.36 + (t / 11) * 0.66, wob = (fbm(r * 7 + t * 0.5 + seed, t * 0.3) - 0.5) * 150 * (f - 0.3), perpx = -dirz, perpz = dirx;
        pts.push([MTN.x + dirx * ISLAND.ax * f + perpx * wob, MTN.z + dirz * ISLAND.az * f + perpz * wob, 6 + (f - 0.36) * 15]);
      }
      rivers.push(pts);
    }
    return rivers;
  }
  function riverDist(x, z) {                                                  // nearest distance to any river + its width there
    var best = 1e9, bw = 8;
    for (var r = 0; r < RIVERS.length; r++) { var p = RIVERS[r]; for (var k = 0; k < p.length - 1; k++) {
      var ax = p[k][0], az = p[k][1], bx = p[k + 1][0], bz = p[k + 1][1], dx = bx - ax, dz = bz - az;
      var t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      var qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz);
      if (d < best) { best = d; bw = p[k][2] + (p[k + 1][2] - p[k][2]) * t; }
    } }
    return { d: best, w: bw };
  }
  function genField(biome, seed) {
    var nx = Math.round(WORLD.W / WORLD.cell) + 1, nz = Math.round((WORLD.z1 - WORLD.z0) / WORLD.cell) + 1;
    var H = new Float32Array(nx * nz), RM = new Uint8Array(nx * nz), hilly = biome.hilliness || 1;
    var islets = [[-880, 120, 110], [840, 250, 95], [-160, -260, 80]];        // a few clean, rounded offshore isles in open water
    var coves = isleCoves(seed); RIVERS = genRivers(seed);
    for (var j = 0; j < nz; j++) {
      var z = WORLD.z0 + j * WORLD.cell;
      for (var i = 0; i < nx; i++) {
        var x = -WORLD.W / 2 + i * WORLD.cell;
        var rad = Math.hypot((x - ISLAND.cx) / ISLAND.ax, (z - ISLAND.cz) / ISLAND.az);
        var warp = (fbm(x * 0.006 + seed, z * 0.006 + seed) - 0.5) * 0.42
                 + (fbm(x * 0.015 + seed * 3, z * 0.015 + seed) - 0.5) * 0.22
                 + (fbm(x * 0.034 + seed * 5, z * 0.034 + seed) - 0.5) * 0.11;
        var e = (1 + warp) - rad;
        for (var cc = 0; cc < coves.length; cc++) {
          var dd = Math.hypot(x - coves[cc][0], z - coves[cc][1]) / coves[cc][2];
          dd *= 1 + (fbm(x * 0.022 + cc * 5 + seed, z * 0.022 - cc * 3) - 0.5) * 0.32;   // gentler, rounder cove edge (no slivers)
          if (dd < 1.2) { var ev = (dd - 0.58) * coves[cc][3] * 1.5; if (ev < e) e = ev; }
        }
        for (var k = 0; k < islets.length; k++) { var ir = Math.hypot((x - islets[k][0]) / islets[k][2], (z - islets[k][1]) / islets[k][2]); var ie = (1 - ir) * 0.7; if (ie > e) e = ie; }
        var h = e > 0 ? Math.min(e * 26, 14) : Math.max(e * 30, -4);
        if (e > 0) {
          var mc = Math.hypot((x - MTN.x) / (ISLAND.ax * MTN.ax), (z - MTN.z) / (ISLAND.az * MTN.az)), mt = clamp(1 - mc, 0, 1);
          if (mt > 0) {                                                              // craggy central massif (ridged fractal)
            var rg = 0, amp = 1, fr = 0.017;
            for (var o = 0; o < 4; o++) { var rn = 1 - Math.abs(fbm(x * fr + seed + o * 2, z * fr - o) * 2 - 1); rg += amp * rn * rn; fr *= 2.2; amp *= 0.5; }
            rg = clamp(rg / 1.55, 0, 1);
            h += Math.pow(mt, 1.55) * MTN.h * (0.30 + 0.95 * rg) * (0.9 + hilly * 0.1);
          }
          h += (fbm(x * 0.009 + seed * 4, z * 0.009 + 1.2) - 0.5) * 22 * hilly * clamp(e * 2, 0, 1)   // broad rolling hills (natural, integrated)
             + (fbm(x * 0.022 + seed * 2, z * 0.022 + 3.3) - 0.5) * 8 * hilly * clamp(e * 3, 0, 1);  // finer undulation
          var pr = Math.hypot((x - PLAIN.x) / PLAIN.ax, (z - PLAIN.z) / PLAIN.az);   // flatten the harbour expansion apron
          if (pr < 1) { var pk = (1 - pr); pk = pk * pk * 0.92; h = h * (1 - pk) + PLAIN.h * pk; }
          if (h < 24) {                                                              // rivers only run through the lowlands — never over the massif
            var rv = riverDist(x, z);
            if (rv.d < rv.w) { var rt = rv.d / rv.w; h = Math.min(h, -0.5 + rt * rt * 4); RM[j * nx + i] = 1; }
          }
        }
        if (h < -4) h = -4;
        H[j * nx + i] = h;
      }
    }
    FIELD = { H: H, RM: RM, nx: nx, nz: nz };
  }
  function heightAt(x, z) {
    if (!FIELD) return 0;
    var fx = (x + WORLD.W / 2) / WORLD.cell, fz = (z - WORLD.z0) / WORLD.cell;
    var i = Math.floor(fx), j = Math.floor(fz);
    i = clamp(i, 0, FIELD.nx - 2); j = clamp(j, 0, FIELD.nz - 2);
    var tx = fx - i, tz = fz - j, H = FIELD.H, nx = FIELD.nx;
    var a = H[j * nx + i], b = H[j * nx + i + 1], c = H[(j + 1) * nx + i], d = H[(j + 1) * nx + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
  // grad downhill direction (toward open sea) at (x,z)
  function seaDir(x, z) { var e = 6, gx = heightAt(x + e, z) - heightAt(x - e, z), gz = heightAt(x, z + e) - heightAt(x, z - e); var l = Math.hypot(gx, gz) || 1; return [-gx / l, -gz / l]; }
  function portYaw(x, z) { var s = seaDir(x, z); return Math.atan2(-s[0], -s[1]); } // local -z faces the sea

  // build the heightfield surface into the flat builder (per-vertex colour + normal)
  function buildFieldMesh(flat, biome) {
    var nx = FIELD.nx, nz = FIELD.nz, H = FIELD.H, RM = FIELD.RM, base = flat.P.length / 3;
    var sand = biome.beach || [0.88, 0.80, 0.55], grass = biome.ground, deep = [0.40, 0.46, 0.40];
    var mrock = mixc(biome.hill, [0.40, 0.38, 0.43], 0.62), river = [0.13, 0.42, 0.52], snow = [0.96, 0.97, 1.0];
    var snowLine = 45;
    for (var j = 0; j < nz; j++) {
      var z = WORLD.z0 + j * WORLD.cell;
      for (var i = 0; i < nx; i++) {
        var idx = j * nx + i, x = -WORLD.W / 2 + i * WORLD.cell, y = H[idx];
        var hl = H[j * nx + Math.max(0, i - 1)], hr = H[j * nx + Math.min(nx - 1, i + 1)];
        var hd = H[Math.max(0, j - 1) * nx + i], hu = H[Math.min(nz - 1, j + 1) * nx + i];
        var nX = hl - hr, nZ = hd - hu, nY = 2 * WORLD.cell, nl = Math.hypot(nX, nY, nZ) || 1;
        var slope = 1 - nY / nl, col;
        if (RM[idx]) col = river;                                              // winding river
        else if (y < -0.2) col = mixc(deep, sand, clamp((y + 3) / 2.8, 0, 1));
        else if (y < 1.1) col = sand;                                          // beach (wider sandy rim)
        else if (y < 7) col = grass;
        else if (y < 22) col = mixc(grass, mrock, clamp((y - 7) / 15, 0, 1));  // forested slope -> rock
        else col = mrock;                                                      // bare rock
        if (slope > 0.5 && y > 1.1 && !RM[idx]) col = mixc(col, mrock, clamp((slope - 0.5) * 2, 0, 1));
        if (y > snowLine) col = mixc(col, snow, clamp((y - snowLine) / 12, 0, 1)); // snow-capped peaks (all biomes)
        flat.P.push(x, y, z); flat.N.push(nX / nl, nY / nl, nZ / nl); flat.U.push(i * 0.25, j * 0.25); flat.C.push(col[0], col[1], col[2]);
      }
    }
    for (j = 0; j < nz - 1; j++) for (i = 0; i < nx - 1; i++) { var a = base + j * nx + i, b = a + 1, c = a + nx, d = c + 1; flat.I.push(a, c, b, b, c, d); }
  }

  // ---------------- vegetation (grounded on the field) ----------------
  function tree(flat, x, z, rng, kind, by) {
    var hy = by + 0.4;
    if (kind === 'palm') { var th = 5 + rng() * 3; flat.cyl(x, hy, z, 0.35, th, 6, [0.45, 0.34, 0.22], 0.7); for (var f = 0; f < 6; f++) flat.box(x, hy + th, z, 4.2, 0.3, 1.0, [0.16, 0.46, 0.20], f / 6 * TAU, 0.32); }
    else if (kind === 'pine') { flat.cyl(x, hy, z, 0.5, 2, 6, [0.36, 0.27, 0.18], 1); for (var c = 0; c < 3; c++) flat.cyl(x, hy + 1.5 + c * 2.2, z, 3 - c * 0.8, 2.6, 6, [0.12, 0.34, 0.19], 0.04); }
    else { flat.cyl(x, hy, z, 0.6, 2.4, 6, [0.38, 0.28, 0.18], 1); flat.cyl(x, hy + 2.2, z, 3.0, 4.2, 7, [0.18, 0.44, 0.20], 0.25); }
  }

  // ---------------- distant landforms (built at origin, baked onto the field) ----------------
  function landform(out, b, s, rng) {
    if (b.hillType === 'mountain') {
      var rock = jit(b.hill, 0.05, rng), dark = mul(rock, 0.7), peaks = 2 + (rng() * 3 | 0), spread = (20 + rng() * 16) * s;
      for (var p = 0; p < peaks; p++) {
        var px = (rng() - 0.5) * spread, pz = (rng() - 0.5) * spread * 0.6;
        var h = (44 + rng() * 50) * s * (0.7 + 0.5 * rng()), r = (16 + rng() * 12) * s;
        out.cyl(px, 0, pz, r * 1.15, h * 0.34, 6, dark, 0.55); out.cyl(px, h * 0.30, pz, r, h * 0.7, 5, rock, 0.04);
        if (b.snow) out.cyl(px, h * 0.60, pz, r * 0.5, h * 0.44, 5, [0.97, 0.98, 1.0], 0.05);
      }
    } else if (b.hillType === 'cliff') {
      var crock = jit(b.hill, 0.04, rng), steps = 4 + (rng() * 3 | 0), bw = (40 + rng() * 30) * s, bd = (26 + rng() * 18) * s, sh = (12 + rng() * 9) * s, y = 0;
      for (var st = 0; st < steps; st++) { var t = st / steps; out.box(0, y + sh / 2, 0, bw * (1 - t * 0.55), sh, bd * (1 - t * 0.55), mul(crock, st % 2 ? 0.98 : 0.84), rng() * 0.25); y += sh; }
      out.box(0, y + 0.6, 0, bw * 0.5, 1.2, bd * 0.5, b.snow ? [0.93, 0.95, 1.0] : mul(b.ground, 1.1), 0);
      out.cyl(0, -2, 0, bw * 0.65, sh * 0.7, 7, mul(crock, 0.78), 0.6);
    } else if (b.hillType === 'mesa') {
      var sand = jit(b.hill, 0.05, rng), layers = 4 + (rng() * 2 | 0), br = (24 + rng() * 16) * s, lh = (10 + rng() * 7) * s, my = 0;
      for (var l = 0; l < layers; l++) { var lt = l / layers; out.cyl(0, my, 0, br * (1 - lt * 0.45), lh, 6, mul(sand, l % 2 ? 1.0 : 0.84), 0.92); my += lh; }
      if (rng() < 0.5) out.cyl((rng() - 0.5) * br, 0, 0, (4 + rng() * 3) * s, (24 + rng() * 16) * s, 5, mul(sand, 0.9), 0.04);
    } else {
      var grass = jit(b.hill, 0.05, rng), mounds = 2 + (rng() * 3 | 0), msp = (24 + rng() * 18) * s;
      for (var m = 0; m < mounds; m++) out.cyl((rng() - 0.5) * msp, -2, (rng() - 0.5) * msp * 0.6, (20 + rng() * 18) * s, (12 + rng() * 16) * s, 7, jit(grass, 0.04, rng), 0.34);
    }
  }
  function landforms(flat, b, rng) {
    var target = Math.round(WORLD.W / 150), placed = 0, tries = 0;   // craggy rock outcrops on the mid slopes
    while (placed < target && tries < target * 12) {
      tries++;
      var cx = (rng() - 0.5) * (ISLAND.ax * 1.7), cz = ISLAND.cz + (rng() - 0.5) * (ISLAND.az * 1.5);
      var y = heightAt(cx, cz);
      if (y < 8 || y > 50) continue;                                 // on slopes, not the summit or lowlands
      var s = 0.5 + rng() * 0.7, tmp = new g.HGL.Builder(); landform(tmp, b, s, rng);
      flat.addXform(tmp, cx, y - 1, cz, rng() * TAU); placed++;
    }
  }

  // ---------------- port structures (LOCAL origin: water toward -z, land +z) ----------------
  function hut(flat, x, z, rng, b) {
    var wood = pick([[0.55, 0.40, 0.26], [0.62, 0.46, 0.30], [0.48, 0.34, 0.22], [0.66, 0.54, 0.40]], rng);
    var w = 4 + rng() * 2, h = 3 + rng() * 1.5, d = 4 + rng() * 2, rot = (rng() - 0.5) * 0.5;
    flat.box(x, h / 2, z, w, h, d, wood, rot);
    var roof = b.build ? b.build.roof : [0.4, 0.2, 0.15];
    flat.box(x - w * 0.26, h + 1.0, z, w * 0.62, 0.5, d * 1.08, roof, rot, 0.7);
    flat.box(x + w * 0.26, h + 1.0, z, w * 0.62, 0.5, d * 1.08, roof, rot, -0.7);
    flat.box(x, h * 0.4, z + d * 0.5 + 0.05, w * 0.3, h * 0.5, 0.3, [0.2, 0.14, 0.1], rot);
  }
  function dinghy(flat, x, z, rng) {
    var rot = (rng() - 0.5) * 0.8, wood = pick([[0.62, 0.44, 0.28], [0.7, 0.5, 0.32], [0.55, 0.40, 0.26]], rng);
    var c = Math.cos(rot), s = Math.sin(rot), bx = x + c * 3.0, bz = z - s * 3.0;   // bow offset along the hull
    flat.box(x, 0.25, z, 5.0, 1.1, 2.0, wood, rot);                                  // main hull
    flat.box(bx, 0.45, bz, 1.7, 0.85, 1.2, wood, rot, 0.5);                          // tilted-up pointed bow
    flat.cyl(x - c * 0.6, 0.8, z + s * 0.6, 0.95, 0.95, 10, mul(wood, 0.82), 0.85);  // rounded cabin
    flat.box(x + c * 0.6, 2.0, z - s * 0.6, 0.16, 3.2, 0.16, [0.42, 0.30, 0.2], rot); // mast
    flat.cyl(x + c * 0.6, 0.85, z - s * 0.6, 1.1, 3.0, 3, [0.95, 0.94, 0.9], 0.05);   // triangular sail
  }
  function woodenJetty(flat, x) {
    flat.box(x, 0.8, 8, 6, 0.5, 18, [0.52, 0.4, 0.27], 0);
    for (var sx = -2; sx <= 2; sx += 2) for (var sz = 1; sz <= 15; sz += 7) flat.cyl(x + sx, -2.5, sz, 0.45, 3.3, 6, [0.36, 0.26, 0.17], 1);
  }
  function concreteQuay(grit, flat, era) { var w = 150 + era * 18; grit.box(0, 1.1, 15, w, 2.2, 24, [0.64, 0.64, 0.66], 0, 0, 7); grit.box(0, 1.0, 3.6, w, 1.8, 1.4, [0.5, 0.5, 0.52], 0); for (var bx = -w / 2 + 6; bx <= w / 2 - 6; bx += 12) grit.cyl(bx, 0, 4.4, 0.5, 1.5, 6, [0.16, 0.17, 0.19], 0.8); }
  function freighter(grit, flat, x, z, rng) {
    var L = 38, B = 11, deck = 1.8, hb = -2.6, hull = [0.30, 0.34, 0.42];
    grit.box(x, hb + 2.2, z, L * 0.76, 4.4, B, hull, 0, 0, 3); grit.box(x - L * 0.42, hb + 2.2, z, L * 0.14, 4.4, B * 0.66, hull, 0.2); grit.box(x + L * 0.42, hb + 2.2, z, L * 0.14, 4.4, B * 0.82, hull, -0.13);
    flat.box(x, hb + 0.4, z, L * 0.9, 0.7, B + 0.2, [0.82, 0.26, 0.2], 0);
    var ci = 0; for (var cx = -10; cx <= 8; cx += 4.6) { var stk = 1 + (rng() * 2 | 0); for (var r = 0; r < stk; r++) flat.box(x + cx, deck + 0.9 + r * 2.0, z, 4.2, 1.9, B - 1.5, CONT[(ci + r) % CONT.length], 0); ci++; }
    grit.box(x + L * 0.36, deck + 3.0, z, 5, 5.5, B * 0.8, [0.9, 0.92, 0.95], 0, 0, 2); flat.cyl(x + L * 0.36 + 1.5, deck + 6, z, 1.3, 3.2, 9, [0.2, 0.22, 0.26], 1);
  }
  function containerShip(grit, flat, x, z, rng, scale) {
    var s = scale || 1, L = 72 * s, B = 18 * s, deck = 2.4, hb = -4.0, hull = [0.12, 0.16, 0.24], accent = [0.90, 0.24, 0.18];
    grit.box(x, hb + 3.2, z, L * 0.72, 6.4, B, hull, 0, 0, 3); grit.box(x - L * 0.41, hb + 3.4, z, L * 0.16, 6.0, B * 0.66, hull, 0.2); grit.box(x + L * 0.42, hb + 3.2, z, L * 0.14, 6.4, B * 0.86, hull, -0.12);
    flat.cyl(x - L * 0.5, hb + 1.0, z, 1.8, B * 0.5, 8, mul(hull, 1.2), 0.5);
    flat.box(x, hb + 0.6, z, L * 0.94, 1.0, B + 0.3, accent, 0); flat.box(x, deck + 0.05, z, L * 0.9, 0.3, B - 0.5, [0.18, 0.2, 0.24], 0);
    for (var rr = -1; rr <= 1; rr += 2) flat.box(x, deck + 0.8, z + rr * (B / 2 - 0.3), L * 0.9, 0.12, 0.12, [0.85, 0.87, 0.9], 0);
    var ci = 0; for (var cx = -L * 0.36; cx <= L * 0.28; cx += 5.6 * s) for (var row = -1; row <= 1; row++) { var stk = 2 + (rng() * 4 | 0); for (var r = 0; r < stk; r++) flat.box(x + cx, deck + 0.6 + r * 2.5, z + row * 4.2 * s, 5.2 * s, 2.4, 3.8 * s, CONT[(ci + r) % CONT.length], 0); ci++; }
    var bx = x + L * 0.40; grit.box(bx, deck + 6, z, 8 * s, 12, B * 0.82, [0.93, 0.94, 0.96], 0, 0, 2);
    for (var wy = 0; wy < 4; wy++) flat.box(bx - 4.1 * s, deck + 3 + wy * 2.4, z, 0.3, 1.2, B * 0.74, [0.10, 0.16, 0.26], 0);
    flat.box(bx + 1.6, deck + 13.5, z, 4.4 * s, 3.0, 4.4 * s, accent, 0); flat.cyl(bx + 1.6, deck + 12, z, 2.0, 2.0, 10, [0.18, 0.2, 0.24], 1);
    flat.cyl(bx - 2, deck + 12, z, 0.2, 6, 6, [0.7, 0.72, 0.75], 1); flat.box(bx - 2, deck + 18, z, 3.2, 0.3, 0.3, [0.7, 0.72, 0.75], 0);
  }
  function warehouse(grit, flat, x, z, w, d, rng, b) {
    var h = 8 + rng() * 3, col = jit([0.64, 0.66, 0.70], 0.1, rng);
    grit.box(x, h / 2, z, w, h, d, col, 0, 0, 2); grit.box(x, h + 0.5, z, w + 1.2, 1.2, d + 1.2, mul(b.build ? b.build.roof : [0.4, 0.3, 0.3], 0.9), 0, 0, 1);
    var dn = Math.max(2, Math.round(w / 7)); for (var i = 0; i < dn; i++) flat.box(x - w / 2 + (i + 0.5) * w / dn, 2.6, z + d / 2 + 0.05, w / dn * 0.7, 5, 0.4, [0.22, 0.23, 0.26], 0);
  }
  function craneStatic(grit, baseX, z) {
    var col = [0.98, 0.80, 0.20], h = 32, lx = [baseX - 11, baseX + 11], lz = [z + 9, z - 9];
    for (var a = 0; a < 2; a++) for (var bI = 0; bI < 2; bI++) { grit.box(lx[a], h / 2, lz[bI], 2.2, h, 2.2, col); grit.box(lx[a], h * 0.5, lz[bI], 1.1, h * 0.9, 1.1, mul(col, 0.92), 0, (a ? -0.5 : 0.5)); }
    grit.box(lx[0], h, z, 2.4, 2.4, 20, col); grit.box(lx[1], h, z, 2.4, 2.4, 20, col); grit.box(baseX, h, lz[0], 24, 2.4, 2.6, col); grit.box(baseX, h, lz[1], 24, 2.4, 2.6, col);
    grit.box(baseX, h + 2.1, z - 14, 30, 2.6, 3.0, col); grit.box(baseX, h + 2.1, z + 5, 30, 2.6, 3.0, col); grit.box(baseX - 7, h + 2.6, z, 7, 4.8, 9, [0.22, 0.24, 0.28]);
  }
  function props(grit, flat, rng, era) {
    for (var mx = -56; mx <= 56; mx += 28) { grit.cyl(mx, 0, 12, 0.4, 12, 6, [0.3, 0.31, 0.33], 1); flat.box(mx, 12, 12, 2.4, 0.5, 0.8, [1.0, 0.95, 0.7], 0); }
    var ci = 0; for (var yx = 28; yx <= 28 + era * 8; yx += 5.4) for (var yz = 16; yz <= 22; yz += 5.6) { var stk = 1 + (rng() * 2 | 0); for (var r = 0; r < stk; r++) flat.box(yx, 0.4 + r * 2.4, yz, 5, 2.3, 5, CONT[(ci + r) % CONT.length], 0); ci++; }
  }
  function lighthouse(grit, flat, x, z) {
    grit.cyl(x, 0, z, 5, 2.5, 8, [0.3, 0.31, 0.33], 0.9);
    for (var i = 0; i < 5; i++) grit.cyl(x, 2.5 + i * 4, z, 2.6 - i * 0.28, 4, 10, i % 2 ? [0.95, 0.95, 0.97] : [0.92, 0.26, 0.22], 0.92);
    grit.box(x, 22.5, z, 3.4, 2.8, 3.4, [0.15, 0.16, 0.18]); flat.box(x, 23, z, 1.8, 1.8, 1.8, [1.5, 1.3, 0.6]);
  }

  // assemble the port at LOCAL origin for the given era; returns local placements
  function assemblePort(L, biome, rng, era) {
    var sc = { city: [], blobs: [], crane: era >= 2 };
    if (era === 0) {
      // primitive wild village: a few shacks, one jetty, a fishing boat
      woodenJetty(L.flat, 0);
      var huts = 3 + (rng() * 2 | 0);
      for (var hI = 0; hI < huts; hI++) { var hx = -16 + rng() * 32, hz = 24 + rng() * 14; hut(L.flat, hx, hz, rng, biome); sc.blobs.push({ x: hx, z: hz, r: 5 }); }
      dinghy(L.flat, -4 + rng() * 8, -3, rng); sc.blobs.push({ x: 0, z: 8, r: 7 });
    } else {
      concreteQuay(L.grit, L.flat, era); lighthouse(L.grit, L.flat, -70, 8); sc.blobs.push({ x: -70, z: 8, r: 6 });
      var whN = Math.min(6, 1 + era);
      for (var w = 0; w < whN; w++) { var wx = -52 + w * 22; warehouse(L.grit, L.flat, wx, 26, 18, 13, rng, biome); sc.blobs.push({ x: wx, z: 26, r: 12 }); }
      var cityN = Math.min(16, 3 + era * 3);
      for (var cI = 0; cI < cityN; cI++) { var bx = -110 + rng() * 220; if (Math.abs(bx) > 150) continue; var bz = 50 + rng() * 60; sc.city.push({ x: bx, z: bz, s: 6.5 + rng() * 3.5, rot: (rng() * 4 | 0) * (Math.PI / 2), bi: (rng() * 8) | 0, tint: [1, 1, 1] }); sc.blobs.push({ x: bx, z: bz, r: 9 }); }
      if (era === 1) freighter(L.grit, L.flat, 0, -6, rng); else containerShip(L.grit, L.flat, 0, -6, rng, 1 + Math.min(0.5, (era - 2) * 0.18));
      sc.blobs.push({ x: 0, z: -6, r: 22 });
      if (era >= 2) { craneStatic(L.grit, 0, -6); sc.blobs.push({ x: 0, z: -6, r: 14 }); }
      props(L.grit, L.flat, rng, era);
    }
    return sc;
  }

  // ---------------- founding rating ----------------
  function rate(x, z) {
    var landCount = 0, N = 16;
    for (var k = 0; k < N; k++) { var a = k / N * TAU; if (heightAt(x + Math.cos(a) * 44, z + Math.sin(a) * 44) > 0.4) landCount++; }
    var shelter = landCount / N;
    var depth = -heightAt(x, z - 34);
    var navigable = clamp(depth / 2.2, 0, 1);
    var here = heightAt(x, z), onCoast = here > -2.2 && here < 1.8;
    var score = shelter * 0.6 + navigable * 0.4;
    var stars = !onCoast ? 0 : score > 0.62 ? 3 : score > 0.38 ? 2 : 1;
    var label = !onCoast ? (here >= 1.8 ? 'Inland — move to the coast' : 'Open water — move closer')
      : stars === 3 ? 'Sheltered harbour' : stars === 2 ? 'Workable harbour' : 'Exposed coast';
    return { shelter: shelter, depth: depth, score: score, stars: stars, label: label, onCoast: onCoast, y: here };
  }

  // ONE obvious harbour: the best-sheltered spot inside the big front bay.
  function sites() {
    if (!FIELD) return [];
    var best = null, x, z;
    for (x = BAY.x - BAY.r; x <= BAY.x + BAY.r; x += 16)
      for (z = BAY.z - BAY.r; z <= BAY.z + BAY.r; z += 16) {
        if (Math.hypot(x - BAY.x, z - BAY.z) > BAY.r) continue;
        var r = rate(x, z);
        if (r.onCoast) { var sc = r.shelter * 0.5 + clamp(r.depth / 2.2, 0, 1) * 0.5; if (!best || sc > best.score) best = { x: x, z: z, score: sc }; }
      }
    if (!best) for (x = -420; x <= 420; x += 30) for (z = -170; z <= 80; z += 14) { var rr = rate(x, z); if (rr.onCoast && (!best || rr.score > best.score)) best = { x: x, z: z, score: rr.score }; }
    if (!best) return [];
    return [{ x: Math.round(best.x), z: Math.round(best.z), yaw: portYaw(best.x, best.z), stars: 3, name: 'Great Harbour', score: +best.score.toFixed(2) }];
  }

  // ---------------- top-level build ----------------
  function buildStatic(B, biome, rng, era, port) {
    era = era | 0;
    var seed = (hashStr(biome.id) % 997) * 0.013;
    genField(biome, seed);
    buildFieldMesh(B.flat, biome);
    if (biome.hillType !== 'hill') landforms(B.flat, biome, rng);   // craggy rock props only for mountain/cliff/mesa; green/tropical use natural rolling terrain
    if (biome.veg !== 'none') {                            // dense forest on the lower/mid slopes
      var nv = Math.round((biome.vegN + 30) * WORLD.W / 760 * 1.7), hw = WORLD.W * 0.48;
      for (var v = 0; v < nv; v++) {
        var x = -hw + rng() * hw * 2, z = -120 + rng() * 560, y = heightAt(x, z);
        if (y < 1.1 || y > 28) continue;                 // dry land below the rock line
        if (port && Math.abs(x - port.x) < 46 && Math.abs(z - port.z) < 46) continue;
        var pr = Math.hypot((x - PLAIN.x) / (PLAIN.ax * 0.82), (z - PLAIN.z) / (PLAIN.az * 0.82));
        if (pr < 1 && rng() < 0.82) continue;            // keep the harbour apron mostly clear for building
        tree(B.flat, x, z, rng, biome.veg, y);
      }
    }
    for (var bk = 0, bt = 0; bk < 8 && bt < 80; bt++) {    // little boats dotted in the water around the island
      var bx = -760 + rng() * 1520, bz = -210 + rng() * 760, byy = heightAt(bx, bz);
      if (byy > -3.2 && byy < -0.7) { dinghy(B.flat, bx, bz, rng); bk++; }
    }
    var scene = { city: [], blobs: [], crane: false, era: era, founded: !!port, port: null };
    if (!port) return scene;                               // wild, unfounded — no structures

    var by = heightAt(port.x, port.z); if (by < 0.3) by = 0.3;
    var yaw = (port.yaw == null) ? portYaw(port.x, port.z) : port.yaw;
    scene.port = { x: port.x, z: port.z, by: by, yaw: yaw };
    var L = { fac: new g.HGL.Builder(), grit: new g.HGL.Builder(), flat: new g.HGL.Builder() };
    var lsc = assemblePort(L, biome, rng, era);
    B.fac.addXform(L.fac, port.x, by, port.z, yaw); B.grit.addXform(L.grit, port.x, by, port.z, yaw); B.flat.addXform(L.flat, port.x, by, port.z, yaw);
    var c = Math.cos(yaw), s = Math.sin(yaw);
    function W(p) { return { x: p.x * c + p.z * s + port.x, z: -p.x * s + p.z * c + port.z }; }
    lsc.city.forEach(function (p) { var w = W(p); scene.city.push({ x: w.x, z: w.z, s: p.s, rot: p.rot + yaw, bi: p.bi, tint: p.tint }); });
    lsc.blobs.forEach(function (b) { var w = W(b); scene.blobs.push({ x: w.x, z: w.z, r: b.r }); });
    scene.crane = lsc.crane;
    return scene;
  }

  g.HARBOR_MODELS = { buildStatic: buildStatic, heightAt: heightAt, rate: rate, sites: sites, portYaw: portYaw, CONT: CONT, WORLD: WORLD };
})(window);
