/* HARBOR — minimal glTF 2.0 (.glb) loader → engine mesh data. window.HGLTF
 * Scoped to static low-poly assets: POSITION / NORMAL / TEXCOORD_0 + indices, node TRS baked
 * to world space, per-material baseColorFactor (→ vertex colour) and embedded baseColorTexture
 * (PNG in a bufferView). Returns primitives in the same shape HGL.mesh()/Builder.data() consume,
 * so loaded meshes drop straight into the existing renderer. No skinning/animation. Self-contained
 * (no deps) so it works in the browser and under Node for tests.
 */
(function (global) {
  'use strict';
  var CSIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  var CGET = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' };
  var NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

  function fromTRS(t, r, s) {
    var x = r[0], y = r[1], z = r[2], w = r[3];
    var x2 = x + x, y2 = y + y, z2 = z + z;
    var xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    var sx = s[0], sy = s[1], sz = s[2];
    return [(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
      (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
      (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
      t[0], t[1], t[2], 1];
  }
  function mul(a, b) { // col-major a*b
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
    return o;
  }
  var IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  function readAccessor(json, bin, ai) {
    var a = json.accessors[ai], bv = json.bufferViews[a.bufferView], dv = new DataView(bin);
    var nc = NCOMP[a.type], cs = CSIZE[a.componentType], getter = CGET[a.componentType];
    var base = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || (nc * cs);
    var out = new Array(a.count * nc);
    for (var i = 0; i < a.count; i++) { var p = base + i * stride; for (var c = 0; c < nc; c++) out[i * nc + c] = dv[getter](p + c * cs, true); }
    return { data: out, count: a.count, nc: nc };
  }

  function build(json, bin) {
    var prims = [], images = (json.images || []).map(function (img) {
      if (img.bufferView != null) { var bv = json.bufferViews[img.bufferView]; return new Uint8Array(bin, bv.byteOffset || 0, bv.byteLength); }
      return null;
    });
    function texImage(ti) { var t = json.textures && json.textures[ti]; return t ? t.source : null; }

    var scene = json.scenes[json.scene || 0];
    (scene.nodes || []).forEach(function (n) { traverse(n, IDENT); });

    function traverse(ni, parent) {
      var node = json.nodes[ni];
      var local = node.matrix ? node.matrix : fromTRS(node.translation || [0, 0, 0], node.rotation || [0, 0, 0, 1], node.scale || [1, 1, 1]);
      var world = mul(parent, local);
      if (node.mesh != null) addMesh(node.mesh, world);
      (node.children || []).forEach(function (c) { traverse(c, world); });
    }
    function addMesh(mi, world) {
      json.meshes[mi].primitives.forEach(function (p) {
        if (p.attributes.POSITION == null) return;
        var pos = readAccessor(json, bin, p.attributes.POSITION);
        var nrm = p.attributes.NORMAL != null ? readAccessor(json, bin, p.attributes.NORMAL) : null;
        var uv = p.attributes.TEXCOORD_0 != null ? readAccessor(json, bin, p.attributes.TEXCOORD_0) : null;
        var idx = p.indices != null ? readAccessor(json, bin, p.indices) : null;
        var P = new Float32Array(pos.count * 3), N = new Float32Array(pos.count * 3), U = new Float32Array(pos.count * 2);
        for (var i = 0; i < pos.count; i++) {
          var x = pos.data[i * 3], y = pos.data[i * 3 + 1], z = pos.data[i * 3 + 2];
          P[i * 3] = world[0] * x + world[4] * y + world[8] * z + world[12];
          P[i * 3 + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
          P[i * 3 + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
          if (nrm) {
            var nx = nrm.data[i * 3], ny = nrm.data[i * 3 + 1], nz = nrm.data[i * 3 + 2];
            var tx = world[0] * nx + world[4] * ny + world[8] * nz, ty = world[1] * nx + world[5] * ny + world[9] * nz, tz = world[2] * nx + world[6] * ny + world[10] * nz;
            var l = Math.hypot(tx, ty, tz) || 1; N[i * 3] = tx / l; N[i * 3 + 1] = ty / l; N[i * 3 + 2] = tz / l;
          } else N[i * 3 + 1] = 1;
          if (uv) { U[i * 2] = uv.data[i * 2]; U[i * 2 + 1] = uv.data[i * 2 + 1]; }
        }
        var mat = (json.materials && p.material != null) ? json.materials[p.material] : null;
        var pbr = (mat && mat.pbrMetallicRoughness) || {};
        var bc = pbr.baseColorFactor || [1, 1, 1, 1];
        var img = pbr.baseColorTexture ? texImage(pbr.baseColorTexture.index) : null;
        var indices;
        if (idx) { indices = new Uint32Array(idx.count); for (var j = 0; j < idx.count; j++) indices[j] = idx.data[j]; }
        else { indices = new Uint32Array(pos.count); for (j = 0; j < pos.count; j++) indices[j] = j; }
        var C = new Float32Array(pos.count * 3);
        for (i = 0; i < pos.count; i++) { C[i * 3] = bc[0]; C[i * 3 + 1] = bc[1]; C[i * 3 + 2] = bc[2]; }
        prims.push({ positions: P, normals: N, uvs: U, colors: C, indices: indices, baseColor: [bc[0], bc[1], bc[2]], image: img });
      });
    }

    var min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    prims.forEach(function (pr) { for (var i = 0; i < pr.positions.length; i += 3) for (var c = 0; c < 3; c++) { var v = pr.positions[i + c]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v; } });
    return { primitives: prims, images: images, min: min, max: max };
  }

  function parseGLB(buf) {
    var dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('glTF: bad magic');
    var len = dv.getUint32(8, true), off = 12, json = null, bin = null;
    var dec = (typeof TextDecoder !== 'undefined') ? new TextDecoder() : { decode: function (u) { return Buffer.from(u).toString('utf8'); } };
    while (off < len) {
      var clen = dv.getUint32(off, true), ctype = dv.getUint32(off + 4, true); off += 8;
      if (ctype === 0x4E4F534A) json = JSON.parse(dec.decode(new Uint8Array(buf, off, clen)));
      else if (ctype === 0x004E4942) bin = buf.slice(off, off + clen);
      off += clen;
    }
    if (!json) throw new Error('glTF: no JSON chunk');
    return build(json, bin);
  }

  // browser helper: fetch a .glb url → parsed model
  function load(url) { return fetch(url).then(function (r) { return r.arrayBuffer(); }).then(parseGLB); }

  global.HGLTF = { parseGLB: parseGLB, load: load };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.HGLTF;
})(typeof window !== 'undefined' ? window : globalThis);
