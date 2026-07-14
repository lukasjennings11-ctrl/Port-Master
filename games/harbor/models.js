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
  var CONT = [[0.74, 0.42, 0.34], [0.40, 0.54, 0.64], [0.80, 0.66, 0.40], [0.46, 0.58, 0.44], [0.58, 0.48, 0.62], [0.76, 0.56, 0.54], [0.88, 0.86, 0.82]];  // Phase 19a: dyed card, not candy

  // ---------------- value-noise heightfield ----------------
  var WORLD = { W: 2400, z0: -130, z1: 430, cell: 5 };
  var FIELD = null;
  // Phase 18a: budget/feature telemetry for the faceted-terrain rebuild — read by game.js's
  // __harbor.terrainStats() test hook (vertex-budget + per-biome feature-count assertions).
  var TERRAIN_STATS = { quads: 0, verts: 0 };
  var DRESS_STATS = null, PORT_DRESS = null;
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

  // Phase 18a LOOK 6.0: build the heightfield surface as FACETED FLAT-SHADED tiles — the single
  // biggest pixel-count lever in every frame. heightAt() and the underlying FIELD values are
  // completely untouched (gameplay-critical: building placement/site heights identical before/
  // after) — this only changes how the SAME heights are turned into a mesh. Each grid quad gets
  // its OWN 4 vertices (not shared with neighbours) and a single flat face normal (cross product
  // of the quad's two edges), so every quad reads as one distinct light-catching facet — the
  // Monument-Valley/Poly-Bridge "sculpted diorama" look — instead of the old smooth vertex-
  // averaged normals. Per-quad (not per-triangle) duplication is a deliberate choice: the two
  // triangles of a quad share the same flat normal + colour, so the diagonal split inside a quad
  // never becomes a spurious extra edge for the ink-outline pass (14a/F_POST) — only real facet-
  // to-facet boundaries ink, keeping the faceted look from reading as scratchy noise. A small
  // deterministic per-face lightness jitter (hash of the quad's grid cell, not the shared rng
  // stream — never perturbs prop/building placement order) makes even coplanar facets read as
  // separate hand-placed plates. ~4x the old shared-vertex count (see terrainStats() budget).
  function buildFieldMesh(flat, biome) {
    var nx = FIELD.nx, nz = FIELD.nz, H = FIELD.H, RM = FIELD.RM;
    var sand = biome.beach || [0.88, 0.80, 0.55], grass = biome.ground, deep = [0.40, 0.46, 0.40];
    var mrock = mixc(biome.hill, [0.40, 0.38, 0.43], 0.62), river = [0.30, 0.42, 0.46], snow = [0.93, 0.93, 0.92];   // 19a: card river, warm-grey snow
    var snowLine = 45;
    function faceColor(i, j, yavg) {
      var idx = j * nx + i;
      var hl = H[j * nx + Math.max(0, i - 1)], hr = H[j * nx + Math.min(nx - 1, i + 1)];
      var hd = H[Math.max(0, j - 1) * nx + i], hu = H[Math.min(nz - 1, j + 1) * nx + i];
      var nX = hl - hr, nZ = hd - hu, nY = 2 * WORLD.cell, nl = Math.hypot(nX, nY, nZ) || 1, slope = 1 - nY / nl;
      var isRiver = RM[idx] || RM[j * nx + Math.min(nx - 1, i + 1)] || RM[Math.min(nz - 1, j + 1) * nx + i] || RM[Math.min(nz - 1, j + 1) * nx + Math.min(nx - 1, i + 1)];
      var col;
      if (isRiver) col = river;                                              // winding river
      else if (yavg < -0.2) col = mixc(deep, sand, clamp((yavg + 3) / 2.8, 0, 1));
      else if (yavg < 1.3) col = sand;                                        // beach (slightly widened to complement facets)
      else if (yavg < 7) col = grass;
      else if (yavg < 22) col = mixc(grass, mrock, clamp((yavg - 7) / 15, 0, 1)); // forested slope -> rock
      else col = mrock;                                                       // bare rock
      if (slope > 0.5 && yavg > 1.1 && !isRiver) col = mixc(col, mrock, clamp((slope - 0.5) * 2, 0, 1));
      if (yavg > snowLine) col = mixc(col, snow, clamp((yavg - snowLine) / 12, 0, 1)); // snow-capped peaks (all biomes)
      return col;
    }
    var quads = 0;
    for (var j = 0; j < nz - 1; j++) {
      var z0 = WORLD.z0 + j * WORLD.cell, z1 = z0 + WORLD.cell;
      for (var i = 0; i < nx - 1; i++) {
        var x0 = -WORLD.W / 2 + i * WORLD.cell, x1 = x0 + WORLD.cell;
        var ya = H[j * nx + i], yb = H[j * nx + i + 1], yc = H[(j + 1) * nx + i], yd = H[(j + 1) * nx + i + 1];
        // flat facet normal from the quad's two edge vectors (a->c "up", a->b "across")
        var e1y = yc - ya, e2y = yb - ya;
        var fnx = e1y * 0 - WORLD.cell * e2y, fny = WORLD.cell * WORLD.cell - 0, fnz = 0 * e2y - e1y * WORLD.cell;
        var fl = Math.hypot(fnx, fny, fnz) || 1; fnx /= fl; fny /= fl; fnz /= fl;
        if (fny < 0) { fnx = -fnx; fny = -fny; fnz = -fnz; }                  // keep facing up
        var col = faceColor(i, j, (ya + yb + yc + yd) / 4);
        var jitk = 1 + (h2(i, j) - 0.5) * 0.14;                               // ±7% per-face lightness jitter — deliberate craft, not noise
        var fc = [clamp(col[0] * jitk, 0, 1), clamp(col[1] * jitk, 0, 1), clamp(col[2] * jitk, 0, 1)];
        var base = flat.P.length / 3;
        flat.P.push(x0, ya, z0); flat.N.push(fnx, fny, fnz); flat.U.push(0, 0); flat.C.push(fc[0], fc[1], fc[2]);
        flat.P.push(x1, yb, z0); flat.N.push(fnx, fny, fnz); flat.U.push(1, 0); flat.C.push(fc[0], fc[1], fc[2]);
        flat.P.push(x0, yc, z1); flat.N.push(fnx, fny, fnz); flat.U.push(0, 1); flat.C.push(fc[0], fc[1], fc[2]);
        flat.P.push(x1, yd, z1); flat.N.push(fnx, fny, fnz); flat.U.push(1, 1); flat.C.push(fc[0], fc[1], fc[2]);
        flat.I.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        quads++;
      }
    }
    TERRAIN_STATS.quads = quads; TERRAIN_STATS.verts = quads * 4;
  }

  // ---------------- vegetation (grounded on the field) ----------------
  // Phase 16b VIBRANT STORYBOOK: bigger, chunkier canopies with a visible tier or two — each kind
  // keeps its old vertex shape (no new cylinders on palm/pine — just scaled up, budget-free) except
  // the broadleaf 'hill' tree, which gains ONE extra small top tier (still just 2 cyls total, +1
  // over the old single-canopy shape) so it reads as a lumpy layered canopy instead of a smooth
  // cone — the #1 silhouette most on-screen (green isles' default world).
  function tree(flat, x, z, rng, kind, by) {
    var hy = by + 0.4;
    if (kind === 'palm') { var th = 5 + rng() * 3; flat.cyl(x, hy, z, 0.40, th, 6, [0.52, 0.42, 0.30], 0.7); for (var f = 0; f < 6; f++) flat.box(x, hy + th, z, 5.4, 0.34, 1.3, [0.32, 0.50, 0.28], f / 6 * TAU, 0.30); }
    else if (kind === 'pine') { flat.cyl(x, hy, z, 0.56, 2.2, 6, [0.42, 0.33, 0.23], 1); for (var c = 0; c < 3; c++) flat.cyl(x, hy + 1.6 + c * 2.5, z, 3.7 - c * 0.95, 3.1, 6, [0.28, 0.42, 0.28], 0.04); }
    else { // broadleaf: trunk + two chunky canopy tiers (bigger base, smaller lumpy top)
      flat.cyl(x, hy, z, 0.66, 2.5, 6, [0.44, 0.33, 0.23], 0.92);
      flat.cyl(x, hy + 2.3, z, 3.6, 4.4, 7, [0.34, 0.48, 0.28], 0.28);
      flat.cyl(x, hy + 5.6, z, 2.15, 2.6, 6, [0.42, 0.54, 0.32], 0.30);
    }
  }
  // Phase 16b: cheap static lushness — small bushes + flower dots scattered on the grass near a
  // FOUNDED port only (the always-visible "hero" area). Bounded, budget-capped count (see the
  // scatterLushness() caller below); one box (24 verts) per flower, one small cyl (32 verts) per
  // bush — far cheaper than another tree, but enough colour confetti to read as a storybook
  // meadow rather than bare grass right around the harbour.
  function bush(flat, x, z, rng, y) {
    var g = jit([0.34, 0.47, 0.28], 0.07, rng);
    flat.cyl(x, y + 0.02, z, 0.85 + rng() * 0.55, 0.9 + rng() * 0.5, 6, g, 0.5);
  }
  var FLOWER_HUES = [[0.80, 0.42, 0.46], [0.84, 0.72, 0.38], [0.88, 0.87, 0.84], [0.62, 0.44, 0.72], [0.82, 0.56, 0.36]];   // 19a: felt petals
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
        if (b.snow) out.cyl(px, h * 0.60, pz, r * 0.5, h * 0.44, 5, [0.93, 0.94, 0.94], 0.05);
      }
    } else if (b.hillType === 'cliff') {
      var crock = jit(b.hill, 0.04, rng), steps = 4 + (rng() * 3 | 0), bw = (40 + rng() * 30) * s, bd = (26 + rng() * 18) * s, sh = (12 + rng() * 9) * s, y = 0;
      for (var st = 0; st < steps; st++) { var t = st / steps; out.box(0, y + sh / 2, 0, bw * (1 - t * 0.55), sh, bd * (1 - t * 0.55), mul(crock, st % 2 ? 0.98 : 0.84), rng() * 0.25); y += sh; }
      out.box(0, y + 0.6, 0, bw * 0.5, 1.2, bd * 0.5, b.snow ? [0.91, 0.92, 0.93] : mul(b.ground, 1.1), 0);
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

  // ---------------- Phase 18a LOOK 6.0: sculpted coast & per-biome dressing ------------------
  // Static, budget-aware props scattered across the WHOLE world (wild or founded — landscape
  // identity, not port furniture) so every biome reads as distinctly its own place up close, not
  // just a different terrain tint. Small chamfered-box/cylinder kit pieces, same shape language as
  // the rest of the game (bbox/box/cyl) — no new primitives, no new asset pipeline.
  function rockOutcrop(flat, x, z, rng, biome) {                    // chunky stacked chamfered boulders
    var rock = jit(biome.hill, 0.06, rng), n = 2 + (rng() * 3 | 0), y0 = 0;
    for (var k = 0; k < n; k++) {
      var s = 1.5 - k * 0.30 + rng() * 0.5, dx = (rng() - 0.5) * 1.5 * (k + 1), dz = (rng() - 0.5) * 1.5 * (k + 1);
      flat.bbox(x + dx, y0 + s * 0.55, z + dz, s * 2.3, s * 1.5, s * 2.0, mul(rock, 0.84 + rng() * 0.3), rng() * TAU, s * 0.42);
      y0 += s * 0.42;
    }
  }
  function stoneShelf(flat, x, z, rng, biome) {                     // stepped rock shelf right at the waterline
    var rock = mul(jit(biome.hill, 0.05, rng), 0.82), steps = 2 + (rng() * 2 | 0), y = -0.3;
    for (var s = 0; s < steps; s++) {
      var w = 7.5 - s * 1.5 + rng(), d = 3.6 - s * 0.5;
      flat.bbox(x, y, z - s * 1.7, w, 0.9, d, mul(rock, 1 - s * 0.06), (rng() - 0.5) * 0.2, 0.5);
      y -= 0.75;
    }
  }
  var PEBBLE_TONES = [[0.90, 0.86, 0.78], [0.80, 0.74, 0.62], [0.96, 0.92, 0.86], [0.72, 0.68, 0.60], [0.62, 0.58, 0.52]];
  function pebble(flat, x, z, rng) {                                 // shell/pebble speckle in the sand band
    flat.bbox(x, 0.09 + rng() * 0.05, z, 0.32 + rng() * 0.34, 0.14 + rng() * 0.12, 0.28 + rng() * 0.30, pick(PEBBLE_TONES, rng), rng() * TAU, 0.07);
  }
  function duneRidge(flat, x, z, rng, biome) {                       // low elongated sand mound (desert)
    var sand = jit(biome.hill, 0.05, rng), len = 9 + rng() * 13;
    flat.cyl(x, -0.3, z, len * 0.5, 1.0 + rng() * 0.8, 6, sand, 0.72);
  }
  function boulder(flat, x, z, rng, biome) {                         // scattered snow-country boulder
    var rock = jit(biome.hill, 0.07, rng), s = 0.9 + rng() * 1.6;
    flat.bbox(x, s * 0.42, z, s * 1.5, s * 0.85, s * 1.3, rock, rng() * TAU, s * 0.32);
    if (rng() < 0.4) flat.bbox(x + s * 0.6, s * 0.7, z - s * 0.4, s * 0.7, s * 0.5, s * 0.6, mul(rock, 0.9), rng() * TAU, s * 0.2);
  }
  function bigLeafPlant(flat, x, z, rng, y) {                        // broad-leaf tropical understory plant
    var stalk = [0.32, 0.42, 0.26], leaf = jit([0.32, 0.48, 0.26], 0.08, rng), n = 3 + (rng() * 2 | 0);
    for (var i = 0; i < n; i++) {
      var a = i / n * TAU + rng() * 0.6, r = 1.0 + rng() * 0.6;
      flat.box(x + Math.cos(a) * r * 0.5, y + 0.85 + rng() * 0.4, z + Math.sin(a) * r * 0.5, 2.1 + rng() * 0.8, 0.10, 0.8 + rng() * 0.3, leaf, a, 0.25);
    }
    flat.cyl(x, y, z, 0.18, 0.85, 5, stalk, 0.85);
  }
  // Scatters coastal rock/shelf/speckle + biome-specific dune/boulder/leaf features across the
  // whole visible world. Called for BOTH wild and founded worlds (landscape identity), so a `port`
  // exclusion zone keeps the harbour plot itself clear for building placement.
  function biomeDressing(flat, biome, rng, port) {
    var hw = WORLD.W * 0.48, rocky = biome.hillType === 'cliff' || biome.hillType === 'mountain', sandy = biome.hillType === 'hill';
    var stats = { rock: 0, shelf: 0, speckle: 0, dune: 0, boulder: 0, leaf: 0 };
    var targetRock = rocky ? 70 : 30, targetShelf = rocky ? 34 : 8, tries = 0, budget = (targetRock + targetShelf) * 46;
    while ((stats.rock < targetRock || stats.shelf < targetShelf) && tries < budget) {
      tries++;
      var x = -hw + rng() * hw * 2, z = -120 + rng() * 560, y = heightAt(x, z);
      if (port && Math.abs(x - port.x) < 70 && Math.abs(z - port.z) < 70) continue;
      if (y <= -1.0 || y >= 3.2) continue;                           // right at/near the coastline only
      if (stats.shelf < targetShelf && y < 0.6 && rng() < (rocky ? 0.5 : 0.16)) { stoneShelf(flat, x, z, rng, biome); stats.shelf++; }
      else if (stats.rock < targetRock && rng() < (rocky ? 0.55 : 0.14)) { rockOutcrop(flat, x, z, rng, biome); stats.rock++; }
    }
    if (sandy) {                                                     // beach speckle — sandy coastlines only
      var targetSpeckle = 160, t2 = 0;
      while (stats.speckle < targetSpeckle && t2 < targetSpeckle * 30) {
        t2++;
        var x2 = -hw + rng() * hw * 2, z2 = -120 + rng() * 560, y2 = heightAt(x2, z2);
        if (y2 < -0.1 || y2 > 1.3) continue;
        if (port && Math.abs(x2 - port.x) < 40 && Math.abs(z2 - port.z) < 40) continue;
        pebble(flat, x2, z2, rng); stats.speckle++;
      }
    }
    if (biome.hillType === 'mesa') {                                 // dune ridges — desert only
      var targetDune = 22, t3 = 0;
      while (stats.dune < targetDune && t3 < targetDune * 20) {
        t3++;
        var x3 = -hw + rng() * hw * 2, z3 = -100 + rng() * 520, y3 = heightAt(x3, z3);
        if (y3 < 1.1 || y3 > 10) continue;
        duneRidge(flat, x3, z3, rng, biome); stats.dune++;
      }
    }
    if (biome.snow) {                                                // scattered boulders — nordic/mountain
      var targetBoulder = 46, t4 = 0;
      while (stats.boulder < targetBoulder && t4 < targetBoulder * 20) {
        t4++;
        var x4 = -hw + rng() * hw * 2, z4 = -80 + rng() * 500, y4 = heightAt(x4, z4);
        if (y4 < 8 || y4 > 40) continue;
        boulder(flat, x4, z4, rng, biome); stats.boulder++;
      }
    }
    if (biome.veg === 'palm') {                                      // extra big-leaf plants — tropical only
      var targetLeaf = 28, t5 = 0;
      while (stats.leaf < targetLeaf && t5 < targetLeaf * 20) {
        t5++;
        var x5 = -hw + rng() * hw * 2, z5 = -100 + rng() * 520, y5 = heightAt(x5, z5);
        if (y5 < 1.1 || y5 > 9) continue;
        if (port && Math.abs(x5 - port.x) < 40 && Math.abs(z5 - port.z) < 40) continue;
        bigLeafPlant(flat, x5, z5, rng, y5); stats.leaf++;
      }
    }
    return stats;
  }

  // ---------------- Phase 18b LOOK 6.0: building TOTAL REMODEL — shared diorama part-kit --------
  // Every structure in the port used to be one chamfered box + a flat lean-to roof (10b/16b shape
  // language, never revisited since). This phase gives every type its OWN hand-crafted silhouette
  // from a small shared kit of roof/wall/detail builders, reused across types exactly like
  // SHIPYARD's hull/trim kit (16a) reuses strut/mast/sail builders across ship classes — a later
  // phase's new building type is another function calling the same kit, never copy-pasted geometry.
  // Roof STYLE ('pitch'/'hip'/'flat') comes straight from biome.build.roofStyle (biomes.js has
  // carried this field since it was authored — unused until now) so every world's architecture
  // reads distinctly: Green Isles' steep cottage eaves vs. Tropical's broad hipped verandas vs.
  // Desert Coast's flat sun-baked parapets — with zero per-biome special-casing inside the building
  // functions themselves. Roofs are gently OVERSIZED (cartoon exaggeration, eave overhang well past
  // the wall footprint) per the LOOK 6.0 brief; every wall gets a contrast material treatment
  // (timber-frame beams / brick banding / plaster+awning) so nothing reads as a bare box anymore.
  var DEFAULT_BUILD = { wall: [[0.70, 0.68, 0.62], [0.78, 0.74, 0.62]], roof: [0.42, 0.20, 0.16], roofStyle: 'pitch', trim: [0.92, 0.88, 0.78] };
  function buildOf(b) { return (b && b.build) || DEFAULT_BUILD; }

  // deep-eave gabled roof: two sloped panels (box() rz-tilt — the same technique the original hut
  // used, kept for continuity) + a ridge cap + contrast fascia boards at both eaves. Returns the
  // peak Y (chimney placement). eave/pitch let callers size the cartoon-oversized overhang per type.
  function gableRoof(B, cx, wallTop, cz, w, d, tone, trim, eave, pitch) {
    eave = eave == null ? 1.15 : eave; pitch = pitch || 0.60;
    var half = w / 2 + eave, rise = half * Math.tan(pitch), panelLen = half / Math.cos(pitch), rd = d + eave * 1.4;
    B.box(cx - w * 0.25, wallTop + rise * 0.5, cz, panelLen, 0.46, rd, tone, 0, pitch);
    B.box(cx + w * 0.25, wallTop + rise * 0.5, cz, panelLen, 0.46, rd, tone, 0, -pitch);
    B.box(cx, wallTop + rise + 0.20, cz, w * 0.22, 0.34, rd * 0.97, mul(trim, 0.86), 0, 0);          // ridge cap
    B.box(cx - half * 0.985, wallTop - 0.02, cz, 0.20, 0.26, rd, trim, 0, pitch);                     // eave fascia (contrast board)
    B.box(cx + half * 0.985, wallTop - 0.02, cz, 0.20, 0.26, rd, trim, 0, -pitch);
    return wallTop + rise + 0.36;
  }
  // gambrel (barn) roof: steep lower flare + shallow upper slope, per side — the sawmill's silhouette.
  function gambrelRoof(B, cx, wallTop, cz, w, d, tone, trim, eave) {
    eave = eave == null ? 0.85 : eave;
    var halfLow = w * 0.40, halfUp = w * 0.15, rd = d + eave * 1.3;
    var riseLow = halfLow * 1.05, pitchLow = Math.atan2(riseLow, halfLow), lenLow = halfLow / Math.cos(pitchLow);
    var riseUp = halfUp * 0.5, pitchUp = Math.atan2(riseUp, halfUp), lenUp = (halfUp + eave) / Math.cos(pitchUp);
    B.box(cx - w * 0.30, wallTop + riseLow * 0.5, cz, lenLow, 0.40, rd, tone, 0, pitchLow);
    B.box(cx + w * 0.30, wallTop + riseLow * 0.5, cz, lenLow, 0.40, rd, tone, 0, -pitchLow);
    var y2 = wallTop + riseLow;
    B.box(cx - halfUp * 0.5, y2 + riseUp * 0.5, cz, lenUp, 0.38, rd * 0.96, mul(tone, 1.08), 0, pitchUp);
    B.box(cx + halfUp * 0.5, y2 + riseUp * 0.5, cz, lenUp, 0.38, rd * 0.96, mul(tone, 1.08), 0, -pitchUp);
    B.box(cx, y2 + riseUp + 0.20, cz, w * 0.13, 0.30, rd * 0.94, mul(trim, 0.86), 0, 0);              // ridge cap
    return y2 + riseUp + 0.34;
  }
  // hipped roof: a heavily-chamfered box — bbox's own chamfer strips ARE the four hip slopes, the
  // same primitive as every other "chamfered box" in the game, just pushed to its shape limit — the
  // cheapest correct-reading hip given the engine's box/bbox/cyl kit. + a contrast ridge cap.
  function hippedRoof(B, cx, wallTop, cz, w, d, tone, trim, eave) {
    eave = eave == null ? 1.0 : eave;
    var rw = w + eave * 2, rd = d + eave * 2, rh = Math.min(rw, rd) * 0.46, bev = Math.min(rw, rd) * 0.435;
    B.bbox(cx, wallTop + rh / 2, cz, rw, rh, rd, tone, 0, bev);
    B.box(cx, wallTop + rh + 0.06, cz, Math.abs(rw - rd) * 0.5 + 0.6, 0.20, Math.abs(rw - rd) * 0.5 + 0.6, mul(trim, 0.86), 0);
    return wallTop + rh + 0.20;
  }
  // flat parapet roof (desert) — a slim slab + contrast cornice cap line, Pueblo/Med flat-roof read.
  function flatRoof(B, cx, wallTop, cz, w, d, tone, trim, eave) {
    eave = eave == null ? 0.55 : eave;
    var rw = w + eave * 2, rd = d + eave * 2, slabH = 0.85;
    B.bbox(cx, wallTop + slabH / 2, cz, rw, slabH, rd, tone, 0, Math.min(rw, rd) * 0.10);
    B.box(cx, wallTop + slabH + 0.10, cz, rw * 0.93, 0.18, rd * 0.93, trim, 0);
    return wallTop + slabH + 0.28;
  }
  function roofKit(B, cx, wallTop, cz, w, d, tone, trim, style, eave, pitch) {
    if (style === 'hip') return hippedRoof(B, cx, wallTop, cz, w, d, tone, trim, eave);
    if (style === 'flat') return flatRoof(B, cx, wallTop, cz, w, d, tone, trim, eave);
    return gableRoof(B, cx, wallTop, cz, w, d, tone, trim, eave, pitch);
  }
  function chimneyPot(B, x, y0, z, h, tone) {
    B.box(x, y0 + h / 2, z, 0.60, h, 0.60, tone, 0);
    B.box(x, y0 + h + 0.10, z, 0.80, 0.22, 0.80, mul(tone, 0.82), 0);
    B.cyl(x, y0 + h + 0.22, z, 0.20, 0.46, 6, [0.24, 0.22, 0.20], 0.85);
  }
  // timber-frame contrast beams over a plain wall (hut/cottage/sawmill) — 4 corner posts + front/
  // back mid-rails, thin boxes sitting a hair proud of the wall face.
  function timberFrame(B, cx, y0, cz, w, h, d, beamTone) {
    var hx = w / 2, hz = d / 2;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) { B.box(cx + c[0] * hx, y0 + h / 2, cz + c[1] * hz, 0.16, h, 0.16, beamTone, 0); });
    B.box(cx, y0 + h * 0.58, cz + hz + 0.01, w * 0.92, 0.13, 0.14, beamTone, 0);
    B.box(cx, y0 + h * 0.58, cz - hz - 0.01, w * 0.92, 0.13, 0.14, beamTone, 0);
  }
  // horizontal brick/stone courses over a wall (warehouse/factory) — a few contrast band lines.
  function brickBanding(B, cx, y0, cz, w, h, d, bandTone) {
    for (var i = 1; i <= 3; i++) { var t = i / 4; B.box(cx, y0 + h * t, cz, w + 0.05, 0.12, d + 0.05, bandTone, 0); }
  }
  // striped canvas shop awning over a door + two support poles (market/trading post).
  function shopAwning(B, cx, y0, cz, w, cz2, stripeA, stripeB) {
    var n = 4, seg = w / n;
    for (var i = 0; i < n; i++) B.box(cx - w / 2 + (i + 0.5) * seg, y0, cz, seg * 0.96, 0.10, 1.3, i % 2 ? stripeA : stripeB, 0, 0.34);
    B.cyl(cx - w * 0.42, y0 * 0.42, cz2, 0.06, y0 * 0.94, 5, [0.30, 0.28, 0.24], 0.9);
    B.cyl(cx + w * 0.42, y0 * 0.42, cz2, 0.06, y0 * 0.94, 5, [0.30, 0.28, 0.24], 0.9);
  }
  function doorSlab(B, x, y0, z, w, h, tone, lintelTone) {
    B.box(x, y0 + h / 2, z, w, h, 0.22, tone, 0);
    B.box(x, y0 + h + 0.14, z, w * 1.30, 0.24, 0.30, lintelTone, 0);
  }
  function windowInset(B, x, y, z, w, h, frameTone, glassTone) {
    B.box(x, y, z, w * 1.24, h * 1.2, 0.14, frameTone, 0);
    B.box(x, y, z + 0.035, w, h, 0.08, glassTone, 0);
    B.box(x, y - h * 0.62, z + 0.05, w * 1.35, 0.12, 0.26, frameTone, 0);
  }
  var FLOWERBOX_HUES = [[0.80, 0.42, 0.46], [0.84, 0.72, 0.38], [0.62, 0.44, 0.72], [0.82, 0.56, 0.36]];   // 19a: felt petals
  function windowFlowerBox(B, x, y, z, rng) {
    B.box(x, y, z, 0.9, 0.16, 0.34, [0.42, 0.30, 0.18], 0);
    for (var i = 0; i < 3; i++) B.box(x - 0.3 + i * 0.3, y + 0.15, z, 0.18, 0.22, 0.18, pick(FLOWERBOX_HUES, rng), (rng() - 0.5) * 0.6);
  }
  function hangingSign(B, x, y, z, poleTone, signTone) {
    B.box(x, y, z, 0.10, 0.10, 0.9, poleTone, 0);
    B.box(x, y - 0.42, z + 0.42, 0.10, 0.75, 0.10, poleTone, 0);
    B.box(x, y - 0.80, z + 0.42, 0.85, 0.55, 0.08, signTone, 0);
  }
  function groundBarrel(B, x, z, tone) { B.cyl(x, 0.02, z, 0.40, 0.72, 8, tone || [0.44, 0.30, 0.18], 0.94); B.cyl(x, 0.68, z, 0.42, 0.10, 8, [0.20, 0.18, 0.16], 0.98); }
  function groundCrate(B, x, z, rot, tone) { B.box(x, 0.35, z, 0.7, 0.7, 0.7, tone || [0.62, 0.46, 0.28], rot || 0); }
  // stacked horizontal "log" boxes (sawmill timber stock) — a box, not a cyl, since cyl only
  // extrudes vertically in this kit; laid on its side it reads as a bound stack of trimmed logs.
  function logStack(B, x, z, n, tone) { for (var i = 0; i < n; i++) B.box(x, 0.3 + i * 0.5, z, 3.2, 0.42, 0.42, tone, 0, (i % 2) * 0.03); }
  function lanternBracket(B, x, y, z, tone) {
    B.box(x, y, z, 0.45, 0.08, 0.08, mul(tone, 0.4), 0);
    B.cyl(x + 0.22, y - 0.22, z, 0.10, 0.20, 6, [0.20, 0.20, 0.22], 0.8);
    B.box(x + 0.22, y - 0.02, z, 0.14, 0.14, 0.14, [1.0, 0.85, 0.45], 0);
  }

  // ---------------- port structures (LOCAL origin: water toward -z, land +z) ----------------
  // Phase 16b: hut wood + prop colours pushed warmer/more saturated — confident toy-like hues
  // rather than desaturated realism (the biome's own build.wall/roof palette in biomes.js carries
  // the bigger structures; these are the small shared kit pieces every era reuses). Phase 18b: full
  // diorama craft — timber-frame walls, deep-eave roof (per biome.build.roofStyle), oversized door
  // with lintel, a real window with frame+sill, an occasional cooking-fire chimney.
  function hut(flat, x, z, rng, b) {
    var bd = buildOf(b), wood = pick(bd.wall, rng), roof = bd.roof, trim = bd.trim;
    var w = 4.4 + rng() * 1.8, h = 2.9 + rng() * 1.0, d = 4.4 + rng() * 1.8, rot = (rng() - 0.5) * 0.4;
    flat.bbox(x, h / 2, z, w, h, d, wood, rot, Math.min(w, d) * 0.11);
    timberFrame(flat, x, 0, z, w, h, d, mul(trim, 0.5));
    var peak = roofKit(flat, x, h, z, w, d, roof, trim, bd.roofStyle, 0.85, 0.62);
    doorSlab(flat, x, 0, z + d * 0.5 + 0.08, w * 0.30, h * 0.62, mul(wood, 0.5), trim);
    windowInset(flat, x - w * 0.30, h * 0.58, z + d * 0.5 + 0.05, 0.55, 0.55, trim, [0.58, 0.66, 0.70]);
    if (rng() < 0.5) chimneyPot(flat, x + w * 0.28, h, z - d * 0.15, 1.5 + rng() * 0.6, mul(wood, 0.65));
    return peak;
  }
  // Cottage (BT 'cottage', era0 housing) — a snugger home than the fishing hut: window boxes with
  // flowers on both sides of the door, always a chimney (a lived-in house, not a work shack), a
  // steeper roof pitch for a cosier silhouette.
  function cottage(grit, flat, x, z, rng, b) {
    var bd = buildOf(b), wall = pick(bd.wall, rng), roof = bd.roof, trim = bd.trim;
    var w = 5.4 + rng() * 1.6, h = 3.3 + rng() * 0.8, d = 5.0 + rng() * 1.4, rot = (rng() - 0.5) * 0.3;
    grit.bbox(x, h / 2, z, w, h, d, wall, rot, Math.min(w, d) * 0.12);
    timberFrame(flat, x, 0, z, w, h, d, mul(trim, 0.55));
    var peak = roofKit(flat, x, h, z, w, d, roof, trim, bd.roofStyle, 1.0, 0.68);
    doorSlab(flat, x, 0, z + d * 0.5 + 0.08, w * 0.24, h * 0.60, mul(wall, 0.45), trim);
    windowInset(flat, x - w * 0.28, h * 0.60, z + d * 0.5 + 0.05, 0.5, 0.5, trim, [0.58, 0.66, 0.70]);
    windowInset(flat, x + w * 0.28, h * 0.60, z + d * 0.5 + 0.05, 0.5, 0.5, trim, [0.58, 0.66, 0.70]);
    windowFlowerBox(flat, x - w * 0.28, h * 0.34, z + d * 0.5 + 0.22, rng);
    windowFlowerBox(flat, x + w * 0.28, h * 0.34, z + d * 0.5 + 0.22, rng);
    chimneyPot(flat, x - w * 0.30, h, z - d * 0.18, 1.7 + rng() * 0.5, mul(wall, 0.6));
    if (rng() < 0.6) { groundCrate(flat, x + w * 0.55, z + d * 0.3, rng() * 0.5, mul(wall, 0.7)); }
    return peak;
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
    flat.box(x, hb + 0.4, z, L * 0.9, 0.7, B + 0.2, [0.68, 0.38, 0.30], 0);
    var ci = 0; for (var cx = -10; cx <= 8; cx += 4.6) { var stk = 1 + (rng() * 2 | 0); for (var r = 0; r < stk; r++) flat.bbox(x + cx, deck + 0.9 + r * 2.0, z, 4.2, 1.9, B - 1.5, CONT[(ci + r) % CONT.length], 0, 0.3); ci++; }
    grit.bbox(x + L * 0.36, deck + 3.0, z, 5, 5.5, B * 0.8, [0.9, 0.92, 0.95], 0, 0.6, 2); flat.cyl(x + L * 0.36 + 1.5, deck + 6, z, 1.3, 3.2, 9, [0.2, 0.22, 0.26], 1);
  }
  function containerShip(grit, flat, x, z, rng, scale) {
    var s = scale || 1, L = 72 * s, B = 18 * s, deck = 2.4, hb = -4.0, hull = [0.16, 0.19, 0.26], accent = [0.70, 0.38, 0.30];
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
  // Phase 18b: brick-banded walls + a hipped (biome flat -> flat parapet) roof + big loading doors
  // with lintels, a couple of glazed upper windows, quay-side barrels/crates and a lantern bracket.
  function warehouse(grit, flat, x, z, w, d, rng, b) {
    var bd = buildOf(b), wall = jit(pick(bd.wall, rng), 0.06, rng), trim = bd.trim;
    var h = 7.4 + rng() * 2.6;
    grit.bbox(x, h / 2, z, w, h, d, wall, 0, Math.min(w, d) * 0.09, 2);
    brickBanding(grit, x, 0, z, w, h, d, mul(trim, 0.72));
    var peak = roofKit(flat, x, h, z, w, d, bd.roof, trim, bd.roofStyle === 'flat' ? 'flat' : 'hip', 1.3);
    var dn = Math.max(2, Math.round(w / 8)), doorW = w / dn * 0.62;
    for (var i = 0; i < dn; i++) {
      var dx = x - w / 2 + (i + 0.5) * w / dn;
      doorSlab(flat, dx, 0, z + d / 2 + 0.05, doorW, h * 0.62, [0.20, 0.21, 0.24], trim);
      if (i % 2) windowInset(flat, dx, h * 0.80, z + d / 2 + 0.05, doorW * 0.55, 0.9, trim, [0.42, 0.55, 0.62]);
    }
    groundBarrel(flat, x - w / 2 - 0.9, z + d / 2 + 1.2, mul(wall, 0.7));
    groundCrate(flat, x - w / 2 - 0.9, z + d / 2 + 2.4, rng() * 0.4, trim);
    lanternBracket(flat, x + w / 2 + 0.1, h * 0.55, z + d / 2, trim);
    return peak;
  }
  // Market (BT 'market', "Fish Market") — plaster wall, striped canvas awning over the stall front,
  // a hanging shop sign, barrels/crates of the day's catch either side of the door.
  function market(grit, flat, x, z, rng, b) {
    var bd = buildOf(b), wall = pick(bd.wall, rng), trim = bd.trim, awn = bd.roof;
    var w = 9 + rng() * 1.5, h = 4.0 + rng() * 0.6, d = 7 + rng() * 1;
    grit.bbox(x, h / 2, z, w, h, d, wall, 0, Math.min(w, d) * 0.10);
    var peak = roofKit(flat, x, h, z, w, d, awn, trim, bd.roofStyle, 0.9, 0.5);
    shopAwning(flat, x, h * 0.62, z + d / 2 + 0.7, w * 0.86, z + d / 2 + 0.05, awn, mul(awn, 1.3));
    doorSlab(flat, x, 0, z + d / 2 + 0.08, w * 0.28, h * 0.62, mul(wall, 0.5), trim);
    hangingSign(flat, x + w * 0.32, h * 0.72, z + d / 2, mul(trim, 0.5), [0.68, 0.34, 0.28]);
    groundBarrel(flat, x - w * 0.40, z + d / 2 + 1.6, mul(wall, 0.65));
    groundCrate(flat, x - w * 0.40 + 1.1, z + d / 2 + 1.7, rng() * 0.5, trim);
    groundBarrel(flat, x + w * 0.42, z + d / 2 + 1.7, mul(trim, 0.7));
    return peak;
  }
  // Sawmill (BT 'sawmill') — rustic timber-frame walls, a barn-style gambrel roof, a saw-blade
  // accent on the gable end, and a stack of trimmed logs waiting to be milled.
  function sawmill(grit, flat, x, z, rng, b) {
    var bd = buildOf(b), wall = pick(bd.wall, rng), trim = bd.trim;
    var w = 8.5 + rng() * 1.4, h = 5.0 + rng() * 1.0, d = 7.5 + rng() * 1.2;
    grit.bbox(x, h / 2, z, w, h, d, mul(wall, 0.9), 0, Math.min(w, d) * 0.08);
    timberFrame(flat, x, 0, z, w, h, d, mul(trim, 0.4));
    var peak = gambrelRoof(flat, x, h, z, w, d, [0.36, 0.24, 0.16], trim, 1.0);
    doorSlab(flat, x, 0, z + d / 2 + 0.08, w * 0.30, h * 0.66, mul(wall, 0.4), trim);
    // saw-blade accent on the gable end: two thin crossed boxes -> an octagonal blade standing
    // UPRIGHT against the wall (a vertical-axis cyl would lie flat like a table, and cyl top caps
    // don't render from above anyway — see droneBayPad)
    flat.box(x, h * 0.62, z - d / 2 - 0.10, 1.9, 1.9, 0.12, [0.60, 0.61, 0.63], 0, Math.PI / 4);
    flat.box(x, h * 0.62, z - d / 2 - 0.10, 1.9, 1.9, 0.12, [0.60, 0.61, 0.63], 0, 0);
    flat.box(x, h * 0.62, z - d / 2 - 0.16, 0.5, 0.5, 0.10, [0.30, 0.30, 0.32], 0, 0);   // hub
    logStack(flat, x - w * 0.62, z - d * 0.1, 4, [0.58, 0.40, 0.24]);
    groundCrate(flat, x + w * 0.52, z + d * 0.2, rng() * 0.4, trim);
    return peak;
  }
  // Goods Factory (BT 'factory') — brick-banded industrial block, roof skylight strips, a tall
  // chimney (visual only — the actual chimney-smoke particle system anchors on the port's own
  // centre, see game.js emitSmoke, so this reads correctly even before the chimney exists at draw
  // time on a fresh save) and twin glazed windows either side of the loading door.
  function factory(grit, flat, x, z, rng, b) {
    var bd = buildOf(b), wall = jit(mul(pick(bd.wall, rng), 0.85), 0.05, rng), trim = bd.trim;
    var w = 10 + rng() * 1.6, h = 8.5 + rng() * 2.0, d = 8.5 + rng() * 1.4;
    grit.bbox(x, h / 2, z, w, h, d, wall, 0, Math.min(w, d) * 0.08, 2);
    brickBanding(grit, x, 0, z, w, h, d, mul(trim, 0.6));
    var peak = roofKit(flat, x, h, z, w, d, mul(bd.roof, 0.9), trim, bd.roofStyle === 'flat' ? 'flat' : 'hip', 1.0);
    for (var s = 0; s < 3; s++) flat.box(x - w * 0.3 + s * w * 0.3, peak + 0.15, z, w * 0.16, 0.3, d * 0.7, [0.45, 0.62, 0.72], 0, 0, 0.2);   // roof skylight strips
    doorSlab(flat, x, 0, z + d / 2 + 0.08, w * 0.24, h * 0.5, [0.20, 0.21, 0.24], trim);
    windowInset(flat, x - w * 0.30, h * 0.7, z + d / 2 + 0.05, 0.9, 1.1, trim, [0.40, 0.50, 0.58]);
    windowInset(flat, x + w * 0.30, h * 0.7, z + d / 2 + 0.05, 0.9, 1.1, trim, [0.40, 0.50, 0.58]);
    chimneyPot(flat, x + w * 0.36, h, z - d * 0.28, (peak - h) + 4.0 + rng() * 1.5, mul(wall, 0.7));
    return peak;
  }
  // Cargo Dock (BT 'dock') — a small dockmaster's office beside the crane: flat utility roof, a
  // wide door, a "Cargo" sign, crates/barrels staged for loading.
  function cargoDock(grit, flat, x, z, rng, b) {
    var bd = buildOf(b), wall = pick(bd.wall, rng), trim = bd.trim;
    var w = 6.5 + rng() * 1, h = 4.2 + rng() * 0.6, d = 5.5 + rng() * 1;
    grit.bbox(x, h / 2, z, w, h, d, mul(wall, 0.85), 0, Math.min(w, d) * 0.10, 2);
    brickBanding(grit, x, 0, z, w, h, d, mul(trim, 0.65));
    var peak = flatRoof(flat, x, h, z, w, d, bd.roof, trim, 0.7);
    doorSlab(flat, x, 0, z + d / 2 + 0.06, w * 0.34, h * 0.66, [0.20, 0.21, 0.24], trim);
    windowInset(flat, x + w * 0.28, h * 0.62, z + d / 2 + 0.05, 0.6, 0.6, trim, [0.42, 0.55, 0.62]);
    hangingSign(flat, x - w * 0.34, h * 0.9, z + d / 2, mul(trim, 0.5), [0.32, 0.44, 0.58]);
    groundCrate(flat, x + w * 0.5 + 1.0, z, rng() * 0.5, [0.62, 0.46, 0.28]);
    groundBarrel(flat, x + w * 0.5 + 1.0, z + 1.2, mul(wall, 0.6));
    lanternBracket(flat, x - w / 2 - 0.1, h * 0.7, z - d / 2, trim);
    return peak;
  }
  // Trading Post — the era's namesake mercantile stall: plaster walls, an awning, a swinging sign
  // and a small flagpole (distinct from the fish-only Market — general goods & barter).
  function tradingPost(grit, flat, x, z, rng, b) {
    var bd = buildOf(b), wall = pick(bd.wall, rng), trim = bd.trim;
    var w = 7.5 + rng() * 1.2, h = 4.4 + rng() * 0.6, d = 6.5 + rng() * 1;
    grit.bbox(x, h / 2, z, w, h, d, wall, 0, Math.min(w, d) * 0.11);
    var peak = roofKit(flat, x, h, z, w, d, bd.roof, trim, bd.roofStyle, 1.05, 0.55);
    shopAwning(flat, x, h * 0.58, z + d / 2 + 0.7, w * 0.7, z + d / 2 + 0.05, trim, mul(trim, 0.6));
    doorSlab(flat, x, 0, z + d / 2 + 0.08, w * 0.26, h * 0.60, mul(wall, 0.5), trim);
    windowInset(flat, x - w * 0.32, h * 0.6, z + d / 2 + 0.05, 0.55, 0.55, trim, [0.58, 0.66, 0.70]);
    hangingSign(flat, x + w * 0.36, h * 0.78, z + d / 2, mul(trim, 0.5), [0.74, 0.63, 0.40]);
    flat.cyl(x - w * 0.5 - 0.3, h, z - d * 0.2, 0.06, 2.0, 5, mul(trim, 0.5), 0.9);            // flagpole
    flat.box(x - w * 0.5 + 0.02, h + 1.7, z - d * 0.2, 0.5, 0.34, 0.05, [0.68, 0.34, 0.28], 0);  // pennant
    groundCrate(flat, x + w * 0.5 + 0.9, z + d * 0.3, rng() * 0.4, trim);
    groundBarrel(flat, x - w * 0.5 - 0.9, z + d * 0.3, mul(wall, 0.65));
    return peak;
  }
  // Sea Wall (BT 'seawall') — a stone-block coping wall segment running along the quay's seaward
  // edge; assemblePort() below strings several of these end to end.
  function seawallSegment(grit, flat, x0, x1, z, rng, b) {
    var bd = buildOf(b), stone = mul(pick(bd.wall, rng), 0.65), cap = bd.trim;
    var w = x1 - x0, cx = (x0 + x1) / 2, h = 1.6;
    grit.bbox(cx, h / 2, z, w, h, 1.3, stone, 0, 0.3);
    flat.box(cx, h + 0.14, z, w * 1.02, 0.26, 1.5, cap, 0);
    var n = Math.max(2, Math.round(w / 3.2));
    for (var i = 0; i < n; i++) flat.box(x0 + (i + 0.5) * w / n, h + 0.02, z, w / n * 0.16, 0.4, 1.55, mul(cap, 0.82), 0);   // coping blocks
    return h;
  }
  function craneStatic(grit, baseX, z) {
    var col = [0.72, 0.58, 0.30], h = 32, lx = [baseX - 11, baseX + 11], lz = [z + 9, z - 9];
    for (var a = 0; a < 2; a++) for (var bI = 0; bI < 2; bI++) { grit.box(lx[a], h / 2, lz[bI], 2.2, h, 2.2, col); grit.box(lx[a], h * 0.5, lz[bI], 1.1, h * 0.9, 1.1, mul(col, 0.92), 0, (a ? -0.5 : 0.5)); }
    grit.box(lx[0], h, z, 2.4, 2.4, 20, col); grit.box(lx[1], h, z, 2.4, 2.4, 20, col); grit.box(baseX, h, lz[0], 24, 2.4, 2.6, col); grit.box(baseX, h, lz[1], 24, 2.4, 2.6, col);
    grit.box(baseX, h + 2.1, z - 14, 30, 2.6, 3.0, col); grit.box(baseX, h + 2.1, z + 5, 30, 2.6, 3.0, col); grit.bbox(baseX - 7, h + 2.6, z, 7, 4.8, 9, [0.22, 0.24, 0.28], 0, 0.6);
  }
  // sc (optional, Phase 14b): the yard floodlight poles below ARE the quay's lampposts — each
  // pole's ground position is recorded into sc.lamps so game.js can drop a warm night-time light
  // pool decal under it (see drawNightPools/scene.lamps) without inventing new geometry. q:1
  // marks a QUAY-MOUNTED lamp (the pool must sit on the concrete deck, 2.2 above the port base
  // — concreteQuay's slab height) vs q:0 for ground-level anchors (warehouse doorways, on terrain).
  function props(grit, flat, rng, era, sc) {
    for (var mx = -56; mx <= 56; mx += 28) { grit.cyl(mx, 0, 12, 0.4, 12, 6, [0.3, 0.31, 0.33], 1); flat.box(mx, 12, 12, 2.4, 0.5, 0.8, [1.0, 0.95, 0.7], 0); if (sc) sc.lamps.push({ x: mx, z: 12, q: 1 }); }
    var ci = 0; for (var yx = 28; yx <= 28 + era * 8; yx += 5.4) for (var yz = 16; yz <= 22; yz += 5.6) { var stk = 1 + (rng() * 2 | 0); for (var r = 0; r < stk; r++) flat.bbox(yx, 0.4 + r * 2.4, yz, 5, 2.3, 5, CONT[(ci + r) % CONT.length], 0, 0.35); ci++; }
  }
  // Phase 18b: proper tapered tower (6 shrinking banded segments over a flared stone plinth), a
  // jutting gallery ring with a railing of individual posts, a glazed lamp housing under a red
  // conical roof, and a bright beacon finial — the alternating red/white bands read as the
  // lighthouse's signature spiral stripe as the tower tapers past them.
  function lighthouse(grit, flat, x, z) {
    var stone = [0.30, 0.31, 0.33], stripe1 = [0.93, 0.92, 0.89], stripe2 = [0.72, 0.34, 0.28];   // 19a: paper white / brick card
    var plinthR = 5.0, botR = 3.6, topR = 1.7, segs = 6, segH = 3.2;
    grit.cyl(x, 0, z, plinthR, 2.4, 10, stone, botR / plinthR);            // flared stone plinth
    var y = 2.4, i;
    for (i = 0; i < segs; i++) {
      var t0 = i / segs, t1 = (i + 1) / segs, r0 = botR + (topR - botR) * t0, r1 = botR + (topR - botR) * t1;
      grit.cyl(x, y, z, r0, segH, 12, i % 2 ? stripe1 : stripe2, r1 / r0);
      y += segH;
    }
    grit.cyl(x, y, z, topR + 0.9, 0.5, 12, [0.22, 0.22, 0.24], 0.94);      // gallery ring
    for (i = 0; i < 12; i++) { var a = i / 12 * TAU, px = x + Math.cos(a) * (topR + 0.85), pz = z + Math.sin(a) * (topR + 0.85); flat.cyl(px, y + 0.5, pz, 0.06, 0.9, 4, [0.85, 0.86, 0.88], 0.95); }
    y += 0.5;
    grit.cyl(x, y, z, topR * 0.85, 2.6, 10, [0.20, 0.20, 0.22], 0.92);     // lamp housing frame
    flat.cyl(x, y + 0.3, z, topR * 0.72, 2.0, 10, [0.66, 0.76, 0.79], 0.9);   // glazing band
    y += 2.6;
    flat.cyl(x, y, z, topR * 0.95, 1.6, 10, [0.68, 0.32, 0.27], 0.06);     // conical lamp roof
    y += 1.6;
    flat.box(x, y + 0.35, z, 0.5, 0.5, 0.5, [1.6, 1.35, 0.6]);             // beacon finial
    doorSlab(flat, x, 0, z + botR * 0.72, 1.2, 2.0, [0.20, 0.20, 0.22], stripe1);
    return y + 0.7;
  }

  // ---------------- Phase 17a: technology-age silhouettes (Automated Harbour / Neon Horizon) ----
  // Same shared-kit approach as the rest of the port (chamfered boxes + cylinders, no new asset
  // pipeline) but a deliberately different palette — glassy blues + steel instead of wood/brick —
  // so era6/7 read as a distinct skyline the moment the outline pass (14a) picks out their silhouette.
  var GLASS_STEEL = [0.72, 0.74, 0.77], GLASS_PANE = [0.58, 0.72, 0.80], SOLAR_BLUE = [0.32, 0.48, 0.64];   // 19a: matte card, no glow
  var NEON_HUES = [[0.46, 0.72, 0.78], [0.76, 0.50, 0.70], [0.54, 0.74, 0.58]];   // 19a: dyed-card accents, not neon
  // Automated Harbour: a slim steel-framed tower with a stack of glass curtain-wall bands and a
  // tilted rooftop solar array — the age's signature silhouette (also SIM.BT's Solar Spire flavour).
  // Phase 18b: kept its futuristic identity but gained diorama craft — vertical panel-seam trim
  // lines on the curtain wall and a small rooftop antenna cluster, same technique (thin flat.box
  // trim) as the wood-era buildings' fascia/ridge-cap boards, just glass-steel toned.
  function solarSpire(grit, flat, x, z, rng) {
    var h = 24 + rng() * 8;
    grit.bbox(x, h / 2, z, 5.0, h, 5.0, GLASS_STEEL, 0, 0.55, 3);
    for (var f = 3.2; f < h - 2; f += 3.6) flat.box(x, f, z + 2.6, 4.4, 1.5, 0.18, GLASS_PANE, 0, 0, 0.2);
    for (var seam = -1; seam <= 1; seam++) flat.box(x + seam * 1.6, h * 0.5, z + 2.62, 0.06, h * 0.94, 0.05, mul(GLASS_STEEL, 0.55), 0);   // panel seams
    flat.box(x, h + 1.3, z, 7.2, 0.3, 3.8, SOLAR_BLUE, 0.05, 0.3);   // tilted rooftop solar array
    flat.cyl(x, h + 0.1, z, 0.55, 0.9, 6, GLASS_STEEL, 0.7);
    flat.cyl(x + 1.6, h + 1.5, z - 0.6, 0.05, 1.2, 4, GLASS_STEEL, 0.9); flat.box(x + 1.6, h + 2.8, z - 0.6, 0.14, 0.14, 0.14, NEON_HUES[0], 0);   // antenna
    return h + 3.0;
  }
  // Neon Horizon: a stepped glass skyscraper ringed in a glowing accent colour + rooftop beacon —
  // three tints rotate through a port so a Neon Horizon skyline never reads as one repeated block.
  // Phase 18b: corner panel-seam trim lines + a second short antenna cluster.
  function neonTower(grit, flat, x, z, rng) {
    var h = 32 + rng() * 16, accent = pick(NEON_HUES, rng), glass = [0.30, 0.35, 0.45];
    grit.bbox(x, h * 0.42, z, 7.6, h * 0.84, 7.6, glass, 0, 0.5, 3);
    grit.bbox(x, h * 0.94, z, 5.2, h * 0.20, 5.2, mul(glass, 1.15), 0, 0.5, 2);
    for (var b = 0; b < 3; b++) flat.box(x, h * (0.24 + b * 0.28), z, 7.9, 0.28, 7.9, accent, 0, 0, 0.5);
    for (var sm = 0; sm < 4; sm++) { var a = sm / 4 * TAU; flat.box(x + Math.cos(a) * 3.85, h * 0.5, z + Math.sin(a) * 3.85, 0.06, h * 0.82, 0.06, mul(glass, 0.55), a); }   // corner panel seams
    flat.box(x, h + 1.1, z, 0.35, 2.2, 0.35, accent, 0);   // antenna beacon
    flat.cyl(x + 0.8, h + 1.6, z, 0.05, 1.0, 4, GLASS_STEEL, 0.9); flat.box(x + 0.8, h + 2.7, z, 0.12, 0.12, 0.12, accent, 0);   // secondary antenna
    return h + 2.4;
  }
  // Automated Harbour: a drone landing pad (Drone Bay) — a low glowing deck with a few parked
  // delivery drones, ringing the crane/quay rather than joining the tower skyline. Phase 18b:
  // rebuilt from BOXES. Two findings while remodeling: (1) 17a baked the blue glow deck at
  // y 0.60-0.70 INSIDE the grey base cylinder (top 0.83), so the pad had always rendered as a bare
  // concrete-grey disc; (2) cyl() TOP CAPS are back-face-culled from above (wound for a from-below
  // view — every other cyl in the game reads by its side wall, so it never mattered), which makes
  // a mostly-top-facing cyl deck unrenderable from the game's camera. Box tops render fine (every
  // roof proves it), so the deck is now an octagon of two stacked 45-degree-crossed flat boxes
  // with corner studs and a white centre 'H' — the classic landing-pad read from any angle.
  function droneBayPad(grit, flat, x, z, rng) {
    grit.cyl(x, 0.28, z, 6.2, 0.55, 10, [0.66, 0.68, 0.72], 0.85);                // grey plinth (side wall read)
    flat.box(x, 0.90, z, 8.6, 0.14, 8.6, SOLAR_BLUE, 0);                          // glow deck: crossed squares
    flat.box(x, 0.90, z, 8.6, 0.14, 8.6, SOLAR_BLUE, Math.PI / 4);                //   -> octagon from above
    for (var st = 0; st < 8; st++) {                                              // rim studs
      var sa = st / 8 * TAU + Math.PI / 8;
      flat.box(x + Math.cos(sa) * 4.9, 1.06, z + Math.sin(sa) * 4.9, 0.42, 0.22, 0.42, mul(SOLAR_BLUE, 0.55), sa);
    }
    flat.box(x - 0.72, 1.02, z, 0.30, 0.10, 2.0, [0.94, 0.96, 0.99], 0);          // centre 'H' marking
    flat.box(x + 0.72, 1.02, z, 0.30, 0.10, 2.0, [0.94, 0.96, 0.99], 0);
    flat.box(x, 1.02, z, 1.2, 0.10, 0.30, [0.94, 0.96, 0.99], 0);
    for (var i = 0; i < 3; i++) { var a = i * 2.15 + rng() * 0.4, dx = x + Math.cos(a) * 3.2, dz = z + Math.sin(a) * 3.2; flat.bbox(dx, 1.20, dz, 0.85, 0.4, 0.85, [0.86, 0.87, 0.9], a, 0.2); }
    return 1.7;
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

  // ---------------- Phase 17b: FLEET REGISTRY — three 8-tier ladders (fishing/trade/expedition)
  // layered on the SAME assembleShip()/SPEC-table kit as 16a's six classes (three of which are
  // reused in place as ladder rungs: dinghy=fishing2, sloop=fishing3, brig=trade2, steamer=trade5,
  // schooner=expedition2 — corsair stays the rival's own thing, off every ladder). Sail-era rungs
  // differ by proportion + rig (mast count, tri/square/mixed sails); powered/futuristic rungs differ
  // via the `extra` hook below — funnels, paddle boxes, containers, radar, hydrofoil struts, solar
  // decking, glow trim — a handful of small shared part-builders, never bespoke per-class geometry.
  // Futuristic tiers deliberately borrow the 17a Automated Harbour/Neon Horizon palette (GLASS_STEEL/
  // GLASS_PANE/SOLAR_BLUE/NEON_HUES, defined earlier in this file) so "the harbourmaster's fleet
  // keeps up with the times" reads as the SAME future as the skyline behind it.
  function funnelPart(trim, x, z, base, h, r, bandC) {
    trim.cyl(x, base, z, r, h, 9, [0.14, 0.14, 0.16], 0.88);
    trim.cyl(x, base + h * 0.78, z, r * 0.94, h * 0.22, 9, bandC || [0.58, 0.30, 0.25], 0.94);
  }
  function containerBlock(trim, x, y, z, ci) { trim.bbox(x, y, z, 2.2, 1.7, 2.1, CONT[ci % CONT.length], 0, 0.22); }
  function radarMastPart(trim, x, z, base, top, tone) {
    trim.cyl(x, base, z, 0.09, top - base, 6, tone || [0.55, 0.57, 0.60], 0.9);
    trim.box(x, top, z, 1.1, 0.42, 0.10, tone || [0.55, 0.57, 0.60], 0.4);
  }
  function sternCraneRig(trim, L, Bm, H) {
    strutS(trim, -Bm * 0.32, H * 1.0, -L * 0.40, 0, H * 2.0, -L * 0.28, 0.15, [0.55, 0.56, 0.58]);
    strutS(trim, Bm * 0.32, H * 1.0, -L * 0.40, 0, H * 2.0, -L * 0.28, 0.15, [0.55, 0.56, 0.58]);
    trim.cyl(0, H * 0.98, -L * 0.41, 0.30, 0.5, 7, [0.28, 0.29, 0.30], 0.92);
  }
  function paddleBoxPart(trim, x, H, Bm) { trim.bbox(x, H * 0.88, 0, 1.5, H * 1.5, Bm * 0.46, [0.68, 0.34, 0.28], 0, 0.3); }
  // strut + foil blade kept ABOVE the local waterline (draft ≈ H*0.40 — hullTint/drawShip subtracts
  // draft from the whole ship's world Y, so anything below local y≈0.4*H sits under the opaque sea
  // and simply never renders) and angled OUTBOARD past the hull's beam, so it reads as a distinct
  // silhouette poking out to the side instead of a "strut" that vanishes straight down underwater.
  function hydrofoilStruts(trim, Bm, H, zc) {
    [-1, 1].forEach(function (s) {
      strutS(trim, s * Bm * 0.30, H * 0.82, zc, s * Bm * 1.05, H * 0.44, zc, 0.13, [0.60, 0.62, 0.66]);
      trim.box(s * Bm * 1.05, H * 0.42, zc, 1.5, 0.12, 0.46, [0.52, 0.54, 0.58], 0);
    });
  }
  function solarDeckPart(trim, Bm, H, z0, z1, tone) {
    for (var z = z0; z <= z1; z += 2.3) trim.box(0, H * 1.02, z, Bm * 0.74, 0.08, 2.0, tone || SOLAR_BLUE, 0, 0, 0.1);
  }
  function glowTrimPart(trim, L, Bm, H, n, bowLift, tone) {
    n = n || 6;
    for (var i = 0; i < n; i++) {
      var t = (i + 0.5) / n, w = hullW(Bm, t), lift = hullLift(bowLift, t), z = -L / 2 + L * (i + 0.5) / n, len = L / n * 1.05;
      trim.box(w / 2 + 0.03, H * 0.5 + lift, z, 0.08, 0.10, len, tone || NEON_HUES[0], 0);
      trim.box(-w / 2 - 0.03, H * 0.5 + lift, z, 0.08, 0.10, len, tone || NEON_HUES[0], 0);
    }
  }
  // a small tapered pontoon merged in at a beam offset — catamaran/trimaran outer hulls. Real baked
  // colour (not tint-ready): expedition-role ships already draw with a fixed EXP_HULL tint, so a
  // pontoon's own tone reads consistently without needing to match the runtime uBase.
  function pontoonHullPart(trim, len, bm, h, x, tone) {
    var mini = new g.HGL.Builder(), n = 4;
    for (var i = 0; i < n; i++) {
      var t = (i + 0.5) / n, w = bm * (1 - Math.pow(Math.abs(t - 0.5) * 2, 1.7)) + bm * 0.16, segZ = -len / 2 + len * (i + 0.5) / n, segLen = len / n * 1.08;
      mini.bbox(0, h / 2, segZ, segLen, h, w, tone, 0, Math.min(segLen, w) * 0.2);
    }
    trim.addXform(mini, x, 0, 0, 0);
  }
  // a row of parallel "bound log" boxes running FORE-AFT (long axis on Z, the ship's length),
  // offset across the beam (X) — log_barge cargo + raft hull texture. bbox's sx is the BEAM
  // dimension here and sz the fore-aft length, so each log lies along the hull instead of
  // crossing it corner-to-corner.
  function logBundlePart(trim, Bm, y, len, tone, n) {
    n = n || 5;
    for (var i = 0; i < n; i++) { var x = -Bm * 0.40 + Bm * 0.80 * (n === 1 ? 0.5 : i / (n - 1)); trim.bbox(x, y, 0, 0.55, 0.5, len, tone, 0, 0.22); }
  }
  var STEEL = [0.60, 0.62, 0.66], WHITE_HULL = [0.89, 0.87, 0.82], SAFETY = [0.78, 0.50, 0.30], WICKER = [0.58, 0.44, 0.24];   // 19a: paper hull, brick-orange safety
  var SHIP_SPECS = {
    dinghy: {   // tiny open boat: bench, bare mast (no standing rigging), one small sail
      L: 6.4, Bm: 2.5, H: 1.1, n: 5, bowLift: 0.45, gunwale: true, rudder: true, bench: true, rig: false,
      masts: [{ z: 0.3, top: 5.0 }], sails: [{ shape: 'tri', mast: 0, base: 3.2, h: 4.0 }]
    },
    sloop: {    // one mast, big mainsail + jib off the bowsprit, net-barrel aft
      L: 10.5, Bm: 3.6, H: 1.6, n: 7, bowLift: 0.70, gunwale: true, rudder: true, bowspritLen: 1.9,
      masts: [{ z: -0.5, top: 9.4, boom: 4.6 }],
      sails: [{ shape: 'tri', mast: 0, base: 5.0, h: 7.2 }, { shape: 'tri', mast: 'bowsprit', base: 2.2, h: 3.4 }],
      pennant: { c: [0.70, 0.36, 0.30] }, props: [{ k: 'barrel', x: -0.9, z: -4.2 }]
    },
    brig: {     // beamy two-master, SQUARE sails hung high on yards — the workhorse silhouette
      L: 20, Bm: 6.0, H: 2.6, n: 7, bowLift: 1.1, gunwale: true, rudder: true, bowspritLen: 2.6, cabin: true,
      masts: [{ z: 4.0, top: 14.0 }, { z: -3.2, top: 15.0 }],
      sails: [{ shape: 'square', mast: 0, base: 7.2, h: 7.6, y0: 3.4 }, { shape: 'square', mast: 1, base: 7.8, h: 8.4, y0: 3.6 }],
      pennant: { c: [0.36, 0.40, 0.54] }, props: [{ k: 'barrel', x: 1.6, z: 0.4 }, { k: 'crate', x: -1.6, z: 0.6 }]
    },
    schooner: { // long elegant two-master, tall fore-and-aft sails + jib, gilded rail, stern lantern
      L: 23, Bm: 5.2, H: 2.35, n: 7, bowLift: 1.05, gunwale: true, gunwaleTone: [0.74, 0.60, 0.38], rudder: true,
      bowspritLen: 3.2, cabin: true, lantern: true, deckTone: [0.84, 0.80, 0.70],
      masts: [{ z: 5.0, top: 13.0, boom: 6.0 }, { z: -3.6, top: 15.5, boom: 7.0 }],
      sails: [{ shape: 'tri', mast: 0, base: 6.4, h: 9.6 }, { shape: 'tri', mast: 1, base: 7.4, h: 11.4 }, { shape: 'tri', mast: 'bowsprit', base: 2.6, h: 4.2 }],
      pennant: { c: [0.76, 0.64, 0.38] }
    },
    steamer: {  // no sails: fat funnel amidships, white bridge house aft, container rows forward
      L: 25, Bm: 6.4, H: 2.9, n: 7, bowLift: 0.5, gunwale: true, gunwaleTone: [0.55, 0.56, 0.60], rudder: true,
      deckTone: [0.30, 0.31, 0.34], funnel: [0, 2.9 + 2.9 * 2.2, 1.2],
      extra: function (trim, L2, Bm2, H2) {
        var fz = 1.2, fh = H2 * 2.2;
        trim.cyl(0, H2, fz, 0.95, fh, 10, [0.14, 0.14, 0.16], 0.88);                                     // fat funnel shaft
        trim.cyl(0, H2 + fh * 0.80, fz, 0.90, fh * 0.20, 10, [0.58, 0.30, 0.25], 0.94);                  // red-band top
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
    },

    // ---- FISHING ladder (dinghy=tier2, sloop=tier3 already above) ------------------------------
    raft: {     // tier0: no proper hull at all — bound logs, paddled, no mast
      L: 5.2, Bm: 2.4, H: 0.5, n: 3, bowLift: 0.05, gunwale: false, rudder: false, rig: false,
      deckTone: WOOD_DARK,
      extra: function (trim, L2, Bm2, H2) { logBundlePart(trim, Bm2, H2 * 1.05, L2 * 0.94, WOOD_LIGHT, 5); trim.box(Bm2 * 0.55, H2 * 1.3, -L2 * 0.3, 0.14, 2.4, 0.14, WOOD_DARK, 0.5, 0.6); }
    },
    coracle: {  // tier1: tiny round wicker tub, paddled
      L: 3.4, Bm: 3.0, H: 0.85, n: 5, bowLift: 0.10, gunwale: true, gunwaleTone: WICKER, rudder: false, rig: false,
      deckTone: WICKER,
      extra: function (trim, L2, Bm2, H2) { trim.box(0, H2 * 1.1, L2 * 0.1, 0.12, 2.0, 0.12, WOOD_DARK, 0.6, 0.5); }
    },
    // dinghy = tier2 (existing), sloop = tier3 (existing)
    steam_trawler: {  // tier4: stubby steel trawler, small funnel, stern trawl gantry
      L: 14, Bm: 4.6, H: 2.0, n: 6, bowLift: 0.5, gunwale: true, gunwaleTone: STEEL, rudder: true, cabin: true, cabinTone: WHITE_HULL,
      deckTone: [0.30, 0.31, 0.34],
      extra: function (trim, L2, Bm2, H2) { funnelPart(trim, 0, L2 * 0.06, H2, H2 * 1.5, 0.55, [0.58, 0.30, 0.25]); sternCraneRig(trim, L2, Bm2, H2); barrelProp(trim, Bm2 * 0.32, L2 * 0.3, H2); }
    },
    modern_trawler: {  // tier5: bigger steel trawler, twin outrigger trawl booms + radar mast
      L: 17, Bm: 5.4, H: 2.3, n: 6, bowLift: 0.4, gunwale: true, gunwaleTone: STEEL, rudder: true, cabin: true, cabinTone: WHITE_HULL,
      deckTone: [0.28, 0.29, 0.32],
      extra: function (trim, L2, Bm2, H2) {
        funnelPart(trim, -0.6, -L2 * 0.20, H2, H2 * 1.3, 0.42, [0.20, 0.22, 0.26]); radarMastPart(trim, 0.6, -L2 * 0.22, H2, H2 * 3.0, STEEL);
        strutS(trim, 0, H2 * 1.4, L2 * 0.05, Bm2 * 1.3, H2 * 0.4, L2 * 0.05, 0.13, STEEL); strutS(trim, 0, H2 * 1.4, L2 * 0.05, -Bm2 * 1.3, H2 * 0.4, L2 * 0.05, 0.13, STEEL);
        sternCraneRig(trim, L2, Bm2, H2);
      }
    },
    hydrofoil_skiff: {  // tier6: sleek skiff lifted on hydrofoil struts, no mast
      L: 9, Bm: 2.6, H: 1.0, n: 5, bowLift: 0.30, gunwale: true, gunwaleTone: GLASS_STEEL, rudder: true, rig: false,
      deckTone: GLASS_STEEL,
      extra: function (trim, L2, Bm2, H2) { hydrofoilStruts(trim, Bm2, H2, L2 * 0.10); hydrofoilStruts(trim, Bm2 * 0.7, H2, -L2 * 0.32); trim.bbox(0, H2 * 1.5, L2 * 0.30, 1.6, 0.9, 1.4, GLASS_PANE, 0, 0.2); }
    },
    solar_skimmer: {  // tier7: flat solar-decked drone skiff, glow trim, no mast/gunwale
      L: 10, Bm: 3.6, H: 0.75, n: 5, bowLift: 0.12, gunwale: false, rudder: false, rig: false,
      deckTone: SOLAR_BLUE,
      extra: function (trim, L2, Bm2, H2) { solarDeckPart(trim, Bm2, H2, -L2 * 0.36, L2 * 0.36, SOLAR_BLUE); glowTrimPart(trim, L2, Bm2, H2, 5, 0.12, NEON_HUES[0]); trim.cyl(0, H2 * 0.9, -L2 * 0.46, 0.34, 0.6, 8, GLASS_STEEL, 0.85); }
    },

    // ---- TRADE ladder (brig=tier2, steamer=tier5 already above) --------------------------------
    log_barge: {  // tier0: blunt flat barge stacked with timber, poled/towed
      L: 16, Bm: 6.5, H: 1.1, n: 5, bowLift: 0.15, gunwale: true, gunwaleTone: WOOD_DARK, rudder: true, rig: false,
      deckTone: WOOD_DARK,
      extra: function (trim, L2, Bm2, H2) { logBundlePart(trim, Bm2, H2 * 1.3, L2 * 0.68, WOOD_LIGHT, 6); logBundlePart(trim, Bm2 * 0.7, H2 * 1.75, L2 * 0.5, WOOD_LIGHT, 4); }
    },
    cog: {  // tier1: round-bellied medieval trader, one square sail, high stern castle
      L: 13, Bm: 5.0, H: 2.2, n: 6, bowLift: 0.9, gunwale: true, rudder: true, cabin: true, deckTone: PLANK,
      masts: [{ z: 0, top: 11.0 }],
      sails: [{ shape: 'square', mast: 0, base: 6.5, h: 6.0, y0: 3.0 }],
      pennant: { c: [0.64, 0.34, 0.28] },
      extra: function (trim, L2, Bm2, H2) { trim.bbox(0, H2 * 1.5, L2 * 0.40, Bm2 * 0.55, H2 * 0.6, L2 * 0.14, WOOD_LIGHT, 0, 0.2); }
    },
    // brig = tier2 (existing)
    clipper: {  // tier3: tall three-masted fast trader, lots of canvas, sharp sleek hull
      L: 26, Bm: 5.6, H: 2.5, n: 7, bowLift: 1.3, gunwale: true, gunwaleTone: [0.72, 0.58, 0.36], rudder: true,
      bowspritLen: 3.6, cabin: true, deckTone: [0.72, 0.62, 0.46],
      masts: [{ z: 6.5, top: 16.0, boom: 5.4 }, { z: 0, top: 18.0, boom: 6.2 }, { z: -6.5, top: 15.6, boom: 5.2 }],
      sails: [{ shape: 'tri', mast: 0, base: 6.0, h: 9.0 }, { shape: 'tri', mast: 1, base: 6.6, h: 10.4 }, { shape: 'tri', mast: 2, base: 5.6, h: 8.4 }, { shape: 'tri', mast: 'bowsprit', base: 2.6, h: 4.0 }],
      pennant: { c: [0.76, 0.64, 0.38] }
    },
    paddle_steamer: {  // tier4: white coastal steamer, side paddle boxes, single tall funnel
      L: 20, Bm: 6.2, H: 2.4, n: 6, bowLift: 0.5, gunwale: true, gunwaleTone: WHITE_HULL, rudder: true, cabin: true, cabinTone: WHITE_HULL,
      deckTone: [0.80, 0.78, 0.72],
      extra: function (trim, L2, Bm2, H2) { funnelPart(trim, 0, -0.4, H2, H2 * 2.0, 0.75, [0.68, 0.34, 0.28]); paddleBoxPart(trim, Bm2 * 0.62, H2, Bm2); paddleBoxPart(trim, -Bm2 * 0.62, H2, Bm2); }
    },
    // steamer = tier5 (existing, "Steam Freighter")
    container_ship: {  // tier6: long modern boxship, three container rows stacked high, aft funnel
      L: 30, Bm: 7.5, H: 3.1, n: 7, bowLift: 0.4, gunwale: true, gunwaleTone: STEEL, rudder: true, deckTone: [0.20, 0.21, 0.24],
      extra: function (trim, L2, Bm2, H2) {
        funnelPart(trim, 0, -L2 * 0.40, H2, H2 * 1.6, 0.85, [0.34, 0.44, 0.58]);
        trim.bbox(0, H2 * 1.55, -L2 * 0.40, Bm2 * 0.60, H2 * 1.0, L2 * 0.14, WHITE_HULL, 0, 0.25);
        var ci = 0; for (var cz = -L2 * 0.24; cz <= L2 * 0.42; cz += 3.4) { for (var row = -1; row <= 1; row++) { var stk = 2 + (ci + row + 3) % 3; for (var r = 0; r < stk; r++) containerBlock(trim, row * 2.4, H2 * 1.30 + r * 1.9, cz, ci + r); } ci++; }
      }
    },
    hover_freighter: {  // tier7: sleek hull, glow skirt, thruster pods, no gunwale/mast
      L: 24, Bm: 6.8, H: 2.2, n: 6, bowLift: 0.30, gunwale: false, rudder: false, rig: false, deckTone: GLASS_STEEL,
      extra: function (trim, L2, Bm2, H2) {
        glowTrimPart(trim, L2, Bm2, H2, 7, 0.30, SOLAR_BLUE);
        var ci = 0; for (var cz = -L2 * 0.2; cz <= L2 * 0.34; cz += 3.4) { trim.bbox(0, H2 * 1.35, cz, 3.2, 1.6, Bm2 * 0.58, mixc(GLASS_PANE, [1, 1, 1], 0.15), 0, 0.3); ci++; }
        trim.cyl(Bm2 * 0.5, H2 * 0.5, -L2 * 0.46, 0.5, 0.9, 8, GLASS_STEEL, 0.8); trim.cyl(-Bm2 * 0.5, H2 * 0.5, -L2 * 0.46, 0.5, 0.9, 8, GLASS_STEEL, 0.8);
      }
    },

    // ---- EXPEDITION ladder (schooner=tier2 already above) ---------------------------------------
    outrigger: {  // tier0: slender canoe + a single small outrigger float on struts
      L: 8, Bm: 1.8, H: 0.8, n: 5, bowLift: 0.5, gunwale: false, rudder: false,
      masts: [{ z: 0, top: 5.5 }], sails: [{ shape: 'tri', mast: 0, base: 2.0, h: 3.0 }],
      extra: function (trim, L2, Bm2, H2) { pontoonHullPart(trim, L2 * 0.7, Bm2 * 0.5, H2 * 0.7, Bm2 * 2.1, WOOD_DARK); strutS(trim, 0, H2 * 0.3, L2 * 0.2, Bm2 * 2.1, H2 * 0.3, L2 * 0.2, 0.10, WOOD_LIGHT); strutS(trim, 0, H2 * 0.3, -L2 * 0.2, Bm2 * 2.1, H2 * 0.3, -L2 * 0.2, 0.10, WOOD_LIGHT); }
    },
    caravel: {  // tier1: compact age-of-exploration ship, raked lateen-style sails, tall aftcastle
      L: 13, Bm: 4.4, H: 2.1, n: 6, bowLift: 0.8, gunwale: true, rudder: true, cabin: true, bowspritLen: 1.8, deckTone: PLANK,
      masts: [{ z: 3.0, top: 10.0 }, { z: -3.2, top: 11.0 }],
      sails: [{ shape: 'tri', mast: 0, base: 4.6, h: 6.6 }, { shape: 'tri', mast: 1, base: 5.2, h: 7.4 }, { shape: 'tri', mast: 'bowsprit', base: 2.0, h: 3.2 }],
      pennant: { c: [0.64, 0.34, 0.28] }
    },
    // schooner = tier2 (existing)
    barque: {  // tier3: three-masted tall ship, mixed rig — square fore/main, fore-and-aft mizzen
      L: 24, Bm: 5.8, H: 2.6, n: 7, bowLift: 1.0, gunwale: true, rudder: true, bowspritLen: 3.0, cabin: true, deckTone: [0.68, 0.58, 0.42],
      masts: [{ z: 6.0, top: 15.0 }, { z: 0, top: 16.0 }, { z: -6.0, top: 13.0, boom: 5.0 }],
      sails: [{ shape: 'square', mast: 0, base: 6.6, h: 6.6, y0: 3.2 }, { shape: 'square', mast: 1, base: 7.2, h: 7.4, y0: 3.4 }, { shape: 'tri', mast: 2, base: 5.4, h: 6.8 }, { shape: 'tri', mast: 'bowsprit', base: 2.4, h: 3.8 }],
      pennant: { c: [0.36, 0.40, 0.54] }
    },
    steam_yacht: {  // tier4: elegant white private steamer, thin funnel, stern awning, no sails
      L: 16, Bm: 4.0, H: 2.0, n: 6, bowLift: 0.9, gunwale: true, gunwaleTone: [0.72, 0.60, 0.38], rudder: true, cabin: true, cabinTone: WHITE_HULL,
      deckTone: [0.82, 0.80, 0.74],
      extra: function (trim, L2, Bm2, H2) { funnelPart(trim, 0, -0.2, H2, H2 * 1.9, 0.45, [0.16, 0.16, 0.18]); trim.box(0, H2 * 1.9, -L2 * 0.32, Bm2 * 0.5, 0.10, L2 * 0.16, [0.70, 0.42, 0.36], 0, 0.1); }
    },
    research_vessel: {  // tier5: modern boxy research ship, radar lattice mast, stern A-frame crane
      L: 19, Bm: 5.6, H: 2.5, n: 6, bowLift: 0.35, gunwale: true, gunwaleTone: SAFETY, rudder: true, cabin: true, cabinTone: WHITE_HULL,
      deckTone: [0.30, 0.31, 0.34],
      extra: function (trim, L2, Bm2, H2) { radarMastPart(trim, 0, -L2 * 0.20, H2, H2 * 3.4, SAFETY); sternCraneRig(trim, L2, Bm2, H2); crateProp(trim, -Bm2 * 0.3, L2 * 0.24, H2, SAFETY); crateProp(trim, Bm2 * 0.3, L2 * 0.24, H2, WHITE_HULL); }
    },
    expedition_catamaran: {  // tier6: twin-hull cruiser — slim central bridge deck + two pontoons
      L: 18, Bm: 2.0, H: 0.9, n: 5, bowLift: 0.4, gunwale: false, rudder: false, deckTone: WHITE_HULL,
      masts: [{ z: -1.0, top: 11.0 }], sails: [{ shape: 'tri', mast: 0, base: 4.4, h: 8.0 }],
      extra: function (trim, L2, Bm2, H2) { pontoonHullPart(trim, L2 * 0.94, Bm2 * 1.1, H2 * 1.1, Bm2 * 1.9, WHITE_HULL); pontoonHullPart(trim, L2 * 0.94, Bm2 * 1.1, H2 * 1.1, -Bm2 * 1.9, WHITE_HULL); trim.box(0, H2 * 1.1, 0, Bm2 * 4.2, 0.16, L2 * 0.5, WHITE_HULL, 0, 0.1); }
    },
    solar_trimaran: {  // tier7: solar-decked central hull + two slender glowing amas, no mast
      L: 17, Bm: 2.2, H: 0.85, n: 5, bowLift: 0.35, gunwale: false, rudder: false, rig: false, deckTone: SOLAR_BLUE,
      extra: function (trim, L2, Bm2, H2) {
        solarDeckPart(trim, Bm2, H2, -L2 * 0.32, L2 * 0.32, SOLAR_BLUE); glowTrimPart(trim, L2, Bm2, H2, 5, 0.35, NEON_HUES[2]);
        pontoonHullPart(trim, L2 * 0.55, Bm2 * 0.55, H2 * 0.8, Bm2 * 1.7, mixc(GLASS_STEEL, NEON_HUES[2], 0.2));
        pontoonHullPart(trim, L2 * 0.55, Bm2 * 0.55, H2 * 0.8, -Bm2 * 1.7, mixc(GLASS_STEEL, NEON_HUES[2], 0.2));
        trim.cyl(0, H2 * 0.9, -L2 * 0.44, 0.32, 0.6, 8, GLASS_STEEL, 0.85);
      }
    }
  };

  // ---------------- Phase 17c: THE NAVY — a 5-rung DEFENSE ladder (sim.js S.navy), off every 17b
  // fleet ladder (its own SHIPYARD.NAVY list below). Same assembleShip()/SPEC-table kit as every
  // other class, deliberately CHARMING not grim: crisp white hulls, a bold navy-blue "gun-deck
  // stripe" (gunDeckStripe below — a painted band, not an actual line of guns) and gold trim/
  // pennants throughout, so the fleet reads as ceremonial harbour patrol boats rather than warships
  // — no cannons, turrets or missiles anywhere in the kit, only stylised deck fixtures (a signal
  // lamp, a ram-bow spur, funnels, a bridge tower, two tiny hovering drone "satellites" baked into
  // the futuristic capstone's own trim mesh).
  var NAVY_BLUE = [0.18, 0.22, 0.34], NAVY_TRIM = [0.24, 0.28, 0.42], GOLD_TRIM = [0.76, 0.64, 0.38];   // 19a: denim + matte brass
  // a painted horizontal band around the hull at a given height fraction (y, 0=waterline..1=deck) —
  // reuses the SAME hullW/hullLift profile every hull ring samples, so the stripe always hugs the
  // real silhouette instead of floating off a straight-line approximation.
  function gunDeckStripe(trim, L, Bm, H, n, bowLift, y, tone) {
    n = n || 7;
    for (var i = 0; i < n; i++) {
      var t = (i + 0.5) / n, w = hullW(Bm, t) * 1.01, lift = hullLift(bowLift, t), z = -L / 2 + L * (i + 0.5) / n, len = L / n * 1.05;
      trim.box(0, H * y + lift, z, len, H * 0.16, w, tone, 0);
    }
  }
  function signalLamp(trim, x, y, z, r) { trim.cyl(x, y, z, r, r * 1.3, 7, [0.92, 0.90, 0.78], 0.85); trim.cyl(x, y + r * 1.3, z, r * 0.65, r * 0.32, 7, [0.18, 0.18, 0.20], 0.6); }
  // a tiny hovering "drone satellite" — a flat glass-steel pad + a short glowing antenna mast,
  // TETHERED to the deck by a thin strut (deckY = local hull deck height) so it reads as hovering
  // just off the mothership rather than floating disconnected in the distance — baked directly
  // into the mothership's own trim mesh (not a separate draw call/animation) so it reads as "part
  // of the fleet" the instant the class is drawn, exactly like the steamer's baked containers or
  // the trimaran's baked pontoons.
  function droneSat(trim, x, y, z, s, deckY, tone) {
    strutS(trim, x, deckY, z, x, y - s * 0.3, z, 0.07, [0.55, 0.57, 0.60]);
    trim.bbox(x, y, z, s * 1.4, s * 0.45, s * 1.4, tone || GLASS_STEEL, 0, s * 0.18);
    trim.box(x, y + s * 0.42, z, s * 0.14, s * 0.5, s * 0.14, NEON_HUES[1], 0);
  }
  var NAVY_SPECS = {
    patrol_cutter: {  // tier1 (era>=1): tiny sharp motor launch, no sails — a signal mast + gold
                       // pennant and a deck lamp are its only "fixtures"
      L: 9, Bm: 2.8, H: 1.15, n: 5, bowLift: 0.55, gunwale: true, gunwaleTone: NAVY_TRIM, rudder: true, rig: false,
      deckTone: WHITE_HULL, masts: [{ z: -1.6, top: 4.6 }], pennant: { c: NAVY_BLUE, accent: GOLD_TRIM },
      extra: function (trim, L2, Bm2, H2) { gunDeckStripe(trim, L2, Bm2, H2, 5, 0.55, 0.55, NAVY_BLUE); signalLamp(trim, 0, H2 * 1.30, L2 * 0.18, 0.30); }
    },
    frigate: {  // tier2 (era>=2): two-master, white hull + a bold navy gun-deck stripe, gold pennant
      L: 18, Bm: 5.4, H: 2.4, n: 7, bowLift: 1.0, gunwale: true, gunwaleTone: NAVY_TRIM, rudder: true,
      bowspritLen: 2.4, cabin: true, cabinTone: WHITE_HULL, deckTone: [0.86, 0.84, 0.78],
      masts: [{ z: 3.6, top: 13.0 }, { z: -2.8, top: 14.0 }],
      sails: [{ shape: 'square', mast: 0, base: 6.6, h: 6.8, y0: 3.2 }, { shape: 'square', mast: 1, base: 7.2, h: 7.6, y0: 3.4 }],
      pennant: { c: NAVY_BLUE, accent: GOLD_TRIM },
      extra: function (trim, L2, Bm2, H2) { gunDeckStripe(trim, L2, Bm2, H2, 7, 1.0, 0.58, NAVY_BLUE); }
    },
    ironclad: {  // tier3 (era>=4): low iron hull, ram-bow spur, single funnel — no sails
      L: 21, Bm: 5.8, H: 2.0, n: 7, bowLift: 0.35, gunwale: true, gunwaleTone: STEEL, rudder: true, rig: false,
      cabin: true, cabinTone: STEEL, deckTone: [0.24, 0.25, 0.27],
      extra: function (trim, L2, Bm2, H2) {
        funnelPart(trim, 0, -L2 * 0.05, H2, H2 * 1.7, 0.62, GOLD_TRIM);
        strutS(trim, 0, H2 * 0.30, L2 * 0.40, 0, H2 * 0.18, L2 * 0.56, Math.max(0.5, Bm2 * 0.16), STEEL);   // ram-bow spur, low at the waterline
        gunDeckStripe(trim, L2, Bm2, H2, 7, 0.35, 0.62, NAVY_BLUE);
      }
    },
    destroyer: {  // tier4 (era>=5): sleek grey hull, tall bridge tower, twin funnels — no sails
      L: 26, Bm: 5.6, H: 2.3, n: 7, bowLift: 0.55, gunwale: true, gunwaleTone: STEEL, rudder: true, rig: false,
      deckTone: [0.30, 0.31, 0.34],
      extra: function (trim, L2, Bm2, H2) {
        trim.bbox(0, H2 * 1.7, L2 * 0.10, Bm2 * 0.42, H2 * 1.5, L2 * 0.10, WHITE_HULL, 0, 0.2);      // bridge tower
        trim.box(0, H2 * 2.35, L2 * 0.10, Bm2 * 0.40, 0.4, 0.12, NAVY_TRIM, 0);                       // bridge window band
        funnelPart(trim, 0, -L2 * 0.06, H2, H2 * 1.5, 0.5, GOLD_TRIM); funnelPart(trim, 0, -L2 * 0.24, H2, H2 * 1.5, 0.5, GOLD_TRIM);
        gunDeckStripe(trim, L2, Bm2, H2, 7, 0.55, 0.56, NAVY_BLUE);
      }
    },
    drone_screen: {  // tier5 (era>=6): futuristic mothership + two tiny hovering drone satellites
                      // baked into its own trim mesh — the Navy's "harbour of tomorrow" capstone
      L: 20, Bm: 5.2, H: 1.6, n: 6, bowLift: 0.25, gunwale: false, rudder: false, rig: false, deckTone: SOLAR_BLUE,
      extra: function (trim, L2, Bm2, H2) {
        solarDeckPart(trim, Bm2, H2, -L2 * 0.30, L2 * 0.30, SOLAR_BLUE); glowTrimPart(trim, L2, Bm2, H2, 6, 0.25, GOLD_TRIM);
        trim.cyl(0, H2 * 1.3, -L2 * 0.40, 0.30, 0.6, 8, GLASS_STEEL, 0.85);
        droneSat(trim, Bm2 * 0.85, H2 * 1.9, L2 * 0.12, 1.1, H2, GLASS_STEEL); droneSat(trim, -Bm2 * 0.80, H2 * 1.75, -L2 * 0.10, 1.0, H2, GLASS_STEEL);
      }
    }
  };
  for (var __navyKey in NAVY_SPECS) SHIP_SPECS[__navyKey] = NAVY_SPECS[__navyKey];   // merge navy rungs into the shared SPEC table

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
  // Phase 17b: the three 8-rung ladders — index === fleetTier() from sim.js (HARBOR_SIM.fleetTier),
  // so game.js just indexes straight in. Display names for the Registry panel + tips sit alongside.
  var FLEET_LADDERS = {
    fishing: ['raft', 'coracle', 'dinghy', 'sloop', 'steam_trawler', 'modern_trawler', 'hydrofoil_skiff', 'solar_skimmer'],
    trade: ['log_barge', 'cog', 'brig', 'clipper', 'paddle_steamer', 'steamer', 'container_ship', 'hover_freighter'],
    expedition: ['outrigger', 'caravel', 'schooner', 'barque', 'steam_yacht', 'research_vessel', 'expedition_catamaran', 'solar_trimaran']
  };
  // Phase 17c: the Navy's own 5-rung ladder — index === navyTier()-1 from sim.js (HARBOR_SIM.navyTier;
  // tier0 = no navy = no class at all), kept separate from FLEET_LADDERS (it isn't a production
  // role — see NAVY_SPECS above).
  var NAVY_LADDER = ['patrol_cutter', 'frigate', 'ironclad', 'destroyer', 'drone_screen'];
  var SHIP_NAMES = {
    dinghy: 'Dinghy', sloop: 'Sloop', brig: 'Brig', schooner: 'Schooner', steamer: 'Steam Freighter', corsair: 'Corsair',
    raft: 'Raft', coracle: 'Coracle', steam_trawler: 'Steam Trawler', modern_trawler: 'Modern Trawler', hydrofoil_skiff: 'Hydrofoil Skiff', solar_skimmer: 'Solar Skimmer',
    log_barge: 'Log Barge', cog: 'Cog', clipper: 'Clipper', paddle_steamer: 'Paddle Steamer', container_ship: 'Container Ship', hover_freighter: 'Hover-Freighter',
    outrigger: 'Outrigger', caravel: 'Caravel', barque: 'Barque', steam_yacht: 'Steam Yacht', research_vessel: 'Research Vessel', expedition_catamaran: 'Expedition Catamaran', solar_trimaran: 'Solar Trimaran',
    patrol_cutter: 'Patrol Cutter', frigate: 'Frigate', ironclad: 'Ironclad', destroyer: 'Destroyer', drone_screen: 'Drone Screen'
  };
  var SHIPYARD = {
    CLASSES: ['dinghy', 'sloop', 'brig', 'schooner', 'steamer', 'corsair'].concat(
      FLEET_LADDERS.fishing, FLEET_LADDERS.trade, FLEET_LADDERS.expedition, NAVY_LADDER).filter(function (c, i, a) { return a.indexOf(c) === i; }),
    LADDERS: FLEET_LADDERS, NAVY: NAVY_LADDER, NAMES: SHIP_NAMES,
    build: function (cls) { return assembleShip(SHIP_SPECS[cls] || SHIP_SPECS.dinghy); }
  };

  // assemble the port at LOCAL origin for the given era; returns local placements
  // ---------------- Phase 18a LOOK 6.0: dressed ground near a FOUNDED port -------------------
  // Local port-frame geometry (water toward -z, land toward +z — same convention as the rest of
  // assemblePort). Only ever built when a port is actually founded (assemblePort is never called
  // for a wild/unfounded world) so this apron/dock/path/fence/clutter geometry is strictly a
  // founded-port feature, verified by terrainStats().port in the test suite.
  // groundY(lx,lz): local-space (lx,lz) -> the REAL terrain height at that world position, minus
  // the port's own founding height 'by' — i.e. how far the actual (possibly hilly) ground sits
  // above/below the flat y=0 plane every port structure assumes. The generic PLAIN flattening in
  // genField only smooths height near the plain's own centre, so terrain a few tens of units
  // inland from the (often low, coastal) founding point can genuinely sit metres above 'by' —
  // invisible on the old soft/blurred terrain, but a ground-hugging apron/path/fence would bury
  // itself under the new hard-edged facets without this correction. Structures that were already
  // flat-assumed pre-18a (huts/warehouses/quay) are left exactly as before — out of scope here.
  function stoneApron(grit, x0, x1, z0, z1, rng, biome, groundY) {   // bordered slab grid, grout lines via facet-colour banding
    var wallC = biome.build && biome.build.wall && biome.build.wall[2] ? biome.build.wall[2] : [0.72, 0.70, 0.66];
    var base = mixc(wallC, [0.74, 0.72, 0.68], 0.6), tile = 6.5, n = 0;
    for (var z = z0; z < z1; z += tile) for (var x = x0; x < x1; x += tile) {
      var w = Math.min(tile, x1 - x) - 0.4, d = Math.min(tile, z1 - z) - 0.4;
      if (w < 2 || d < 2) continue;
      var cx = x + w / 2, cz = z + d / 2, gy = groundY ? groundY(cx, cz) : 0;
      var shade = mul(base, 0.90 + h2((x / tile) | 0, (z / tile) | 0) * 0.18);   // per-slab grout-line jitter
      grit.box(cx, gy + 0.08, cz, w, 0.16, d, shade, 0); n++;
    }
    return n;
  }
  function plankDockStrip(flat, x0, x1, z, rng) {                      // raised plank rows where the quay meets the water
    var n = Math.max(2, Math.round((x1 - x0) / 1.6)), step = (x1 - x0) / n;
    for (var i = 0; i < n; i++) {
      var px = x0 + (i + 0.5) * step, tone = i % 2 ? [0.56, 0.40, 0.24] : [0.62, 0.46, 0.28];
      flat.box(px, 0.55, z, step * 0.92, 0.30, 3.6, tone, 0);
    }
    for (var p = 0; p <= 2; p++) flat.cyl(x0 + p * (x1 - x0) / 2, -1.8, z - 1.6, 0.32, 2.6, 6, [0.34, 0.25, 0.16], 1);
    return n;
  }
  function dirtPath(flat, ax, az, bx, bz, rng, groundY) {              // flattened, slightly desaturated ribbon that follows the real terrain
    var dirt = mixc([0.52, 0.42, 0.28], [0.5, 0.5, 0.5], 0.12), n = 6 + (rng() * 3 | 0);
    for (var i = 0; i < n; i++) {
      var t0 = i / n, t1 = (i + 1) / n, mx = ax + (bx - ax) * (t0 + t1) / 2, mz = az + (bz - az) * (t0 + t1) / 2;
      var yaw = Math.atan2(bx - ax, bz - az), len = Math.hypot((bx - ax) / n, (bz - az) / n) * 1.18;
      var gy = groundY ? groundY(mx, mz) : 0;
      flat.box(mx, gy + 0.06, mz, 3.2 + (h2(i, 7) - 0.5) * 0.8, 0.10, len, mul(dirt, 0.94 + h2(i, 3) * 0.14), yaw);
    }
    return n;
  }
  function fenceLine(flat, cx, cz, w, d, rng, biome, groundY) {        // low stone wall (rocky biomes) or pickets, around a field patch
    var stony = biome.hillType === 'cliff' || biome.hillType === 'mountain';
    var post = stony ? [0.52, 0.52, 0.54] : [0.42, 0.30, 0.18], rail = mul(post, 1.15);
    var hw = w / 2, hd = d / 2, corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd]], n = 0;
    for (var s = 0; s < 4; s++) {
      var ax = corners[s][0], az = corners[s][1], bx = corners[s + 1][0], bz = corners[s + 1][1];
      var segN = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 3.2));
      for (var i = 0; i <= segN; i++) {
        var t = i / segN, px = cx + ax + (bx - ax) * t, pz = cz + az + (bz - az) * t, gy = groundY ? groundY(px, pz) : 0;
        flat.cyl(px, gy, pz, 0.11, stony ? 0.7 : 0.9, 5, post, 0.85); n++;
      }
      var mx = cx + ax + (bx - ax) * 0.5, mz = cz + az + (bz - az) * 0.5, yaw = Math.atan2(bx - ax, bz - az);
      var railGy = groundY ? groundY(mx, mz) : 0;
      if (!stony) flat.box(mx, railGy + 0.55, mz, Math.hypot(bx - ax, bz - az), 0.10, 0.10, rail, yaw);   // pickets get a top rail; stone walls read solid from posts alone
    }
    return n;
  }
  var QUAY_PROP_KINDS = ['crate', 'barrel', 'rope', 'pot', 'basket'];
  function quayProp(flat, x, z, kind, rng) {                           // crates / barrels / rope coils / lobster pots / fish baskets
    if (kind === 'crate') flat.box(x, 0.35, z, 0.7, 0.7, 0.7, pick([[0.62, 0.46, 0.28], [0.70, 0.52, 0.30]], rng), rng() * 0.3);
    else if (kind === 'barrel') { flat.cyl(x, 0.02, z, 0.42, 0.75, 8, [0.44, 0.30, 0.18], 0.94); flat.cyl(x, 0.70, z, 0.44, 0.10, 8, [0.20, 0.18, 0.16], 0.98); }
    else if (kind === 'rope') flat.cyl(x, 0.10, z, 0.42, 0.20, 10, [0.72, 0.64, 0.42], 0.7);
    else if (kind === 'pot') { flat.cyl(x, 0.05, z, 0.34, 0.42, 6, [0.30, 0.22, 0.16], 0.6); flat.box(x, 0.42, z, 0.55, 0.10, 0.55, [0.34, 0.26, 0.18], rng() * TAU); }
    else flat.bbox(x, 0.22, z, 0.55, 0.42, 0.42, [0.66, 0.52, 0.34], rng() * TAU, 0.08);            // basket
  }
  function quayClutter(flat, x0, x1, z0, z1, rng, cap) {                // deterministic prop set, capped per port
    var n = Math.min(cap, 6 + (rng() * (cap - 5) | 0)), placed = 0, tries = 0;
    while (placed < n && tries < n * 4) { tries++; quayProp(flat, x0 + rng() * (x1 - x0), z0 + rng() * (z1 - z0), pick(QUAY_PROP_KINDS, rng), rng); placed++; }
    return placed;
  }
  // Phase 18b: slot-kind dispatcher — the old port scene filled every yard slot with an identical
  // warehouse; now each slot gets a distinct building TYPE so the port reads as a real settlement
  // (and every remodeled type from the kit above actually appears in the scene). All types are
  // internally smaller than the historical warehouse envelope (18x13 on a 22-unit slot pitch), so
  // the decorative footprint/slot grid is byte-for-byte unchanged — only what stands on it.
  function placeBuilding(grit, flat, kind, x, z, rng, b) {
    if (kind === 'cottage') return cottage(grit, flat, x, z, rng, b);
    if (kind === 'market') return market(grit, flat, x, z, rng, b);
    if (kind === 'sawmill') return sawmill(grit, flat, x, z, rng, b);
    if (kind === 'factory') return factory(grit, flat, x, z, rng, b);
    if (kind === 'cargoDock') return cargoDock(grit, flat, x, z, rng, b);
    if (kind === 'tradingPost') return tradingPost(grit, flat, x, z, rng, b);
    return warehouse(grit, flat, x, z, 18, 13, rng, b);
  }
  var SLOT_KINDS_ERA1 = ['warehouse', 'cottage', 'market', 'tradingPost', 'warehouse', 'cottage'];
  var SLOT_KINDS_ERA2 = ['warehouse', 'sawmill', 'market', 'factory', 'cargoDock', 'tradingPost'];
  function assemblePort(L, biome, rng, era, port, by, yaw) {
    var sc = { city: [], blobs: [], lamps: [], crane: era >= 2 };
    // Phase 18b: buildings get their OWN local-space builder pair, kept separate from the static
    // world bake — game.js draws them with a per-frame composeRYS transform at the port frame, so
    // the squash-and-stretch pop (build/upgrade/collect juice) can scale the whole settlement via
    // the draw transform without rebaking any geometry. Quay/crane/ships/dressing stay in L (baked).
    var Lb = { grit: new g.HGL.Builder(), flat: new g.HGL.Builder() };
    sc.bldg = Lb;
    // Phase 18a: local(x,z) -> real terrain height minus 'by', for ground-hugging dressing that
    // must follow the actual (possibly hilly) surface instead of the flat y=0 every other port
    // part assumes — see the long comment above stoneApron().
    var pc = Math.cos(yaw), ps = Math.sin(yaw);
    function groundY(lx, lz) { return heightAt(lx * pc + lz * ps + port.x, -lx * ps + lz * pc + port.z) - by; }
    // the fenced field patch is small (posts every ~3 units) and reads badly on a real slope — a
    // level-looking enclosure needs a comparatively flat spot, so pick the flattest of a couple of
    // candidate centres (min/max groundY sample across the patch footprint) rather than a single
    // fixed offset that might land on a steep hillside in a hillier biome/seed.
    function flattest(cands, hw, hd) {
      var best = cands[0], bestRange = Infinity;
      cands.forEach(function (c) {
        var vs = [groundY(c[0] - hw, c[1] - hd), groundY(c[0] + hw, c[1] - hd), groundY(c[0] - hw, c[1] + hd), groundY(c[0] + hw, c[1] + hd), groundY(c[0], c[1])];
        var range = Math.max.apply(null, vs) - Math.min.apply(null, vs);
        if (range < bestRange) { bestRange = range; best = c; }
      });
      return best;
    }
    if (era === 0) {
      // primitive wild village: a few shacks, one jetty, a fishing boat — no quay yet, so no
      // lampposts/lit-window pools (Phase 14b night light pools start once a real quay exists)
      woodenJetty(L.flat, 0);
      var huts = 3 + (rng() * 2 | 0), placedHuts = [];
      // Phase 18b: the village alternates fishing huts with snugger cottages (both live in the
      // separate Lb building builders — see the comment at the top of assemblePort). The deep-eave
      // roofs span wider than the old lean-to shacks, so placements now keep a minimum spacing —
      // overlapping roof planes read as a glitch where overlapping box shacks once hid it.
      for (var hI = 0; hI < huts; hI++) {
        var hx = 0, hz = 0, hTry = 0, hOk = false;
        while (hTry++ < 12 && !hOk) {
          hx = -18 + rng() * 36; hz = 24 + rng() * 16; hOk = true;
          for (var hp = 0; hp < placedHuts.length; hp++) if (Math.hypot(hx - placedHuts[hp][0], hz - placedHuts[hp][1]) < 10) { hOk = false; break; }
        }
        if (!hOk) continue;
        placedHuts.push([hx, hz]);
        if (hI % 2) cottage(Lb.grit, Lb.flat, hx, hz, rng, biome); else hut(Lb.flat, hx, hz, rng, biome);
        sc.blobs.push({ x: hx, z: hz, r: 5 });
      }
      dinghy(L.flat, -4 + rng() * 8, -3, rng); sc.blobs.push({ x: 0, z: 8, r: 7 });
      // Phase 18a: even the primitive village gets a worn dirt track from the jetty to the huts, a
      // small fenced garden patch, and a handful of dropped crates/rope by the water — no stone
      // apron or plank dock yet (there's no real quay to dress until era1's concreteQuay exists).
      var dPath0 = dirtPath(L.flat, 0, 9, 0, 28, rng, groundY);
      var fc0 = flattest([[28, 30], [-28, 30]], 8, 7);
      var dFence0 = fenceLine(L.flat, fc0[0], fc0[1], 16, 14, rng, biome, groundY);
      var dProps0 = quayClutter(L.flat, -12, 12, 3, 15, rng, 8);
      sc.portDressing = { apron: 0, dock: 0, path: dPath0, fence: dFence0, props: dProps0 };
    } else {
      concreteQuay(L.grit, L.flat, era); lighthouse(Lb.grit, Lb.flat, -70, 8); sc.blobs.push({ x: -70, z: 8, r: 6 });
      var whN = Math.min(6, 1 + era), whSpan = 56 + whN * 3;
      // Phase 14b: each building's lit facade becomes a second night-pool anchor — a soft glow
      // spilling from the doorway onto the quay apron, alongside the floodlight poles from props()
      // below. Phase 18b: the yard row is no longer six identical warehouses — each slot draws a
      // distinct remodeled type from the slot-kind table (same slot positions/pitch, see
      // placeBuilding above), and a stone-block seawall copes the quay's landward lip.
      var slotKinds = era >= 2 ? SLOT_KINDS_ERA2 : SLOT_KINDS_ERA1;
      for (var w = 0; w < whN; w++) { var wx = -52 + w * 22; placeBuilding(Lb.grit, Lb.flat, slotKinds[w % slotKinds.length], wx, 26, rng, biome); sc.blobs.push({ x: wx, z: 26, r: 12 }); sc.lamps.push({ x: wx, z: 32.5, q: 0 }); }
      // stone-block coping seawall on the quay's outer wings (x beyond the plank-dock strip at
      // |x|<=46, z just seaward of the quay slab edge — clear of curb/bollards/planks). Each short
      // span is GROUND-ANCHORED via the 18a groundY sampler — the terrain along the wings rises
      // 2-4 units above the port base on real seeds, which would bury a flat-assumed wall outright.
      [[-whSpan, -48], [48, whSpan]].forEach(function (wing) {
        for (var sx0 = wing[0]; sx0 < wing[1] - 2; sx0 += 9) {
          var sx1 = Math.min(sx0 + 9, wing[1]), scx = (sx0 + sx1) / 2;
          var sg = new g.HGL.Builder(), sf = new g.HGL.Builder();
          seawallSegment(sg, sf, -(sx1 - sx0) / 2, (sx1 - sx0) / 2, 0, rng, biome);
          var swy = Math.max(0, groundY(scx, 2.0));
          Lb.grit.addXform(sg, scx, swy, 2.0, 0); Lb.flat.addXform(sf, scx, swy, 2.0, 0);
        }
      });
      var cityN = Math.min(16, 3 + era * 3);
      for (var cI = 0; cI < cityN; cI++) { var bx = -110 + rng() * 220; if (Math.abs(bx) > 150) continue; var bz = 50 + rng() * 60; sc.city.push({ x: bx, z: bz, s: 6.5 + rng() * 3.5, rot: (rng() * 4 | 0) * (Math.PI / 2), bi: (rng() * 8) | 0, tint: [1, 1, 1] }); sc.blobs.push({ x: bx, z: bz, r: 9 }); }
      if (era === 1) freighter(L.grit, L.flat, 0, -6, rng); else containerShip(L.grit, L.flat, 0, -6, rng, 1 + Math.min(0.5, (era - 2) * 0.18));
      sc.blobs.push({ x: 0, z: -6, r: 22 });
      if (era >= 2) { craneStatic(L.grit, 0, -6); sc.blobs.push({ x: 0, z: -6, r: 14 }); }
      props(L.grit, L.flat, rng, era, sc);
      // Phase 18a: dressed ground — a bordered stone-slab apron under the warehouse/yard cluster
      // (grout-line facet jitter, sits just behind the concrete quay so it never intersects it),
      // raised plank-dock rows bridging the quay's seaward lip to open water, a dirt path threading
      // from the quay back toward the city blocks, a low fenced field patch off to one side, and a
      // capped, deterministic scatter of quay clutter (crates/barrels/rope/pots/baskets).
      var dApron = stoneApron(L.grit, -whSpan, whSpan, 18, 46, rng, biome, groundY);   // whSpan hoisted above (18b) — same formula
      var dDock = plankDockStrip(L.flat, -46, 46, 1.4, rng);
      var dPath = dirtPath(L.flat, 0, 46, 0, 88, rng, groundY);
      var fc1 = flattest([[-whSpan - 22, 34], [whSpan + 22, 34]], 10, 8);
      var dFence = fenceLine(L.flat, fc1[0], fc1[1], 20, 16, rng, biome, groundY);
      var dProps = quayClutter(L.flat, -whSpan, whSpan, 6, 16, rng, 14);
      sc.portDressing = { apron: dApron, dock: dDock, path: dPath, fence: dFence, props: dProps };
      // Phase 17a: Automated Harbour (era6) / Neon Horizon (era7) get their OWN skyline — a small
      // cluster of tech-age towers east of the warehouse row (solarSpire's steel/glass silhouette at
      // era6, swapping to neonTower's glowing accent rings at era7) plus a drone landing pad by the
      // quay — distinct from the generic glTF city-block fill above, so the outline pass (14a) picks
      // out a genuinely different age instead of "more of the same skyline".
      if (era >= 6) {
        // Phase 18b: tech-age structures now GROUND-ANCHOR onto the real terrain (18a groundY) —
        // built at a temp origin then addXform'd up to the surface. The drone pad especially was
        // silently buried on seeds where the terrain at (-92,38) rises a few metres above the port
        // base (it's barely 1 unit tall); the towers get the same anchoring so their bases never
        // float/sink on a slope.
        var spireN = era >= 7 ? 3 : 2;
        for (var sp = 0; sp < spireN; sp++) {
          var spx = 70 + sp * 26, spz = 30 + rng() * 10;
          var tg = new g.HGL.Builder(), tf = new g.HGL.Builder();
          if (era >= 7) neonTower(tg, tf, 0, 0, rng); else solarSpire(tg, tf, 0, 0, rng);
          var spy = Math.max(0, groundY(spx, spz));
          Lb.grit.addXform(tg, spx, spy, spz, 0); Lb.flat.addXform(tf, spx, spy, spz, 0);
          sc.blobs.push({ x: spx, z: spz, r: 8 });
        }
        // the drone pad moves ONTO the quay deck beside the crane (17a's own comment says it rings
        // "the crane/quay" — but its old (-92,38) spot is a hillside on the green seed, and the
        // sub-1-unit-tall pad has been silently buried there since 17a shipped). (16,10) is open
        // deck between the crane legs and the container yard; 2.2 = concreteQuay slab top.
        var pg = new g.HGL.Builder(), pf2 = new g.HGL.Builder();
        droneBayPad(pg, pf2, 0, 0, rng);
        Lb.grit.addXform(pg, 16, 2.2, 10, 0); Lb.flat.addXform(pf2, 16, 2.2, 10, 0);
        sc.blobs.push({ x: 16, z: 10, r: 8 });
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
    DRESS_STATS = biomeDressing(B.flat, biome, rng, port);   // Phase 18a: coastal rocks/shelves/speckle + biome features
    for (var bk = 0, bt = 0; bk < 8 && bt < 80; bt++) {    // little boats dotted in the water around the island
      var bx = -760 + rng() * 1520, bz = -210 + rng() * 760, byy = heightAt(bx, bz);
      if (byy > -3.2 && byy < -0.7) { dinghy(B.flat, bx, bz, rng); bk++; }
    }
    var scene = { city: [], blobs: [], lamps: [], crane: false, era: era, founded: !!port, port: null, dressing: DRESS_STATS };
    PORT_DRESS = null;
    if (!port) return scene;                               // wild, unfounded — no structures

    var by = heightAt(port.x, port.z); if (by < 0.3) by = 0.3;
    var yaw = (port.yaw == null) ? portYaw(port.x, port.z) : port.yaw;
    scene.port = { x: port.x, z: port.z, by: by, yaw: yaw };
    var L = { fac: new g.HGL.Builder(), grit: new g.HGL.Builder(), flat: new g.HGL.Builder() };
    var lsc = assemblePort(L, biome, rng, era, port, by, yaw);
    B.fac.addXform(L.fac, port.x, by, port.z, yaw); B.grit.addXform(L.grit, port.x, by, port.z, yaw); B.flat.addXform(L.flat, port.x, by, port.z, yaw);
    var c = Math.cos(yaw), s = Math.sin(yaw);
    function W(p) { return { x: p.x * c + p.z * s + port.x, z: -p.x * s + p.z * c + port.z }; }
    lsc.city.forEach(function (p) { var w = W(p); scene.city.push({ x: w.x, z: w.z, s: p.s, rot: p.rot + yaw, bi: p.bi, tint: p.tint }); });
    lsc.blobs.forEach(function (b) { var w = W(b); scene.blobs.push({ x: w.x, z: w.z, r: b.r }); });
    lsc.lamps.forEach(function (l) { var w = W(l); scene.lamps.push({ x: w.x, z: w.z, q: l.q }); });   // Phase 14b: night light pool anchors (q=1: on the quay deck)
    scene.crane = lsc.crane;
    PORT_DRESS = lsc.portDressing || null; scene.portDressing = PORT_DRESS;   // Phase 18a: apron/dock/path/fence/prop counts — founded ports only
    // Phase 18b: the port's BUILDINGS stay in LOCAL port space (never addXform'd into the static
    // world bake) — game.js uploads these as their own meshes and draws them each frame with a
    // composeRYS transform at the port frame, which is what lets the squash-and-stretch pop scale
    // the settlement via the draw transform (see drawPortBuildings in game.js).
    scene.bldg = lsc.bldg ? { grit: lsc.bldg.grit.data(), flat: lsc.bldg.flat.data() } : null;
    return scene;
  }

  // ---------------- Phase 18b: per-type building telemetry (test/debug hook) -------------------
  // buildingStats(kind, biomeId): builds ONE fresh instance of a building type at the origin with
  // a deterministic per-kind rng and returns its vertex/index counts — the per-type vert budget
  // guard in the test suite reads this (mirrors terrainStats()/shipStats()'s role for their passes).
  var BLDG_KINDS = ['hut', 'cottage', 'warehouse', 'market', 'sawmill', 'factory', 'cargoDock', 'tradingPost', 'seawall', 'lighthouse', 'solarSpire', 'neonTower', 'droneBayPad'];
  function rngFor(seed) { var s = (seed >>> 0) || 1; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  function buildingStats(kind, biomeId) {
    var biomeObj = (g.HARBOR_BIOMES && g.HARBOR_BIOMES[biomeId || 'green']) || null;
    var rng = rngFor(hashStr(kind + ':' + (biomeId || 'green')));
    var grit = new g.HGL.Builder(), flat = new g.HGL.Builder();
    switch (kind) {
      case 'hut': hut(flat, 0, 0, rng, biomeObj); break;
      case 'cottage': cottage(grit, flat, 0, 0, rng, biomeObj); break;
      case 'warehouse': warehouse(grit, flat, 0, 0, 18, 13, rng, biomeObj); break;
      case 'market': market(grit, flat, 0, 0, rng, biomeObj); break;
      case 'sawmill': sawmill(grit, flat, 0, 0, rng, biomeObj); break;
      case 'factory': factory(grit, flat, 0, 0, rng, biomeObj); break;
      case 'cargoDock': cargoDock(grit, flat, 0, 0, rng, biomeObj); break;
      case 'tradingPost': tradingPost(grit, flat, 0, 0, rng, biomeObj); break;
      case 'seawall': seawallSegment(grit, flat, -10, 10, 0, rng, biomeObj); break;
      case 'lighthouse': lighthouse(grit, flat, 0, 0); break;
      case 'solarSpire': solarSpire(grit, flat, 0, 0, rng); break;
      case 'neonTower': neonTower(grit, flat, 0, 0, rng); break;
      case 'droneBayPad': droneBayPad(grit, flat, 0, 0, rng); break;
      default: return null;
    }
    return { grit: grit.P.length / 3, flat: flat.P.length / 3, verts: (grit.P.length + flat.P.length) / 3, indices: grit.I.length + flat.I.length };
  }

  // Phase 18a: LOOK 6.0 terrain/dressing telemetry — read by game.js's __harbor.terrainStats()
  // test hook (vertex-budget + per-biome feature-count + founded-port-only assertions).
  function terrainStats() { return { terrain: { quads: TERRAIN_STATS.quads, verts: TERRAIN_STATS.verts }, dressing: DRESS_STATS, port: PORT_DRESS }; }
  g.HARBOR_MODELS = { buildStatic: buildStatic, heightAt: heightAt, rate: rate, sites: sites, portYaw: portYaw, CONT: CONT, WORLD: WORLD, SHIPYARD: SHIPYARD, terrainStats: terrainStats, buildingStats: buildingStats, BLDG_KINDS: BLDG_KINDS };
})(window);
