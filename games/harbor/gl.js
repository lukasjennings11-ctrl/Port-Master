/* HARBOR — hand-rolled WebGL2 micro-engine (zero dependency).
 * window.HGL = { mat4, geom, Builder, createEngine(gl) }
 *
 * Detailed merged meshes (vertex colours), a geometry Builder (boxes/cylinders with
 * rotation), directional sun + PCF shadow map, hemisphere ambient, fog, ACES tonemap with
 * exposure + saturation, night-lit windows (texture alpha = window mask), and an animated
 * fresnel water plane. Static scene geometry is merged into a few meshes for speed.
 */
(function (global) {
  'use strict';

  // ---------------- mat4 (column-major) ----------------
  var mat4 = {
    create: function () { var o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; },
    mul: function (o, a, b) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      for (var i = 0; i < 4; i++) { var b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
        o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30; o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32; o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33; }
      return o;
    },
    perspective: function (o, fovy, aspect, near, far) { var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far); o.fill(0); o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf; return o; },
    ortho: function (o, l, r, b, t, n, f) { var lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f); o.fill(0); o[0] = -2 * lr; o[5] = -2 * bt; o[10] = 2 * nf; o[12] = (l + r) * lr; o[13] = (t + b) * bt; o[14] = (f + n) * nf; o[15] = 1; return o; },
    lookAt: function (o, e, c, up) {
      var z0 = e[0] - c[0], z1 = e[1] - c[1], z2 = e[2] - c[2]; var zl = Math.hypot(z0, z1, z2) || 1; z0 /= zl; z1 /= zl; z2 /= zl;
      var x0 = up[1] * z2 - up[2] * z1, x1 = up[2] * z0 - up[0] * z2, x2 = up[0] * z1 - up[1] * z0; var xl = Math.hypot(x0, x1, x2) || 1; x0 /= xl; x1 /= xl; x2 /= xl;
      var y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
      o[0] = x0; o[1] = y0; o[2] = z0; o[3] = 0; o[4] = x1; o[5] = y1; o[6] = z1; o[7] = 0; o[8] = x2; o[9] = y2; o[10] = z2; o[11] = 0;
      o[12] = -(x0 * e[0] + x1 * e[1] + x2 * e[2]); o[13] = -(y0 * e[0] + y1 * e[1] + y2 * e[2]); o[14] = -(z0 * e[0] + z1 * e[1] + z2 * e[2]); o[15] = 1; return o;
    }
  };

  // ---------------- geometry Builder (merged, vertex-coloured) ----------------
  function Builder() { this.P = []; this.N = []; this.U = []; this.C = []; this.I = []; }
  Builder.prototype._v = function (p, n, u, c) { this.P.push(p[0], p[1], p[2]); this.N.push(n[0], n[1], n[2]); this.U.push(u[0], u[1]); this.C.push(c[0], c[1], c[2]); };
  // transform a centered-unit point/normal by scale, rotateZ, rotateY, translate
  function xf(out, x, y, z, s, cz, sz, cy, sy, t) {
    x *= s[0]; y *= s[1]; z *= s[2];
    var x1 = x * cz - y * sz, y1 = x * sz + y * cz;            // rotateZ
    var x2 = x1 * cy + z * sy, z2 = -x1 * sy + z * cy;         // rotateY
    out[0] = x2 + t[0]; out[1] = y1 + t[1]; out[2] = z2 + t[2];
  }
  function xfN(out, x, y, z, cz, sz, cy, sy) {
    var x1 = x * cz - y * sz, y1 = x * sz + y * cz;
    var x2 = x1 * cy + z * sy, z2 = -x1 * sy + z * cy;
    var l = Math.hypot(x2, y1, z2) || 1; out[0] = x2 / l; out[1] = y1 / l; out[2] = z2 / l;
  }
  // box centered at (cx,cy,cz) with size (sx,sy,sz), colour c, optional rotateY ry & rotateZ rz, uv tiling uvr
  Builder.prototype.box = function (cx, cy, cz, sx, sy, sz, c, ry, rz, uvr) {
    ry = ry || 0; rz = rz || 0; uvr = uvr || 1;
    var cy_ = Math.cos(ry), sy_ = Math.sin(ry), cz_ = Math.cos(rz), sz_ = Math.sin(rz);
    var s = [sx, sy, sz], t = [cx, cy, cz];
    var faces = [
      [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5], [0, 0, 1]],
      [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5], [0, 0, -1]],
      [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [1, 0, 0]],
      [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5], [-1, 0, 0]],
      [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5], [0, 1, 0]],
      [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5], [0, -1, 0]]
    ];
    var uvs = [[0, 0], [uvr, 0], [uvr, uvr], [0, uvr]];
    for (var f = 0; f < 6; f++) {
      var fc = faces[f], base = this.P.length / 3, p = [0, 0, 0], n = [0, 0, 0];
      for (var i = 0; i < 4; i++) {
        xf(p, fc[i][0], fc[i][1], fc[i][2], s, cz_, sz_, cy_, sy_, t);
        xfN(n, fc[4][0], fc[4][1], fc[4][2], cz_, sz_, cy_, sy_);
        this._v(p, n, uvs[i], c);
      }
      this.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  };
  // BEVELLED box (Phase 10b shape language): same as box() but the TOP edges are chamfered —
  // an inset top face joined to full-height sides by 4 sloped strips whose 45° normals catch the
  // warm key light against the cool shadow ramp (the Townscaper/Tiny Glade roundness read).
  // bev is in world units, clamped so tiny/thin boxes never invert. 40 verts vs box's 24.
  Builder.prototype.bbox = function (cx, cy, cz, sx, sy, sz, c, ry, bev, uvr) {
    var hx = sx / 2, hy = sy / 2, hz = sz / 2;
    var b = Math.min(bev == null ? Math.min(sx, sz) * 0.11 : bev, hx * 0.45, hz * 0.45, sy * 0.42);
    if (b <= 0.1) return this.box(cx, cy, cz, sx, sy, sz, c, ry, 0, uvr);   // masts/posts/trim: chamfer would be invisible — keep the cheap box
    ry = ry || 0; uvr = uvr || 1;
    var yr = hy - b, ix = hx - b, iz = hz - b, K = 0.70710678;
    var faces = [
      [[-hx, -hy, hz], [hx, -hy, hz], [hx, yr, hz], [-hx, yr, hz], [0, 0, 1]],
      [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, yr, -hz], [hx, yr, -hz], [0, 0, -1]],
      [[hx, -hy, hz], [hx, -hy, -hz], [hx, yr, -hz], [hx, yr, hz], [1, 0, 0]],
      [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, yr, hz], [-hx, yr, -hz], [-1, 0, 0]],
      [[-ix, hy, iz], [ix, hy, iz], [ix, hy, -iz], [-ix, hy, -iz], [0, 1, 0]],
      [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [0, -1, 0]],
      // 4 chamfer strips (trapezoids sharing the sloped corner edges — watertight)
      [[-hx, yr, hz], [hx, yr, hz], [ix, hy, iz], [-ix, hy, iz], [0, K, K]],
      [[hx, yr, -hz], [-hx, yr, -hz], [-ix, hy, -iz], [ix, hy, -iz], [0, K, -K]],
      [[hx, yr, hz], [hx, yr, -hz], [ix, hy, -iz], [ix, hy, iz], [K, K, 0]],
      [[-hx, yr, -hz], [-hx, yr, hz], [-ix, hy, iz], [-ix, hy, -iz], [-K, K, 0]]
    ];
    var cy_ = Math.cos(ry), sy_ = Math.sin(ry), s1 = [1, 1, 1], t = [cx, cy, cz];
    var uvs = [[0, 0], [uvr, 0], [uvr, uvr], [0, uvr]];
    for (var f = 0; f < faces.length; f++) {
      var fc = faces[f], base = this.P.length / 3, p = [0, 0, 0], n = [0, 0, 0];
      for (var i = 0; i < 4; i++) {
        xf(p, fc[i][0], fc[i][1], fc[i][2], s1, 1, 0, cy_, sy_, t);
        xfN(n, fc[4][0], fc[4][1], fc[4][2], 1, 0, cy_, sy_);
        this._v(p, n, uvs[i], c);
      }
      this.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  };
  // vertical cylinder (base at cy, height h)
  Builder.prototype.cyl = function (cx, cy, cz, r, h, seg, c, taper) {
    seg = seg || 12; taper = taper == null ? 1 : taper;
    var base = this.P.length / 3, i;
    for (i = 0; i < seg; i++) {
      var a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      var x0 = Math.cos(a0), z0 = Math.sin(a0), x1 = Math.cos(a1), z1 = Math.sin(a1);
      var nb = this.P.length / 3;
      this._v([cx + x0 * r, cy, cz + z0 * r], [x0, 0, z0], [0, 0], c);
      this._v([cx + x1 * r, cy, cz + z1 * r], [x1, 0, z1], [1, 0], c);
      this._v([cx + x1 * r * taper, cy + h, cz + z1 * r * taper], [x1, 0, z1], [1, 1], c);
      this._v([cx + x0 * r * taper, cy + h, cz + z0 * r * taper], [x0, 0, z0], [0, 1], c);
      this.I.push(nb, nb + 1, nb + 2, nb, nb + 2, nb + 3);
    }
    // top cap
    var topc = this.P.length / 3; this._v([cx, cy + h, cz], [0, 1, 0], [.5, .5], c);
    for (i = 0; i <= seg; i++) { var a = i / seg * Math.PI * 2; this._v([cx + Math.cos(a) * r * taper, cy + h, cz + Math.sin(a) * r * taper], [0, 1, 0], [0, 0], c); }
    for (i = 0; i < seg; i++) this.I.push(topc, topc + 1 + i, topc + 2 + i);
    return this;
  };
  Builder.prototype.add = function (b2) { // merge another builder
    var off = this.P.length / 3;
    for (var i = 0; i < b2.P.length; i++) this.P.push(b2.P[i]);
    for (i = 0; i < b2.N.length; i++) this.N.push(b2.N[i]);
    for (i = 0; i < b2.U.length; i++) this.U.push(b2.U[i]);
    for (i = 0; i < b2.C.length; i++) this.C.push(b2.C[i]);
    for (i = 0; i < b2.I.length; i++) this.I.push(b2.I[i] + off);
    return this;
  };
  // merge another builder, baking a translate + Y-rotation (yaw) into positions & normals.
  // Used to anchor a locally-built port to the founded harbour frame {ox,oz,yaw}.
  Builder.prototype.addXform = function (b2, ox, oy, oz, yaw) {
    var off = this.P.length / 3, c = Math.cos(yaw), s = Math.sin(yaw), i;
    for (i = 0; i < b2.P.length; i += 3) { var x = b2.P[i], y = b2.P[i + 1], z = b2.P[i + 2]; this.P.push(x * c + z * s + ox, y + oy, -x * s + z * c + oz); }
    for (i = 0; i < b2.N.length; i += 3) { var nx = b2.N[i], ny = b2.N[i + 1], nz = b2.N[i + 2]; this.N.push(nx * c + nz * s, ny, -nx * s + nz * c); }
    for (i = 0; i < b2.U.length; i++) this.U.push(b2.U[i]);
    for (i = 0; i < b2.C.length; i++) this.C.push(b2.C[i]);
    for (i = 0; i < b2.I.length; i++) this.I.push(b2.I[i] + off);
    return this;
  };
  Builder.prototype.data = function () {
    return { positions: new Float32Array(this.P), normals: new Float32Array(this.N), uvs: new Float32Array(this.U), colors: new Float32Array(this.C), indices: new Uint32Array(this.I) };
  };

  function plane(size, seg) {
    var P = [], N = [], U = [], C = [], I = [], s = seg || 1, h = size / 2;
    for (var j = 0; j <= s; j++) for (var i = 0; i <= s; i++) { P.push(-h + size * i / s, 0, -h + size * j / s); N.push(0, 1, 0); U.push(i / s, j / s); C.push(1, 1, 1); }
    for (j = 0; j < s; j++) for (i = 0; i < s; i++) { var a = j * (s + 1) + i, b = a + 1, c = a + (s + 1), d = c + 1; I.push(a, c, b, b, c, d); }
    return { positions: new Float32Array(P), normals: new Float32Array(N), uvs: new Float32Array(U), colors: new Float32Array(C), indices: new Uint32Array(I) };
  }

  // ---------------- shaders ----------------
  var V_MAIN = `#version 300 es
  layout(location=0) in vec3 aPos; layout(location=1) in vec3 aN; layout(location=2) in vec2 aUV; layout(location=3) in vec3 aColor;
  uniform mat4 uVP, uModel, uLightVP;
  out vec3 vN; out vec3 vW; out vec2 vUV; out vec4 vLP; out vec3 vCol;
  void main(){ vec4 wp=uModel*vec4(aPos,1.0); vW=wp.xyz; vN=mat3(uModel)*aN; vUV=aUV; vCol=aColor; vLP=uLightVP*wp; gl_Position=uVP*wp; }`;

  var F_MAIN = `#version 300 es
  precision highp float;
  in vec3 vN; in vec3 vW; in vec2 vUV; in vec4 vLP; in vec3 vCol;
  uniform vec3 uSunDir, uSunCol, uAmbTop, uAmbBot, uCam, uFog, uBase, uWin, uShadowTint;
  uniform float uFogD, uTexMix, uShadowOn, uVCol, uExposure, uSat, uNight, uTime, uToon, uAlbedo, uShadowK, uCrush, uGrain;
  uniform sampler2D uShadow; uniform sampler2D uTex;
  out vec4 frag;
  // Phase 14a: slope-scaled bias — grazing light (low ndl) needs a bigger depth push to avoid
  // acne, direct light can use a thin one so small buildings still ground convincingly (no
  // peter-panning gap under their feet). uShadowOn is now a continuous STRENGTH (0..1), not a
  // boolean: game.js fades it with sun height so the map only bites when the sun is high enough
  // for clean projections — at grazing dusk light the coarse terrain would self-shadow into
  // ugly mottling, so the soft contact blobs carry the low-sun grounding instead.
  float shadow(vec4 lp, float ndl){
    if(uShadowOn<0.05) return 1.0;
    vec3 p=lp.xyz/lp.w*0.5+0.5;
    if(p.z>1.0||p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0) return 1.0;
    float bias=clamp(0.0028*(1.0-ndl)+0.0006, 0.0006, 0.0034); float s=0.0; vec2 tx=vec2(1.0/2048.0);
    for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){ float d=texture(uShadow,p.xy+vec2(float(x),float(y))*tx).r; s+=(p.z-bias>d)?0.0:1.0; }
    return mix(1.0, s/9.0, clamp(uShadowOn,0.0,1.0));
  }
  vec3 aces(vec3 x){ float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
  float dth(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453); }
  // Phase 19a: paper-fibre grain — two-octave value noise on SCREEN position (static, no time
  // term: the fibre belongs to the paper stock the diorama is shot on, so it must never crawl
  // under camera motion). Amplitude is uGrain, authored per pass (terrain > water > sky).
  float vn2(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(dth(i),dth(i+vec2(1.0,0.0)),u.x), mix(dth(i+vec2(0.0,1.0)),dth(i+vec2(1.0,1.0)),u.x), u.y); }
  float fib(vec2 p){ return vn2(p*0.31)*0.6 + vn2(p*0.87+17.0)*0.4; }
  void main(){
    vec3 N=normalize(vN);
    vec3 base = uVCol>0.5 ? vCol : uBase;
    float emiss=0.0;
    if(uAlbedo>0.5){ vec4 t=texture(uTex,vUV); base = t.rgb * uBase; }   // asset albedo atlas, tinted by uBase
    else if(uTexMix>0.0){ vec4 t=texture(uTex,vUV); base=mix(base, base*(0.55+0.9*t.r), uTexMix); emiss=t.a; }
    float ndl=max(dot(N,uSunDir),0.0);
    float sh=shadow(vLP, ndl);
    // Phase 19a PAPERCRAFT: 2-step banded diffuse — a card face is either in the light or in the
    // shade, nothing between (the old 4-band toon ramp read as airbrushed by comparison). All
    // gloss is gone with it: no specular, no fresnel rim sheen, no dark silhouette-edge darkening
    // — matte construction paper under diffuse light. The white scissor-cut rims that replaced
    // the dark ink outlines live in F_POST.
    float diff = ndl;
    if(uToon>0.5){ float n=2.0; diff=(floor(ndl*n)+smoothstep(0.25,0.75,fract(ndl*n)))/n; }
    diff*=sh;
    vec3 amb=mix(uAmbBot,uAmbTop,N.y*0.5+0.5);
    // warm-key / cool-shadow chromatic ramp: as the banded diffuse falls, shift the surface
    // toward the biome's shadow tint (19a: retuned in biomes.js toward neutral grey-mauve paper
    // shadow — a shaded card face, not a glowing blue one).
    float lit = clamp(diff*1.7, 0.0, 1.0);
    vec3 ramp = mix(uShadowTint, vec3(1.0), mix(1.0, lit, uShadowK));
    vec3 col = base*ramp*(amb + uSunCol*diff);
    // night-lit windows: tex alpha mask, flickering warm glow
    float flick = 0.7+0.3*sin(uTime*3.0 + vW.x*1.7 + vW.y*2.3);
    col += uWin * emiss * uNight * flick;
    float dist=length(uCam-vW); float f=1.0-exp(-uFogD*dist); col=mix(col,uFog,clamp(f,0.0,1.0));
    col*=uExposure;
    float luma=dot(col,vec3(0.299,0.587,0.114)); col=mix(vec3(luma),col,uSat);
    // Phase 14a palette pop: pull mid-shadows down a touch for a more "confident", graphic-novel
    // read (m*(1-m) peaks at col=0.5 and is zero at both black and bright, so highlights never
    // clip and true blacks never crush further — safe on HDR-ish >1 values too, since the clamp
    // used to build the factor pins those to m=1, i.e. no effect).
    vec3 m=clamp(col,0.0,1.0); col -= uCrush*m*(1.0-m);
    // paper-fibre grain (19a) + the old 1-bit hash dither (still needed against banding)
    col += (fib(gl_FragCoord.xy)-0.5)*uGrain + (dth(gl_FragCoord.xy)-0.5)/255.0;
    frag=vec4(aces(col),1.0);
  }`;

  var V_DEPTH = `#version 300 es
  layout(location=0) in vec3 aPos; uniform mat4 uLightVP, uModel;
  void main(){ gl_Position=uLightVP*uModel*vec4(aPos,1.0); }`;
  var F_DEPTH = `#version 300 es
  precision highp float; void main(){}`;

  var V_SKY = `#version 300 es
  layout(location=0) in vec3 aPos; out vec2 vUv; void main(){ vUv=aPos.xy*0.5+0.5; gl_Position=vec4(aPos.xy,0.999,1.0); }`;
  // Phase 19b PAPERCRAFT SKY: a clean flat card gradient (2-stop top/bottom, the horizon glow is a
  // 3rd authored stop, all unchanged) but the sun/moon go from soft glow blobs to CUT PAPER DISCS —
  // a crisp circle with a thin white rim (the same scissor-cut-rim language as F_POST's outlines
  // and 19a's construction-paper edges), and the night starfield loses its per-star time-based
  // twinkle (a shimmer read as glitter, not paper) in favour of small STATIC size variation per
  // star (hashed once, never animated) — tiny paper flecks pinned to the card, not glinting glass.
  var F_SKY = `#version 300 es
  precision highp float; in vec2 vUv; uniform vec3 uTop,uBot,uSunCol,uHorizon; uniform vec2 uSun,uMoon; uniform float uNight,uTime,uHorizonY,uGrain,uAspect; out vec4 frag;
  vec3 aces(vec3 x){ float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
  float hash(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453); }
  float vn2(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x), mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x), u.y); }
  float fib(vec2 p){ return vn2(p*0.31)*0.6 + vn2(p*0.87+17.0)*0.4; }
  // aspect-corrected distance: vUv is 0..1 in BOTH axes over a non-square viewport, so a plain
  // distance() would draw every disc as an ellipse — squash x back to real screen proportions first.
  float discDist(vec2 uv, vec2 c){ vec2 d=uv-c; d.x*=uAspect; return length(d); }
  // Phase 20a THE FLOATING DIORAMA: NO HORIZON. The old 3rd "authored horizon band" stop (a glow
  // anchored to the projected sea horizon, uHorizonY) is GONE — sentinel for tests/screenshots:
  // this shader source no longer references uHorizonY or mixes in uHorizon at all. F_SKY is now a
  // pure 2-stop vertical card gradient + a soft vignette — a BACKDROP a floating object sits in
  // front of, not a landscape with a line where sea meets sky. uHorizon/uHorizonY uniforms are kept
  // declared (game.js still sets them harmlessly) so no call-site plumbing had to change.
  void main(){ vec3 c=mix(uBot,uTop,pow(vUv.y,0.85));
    vec2 vc=vUv-0.5; float vig=1.0-dot(vc,vc)*0.35; c*=clamp(vig,0.72,1.0);   // subtle void vignette, no horizon line anywhere
    // paper sun disc: crisp circle (not a soft glow blob) + a thin white cut-paper rim. Explicitly
    // faded out by (1-uNight) — the sun's screen track never truly dips off-card (todKeys clamps
    // its apparent height above the horizon), so relying on uSunCol alone left a dim ghost disc
    // hanging in the night sky; this fully hides it once the crescent moon takes over.
    float sunVis=1.0-uNight;
    float sd=discDist(vUv,uSun);
    float sunDisc=(1.0-smoothstep(0.036,0.040,sd))*sunVis;
    float sunRim=(1.0-smoothstep(0.040,0.045,sd))*smoothstep(0.036,0.040,sd)*sunVis;
    c=mix(c,uSunCol*1.35,sunDisc); c+=vec3(1.0,0.98,0.92)*sunRim*0.9;
    c+=uSunCol*smoothstep(0.16,0.03,sd)*0.10*sunVis;   // faint authored haze so the disc still sits in a hazy sky, not pasted flat
    if(uNight>0.01){
      // crescent moon card: a disc minus an overlapping "bite" circle, same cut-rim treatment
      float md=discDist(vUv,uMoon);
      float bite=1.0-smoothstep(0.019,0.022,discDist(vUv,uMoon+vec2(0.011,0.007)));
      float moonBase=1.0-smoothstep(0.022,0.025,md);
      float moonDisc=clamp(moonBase-bite,0.0,1.0);
      float moonRim=(1.0-smoothstep(0.025,0.029,md))*smoothstep(0.022,0.025,md)*clamp(1.0-bite*1.4,0.0,1.0);
      c=mix(c,vec3(0.93,0.94,0.98),moonDisc*uNight); c+=vec3(1.0)*moonRim*uNight*0.55;
      // static paper-fleck stars: size (not brightness) is hashed per-cell and never animated —
      // no uTime term at all, so nothing twinkles/shimmers.
      vec2 grid=vec2(140.0,90.0); vec2 cell=floor(vUv*grid); float h=hash(cell);
      vec2 f=fract(vUv*grid)-0.5+(vec2(hash(cell+1.7),hash(cell+4.2))-0.5)*0.6;
      float flecksize=0.09+0.10*hash(cell+3.1);                 // static per-star size variation
      float pt=smoothstep(flecksize,0.0,length(f));
      float star=step(0.965,h)*pt*smoothstep(0.20,0.62,vUv.y);
      c+=vec3(0.92,0.95,1.0)*star*uNight*1.15;
    }
    // paper-fibre grain (19a, gentler than terrain — the sky is a distant backdrop card) + dither
    c += (fib(gl_FragCoord.xy)-0.5)*uGrain + (hash(gl_FragCoord.xy)-0.5)/255.0;
    frag=vec4(aces(c*1.05),1.0); }`;

  // Phase 19b PAPERCRAFT SEA: the sea is now a stack of FLAT paper sheets, not an animated
  // heightfield — no vertex waves at all (vN is a constant up-normal; the old sin-wave
  // displacement/normal math is gone). All motion lives in the fragment shader below: shoreT (the
  // existing shore-distance signal, unchanged) selects one of WATER_SHORE_BANDS(4) flat card-blue
  // tones, and each band's zigzag boundary slides laterally at its own speed — this is the
  // "layered paper diorama sea" read (stacked scissor-cut sheets, lightest near shore) rather than
  // a lit/animated liquid surface.
  var V_WATER = `#version 300 es
  layout(location=0) in vec3 aPos; layout(location=3) in vec3 aColor; uniform mat4 uVP; out vec3 vW; out vec3 vN; out float vLandH;
  void main(){ vec3 p=aPos; p.y-=0.12;   // flat sea level, just below the heightfield coastline — no wave displacement (19b: flat paper sheet)
    vN=vec3(0.0,1.0,0.0); vW=p;
    vLandH=aColor.r;   // Phase 14a: terrain height baked per-vertex at mesh-build time (buildWaterMesh) — feeds the shore-distance signal below, no runtime heightfield lookup needed
    gl_Position=uVP*vec4(p,1.0); }`;
  var F_WATER = `#version 300 es
  precision highp float; in vec3 vW; in vec3 vN; in float vLandH; uniform vec3 uCam,uSunDir,uSunCol,uDeep,uShallow,uSky,uSkyTop,uFog; uniform float uFogD,uExposure,uSat,uTime,uFoam,uGrain,uStorm;
  out vec4 frag;
  vec3 aces(vec3 x){ float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
  float dth(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453); }
  float vn2(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(dth(i),dth(i+vec2(1.0,0.0)),u.x), mix(dth(i+vec2(0.0,1.0)),dth(i+vec2(1.0,1.0)),u.x), u.y); }
  float fib(vec2 p){ return vn2(p*0.31)*0.6 + vn2(p*0.87+17.0)*0.4; }
  float triW(float x){ float f=fract(x); return abs(f-0.5)*2.0; }   // 0..1 tent wave, period 1 — the zigzag/scallop primitive
  void main(){ vec3 N=normalize(vN); vec3 V=normalize(uCam-vW);
    float dist=length(uCam-vW);
    // NBANDS=4 flat card-blue sheets — shoreT (unchanged 14a/16b shore-distance signal baked into
    // vLandH at mesh-build time) still drives which sheet a fragment sits on: 0 far/deep, 1 near shore.
    float shoreT=smoothstep(-9.0,-0.35,vLandH);
    float bandsF=shoreT*4.0;
    float kf=floor(clamp(bandsF,0.0,3.999));                      // which boundary/band we're near, BEFORE the wobble (picks its slide speed)
    // Phase 14c: uStorm (0..1, eased in game.js from the hazard warn state) whips the paper sea up
    // during a storm — every band boundary slides up to ~3x faster, and the card tones darken
    // toward a cold slate below. WebGL zero-initializes uniforms, so callers that never set uStorm
    // (and the pre-14c look) get the exact calm-sea behaviour unchanged.
    float spd=(0.05+0.035*kf)*(1.0+2.0*uStorm);                    // each band boundary slides at its OWN speed (matches waterBandPhase() in game.js)
    float lateral=vW.x*0.035+vW.z*0.022;
    // wobble fades out with camera distance: at a grazing/far view a single screen pixel spans a
    // huge range of world-space lateral coordinate, so the (otherwise lovely, up-close) zigzag
    // aliases into a moire of stripes — fading it to a flat quantized band well before the horizon
    // keeps the near/mid water "torn paper", the far water a calm flat sheet (also correct: distant
    // water reading calmer than the foreground is itself a normal depth cue).
    float wobFade=clamp(1.0-dist*0.0022,0.0,1.0); wobFade*=wobFade;
    // two nested tent waves: a broad slow zigzag (the sheet-boundary wobble) plus a finer, quicker
    // one (the small scallop "teeth" along the cut) — both riding the same per-band uTime*spd phase
    // so the whole boundary slides sideways as one piece, never smoothly (a hand-cut edge, not a sine).
    float wob=(triW(lateral*0.9+uTime*spd+kf*1.7)-0.5)*0.9*wobFade;
    float teeth=(triW(lateral*3.4+uTime*spd*1.3+kf*2.3)-0.5)*0.22*wobFade*wobFade;
    float bandsW=clamp(bandsF+wob+teeth,0.0,3.999);
    float bandIdx=floor(bandsW);
    float bandFrac=fract(bandsW);
    vec3 water=mix(uDeep,uShallow,bandIdx/3.0);
    water=mix(water,water*vec3(0.42,0.47,0.58),uStorm*0.55);       // Phase 14c: storm-darkened slate sea (cool multiply, still card-flat)
    // Phase 19c: the band CONTRAST fades with distance too (not just the wobble) — once wobFade has
    // straightened the boundaries into razor lines at grazing/far views, the tone step itself is
    // what reads as a hard seam across the horizon. bandFarFlat eases the whole far field toward
    // one mid card-blue so the distant sea settles into a single flat sheet, no visible band line.
    float bandFarFlat=smoothstep(220.0,760.0,dist);
    water=mix(water,mix(uDeep,uShallow,0.30),bandFarFlat*0.85);
    // Phase 20a: WATERFALL sheets — game.js's buildWaterMesh() bakes a sentinel vLandH<-30 onto the
    // strips that spill over the SLAB boundary. Reusing this same shader (no new program) for them:
    // a banded pattern keyed off world-space Y and uTime scrolls DOWNWARD (falling water), mixed
    // toward white — the "paper waterfall" read, still fully deterministic via the existing uTime.
    // Refinement round: previously BOTH the mask AND the visible band only lit up right at the lip
    // (top vertex vLandH=-40 vs bottom vertex vLandH=-0.05, so only the sliver interpolating below
    // -30 near the top ever qualified) — it read as a flat white rim, not falling water. Now BOTH
    // strip endpoints carry a sentinel (top -46, bottom -31, from game.js), so the mask covers the
    // WHOLE strip, and that same interpolated value doubles as a taper signal (bright at the lip,
    // fading out approaching the base) without any new vertex attribute. 2-3 finer streaks are layered
    // on top of the broad scroll band via a higher-frequency lateral tent wave, so each sheet reads as
    // a few distinct ribbons rather than one flat plane, and the flare/curl at the base is geometric
    // (see WATER_FALL_FLARE in game.js).
    float vFallMask=step(30.0,-vLandH);
    if(vFallMask>0.5){
      float fallTaper=smoothstep(31.0,44.0,-vLandH);              // 1 at the lip (-46), fades to 0 near the base (-31)
      float fallPhase=fract(vW.y*0.18-uTime*0.6+lateral*0.4);
      float fallBand=smoothstep(0.55,0.15,abs(fallPhase-0.5));
      float streakA=triW(lateral*2.6+uTime*0.08);
      float streakB=triW(lateral*4.1-uTime*0.05+1.3);
      float streaks=0.45+0.55*max(1.0-streakA*2.0,0.0)+0.35*max(1.0-streakB*2.0,0.0);
      float fallStrength=clamp((0.35+0.65*fallBand)*streaks*fallTaper,0.0,1.0);
      water=mix(water,vec3(0.96,0.99,1.0),fallStrength*0.8);
    }
    // thin white scissor-cut rim right at each band boundary — wobbly, like the 19a paper edges
    float edgeDist=min(bandFrac,1.0-bandFrac);
    float rim=(1.0-smoothstep(0.0,0.05,edgeDist))*wobFade*(1.0-bandFarFlat);
    water=mix(water,vec3(0.97,0.99,1.0),rim*0.85);
    // a whisper of the sky's colour bleeds in at grazing view angles only (postcard horizon fade) —
    // paper is matte, so this stays gentle; N is now constant, so this is purely a camera-angle term.
    float fres=pow(1.0-max(dot(N,V),0.0),3.0);
    vec3 R=reflect(-V,N); vec3 sky=mix(uSky,uSkyTop,pow(clamp(R.y,0.0,1.0),0.6));
    vec3 col=mix(water,sky,clamp(fres*0.22,0.0,1.0));
    // Phase 14a/19b: scalloped shoreline foam — same shore-distance signal + uFoam ToD-strength
    // contract as before. A rounded scallop (not a sharp tent) reads as pinked/scalloped paper edge
    // rather than jagged shark-teeth — a slow eased ripple, two gentle octaves for a hand-drawn wobble.
    float shoreBand=1.0-smoothstep(0.0,2.6,abs(vLandH+0.15));
    float scallop=0.5+0.35*sin(vW.x*0.14+vW.z*0.09+uTime*0.45)+0.15*sin(vW.x*0.37+vW.z*0.24-uTime*0.6);
    col=mix(col,vec3(0.97,0.99,1.0),clamp(shoreBand*scallop,0.0,1.0)*0.6*uFoam);
    float f=1.0-exp(-uFogD*dist); col=mix(col,uFog,clamp(f,0.0,1.0));
    col*=uExposure; float luma=dot(col,vec3(0.299,0.587,0.114)); col=mix(vec3(luma),col,uSat);
    // paper-fibre grain (19a) + dither — the sea is a sheet of card too
    col += (fib(gl_FragCoord.xy)-0.5)*uGrain + (dth(gl_FragCoord.xy)-0.5)/255.0;
    frag=vec4(aces(col),1.0); }`;

  // Phase 10c post pass: tilt-shift "miniature diorama" DoF + bloom-lite in ONE kernel.
  // The scene is rendered into an offscreen RT, then this fullscreen composite runs a single
  // 12-tap 2-ring poisson blur whose radius grows with vertical distance from a focus band
  // (crisp port, dreamy top/bottom = miniature look). The SAME taps feed a bloom-lite term:
  // luma above uBloomThresh accumulates and is added back slightly warm — no ping-pong,
  // no second target, so night windows / sun glints get a gentle halo for one texture fetch set.
  var V_POST = `#version 300 es
  layout(location=0) in vec3 aPos; out vec2 vUv; void main(){ vUv=aPos.xy*0.5+0.5; gl_Position=vec4(aPos.xy,0.0,1.0); }`;
  // Phase 14a: the same fullscreen composite also does screen-space edge lines. The scene RT's
  // depth is now a samplable texture (see createRT below). Silhouette lines come from a 4-tap
  // depth cross (per-pixel — fwidth is 2x2-quad granular and dashes mid-distance lines) gated by
  // a screen-space Laplacian so smooth-but-steep terrain seen at grazing angles never reads as
  // an edge; interior detail lines come from derivative-reconstructed normals, near field only.
  // Distance-faded + smoothly cut past uOutlineMaxDist, sky masked outright, and the final edge
  // term is snapped through a confidence smoothstep so lines are solid or absent, never speckle.
  // Phase 19a PAPERCRAFT: the line itself flipped from dark ink to a WHITE scissor-cut paper rim
  // — uOutlineTint is now paper-white (see outlineTint() in game.js), the tap radius is wider,
  // and a low-frequency screen-space wobble (uOutlineWobble) sways both the rim width and the
  // edge threshold so every cut edge meanders slightly, hand-cut rather than vector-perfect.
  // The detector machinery (Laplacian slope-rejection, sky mask, distance handling) is untouched.
  var F_POST = `#version 300 es
  precision highp float; in vec2 vUv;
  uniform sampler2D uTex; uniform sampler2D uDepth; uniform vec2 uTexel;
  uniform float uFocusY, uFocusW, uBloomThresh, uBloomAmt, uDofAmt;
  uniform float uNear, uFar, uFovY, uAspect;
  uniform float uOutlineOn, uOutlineDepthT, uOutlineNormT, uOutlineFade, uOutlineMaxDist, uOutlineWidth, uOutlineWobble;
  uniform vec3 uOutlineTint;
  out vec4 frag;
  float linZ(float d){ float z=d*2.0-1.0; return (2.0*uNear*uFar)/(uFar+uNear-z*(uFar-uNear)); }
  float dth(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453); }
  float vn2(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(dth(i),dth(i+vec2(1.0,0.0)),u.x), mix(dth(i+vec2(0.0,1.0)),dth(i+vec2(1.0,1.0)),u.x), u.y); }
  void main(){
    // blur strength: 0 inside the focus band, easing to 1 at the screen edges (quadratic onset keeps the band edge creamy)
    // Review fix: DoF strength now scales with uDofAmt (driven by camera zoom in game.js) — at
    // full zoom-out (near CAM_DIST_MAX) uDofAmt eases to ~0 so the whole slab reads crisp with
    // legible strata, instead of the old fixed-strength blur mushing the cliff bands together.
    // Play-zoom keeps uDofAmt near 1 for the tilt-shift miniature look.
    float b = smoothstep(0.0, 0.42, max(abs(vUv.y - uFocusY) - uFocusW, 0.0)); b *= b * uDofAmt;
    vec3 sharp = texture(uTex, vUv).rgb;
    // 12 taps: centre + 4 inner ring (r=0.45) + 7 outer ring (r=1.0), rotated so no axis lines up
    vec2 T[12];
    T[0]=vec2(0.0,0.0);
    T[1]=vec2( 0.318, 0.318); T[2]=vec2(-0.318, 0.318); T[3]=vec2(-0.318,-0.318); T[4]=vec2( 0.318,-0.318);
    T[5]=vec2( 1.000, 0.000); T[6]=vec2( 0.623, 0.782); T[7]=vec2(-0.223, 0.975); T[8]=vec2(-0.901, 0.434);
    T[9]=vec2(-0.901,-0.434); T[10]=vec2(-0.223,-0.975); T[11]=vec2( 0.623,-0.782);
    vec2 rad = uTexel * (b * 11.0);                  // up to ~11px blur radius at full strength
    vec3 acc = vec3(0.0); float bloom = 0.0;
    for (int i = 0; i < 12; i++) {
      vec3 c = texture(uTex, vUv + T[i] * rad).rgb;
      acc += c;
      bloom += max(dot(c, vec3(0.299, 0.587, 0.114)) - uBloomThresh, 0.0);
    }
    acc /= 12.0; bloom /= 12.0;
    vec3 col = mix(sharp, acc, min(b * 1.15, 1.0));  // crisp in the band, dreamy top/bottom
    col += bloom * uBloomAmt * vec3(1.0, 0.92, 0.78); // bloom-lite, tinted slightly warm
    if (uOutlineOn > 0.5) {
      float d = texture(uDepth, vUv).r;
      float lz = linZ(d);
      // explicit cross taps, NOT fwidth: screen derivatives are 2x2-quad granular, which broke
      // mid-distance lines into dash/dot speckle. Four extra depth fetches buy per-pixel lines.
      // Phase 16b: uOutlineWidth widens the tap radius (clamped >=1 so a stray zero uniform never
      // collapses the cross to zero width). Phase 19a: scissor-cut wobble — a slow value noise
      // over screen position (static: the wobble is a property of the cut edge, and an animated
      // one would shimmer exactly like the dot-speckle 14a stamped out) sways the rim width
      // ±~40% and, further below, the ink threshold, so the paper rim meanders like hand-cut card.
      float wob = vn2(vUv*vec2(uAspect,1.0)*26.0);
      float wob2 = vn2(vUv*vec2(uAspect,1.0)*19.0+7.3);
      float ow = max(uOutlineWidth*(1.0+(wob-0.5)*0.85*uOutlineWobble), 1.0);
      vec2 ot = uTexel * ow;
      float zL = linZ(texture(uDepth, vUv - vec2(ot.x, 0.0)).r);
      float zR = linZ(texture(uDepth, vUv + vec2(ot.x, 0.0)).r);
      float zD = linZ(texture(uDepth, vUv - vec2(0.0, ot.y)).r);
      float zU = linZ(texture(uDepth, vUv + vec2(0.0, ot.y)).r);
      // positive gap = neighbour is FARTHER: the ink hugs the near object, never halos onto the
      // background. Gap alone still fires on steep terrain seen at grazing angles (a slope IS a
      // big per-pixel depth ramp), so gate it with the Laplacian: on any smooth surface the
      // opposite neighbours straddle the centre (2nd derivative ~ 0) no matter how tilted, while
      // a true silhouette step breaks that symmetry — min(gap, lap) fires only on real edges.
      float gap = max(max(zL - lz, zR - lz), max(zD - lz, zU - lz));
      float lap = max(abs(zL + zR - 2.0 * lz), abs(zD + zU - 2.0 * lz));
      float depthEdge = min(gap, lap) / max(lz, 1.0);
      // relative threshold GROWS with view depth: a mid-distance silhouette needs a proportionally
      // bigger step to ink, so terrain/skyline noise stays clean while port buildings keep lines.
      // 19a: threshold wobble (2nd noise channel) makes the edge ONSET meander too — scissor cut.
      float dT = uOutlineDepthT * (1.0 + lz * 0.012) * (1.0+(wob2-0.5)*0.7*uOutlineWobble);
      float edge = smoothstep(dT * 0.7, dT * 1.3, depthEdge);
      // interior detail lines (roof trim vs wall) from derivative-reconstructed normals — near
      // field only (quad-granular derivatives get noisy with distance: mid-range dot speckle)
      vec2 ndc = vUv * 2.0 - 1.0;
      float th = tan(uFovY * 0.5);
      vec3 viewPos = vec3(ndc.x * th * uAspect, ndc.y * th, -1.0) * lz;  // rough view-space position (fovY/aspect reconstruction, no inverse-projection matrix needed)
      vec3 N = normalize(cross(dFdx(viewPos), dFdy(viewPos)));
      float normEdge = length(fwidth(N));
      edge = max(edge, smoothstep(uOutlineNormT * 0.7, uOutlineNormT * 1.3, normEdge) * exp(-lz * 0.025));
      edge *= exp(-lz * uOutlineFade);                             // gentle distance fade
      edge *= 1.0 - smoothstep(uOutlineMaxDist * 0.55, uOutlineMaxDist, lz);  // smooth OUT beyond the playable port — far coast and horizon never ink
      edge *= 1.0 - step(0.9999, d);                               // sky mask: sky draws depthMask-off, so its pixels keep the cleared far-plane depth — never ink sky
      // confidence shaping (hysteresis-ish): values hovering at threshold snap to absent, strong
      // edges snap to full — a line is either there or it isn't, never a shimmer of dots
      edge = smoothstep(0.30, 0.70, edge);
      col = mix(col, uOutlineTint, clamp(edge, 0.0, 1.0));
    }
    frag = vec4(col, 1.0);
  }`;

  // soft contact-shadow blob: a flat ground decal with radial alpha (no shadow map → no "cloud shadows")
  var V_BLOB = `#version 300 es
  layout(location=0) in vec3 aPos; layout(location=2) in vec2 aUV; uniform mat4 uVP, uModel; out vec2 vUv;
  void main(){ vUv=aUV; gl_Position=uVP*uModel*vec4(aPos,1.0); }`;
  // uTint defaults to (0,0,0) — WebGL zero-initializes uniforms never explicitly set — so the
  // original contact-shadow callers (which never set it) are unaffected; Phase 14a's wake decals
  // (drawWakes) set it pale-white to reuse this same alpha-quad pipeline for foam instead of shadow.
  var F_BLOB = `#version 300 es
  precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform float uStr; uniform vec3 uTint; out vec4 frag;
  void main(){ float a=texture(uTex,vUv).a*uStr; frag=vec4(uTint,a); }`;

  // ---------------- engine ----------------
  function createEngine(gl) {
    function sh(t, src) { var s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src); return s; }
    function prog(vs, fs) { var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); } return { p: p, u: u }; }
    function mesh(d) {
      var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      function buf(arr, loc, size) { var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); }
      buf(d.positions, 0, 3); if (d.normals) buf(d.normals, 1, 3); if (d.uvs) buf(d.uvs, 2, 2); if (d.colors) buf(d.colors, 3, 3);
      var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, d.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao: vao, count: d.indices.length, itype: (d.indices instanceof Uint32Array) ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    }
    var aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') || gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
    var anisoMax = aniso ? Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1) : 0;
    function texture(canvas) { var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); if (aniso && anisoMax > 1) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, anisoMax); return t; }

    var SH = 2048, shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SH, SH, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var shadowFB = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFB); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0); gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    var quad = mesh({ positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), indices: new Uint16Array([0, 1, 2, 0, 2, 3]) });
    var blobQuad = mesh(plane(2, 1)); // unit XZ plane (-1..1), uvs 0..1 — for ground shadow decals
    // offscreen render target for the Phase 10c post pass: RGBA8 colour + depth.
    // Phase 14a: depth is now a SAMPLABLE texture (not a renderbuffer) — the post pass reads it
    // back to build screen-space ink outlines (depth + derivative-reconstructed normal
    // discontinuities). Same DEPTH_COMPONENT24-texture-as-FBO-attachment trick the shadow map
    // above already uses successfully, so it's a known-safe path on swiftshader.
    // Returns null on any failure so callers can fall back to direct-to-screen rendering.
    function createRT(w, h) {
      try {
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        var dtex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, dtex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        var fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, dtex, 0);
        var complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null);
        if (!complete) { gl.deleteFramebuffer(fb); gl.deleteTexture(dtex); gl.deleteTexture(tex); return null; }
        var rt = { fb: fb, tex: tex, depthTex: dtex, w: w, h: h };
        rt.resize = function (nw, nh) {
          if (nw === rt.w && nh === rt.h) return true;
          try {
            gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, nw, nh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindTexture(gl.TEXTURE_2D, dtex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, nw, nh, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
            gl.bindTexture(gl.TEXTURE_2D, null);
            rt.w = nw; rt.h = nh; return true;
          } catch (e) { return false; }
        };
        return rt;
      } catch (e) { return null; }
    }
    return { gl: gl, mat4: mat4, mesh: mesh, texture: texture, plane: plane, SH: SH, shadowFB: shadowFB, shadowTex: shadowTex, createRT: createRT,
      P_main: prog(V_MAIN, F_MAIN), P_depth: prog(V_DEPTH, F_DEPTH), P_sky: prog(V_SKY, F_SKY), P_water: prog(V_WATER, F_WATER), P_blob: prog(V_BLOB, F_BLOB), P_post: prog(V_POST, F_POST), quad: quad, blobQuad: blobQuad };
  }

  global.HGL = { mat4: mat4, Builder: Builder, geom: { plane: plane }, createEngine: createEngine };
})(window);
