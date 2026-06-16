/* shared/juice.js — dependency-free game-feel layer.
 * Global: window.Juice. No build step; include with a plain <script> tag.
 * Provides: math/easing helpers, synthesized SFX (no audio files),
 * particles, screenshake, floating-text popups, and haptics.
 * Every game uses this so each one ships with "juice" by default.
 */
(function (global) {
  'use strict';

  // ---------- math / tween helpers ----------
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var ease = {
    outCubic:  function (t) { return 1 - Math.pow(1 - t, 3); },
    inOutCubic:function (t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; },
    outQuad:   function (t) { return 1 - (1 - t) * (1 - t); },
    outBack:   function (t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2); },
    outElastic:function (t) { var c4 = (2*Math.PI)/3; return t===0?0:(t===1?1:Math.pow(2,-10*t)*Math.sin((t*10-0.75)*c4)+1); }
  };

  // ---------- audio: synthesized SFX, zero asset files ----------
  var Audio = (function () {
    var ctx = null, master = null, muted = false;

    function ensure() {
      if (!ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.22;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      return ctx;
    }

    function tone(freq, dur, type, opts) {
      if (muted) return;
      var c = ensure(); if (!c) return;
      opts = opts || {};
      var t0 = c.currentTime;
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (opts.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.glide), t0 + dur);
      var vol = (opts.vol == null) ? 0.6 : opts.vol;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(master);
      osc.start(t0); osc.stop(t0 + dur + 0.03);
    }

    var presets = {
      tap:   function () { tone(440, 0.08, 'triangle', { vol: 0.35 }); },
      move:  function () { tone(200, 0.07, 'sine',     { vol: 0.25, glide: 170 }); },
      merge: function (n) { n = n || 1; var base = 300 + Math.min(n, 11) * 45;
               tone(base, 0.12, 'triangle', { vol: 0.5, glide: base * 1.5 });
               setTimeout(function () { tone(base * 1.5, 0.10, 'sine', { vol: 0.3 }); }, 45); },
      score: function () { tone(660, 0.10, 'square', { vol: 0.25, glide: 990 }); },
      win:   function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { tone(f, 0.18, 'triangle', { vol: 0.4 }); }, i * 95); }); },
      lose:  function () { tone(300, 0.35, 'sawtooth', { vol: 0.35, glide: 70 }); },
      pop:   function () { tone(880, 0.05, 'sine', { vol: 0.25 }); }
    };

    return {
      unlock: ensure,
      play: function (name) { var p = presets[name]; if (p) p.apply(null, Array.prototype.slice.call(arguments, 1)); },
      tone: tone,
      isMuted: function () { return muted; },
      setMuted: function (v) { muted = !!v; if (!muted) ensure(); return muted; },
      toggleMute: function () { muted = !muted; if (!muted) ensure(); return muted; }
    };
  })();

  // ---------- particles ----------
  function Particles() { this.list = []; }
  Particles.prototype.burst = function (x, y, opts) {
    opts = opts || {};
    var n = opts.count || 12;
    var colors = opts.colors || ['#ffffff'];
    for (var i = 0; i < n; i++) {
      var a = (opts.angle != null)
        ? opts.angle + (Math.random() - 0.5) * (opts.spread || Math.PI * 2)
        : Math.random() * Math.PI * 2;
      var sp = (opts.speed || 130) * (0.5 + Math.random());
      this.list.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: opts.life || 0.6, max: opts.life || 0.6,
        size: (opts.size || 4) * (0.6 + Math.random() * 0.8),
        color: colors[(Math.random() * colors.length) | 0],
        gravity: opts.gravity == null ? 360 : opts.gravity,
        shape: opts.shape || 'circle'
      });
    }
  };
  Particles.prototype.update = function (dt) {
    for (var i = this.list.length - 1; i >= 0; i--) {
      var p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) { this.list.splice(i, 1); continue; }
      p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
  };
  Particles.prototype.draw = function (ctx) {
    for (var i = 0; i < this.list.length; i++) {
      var p = this.list[i];
      var a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a; ctx.fillStyle = p.color;
      var s = p.size * (0.4 + a * 0.6);
      if (p.shape === 'rect') { ctx.fillRect(p.x - s/2, p.y - s/2, s, s); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  };
  Object.defineProperty(Particles.prototype, 'count', { get: function () { return this.list.length; } });

  // ---------- screenshake ----------
  function Shake() { this.t = 0; this.dur = 0; this.mag = 0; }
  Shake.prototype.add = function (mag, dur) {
    dur = dur || 0.3;
    this.mag = Math.max(this.mag, mag);
    this.dur = Math.max(this.dur, dur);
    this.t = Math.max(this.t, dur);
  };
  Shake.prototype.update = function (dt) {
    if (this.t <= 0) { this.mag = 0; return { x: 0, y: 0 }; }
    this.t -= dt;
    var k = clamp(this.t / this.dur, 0, 1) * this.mag;
    return { x: (Math.random() * 2 - 1) * k, y: (Math.random() * 2 - 1) * k };
  };

  // ---------- floating-text popups ----------
  function Popups() { this.list = []; }
  Popups.prototype.add = function (x, y, text, opts) {
    opts = opts || {};
    this.list.push({ x: x, y: y, text: text, life: opts.life || 0.85, max: opts.life || 0.85,
      color: opts.color || '#ffffff', size: opts.size || 20, vy: opts.vy || -64 });
  };
  Popups.prototype.update = function (dt) {
    for (var i = this.list.length - 1; i >= 0; i--) {
      var p = this.list[i]; p.life -= dt;
      if (p.life <= 0) { this.list.splice(i, 1); continue; }
      p.y += p.vy * dt; p.vy *= 0.92;
    }
  };
  Popups.prototype.draw = function (ctx) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 0; i < this.list.length; i++) {
      var p = this.list[i]; var a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a; ctx.fillStyle = p.color;
      ctx.font = '700 ' + p.size + 'px system-ui, -apple-system, sans-serif';
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  };

  // ---------- haptics ----------
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

  global.Juice = {
    clamp: clamp, lerp: lerp, ease: ease,
    Audio: Audio, Particles: Particles, Shake: Shake, Popups: Popups, vibrate: vibrate
  };
})(window);
