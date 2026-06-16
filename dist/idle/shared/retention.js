/* shared/retention.js — dependency-free stickiness layer.
 * Global: window.Retention. No build step; include with a plain <script> tag.
 * Provides: namespaced localStorage, best-score + local leaderboard,
 * daily play streaks, and a deterministic daily-seed RNG (everyone gets the
 * same "daily challenge" board on a given date). The "come back tomorrow" hooks.
 */
(function (global) {
  'use strict';

  var NS = 'gf'; // game-factory namespace

  function k(game, key) { return NS + ':' + game + ':' + key; }
  function get(game, key, def) {
    try { var v = localStorage.getItem(k(game, key)); return v == null ? def : JSON.parse(v); }
    catch (e) { return def; }
  }
  function set(game, key, v) {
    try { localStorage.setItem(k(game, key), JSON.stringify(v)); } catch (e) {}
  }

  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // FNV-1a string hash -> uint32
  function hashStr(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // mulberry32 — small deterministic PRNG
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var Retention = {
    get: get, set: set, todayStr: todayStr, hashStr: hashStr, mulberry32: mulberry32,

    // deterministic RNG for a game's daily challenge
    dailyRng: function (game, dateStr) { return mulberry32(hashStr(game + ':' + (dateStr || todayStr()))); },
    dailySeed: function (game, dateStr) { return hashStr(game + ':' + (dateStr || todayStr())); },

    // scores
    best: function (game) { return get(game, 'best', 0); },
    plays: function (game) { return get(game, 'plays', 0); },
    leaderboard: function (game) { return get(game, 'lb', []); },
    submitScore: function (game, score) {
      var prev = this.best(game);
      var isBest = score > prev;
      if (isBest) set(game, 'best', score);
      var lb = get(game, 'lb', []);
      lb.push({ score: score, date: todayStr() });
      lb.sort(function (a, b) { return b.score - a.score; });
      set(game, 'lb', lb.slice(0, 10));
      set(game, 'plays', get(game, 'plays', 0) + 1);
      return { isBest: isBest, best: this.best(game) };
    },

    // daily streak: +1 if last play was yesterday, reset to 1 if a day was missed
    touchStreak: function (game) {
      var t = todayStr();
      var last = get(game, 'lastDay', null);
      var streak = get(game, 'streak', 0);
      if (last !== t) {
        var yesterday = todayStr(new Date(Date.now() - 86400000));
        streak = (last === yesterday) ? streak + 1 : 1;
        set(game, 'streak', streak);
        set(game, 'lastDay', t);
      }
      return streak;
    },
    streak: function (game) { return get(game, 'streak', 0); },

    // daily challenge completion bookkeeping
    dailyDoneToday: function (game) { return get(game, 'dailyDone', null) === todayStr(); },
    markDailyDone: function (game) { set(game, 'dailyDone', todayStr()); }
  };

  global.Retention = Retention;
})(window);
