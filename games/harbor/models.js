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

  // a rounded ISLAND surrounded by water: high interior dropping below sea level all around,
  // with a noise-warped (irregular) coastline + a few small offshore islets.
  var ISLAND = { cx: 0, cz: 150, ax: 540, az: 255 };
  function genField(biome, seed) {
    var nx = Math.round(WORLD.W / WORLD.cell) + 1, nz = Math.round((WORLD.z1 - WORLD.z0) / WORLD.cell) + 1;
    var H = new Float32Array(nx * nz), hilly = biome.hilliness || 1;
    var islets = [[-900, 170, 150], [880, 205, 120], [-280, -95, 85]];        // x, z, radius
    for (var j = 0; j < nz; j++) {
      var z = WORLD.z0 + j * WORLD.cell;
      for (var i = 0; i < nx; i++) {
        var x = -WORLD.W / 2 + i * WORLD.cell;
        var rad = Math.hypot((x - ISLAND.cx) / ISLAND.ax, (z - ISLAND.cz) / ISLAND.az);
        var warp = (fbm(x * 0.006 + seed, z * 0.006 + seed) - 0.5) * 0.5;       // irregular coast (bays/headlands)
        var e = (1 + warp) - rad;                                              // >0 land, <0 sea
        for (var k = 0; k < islets.length; k++) { var ir = Math.hypot((x - islets[k][0]) / islets[k][2], (z - islets[k][1]) / islets[k][2]); var ie = (1 - ir) * 0.7; if (ie > e) e = ie; }
        var h = e > 0 ? Math.min(e * 26, 14) : Math.max(e * 30, -4);           // gentle interior / sea floor
        h += (fbm(x * 0.020 + seed * 2, z * 0.020 + 3.3) - 0.5) * 13 * hilly * clamp(e * 3, 0, 1); // interior hills
        if (h < -4) h = -4;
        H[j * nx + i] = h;
      }
    }
    FIELD = { H: H, nx: nx, nz: nz };
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
    var nx = FIELD.nx, nz = FIELD.nz, H = FIELD.H, base = flat.P.length / 3;
    var sand = biome.beach || [0.88, 0.80, 0.55], rock = biome.hill, grass = biome.ground, deep = [0.46, 0.42, 0.34];
    for (var j = 0; j < nz; j++) {
      var z = WORLD.z0 + j * WORLD.cell;
      for (var i = 0; i < nx; i++) {
        var x = -WORLD.W / 2 + i * WORLD.cell, y = H[j * nx + i];
        var hl = H[j * nx + Math.max(0, i - 1)], hr = H[j * nx + Math.min(nx - 1, i + 1)];
        var hd = H[Math.max(0, j - 1) * nx + i], hu = H[Math.min(nz - 1, j + 1) * nx + i];
        var nX = hl - hr, nZ = hd - hu, nY = 2 * WORLD.cell, nl = Math.hypot(nX, nY, nZ) || 1;
        var slope = 1 - nY / nl;
        var col;
        if (y < -0.2) col = mixc(deep, sand, clamp((y + 3) / 2.8, 0, 1));
        else if (y < 0.7) col = sand;
        else col = mixc(grass, rock, clamp((y - 2) / 7, 0, 1));
        if (slope > 0.45 && y > 0.7) col = mixc(col, rock, clamp((slope - 0.45) * 2, 0, 1));
        if (biome.snow && y > 7) col = mixc(col, [0.95, 0.96, 1.0], clamp((y - 7) / 3, 0, 1));
        flat.P.push(x, y, z); flat.N.push(nX / nl, nY / nl, nZ / nl); flat.U.push(i * 0.25, j * 0.25); flat.C.push(col[0], col[1], col[2]);
      }
    }
    for (j = 0; j < nz - 1; j++) for (i = 0; i < nx - 1; i++) { var a = base + j * nx + i, b = a + 1, c = a + nx, d = c + 1; flat.I.push(a, c, b, b, c, d); }
  }

  // ---------------- vegetation (grounded on the field) ----------------
  function tree(flat, x, z, rng, kind, by) {
    var hy = by + 0.4;
    if (kind === 'palm') { var th = 5 + rng() * 3; flat.cyl(x, hy, z, 0.35, th, 6, [0.45, 0.34, 0.22], 0.7); for (var f = 0; f < 6; f++) flat.box(x, hy + th, z, 4.2, 0.3, 1.0, [0.22, 0.62, 0.26], f / 6 * TAU, 0.32); }
    else if (kind === 'pine') { flat.cyl(x, hy, z, 0.5, 2, 6, [0.40, 0.30, 0.20], 1); for (var c = 0; c < 3; c++) flat.cyl(x, hy + 1.5 + c * 2.2, z, 3 - c * 0.8, 2.6, 6, [0.16, 0.44, 0.26], 0.04); }
    else { flat.cyl(x, hy, z, 0.6, 2.4, 6, [0.42, 0.31, 0.2], 1); flat.cyl(x, hy + 2.2, z, 3.0, 4.2, 7, [0.26, 0.60, 0.30], 0.25); }
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
    var target = Math.round(WORLD.W / 170), placed = 0, tries = 0;   // scatter peaks on the island's interior highs
    while (placed < target && tries < target * 10) {
      tries++;
      var cx = (rng() - 0.5) * (ISLAND.ax * 2.0), cz = ISLAND.cz + (rng() - 0.5) * (ISLAND.az * 1.7);
      var y = heightAt(cx, cz);
      if (y < 5) continue;                                           // only on dry inland highs
      var s = 0.8 + rng() * 1.1, tmp = new g.HGL.Builder(); landform(tmp, b, s, rng);
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
    var rot = (rng() - 0.5) * 0.8, wood = pick([[0.62, 0.44, 0.28], [0.7, 0.5, 0.32], [0.8, 0.78, 0.74]], rng);
    flat.box(x, 0.1, z, 6, 1.4, 2.2, wood, rot); flat.box(x - 2.6, 0.1, z, 1.6, 1.4, 1.6, wood, rot + 0.2); flat.box(x + 2.6, 0.1, z, 1.6, 1.4, 1.6, wood, rot - 0.2);
    flat.box(x, 1.0, z, 1.6, 0.3, 1.8, mul(wood, 0.8), rot); flat.box(x + 0.5, 2.2, z, 0.18, 3.0, 0.18, [0.4, 0.3, 0.2], rot);
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

  // curated harbour candidates: scan the island coast for many natural DEEP-WATER harbours,
  // keep the best, well-spaced spots, and give each a distinct name.
  var DP_NAMES = ['Deep-water Inlet', 'Deepwater Reach', 'Deep Anchorage', "Mariner's Inlet", "Trader's Deep", 'Fathom Bay', 'Keelhaven', 'Lowtide Reach'];
  var SH_NAMES = ['Sheltered Cove', 'Calm Bay', 'Hidden Harbour', 'Quiet Cove', 'Stillwater Bay'];
  var GN_NAMES = ['Harbour Bay', "Fisher's Bay", 'Anchorage', 'Tidewater', 'Saltmarsh Landing'];
  function sites() {
    if (!FIELD) return [];
    var cand = [], x, z;
    for (x = -ISLAND.ax * 1.45; x <= ISLAND.ax * 1.45; x += 30)
      for (z = ISLAND.cz - ISLAND.az * 1.6; z <= ISLAND.cz + ISLAND.az * 1.6; z += 30) {
        var r = rate(x, z);
        if (r.onCoast && r.depth > 1.5) {                              // natural deep-water harbours only
          var dscore = r.shelter * 0.4 + clamp(r.depth / 2.2, 0, 1) * 0.6;  // weight toward depth
          cand.push({ x: x, z: z, score: dscore, shelter: r.shelter, depth: r.depth, stars: r.stars });
        }
      }
    cand.sort(function (a, b) { return b.score - a.score; });
    var picked = [], i, j, want = 8;
    for (var pass = 0; pass < 2 && picked.length < want; pass++) {     // relax spacing on a 2nd pass if needed
      var dmin = pass ? 120 : 175;
      for (i = 0; i < cand.length && picked.length < want; i++) {
        var c = cand[i], ok = picked.indexOf(c) < 0;
        for (j = 0; ok && j < picked.length; j++) if (Math.hypot(c.x - picked[j].x, c.z - picked[j].z) < dmin) ok = false;
        if (ok) picked.push(c);
      }
    }
    var used = {}, dR = { i: 0 }, sR = { i: 0 }, gR = { i: 0 };
    function uniq(pool, ref) { var n; do { n = pool[ref.i % pool.length]; ref.i++; } while (used[n] && ref.i < pool.length * 2); used[n] = 1; return n; }
    return picked.map(function (c) {
      var name = c.depth > 2.0 ? uniq(DP_NAMES, dR) : c.shelter > 0.6 ? uniq(SH_NAMES, sR) : uniq(GN_NAMES, gR);
      return { x: Math.round(c.x), z: Math.round(c.z), yaw: portYaw(c.x, c.z), stars: c.stars, name: name, score: +c.score.toFixed(2) };
    });
  }

  // ---------------- top-level build ----------------
  function buildStatic(B, biome, rng, era, port) {
    era = era | 0;
    var seed = (hashStr(biome.id) % 997) * 0.013;
    genField(biome, seed);
    buildFieldMesh(B.flat, biome);
    landforms(B.flat, biome, rng);
    if (biome.veg !== 'none') {
      var nv = Math.round((biome.vegN + 14) * WORLD.W / 760), hw = WORLD.W * 0.48;
      for (var v = 0; v < nv; v++) {
        var x = -hw + rng() * hw * 2, z = -110 + rng() * 530, y = heightAt(x, z);
        if (y < 1.0 || y > 16) continue;                 // only on dry, non-peak land
        if (port && Math.abs(x - port.x) < 50 && Math.abs(z - port.z) < 50) continue;
        tree(B.flat, x, z, rng, biome.veg, y);
      }
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
