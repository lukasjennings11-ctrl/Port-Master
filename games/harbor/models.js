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
  // Phase 16b VIBRANT STORYBOOK: bigger, chunkier canopies with a visible tier or two — each kind
  // keeps its old vertex shape (no new cylinders on palm/pine — just scaled up, budget-free) except
  // the broadleaf 'hill' tree, which gains ONE extra small top tier (still just 2 cyls total, +1
  // over the old single-canopy shape) so it reads as a lumpy layered canopy instead of a smooth
  // cone — the #1 silhouette most on-screen (green isles' default world).
  function tree(flat, x, z, rng, kind, by) {
    var hy = by + 0.4;
    if (kind === 'palm') { var th = 5 + rng() * 3; flat.cyl(x, hy, z, 0.40, th, 6, [0.48, 0.36, 0.22], 0.7); for (var f = 0; f < 6; f++) flat.box(x, hy + th, z, 5.4, 0.34, 1.3, [0.14, 0.56, 0.20], f / 6 * TAU, 0.30); }
    else if (kind === 'pine') { flat.cyl(x, hy, z, 0.56, 2.2, 6, [0.38, 0.28, 0.17], 1); for (var c = 0; c < 3; c++) flat.cyl(x, hy + 1.6 + c * 2.5, z, 3.7 - c * 0.95, 3.1, 6, [0.10, 0.40, 0.20], 0.04); }
    else { // broadleaf: trunk + two chunky canopy tiers (bigger base, smaller lumpy top)
      flat.cyl(x, hy, z, 0.66, 2.5, 6, [0.40, 0.28, 0.17], 0.92);
      flat.cyl(x, hy + 2.3, z, 3.6, 4.4, 7, [0.16, 0.52, 0.20], 0.28);
      flat.cyl(x, hy + 5.6, z, 2.15, 2.6, 6, [0.24, 0.62, 0.22], 0.30);
    }
  }
  // Phase 16b: cheap static lushness — small bushes + flower dots scattered on the grass near a
  // FOUNDED port only (the always-visible "hero" area). Bounded, budget-capped count (see the
  // scatterLushness() caller below); one box (24 verts) per flower, one small cyl (32 verts) per
  // bush — far cheaper than another tree, but enough colour confetti to read as a storybook
  // meadow rather than bare grass right around the harbour.
  function bush(flat, x, z, rng, y) {
    var g = jit([0.18, 0.54, 0.20], 0.07, rng);
    flat.cyl(x, y + 0.02, z, 0.85 + rng() * 0.55, 0.9 + rng() * 0.5, 6, g, 0.5);
  }
  var FLOWER_HUES = [[0.97, 0.28, 0.40], [0.99, 0.82, 0.16], [0.94, 0.94, 0.99], [0.66, 0.32, 0.90], [1.0, 0.56, 0.20]];
  function flower(flat, x, z, rng) {
    var y = heightAt(x, z), petal = pick(FLOWER_HUES, rng);
    flat.box(x, y + 0.32, z, 0.46, 0.64, 0.46, petal, rng() * TAU);
  }
  function scatterLushness(flat, rng, port, biome) {
    if (!port || biome.veg === 'none') return;
    var n = 46, placed = 0, tries = 0;
    while (placed < n && tries < n * 3) {
      tries++;
      var a = rng() * TAU, r = 22 + rng() * 60;
      var x = port.x + Math.cos(a) * r, z = port.z + Math.sin(a) * r, y = heightAt(x, z);
      if (y < 1.1 || y > 8) continue;                          // grass band only, never sand/rock
      if (Math.abs(x - port.x) < 16 && Math.abs(z - port.z) < 16) continue;   // keep the harbour core clear
      if (placed % 3 === 0) bush(flat, x, z, rng, y); else flower(flat, x, z, rng);
      placed++;
    }
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
  // Phase 16b: hut wood + prop colours pushed warmer/more saturated — confident toy-like hues
  // rather than desaturated realism (the biome's own build.wall/roof palette in biomes.js carries
  // the bigger structures; these are the small shared kit pieces every era reuses).
  function hut(flat, x, z, rng, b) {
    var wood = pick([[0.62, 0.42, 0.24], [0.70, 0.48, 0.26], [0.52, 0.34, 0.20], [0.74, 0.58, 0.36]], rng);
    var w = 4 + rng() * 2, h = 3 + rng() * 1.5, d = 4 + rng() * 2, rot = (rng() - 0.5) * 0.5;
    flat.bbox(x, h / 2, z, w, h, d, wood, rot, Math.min(w, d) * 0.11);   // softened top edges (10b shape language)
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
  function concreteQuay(grit, flat, era) { var w = 150 + era * 18; grit.bbox(0, 1.1, 15, w, 2.2, 24, [0.70, 0.68, 0.64], 0, 0.7, 7); grit.box(0, 1.0, 3.6, w, 1.8, 1.4, [0.56, 0.54, 0.50], 0); for (var bx = -w / 2 + 6; bx <= w / 2 - 6; bx += 12) grit.cyl(bx, 0, 4.4, 0.5, 1.5, 6, [0.16, 0.17, 0.19], 0.8); }
  function freighter(grit, flat, x, z, rng) {
    var L = 38, B = 11, deck = 1.8, hb = -2.6, hull = [0.30, 0.34, 0.42];
    grit.bbox(x, hb + 2.2, z, L * 0.76, 4.4, B, hull, 0, 1.0, 3); grit.bbox(x - L * 0.42, hb + 2.2, z, L * 0.14, 4.4, B * 0.66, hull, 0.2, 0.8); grit.bbox(x + L * 0.42, hb + 2.2, z, L * 0.14, 4.4, B * 0.82, hull, -0.13, 0.8);
    flat.box(x, hb + 0.4, z, L * 0.9, 0.7, B + 0.2, [0.82, 0.26, 0.2], 0);
    var ci = 0; for (var cx = -10; cx <= 8; cx += 4.6) { var stk = 1 + (rng() * 2 | 0); for (var r = 0; r < stk; r++) flat.bbox(x + cx, deck + 0.9 + r * 2.0, z, 4.2, 1.9, B - 1.5, CONT[(ci + r) % CONT.length], 0, 0.3); ci++; }
    grit.bbox(x + L * 0.36, deck + 3.0, z, 5, 5.5, B * 0.8, [0.9, 0.92, 0.95], 0, 0.6, 2); flat.cyl(x + L * 0.36 + 1.5, deck + 6, z, 1.3, 3.2, 9, [0.2, 0.22, 0.26], 1);
  }
  function containerShip(grit, flat, x, z, rng, scale) {
    var s = scale || 1, L = 72 * s, B = 18 * s, deck = 2.4, hb = -4.0, hull = [0.12, 0.16, 0.24], accent = [0.90, 0.24, 0.18];
    grit.bbox(x, hb + 3.2, z, L * 0.72, 6.4, B, hull, 0, 1.2, 3); grit.bbox(x - L * 0.41, hb + 3.4, z, L * 0.16, 6.0, B * 0.66, hull, 0.2, 1.0); grit.bbox(x + L * 0.42, hb + 3.2, z, L * 0.14, 6.4, B * 0.86, hull, -0.12, 1.0);
    flat.cyl(x - L * 0.5, hb + 1.0, z, 1.8, B * 0.5, 8, mul(hull, 1.2), 0.5);
    flat.box(x, hb + 0.6, z, L * 0.94, 1.0, B + 0.3, accent, 0); flat.box(x, deck + 0.05, z, L * 0.9, 0.3, B - 0.5, [0.18, 0.2, 0.24], 0);
    for (var rr = -1; rr <= 1; rr += 2) flat.box(x, deck + 0.8, z + rr * (B / 2 - 0.3), L * 0.9, 0.12, 0.12, [0.85, 0.87, 0.9], 0);
    var ci = 0; for (var cx = -L * 0.36; cx <= L * 0.28; cx += 5.6 * s) for (var row = -1; row <= 1; row++) { var stk = 2 + (rng() * 4 | 0); for (var r = 0; r < stk; r++) flat.bbox(x + cx, deck + 0.6 + r * 2.5, z + row * 4.2 * s, 5.2 * s, 2.4, 3.8 * s, CONT[(ci + r) % CONT.length], 0, 0.32); ci++; }
    var bx = x + L * 0.40; grit.bbox(bx, deck + 6, z, 8 * s, 12, B * 0.82, [0.93, 0.94, 0.96], 0, 0.8, 2);
    for (var wy = 0; wy < 4; wy++) flat.box(bx - 4.1 * s, deck + 3 + wy * 2.4, z, 0.3, 1.2, B * 0.74, [0.10, 0.16, 0.26], 0);
    flat.bbox(bx + 1.6, deck + 13.5, z, 4.4 * s, 3.0, 4.4 * s, accent, 0, 0.45); flat.cyl(bx + 1.6, deck + 12, z, 2.0, 2.0, 10, [0.18, 0.2, 0.24], 1);
    flat.cyl(bx - 2, deck + 12, z, 0.2, 6, 6, [0.7, 0.72, 0.75], 1); flat.box(bx - 2, deck + 18, z, 3.2, 0.3, 0.3, [0.7, 0.72, 0.75], 0);
  }
  function warehouse(grit, flat, x, z, w, d, rng, b) {
    var h = 8 + rng() * 3, col = jit([0.78, 0.74, 0.62], 0.10, rng);
    grit.bbox(x, h / 2, z, w, h, d, col, 0, Math.min(w, d) * 0.09, 2); grit.bbox(x, h + 0.5, z, w + 1.2, 1.2, d + 1.2, mul(b.build ? b.build.roof : [0.4, 0.3, 0.3], 0.9), 0, 0.5, 1);
    var dn = Math.max(2, Math.round(w / 7)); for (var i = 0; i < dn; i++) flat.box(x - w / 2 + (i + 0.5) * w / dn, 2.6, z + d / 2 + 0.05, w / dn * 0.7, 5, 0.4, [0.22, 0.23, 0.26], 0);
  }
  function craneStatic(grit, baseX, z) {
    var col = [1.0, 0.78, 0.08], h = 32, lx = [baseX - 11, baseX + 11], lz = [z + 9, z - 9];
    for (var a = 0; a < 2; a++) for (var bI = 0; bI < 2; bI++) { grit.box(lx[a], h / 2, lz[bI], 2.2, h, 2.2, col); grit.box(lx[a], h * 0.5, lz[bI], 1.1, h * 0.9, 1.1, mul(col, 0.92), 0, (a ? -0.5 : 0.5)); }
    grit.box(lx[0], h, z, 2.4, 2.4, 20, col); grit.box(lx[1], h, z, 2.4, 2.4, 20, col); grit.box(baseX, h, lz[0], 24, 2.4, 2.6, col); grit.box(baseX, h, lz[1], 24, 2.4, 2.6, col);
    grit.box(baseX, h + 2.1, z - 14, 30, 2.6, 3.0, col); grit.box(baseX, h + 2.1, z + 5, 30, 2.6, 3.0, col); grit.bbox(baseX - 7, h + 2.6, z, 7, 4.8, 9, [0.22, 0.24, 0.28], 0, 0.6);
  }
  function props(grit, flat, rng, era) {
    for (var mx = -56; mx <= 56; mx += 28) { grit.cyl(mx, 0, 12, 0.4, 12, 6, [0.3, 0.31, 0.33], 1); flat.box(mx, 12, 12, 2.4, 0.5, 0.8, [1.0, 0.95, 0.7], 0); }
    var ci = 0; for (var yx = 28; yx <= 28 + era * 8; yx += 5.4) for (var yz = 16; yz <= 22; yz += 5.6) { var stk = 1 + (rng() * 2 | 0); for (var r = 0; r < stk; r++) flat.bbox(yx, 0.4 + r * 2.4, yz, 5, 2.3, 5, CONT[(ci + r) % CONT.length], 0, 0.35); ci++; }
  }
  function lighthouse(grit, flat, x, z) {
    grit.cyl(x, 0, z, 5, 2.5, 8, [0.3, 0.31, 0.33], 0.9);
    for (var i = 0; i < 5; i++) grit.cyl(x, 2.5 + i * 4, z, 2.6 - i * 0.28, 4, 10, i % 2 ? [0.97, 0.97, 0.98] : [0.96, 0.20, 0.16], 0.92);
    grit.box(x, 22.5, z, 3.4, 2.8, 3.4, [0.15, 0.16, 0.18]); flat.box(x, 23, z, 1.8, 1.8, 1.8, [1.5, 1.3, 0.6]);
  }

  // ---------------- Phase 17a: technology-age silhouettes (Automated Harbour / Neon Horizon) ----
  // Same shared-kit approach as the rest of the port (chamfered boxes + cylinders, no new asset
  // pipeline) but a deliberately different palette — glassy blues + steel instead of wood/brick —
  // so era6/7 read as a distinct skyline the moment the outline pass (14a) picks out their silhouette.
  var GLASS_STEEL = [0.72, 0.75, 0.80], GLASS_PANE = [0.55, 0.78, 0.92], SOLAR_BLUE = [0.20, 0.55, 0.85];
  var NEON_HUES = [[0.35, 0.85, 0.95], [0.95, 0.45, 0.85], [0.55, 0.95, 0.65]];
  // Automated Harbour: a slim steel-framed tower with a stack of glass curtain-wall bands and a
  // tilted rooftop solar array — the age's signature silhouette (also SIM.BT's Solar Spire flavour).
  function solarSpire(grit, flat, x, z, rng) {
    var h = 24 + rng() * 8;
    grit.bbox(x, h / 2, z, 5.0, h, 5.0, GLASS_STEEL, 0, 0.55, 3);
    for (var f = 3.2; f < h - 2; f += 3.6) flat.box(x, f, z + 2.6, 4.4, 1.5, 0.18, GLASS_PANE, 0, 0, 0.2);
    flat.box(x, h + 1.3, z, 7.2, 0.3, 3.8, SOLAR_BLUE, 0.05, 0.3);   // tilted rooftop solar array
    flat.cyl(x, h + 0.1, z, 0.55, 0.9, 6, GLASS_STEEL, 0.7);
  }
  // Neon Horizon: a stepped glass skyscraper ringed in a glowing accent colour + rooftop beacon —
  // three tints rotate through a port so a Neon Horizon skyline never reads as one repeated block.
  function neonTower(grit, flat, x, z, rng) {
    var h = 32 + rng() * 16, accent = pick(NEON_HUES, rng), glass = [0.28, 0.34, 0.48];
    grit.bbox(x, h * 0.42, z, 7.6, h * 0.84, 7.6, glass, 0, 0.5, 3);
    grit.bbox(x, h * 0.94, z, 5.2, h * 0.20, 5.2, mul(glass, 1.15), 0, 0.5, 2);
    for (var b = 0; b < 3; b++) flat.box(x, h * (0.24 + b * 0.28), z, 7.9, 0.28, 7.9, accent, 0, 0, 0.5);
    flat.box(x, h + 1.1, z, 0.35, 2.2, 0.35, accent, 0);   // antenna beacon
  }
  // Automated Harbour: a drone landing pad (Drone Bay) — a low glowing disc with a few parked
  // delivery drones, ringing the crane/quay rather than joining the tower skyline.
  function droneBayPad(grit, flat, x, z, rng) {
    grit.cyl(x, 0.28, z, 6.2, 0.55, 10, [0.66, 0.68, 0.72], 0.85);
    flat.cyl(x, 0.60, z, 5.3, 0.1, 10, SOLAR_BLUE, 0.9);
    for (var i = 0; i < 3; i++) { var a = i * 2.15 + rng() * 0.4, dx = x + Math.cos(a) * 3.2, dz = z + Math.sin(a) * 3.2; flat.bbox(dx, 0.95, dz, 0.85, 0.4, 0.85, [0.86, 0.87, 0.9], a, 0.2); }
  }

  // ---------------- SHIPYARD (Phase 16a): real ship classes, not a hull-box + triangle ----------
  // Local ship space: +Z is the BOW (forward/heading — matches composeRYS's rotateY convention
  // used for every moving hull in game.js: at yaw=0 a ship's local +Z axis maps to world +Z, the
  // same axis the fleet/ambient heading math already points ships along), +X is beam (port/
  // starboard), +Y is up, origin at the waterline amidships.
  //
  // Every class is data (a SPEC object: length/beam/height, mast positions+heights, sail list,
  // which optional parts it has) fed through ONE generic assemble() using a small shared kit of
  // part-builders (hullTint/keel/deckPlanks/gunwale/rudder/bowsprit/mastPole/boom/strut/pennant/
  // sternCabin/barrel/crate/sail builders) — so a LATER phase's raft/cog/clipper/paddle-steamer/
  // container-ship/trawler/hydrofoil/solar-trimaran/hover-freighter just add another SPEC entry,
  // never copy-pasted geometry code.
  //
  // Each build() returns { hull, trim, sails, meta }:
  //   hull  — TINT-READY (flat [1,1,1] vertex colour) so game.js's uBase uniform can recolour the
  //           whole hull at draw time: resource tint for route freighters, black for the rival,
  //           dark steel for the steamer — exactly like the old single hullMesh did.
  //   trim  — bakes its OWN real per-vertex colours (keel, deck planks, gunwale, rudder, bowsprit,
  //           mast+boom, rigging struts, stern cabin, masthead pennant, deck props, and — for the
  //           steamer — funnel/bridge/containers) and is meant to be drawn with uVCol=1 in one
  //           call, so every part keeps its true tone regardless of the hull's runtime tint.
  //   sails — EACH a separate small mesh with its own mast offset already baked into its vertices,
  //           so game.js can billow/sway every sail on its own phase reusing the ship's existing
  //           composeRYS call — no extra per-sail transform bookkeeping needed.
  //   meta  — { len, beam, wake, funnel } for wake-quad sizing / funnel-smoke world position.
  var WOOD_LIGHT = [0.66, 0.50, 0.32], WOOD_DARK = [0.35, 0.23, 0.14], PLANK = [0.78, 0.64, 0.42],
      ROPE = [0.80, 0.77, 0.70];
  function strutS(B, x1, y1, z1, x2, y2, z2, thick, c) {   // thin box between two 3D points (rigging/bowsprit/boom)
    var dx = x2 - x1, dy = y2 - y1, dz = z2 - z1, len = Math.hypot(dx, dy, dz) || 0.001;
    var rz = Math.asin(clamp(dy / len, -1, 1)), ry = Math.atan2(-dz, dx);
    B.box((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2, len, thick, thick, c, ry, rz);
  }
  // shared hull WIDTH + SHEER profiles, t: 0 stern → 1 bow. Width: slightly-drawn-in transom,
  // full-bodied midship, aggressive elliptical narrowing to a near-point bow (taper starts well
  // before halfway so it reads at gameplay zoom). Sheer: strong t^2.6 bow rise + a gentler stern
  // rise — the classic cartoon banana curve. Hull rings, deck planks and gunwale rails all sample
  // the same two curves so the boat shape reads through every layer (a constant-width deck slab
  // on top would flatten the whole silhouette back into a barge).
  function hullW(Bm, t) {
    var bow = 1, tb = (t - 0.42) / 0.58;
    if (tb > 0) bow = Math.pow(Math.max(0, 1 - tb * tb), 0.62);
    var stern = 0.78 + 0.22 * Math.min(1, t / 0.30);
    return Math.max(Bm * bow * stern, Bm * 0.10);
  }
  function hullLift(bowLift, t) { return (bowLift || 0) * (Math.pow(t, 2.6) + 0.35 * Math.pow(1 - t, 2.2)); }
  // stacked chamfered rings narrowing to a RAISED BOW + squared stern transom + a raked stem
  // rising past the deck line at the prow — the #1 "reads as a boat" cue the old lens-shaped
  // hull was missing, exaggerated cartoon-ward. Tint-ready ([1,1,1]).
  function hullTint(B, L, Bm, H, n, bowLift) {
    n = n || 7; var W = [1, 1, 1];
    for (var i = 0; i < n; i++) {
      var t = (i + 0.5) / n, w = hullW(Bm, t), lift = hullLift(bowLift, t);
      var z = -L / 2 + L * (i + 0.5) / n, len = L / n * 1.06;
      B.bbox(0, H / 2 + lift, z, len, H, w, W, 0, Math.min(len, w) * 0.16);
    }
    // nose ring: one extra short, near-point ring past the last loop step so the prow ends sharp
    B.bbox(0, H / 2 + hullLift(bowLift, 0.99), L / 2 + L * 0.02, L / n * 0.55, H * 0.92, hullW(Bm, 0.99), W, 0, 0.12);
    // raked stem: from the forefoot at the waterline up past the deck at the bow tip
    strutS(B, 0, H * 0.08, L * 0.34, 0, H * 1.25 + (bowLift || 0), L / 2 + L * 0.07, Math.max(0.30, Bm * 0.15), W);
    B.box(0, H * 0.52, -L / 2 - 0.06, Bm * 0.72, H * 0.9, 0.5, W, 0);   // squared stern transom
  }
  function keelLine(B, L, H) { B.box(0, -H * 0.10, 0, 0.30, H * 0.26, L * 0.97, WOOD_DARK, 0); }
  function deckPlanks(B, L, Bm, H, n, bowLift, tone) {
    tone = tone || PLANK; n = n || 7;
    for (var i = 0; i < n; i++) {
      var t = (i + 0.5) / n, w = hullW(Bm, t) * 0.80, lift = hullLift(bowLift, t);
      B.box(0, H * 0.99 + lift, -L / 2 + L * (i + 0.5) / n, L / n * 1.02, 0.14, w, tone, 0);
    }
  }
  function gunwaleRim(B, L, Bm, H, n, bowLift, tone) {
    tone = tone || WOOD_DARK; n = n || 7;
    for (var i = 0; i < n; i++) {
      var t = (i + 0.5) / n, w = hullW(Bm, t), lift = hullLift(bowLift, t), z = -L / 2 + L * (i + 0.5) / n, len = L / n * 1.06;
      B.box(w / 2 - 0.10, H * 1.04 + lift, z, 0.22, 0.30, len, tone, 0);
      B.box(-w / 2 + 0.10, H * 1.04 + lift, z, 0.22, 0.30, len, tone, 0);
    }
  }
  function rudderBlade(B, L, H) { B.box(0, H * 0.30, -L / 2 - 0.26, 0.14, H * 0.60, 0.58, WOOD_DARK, 0); }
  function bowsprit(B, L, H, len) { strutS(B, 0, H * 0.7, L / 2, 0, H * 1.16, L / 2 + len, 0.18, WOOD_LIGHT); return [0, H * 1.16, L / 2 + len]; }
  function mastPole(B, x, z, H, top) { B.cyl(x, H, z, 0.16, top - H, 7, WOOD_DARK, 0.85); }
  function boomSpar(B, x, z, H, len) { strutS(B, x, H * 1.05, z, x, H * 1.05, z - len, 0.13, WOOD_DARK); }
  function pennant(B, x, y, z, flagC, accent) {           // flagpole + flag panel + optional white cross motif
    B.box(x, y, z, 0.06, 1.15, 0.06, WOOD_DARK, 0);
    B.box(x, y + 0.75, z + 0.34, 0.045, 0.5, 0.62, flagC, 0);
    if (accent) { B.box(x, y + 0.75, z + 0.345, 0.05, 0.42, 0.10, accent, 0); B.box(x, y + 0.75, z + 0.345, 0.05, 0.10, 0.50, accent, 0); }
  }
  function sternCabin(B, L, Bm, H, c) { B.bbox(0, H * 1.35, -L * 0.28, Bm * 0.62, H * 0.7, L * 0.22, c || WOOD_LIGHT, 0, 0.18); }
  function barrelProp(B, x, z, H) { B.cyl(x, H * 0.98, z, 0.42, 0.62, 8, WOOD_LIGHT, 0.94); }
  function crateProp(B, x, z, H, c) { B.box(x, H * 1.14, z, 0.7, 0.5, 0.7, c || PLANK, 0); }
  // one sail leaf, real proportions + its OWN mast offset baked in (mx local beam, mz local
  // fore/aft) — game.js needs no further per-sail transform math beyond the ship's own
  // position/yaw/billow. 'tri' is a 3-gon cone COMPRESSED ACROSS THE BEAM into a fore-aft
  // triangular blade (a raw cone is round in plan and reads as a sliver from the side);
  // 'square' is a tall panel hung high on the mast (brig's square-rigged silhouette).
  function squashX(B, mx, k) {
    var i;
    for (i = 0; i < B.P.length; i += 3) B.P[i] = mx + (B.P[i] - mx) * k;
    for (i = 0; i < B.N.length; i += 3) {                       // inverse-scale + renormalise so lighting stays honest
      var nx = B.N[i] / k, ny = B.N[i + 1], nz = B.N[i + 2], l = Math.hypot(nx, ny, nz) || 1;
      B.N[i] = nx / l; B.N[i + 1] = ny / l; B.N[i + 2] = nz / l;
    }
    return B;
  }
  function sailTriB(mx, mz, deckY, halfBase, h, taper) {
    var S = new g.HGL.Builder(); S.cyl(mx, deckY, mz, halfBase, h, 3, [1, 1, 1], taper == null ? 0.05 : taper);
    return squashX(S, mx, 0.38);
  }
  function sailSquareB(mx, mz, y0, w, h) { var S = new g.HGL.Builder(); S.box(mx, y0 + h / 2, mz, w, h, 0.14, [1, 1, 1], 0); return S; }
  function sailTatter(B, mx, mz, deckY, halfBase, h) {   // an extra ragged corner flap, cheap "tattered" read
    var T = new g.HGL.Builder(); T.cyl(mx, deckY + h * 0.02, mz - halfBase * 0.55, halfBase * 0.45, h * 0.34, 3, [1, 1, 1], 0.4);
    B.add(squashX(T, mx, 0.38));
  }
  var SHIP_SPECS = {
    dinghy: {   // tiny open boat: bench, bare mast (no standing rigging), one small sail
      L: 6.4, Bm: 2.5, H: 1.1, n: 5, bowLift: 0.45, gunwale: true, rudder: true, bench: true, rig: false,
      masts: [{ z: 0.3, top: 5.0 }], sails: [{ shape: 'tri', mast: 0, base: 3.2, h: 4.0 }]
    },
    sloop: {    // one mast, big mainsail + jib off the bowsprit, net-barrel aft
      L: 10.5, Bm: 3.6, H: 1.6, n: 7, bowLift: 0.70, gunwale: true, rudder: true, bowspritLen: 1.9,
      masts: [{ z: -0.5, top: 9.4, boom: 4.6 }],
      sails: [{ shape: 'tri', mast: 0, base: 5.0, h: 7.2 }, { shape: 'tri', mast: 'bowsprit', base: 2.2, h: 3.4 }],
      pennant: { c: [0.85, 0.22, 0.20] }, props: [{ k: 'barrel', x: -0.9, z: -4.2 }]
    },
    brig: {     // beamy two-master, SQUARE sails hung high on yards — the workhorse silhouette
      L: 20, Bm: 6.0, H: 2.6, n: 7, bowLift: 1.1, gunwale: true, rudder: true, bowspritLen: 2.6, cabin: true,
      masts: [{ z: 4.0, top: 14.0 }, { z: -3.2, top: 15.0 }],
      sails: [{ shape: 'square', mast: 0, base: 7.2, h: 7.6, y0: 3.4 }, { shape: 'square', mast: 1, base: 7.8, h: 8.4, y0: 3.6 }],
      pennant: { c: [0.30, 0.34, 0.55] }, props: [{ k: 'barrel', x: 1.6, z: 0.4 }, { k: 'crate', x: -1.6, z: 0.6 }]
    },
    schooner: { // long elegant two-master, tall fore-and-aft sails + jib, gilded rail, stern lantern
      L: 23, Bm: 5.2, H: 2.35, n: 7, bowLift: 1.05, gunwale: true, gunwaleTone: [0.82, 0.64, 0.28], rudder: true,
      bowspritLen: 3.2, cabin: true, lantern: true, deckTone: [0.84, 0.80, 0.70],
      masts: [{ z: 5.0, top: 13.0, boom: 6.0 }, { z: -3.6, top: 15.5, boom: 7.0 }],
      sails: [{ shape: 'tri', mast: 0, base: 6.4, h: 9.6 }, { shape: 'tri', mast: 1, base: 7.4, h: 11.4 }, { shape: 'tri', mast: 'bowsprit', base: 2.6, h: 4.2 }],
      pennant: { c: [0.86, 0.68, 0.24] }
    },
    steamer: {  // no sails: fat funnel amidships, white bridge house aft, container rows forward
      L: 25, Bm: 6.4, H: 2.9, n: 7, bowLift: 0.5, gunwale: true, gunwaleTone: [0.55, 0.56, 0.60], rudder: true,
      deckTone: [0.30, 0.31, 0.34], funnel: [0, 2.9 + 2.9 * 2.2, 1.2],
      extra: function (trim, L2, Bm2, H2) {
        var fz = 1.2, fh = H2 * 2.2;
        trim.cyl(0, H2, fz, 0.95, fh, 10, [0.14, 0.14, 0.16], 0.88);                                     // fat funnel shaft
        trim.cyl(0, H2 + fh * 0.80, fz, 0.90, fh * 0.20, 10, [0.62, 0.16, 0.14], 0.94);                  // red-band top
        trim.bbox(0, H2 * 1.55, -L2 * 0.26, Bm2 * 0.62, H2 * 1.1, L2 * 0.20, [0.90, 0.89, 0.84], 0, 0.3); // bridge house
        trim.box(0, H2 * 1.80, -L2 * 0.26 + L2 * 0.104, Bm2 * 0.48, 0.7, 0.12, [0.16, 0.22, 0.30], 0);   // bridge window band
        var ci = 0;                                                                                      // two container rows on the foredeck
        for (var cz = L2 * 0.06; cz <= L2 * 0.34; cz += 2.6) {
          trim.bbox(-1.35, H2 * 1.28, cz, 2.2, 1.5, 2.3, CONT[ci % CONT.length], 0, 0.2);
          trim.bbox(1.35, H2 * 1.28, cz, 2.2, 1.5, 2.3, CONT[(ci + 3) % CONT.length], 0, 0.2);
          ci++;
        }
      }
    },
    corsair: {  // the rival: raked black two-master, tall dark tattered sails, white-cross pennant
      L: 21, Bm: 5.0, H: 2.55, n: 7, bowLift: 1.35, gunwale: true, gunwaleTone: [0.12, 0.11, 0.13], rudder: true,
      bowspritLen: 3.0, cabin: true, cabinTone: [0.22, 0.20, 0.22], deckTone: [0.30, 0.24, 0.20],
      masts: [{ z: 4.2, top: 13.6, boom: 6.2 }, { z: -3.0, top: 14.8, boom: 7.0 }],
      sails: [{ shape: 'tri', mast: 0, base: 7.0, h: 10.0, tatter: true }, { shape: 'tri', mast: 1, base: 7.8, h: 11.0, tatter: true }],
      pennant: { c: [0.08, 0.08, 0.09], accent: [0.92, 0.90, 0.86] }
    }
  };
  function assembleShip(spec) {
    var L = spec.L, Bm = spec.Bm, H = spec.H;
    var hullB = new g.HGL.Builder(); hullTint(hullB, L, Bm, H, spec.n, spec.bowLift);
    var trim = new g.HGL.Builder();
    keelLine(trim, L, H); deckPlanks(trim, L, Bm, H, spec.n, spec.bowLift, spec.deckTone);
    if (spec.gunwale) gunwaleRim(trim, L, Bm, H, spec.n, spec.bowLift, spec.gunwaleTone);
    if (spec.rudder) rudderBlade(trim, L, H);
    var bowspritTip = spec.bowspritLen ? bowsprit(trim, L, H, spec.bowspritLen) : null;
    var mastPos = (spec.masts || []).map(function (m) {
      mastPole(trim, 0, m.z, H, m.top);
      if (m.boom) boomSpar(trim, 0, m.z, H, m.boom);
      return { x: 0, z: m.z, top: m.top };
    });
    if (spec.rig === false) { /* open boat (dinghy): bare mast, no standing rigging */ }
    else if (mastPos.length === 1) {                               // 2-3 thin rigging lines, not a rat's nest
      var m0 = mastPos[0];
      strutS(trim, m0.x, m0.top, m0.z, 0, H * 0.98, L / 2 - 0.3, 0.05, ROPE);
      strutS(trim, m0.x, m0.top, m0.z, 0, H * 0.98, -L / 2 + 0.3, 0.05, ROPE);
      if (bowspritTip) strutS(trim, m0.x, m0.top, m0.z, bowspritTip[0], bowspritTip[1], bowspritTip[2], 0.05, ROPE);
    } else if (mastPos.length >= 2) {
      var fm = mastPos[0], am = mastPos[mastPos.length - 1];
      strutS(trim, fm.x, fm.top, fm.z, am.x, am.top, am.z, 0.05, ROPE);
      if (bowspritTip) strutS(trim, fm.x, fm.top, fm.z, bowspritTip[0], bowspritTip[1], bowspritTip[2], 0.05, ROPE);
      strutS(trim, am.x, am.top, am.z, 0, H * 0.98, -L / 2 + 0.3, 0.05, ROPE);
    }
    if (spec.cabin) sternCabin(trim, L, Bm, H, spec.cabinTone);
    if (spec.lantern) trim.cyl(0, H * 1.5, -L * 0.42, 0.22, 0.4, 6, [1.0, 0.85, 0.5], 0.7);
    if (spec.bench) trim.box(0, H * 0.96, L * 0.12, Bm * 0.7, 0.14, 0.3, PLANK, 0);
    var lastMast = mastPos[mastPos.length - 1];
    if (spec.pennant) pennant(trim, 0, lastMast ? lastMast.top : H + 2, lastMast ? lastMast.z : 0, spec.pennant.c, spec.pennant.accent);
    (spec.props || []).forEach(function (p) { if (p.k === 'barrel') barrelProp(trim, p.x, p.z, H); else if (p.k === 'crate') crateProp(trim, p.x, p.z, H, p.c); });
    if (spec.extra) spec.extra(trim, L, Bm, H);
    var deckY = H * 1.0;
    var sails = (spec.sails || []).map(function (sd, i) {
      var mz = sd.mast === 'bowsprit' ? (bowspritTip ? (L / 2 + bowspritTip[2]) / 2 : L / 2) : (mastPos[sd.mast] ? mastPos[sd.mast].z : 0);
      var B2;
      if (sd.shape === 'square') {                                 // hung high on a yard, not dragged on deck
        var y0 = deckY + (sd.y0 || 0);
        B2 = sailSquareB(0, mz, y0, sd.base, sd.h);
        strutS(trim, -sd.base / 2 - 0.3, y0 + sd.h, mz, sd.base / 2 + 0.3, y0 + sd.h, mz, 0.16, WOOD_DARK);   // the yard (static spar in trim)
      } else B2 = sailTriB(0, mz, deckY, sd.base * 0.5, sd.h, sd.taper);
      if (sd.tatter) sailTatter(B2, 0, mz, deckY, sd.base * 0.5, sd.h);
      return { data: B2.data(), phase: i * 1.7 + 0.4 };
    });
    // draft: how deep the hull sits — game.js subtracts it from the draw y so ships ride IN the
    // water (waterline ~1/3 up the hull) instead of floating on top of it.
    return { hull: hullB.data(), trim: trim.data(), sails: sails, meta: { len: L, beam: Bm, draft: H * 0.40, funnel: spec.funnel || null } };
  }
  var SHIPYARD = {
    CLASSES: ['dinghy', 'sloop', 'brig', 'schooner', 'steamer', 'corsair'],
    build: function (cls) { return assembleShip(SHIP_SPECS[cls] || SHIP_SPECS.dinghy); }
  };

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
      // Phase 17a: Automated Harbour (era6) / Neon Horizon (era7) get their OWN skyline — a small
      // cluster of tech-age towers east of the warehouse row (solarSpire's steel/glass silhouette at
      // era6, swapping to neonTower's glowing accent rings at era7) plus a drone landing pad by the
      // quay — distinct from the generic glTF city-block fill above, so the outline pass (14a) picks
      // out a genuinely different age instead of "more of the same skyline".
      if (era >= 6) {
        var spireN = era >= 7 ? 3 : 2;
        for (var sp = 0; sp < spireN; sp++) {
          var spx = 70 + sp * 26, spz = 30 + rng() * 10;
          if (era >= 7) neonTower(L.grit, L.flat, spx, spz, rng); else solarSpire(L.grit, L.flat, spx, spz, rng);
          sc.blobs.push({ x: spx, z: spz, r: 8 });
        }
        droneBayPad(L.grit, L.flat, -92, 38, rng); sc.blobs.push({ x: -92, z: 38, r: 8 });
      }
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
    scatterLushness(B.flat, rng, port, biome);   // Phase 16b: bushes + flowers near a founded port
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

  g.HARBOR_MODELS = { buildStatic: buildStatic, heightAt: heightAt, rate: rate, sites: sites, portYaw: portYaw, CONT: CONT, WORLD: WORLD, SHIPYARD: SHIPYARD };
})(window);
