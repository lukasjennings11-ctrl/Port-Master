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
  uniform vec3 uSunDir, uSunCol, uAmbTop, uAmbBot, uCam, uFog, uBase, uWin;
  uniform float uFogD, uRough, uTexMix, uShadowOn, uVCol, uExposure, uSat, uNight, uTime, uToon, uAlbedo;
  uniform sampler2D uShadow; uniform sampler2D uTex;
  out vec4 frag;
  float shadow(vec4 lp){
    if(uShadowOn<0.5) return 1.0;
    vec3 p=lp.xyz/lp.w*0.5+0.5;
    if(p.z>1.0||p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0) return 1.0;
    float bias=0.0017; float s=0.0; vec2 tx=vec2(1.0/2048.0);
    for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){ float d=texture(uShadow,p.xy+vec2(float(x),float(y))*tx).r; s+=(p.z-bias>d)?0.0:1.0; }
    return s/9.0;
  }
  vec3 aces(vec3 x){ float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
  void main(){
    vec3 N=normalize(vN);
    vec3 base = uVCol>0.5 ? vCol : uBase;
    float emiss=0.0;
    if(uAlbedo>0.5){ vec4 t=texture(uTex,vUV); base = t.rgb * uBase; }   // asset albedo atlas, tinted by uBase
    else if(uTexMix>0.0){ vec4 t=texture(uTex,vUV); base=mix(base, base*(0.55+0.9*t.r), uTexMix); emiss=t.a; }
    float ndl=max(dot(N,uSunDir),0.0);
    float sh=shadow(vLP);
    vec3 V=normalize(uCam-vW); vec3 H=normalize(uSunDir+V);
    // cartoon banded diffuse (stepped with soft edges) + soft rim highlight
    float diff = ndl;
    float rim = 0.0;
    if(uToon>0.5){ float n=4.0; diff=(floor(ndl*n)+smoothstep(0.25,0.75,fract(ndl*n)))/n;
                   rim = pow(1.0-max(dot(N,V),0.0),3.0)*ndl*0.28; }
    diff*=sh;
    float specK = (uToon>0.5?0.22:0.5)*(1.0-uRough);
    float spec=pow(max(dot(N,H),0.0), mix(8.0,80.0,1.0-uRough))*specK*sh*ndl;
    vec3 amb=mix(uAmbBot,uAmbTop,N.y*0.5+0.5);
    vec3 col = base*(amb + uSunCol*diff) + uSunCol*spec + uSunCol*rim;
    // soft dark silhouette edge for a hand-drawn / animated-cartoon outline feel
    float edge = uToon>0.5 ? pow(1.0-max(dot(N,V),0.0),3.5) : 0.0;
    col *= 1.0 - edge*0.30;
    // night-lit windows: tex alpha mask, flickering warm glow
    float flick = 0.7+0.3*sin(uTime*3.0 + vW.x*1.7 + vW.y*2.3);
    col += uWin * emiss * uNight * flick;
    float dist=length(uCam-vW); float f=1.0-exp(-uFogD*dist); col=mix(col,uFog,clamp(f,0.0,1.0));
    col*=uExposure;
    float luma=dot(col,vec3(0.299,0.587,0.114)); col=mix(vec3(luma),col,uSat);
    frag=vec4(aces(col),1.0);
  }`;

  var V_DEPTH = `#version 300 es
  layout(location=0) in vec3 aPos; uniform mat4 uLightVP, uModel;
  void main(){ gl_Position=uLightVP*uModel*vec4(aPos,1.0); }`;
  var F_DEPTH = `#version 300 es
  precision highp float; void main(){}`;

  var V_SKY = `#version 300 es
  layout(location=0) in vec3 aPos; out vec2 vUv; void main(){ vUv=aPos.xy*0.5+0.5; gl_Position=vec4(aPos.xy,0.999,1.0); }`;
  var F_SKY = `#version 300 es
  precision highp float; in vec2 vUv; uniform vec3 uTop,uBot,uSunCol; uniform vec2 uSun; uniform float uNight,uTime; out vec4 frag;
  vec3 aces(vec3 x){ float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
  float hash(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453); }
  void main(){ vec3 c=mix(uBot,uTop,pow(vUv.y,0.85));
    float d=distance(vUv,uSun); c+=uSunCol*smoothstep(0.05,0.0,d)*1.5; c+=uSunCol*smoothstep(0.3,0.02,d)*0.16;
    if(uNight>0.01){
      vec2 grid=vec2(140.0,90.0); vec2 cell=floor(vUv*grid); float h=hash(cell);
      vec2 f=fract(vUv*grid)-0.5+(vec2(hash(cell+1.7),hash(cell+4.2))-0.5)*0.6;
      float pt=smoothstep(0.15,0.0,length(f));
      float tw=0.55+0.45*sin(uTime*2.0+h*30.0);
      float star=step(0.965,h)*pt*tw*smoothstep(0.20,0.62,vUv.y);
      c+=vec3(0.92,0.95,1.0)*star*uNight*1.25;
    }
    frag=vec4(aces(c*1.05),1.0); }`;

  var V_WATER = `#version 300 es
  layout(location=0) in vec3 aPos; uniform mat4 uVP; uniform float uTime; out vec3 vW; out vec3 vN;
  void main(){ vec3 p=aPos; float t=uTime;
    float h=sin(p.x*0.18+t*1.1)*0.06+sin(p.z*0.23-t*0.9)*0.05+sin((p.x+p.z)*0.4+t*1.7)*0.025; p.y+=h-0.12; // sea level just below the heightfield coastline
    float dx=cos(p.x*0.18+t*1.1)*0.018+cos((p.x+p.z)*0.4+t*1.7)*0.016;
    float dz=cos(p.z*0.23-t*0.9)*0.021+cos((p.x+p.z)*0.4+t*1.7)*0.016;
    vN=normalize(vec3(-dx,1.0,-dz)); vW=p; gl_Position=uVP*vec4(p,1.0); }`;
  var F_WATER = `#version 300 es
  precision highp float; in vec3 vW; in vec3 vN; uniform vec3 uCam,uSunDir,uSunCol,uDeep,uShallow,uSky,uFog; uniform float uFogD,uExposure,uSat;
  out vec4 frag;
  vec3 aces(vec3 x){ float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
  void main(){ vec3 N=normalize(vN); vec3 V=normalize(uCam-vW);
    float fres=pow(1.0-max(dot(N,V),0.0),3.0); fres=floor(fres*3.0+0.2)/3.0;   // banded reflection
    float depthMix=floor(clamp(N.y*0.5+0.4,0.0,1.0)*3.0)/3.0+0.18;             // banded shallow/deep
    vec3 water=mix(uDeep,uShallow,clamp(depthMix,0.0,1.0));
    vec3 col=mix(water,uSky,clamp(fres*0.78,0.0,1.0));
    vec3 H=normalize(uSunDir+V); float gl=pow(max(dot(N,H),0.0),140.0); col+=uSunCol*smoothstep(0.35,0.75,gl)*0.85; // soft toon glint
    float foam=smoothstep(0.972,0.90,N.y); col+=vec3(0.90,0.95,1.0)*foam*0.10;  // gentle foam on wave faces
    float dist=length(uCam-vW); float f=1.0-exp(-uFogD*dist); col=mix(col,uFog,clamp(f,0.0,1.0));
    col*=uExposure; float luma=dot(col,vec3(0.299,0.587,0.114)); col=mix(vec3(luma),col,uSat);
    frag=vec4(aces(col),1.0); }`;

  // soft contact-shadow blob: a flat ground decal with radial alpha (no shadow map → no "cloud shadows")
  var V_BLOB = `#version 300 es
  layout(location=0) in vec3 aPos; layout(location=2) in vec2 aUV; uniform mat4 uVP, uModel; out vec2 vUv;
  void main(){ vUv=aUV; gl_Position=uVP*uModel*vec4(aPos,1.0); }`;
  var F_BLOB = `#version 300 es
  precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform float uStr; out vec4 frag;
  void main(){ float a=texture(uTex,vUv).a*uStr; frag=vec4(0.0,0.0,0.0,a); }`;

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
    function texture(canvas) { var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); return t; }

    var SH = 2048, shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SH, SH, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var shadowFB = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFB); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0); gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    var quad = mesh({ positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), indices: new Uint16Array([0, 1, 2, 0, 2, 3]) });
    var blobQuad = mesh(plane(2, 1)); // unit XZ plane (-1..1), uvs 0..1 — for ground shadow decals
    return { gl: gl, mat4: mat4, mesh: mesh, texture: texture, plane: plane, SH: SH, shadowFB: shadowFB, shadowTex: shadowTex,
      P_main: prog(V_MAIN, F_MAIN), P_depth: prog(V_DEPTH, F_DEPTH), P_sky: prog(V_SKY, F_SKY), P_water: prog(V_WATER, F_WATER), P_blob: prog(V_BLOB, F_BLOB), quad: quad, blobQuad: blobQuad };
  }

  global.HGL = { mat4: mat4, Builder: Builder, geom: { plane: plane }, createEngine: createEngine };
})(window);
