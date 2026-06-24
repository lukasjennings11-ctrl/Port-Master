/* shared/progression.js — depth layer shared by every game.
 * Global: window.Progress. No build step; include with a plain <script> tag.
 *
 * Clones fail CrazyGames review partly because they are bare high-score loops
 * with no reason to continue. This layer adds the missing depth — levels with
 * star objectives, unlockable content, a soft currency, daily missions (which
 * reuse retention.js's daily-seed RNG), and a prestige hook for idle games —
 * all persisted through retention.js so there is no new storage code.
 *
 * Storage keys (per game, namespaced by retention.js):
 *   coins        : number
 *   lvl          : highest level the player has reached (>=1)
 *   stars        : { "<level>": bestStars }
 *   unlocks      : { "<id>": true }
 *   prestige     : number
 *   missions     : { date, list:[{id,text,target,prog,done,reward}] }
 */
(function (global) {
  'use strict';

  var R = global.Retention;
  function get(game, key, def) { return R ? R.get(game, key, def) : def; }
  function set(game, key, v) { if (R) R.set(game, key, v); }

  var Progress = {
    // ---- soft currency ----
    coins: function (game) { return get(game, 'coins', 0) | 0; },
    addCoins: function (game, n) {
      var v = (this.coins(game) + (n | 0));
      if (v < 0) v = 0;
      set(game, 'coins', v);
      return v;
    },
    spend: function (game, n) {
      n = n | 0;
      if (this.coins(game) < n) return false;
      this.addCoins(game, -n);
      return true;
    },

    // ---- levels & stars ----
    level: function (game) { return Math.max(1, get(game, 'lvl', 1) | 0); },
    setLevel: function (game, n) { set(game, 'lvl', Math.max(1, n | 0)); },
    // record a result for a level: bump the furthest-reached level, keep best stars
    completeLevel: function (game, n, stars) {
      n = Math.max(1, n | 0);
      stars = Math.max(0, Math.min(3, stars | 0));
      var map = get(game, 'stars', {});
      var prev = map['' + n] || 0;
      if (stars > prev) { map['' + n] = stars; set(game, 'stars', map); }
      if (n + 1 > this.level(game)) this.setLevel(game, n + 1); // unlock the next
      return stars;
    },
    stars: function (game, n) { var m = get(game, 'stars', {}); return m['' + n] || 0; },
    totalStars: function (game) {
      var m = get(game, 'stars', {}), t = 0;
      for (var k in m) if (m.hasOwnProperty(k)) t += m[k] | 0;
      return t;
    },

    // ---- unlocks ----
    unlock: function (game, id) { var u = get(game, 'unlocks', {}); u[id] = true; set(game, 'unlocks', u); },
    unlocked: function (game, id) { return !!get(game, 'unlocks', {})[id]; },
    unlockedList: function (game) {
      var u = get(game, 'unlocks', {}), a = [];
      for (var k in u) if (u.hasOwnProperty(k) && u[k]) a.push(k);
      return a;
    },

    // ---- prestige (idle) ----
    prestige: function (game) { return get(game, 'prestige', 0) | 0; },
    addPrestige: function (game, n) { set(game, 'prestige', this.prestige(game) + (n | 0)); return this.prestige(game); },

    /* ---- daily missions ----
     * pool: [{ id, text, target, reward }]. Deterministically picks `count`
     * for today (seeded by retention.js dailyRng so it's stable per day) and
     * merges in stored progress. Returns the active list.
     */
    dailyMissions: function (game, pool, count) {
      count = count || 3;
      var today = R ? R.todayStr() : '' + new Date().toDateString();
      var store = get(game, 'missions', null);
      if (store && store.date === today && store.list) return store.list;

      var rng = R ? R.dailyRng(game) : Math.random;
      var idx = pool.map(function (_, i) { return i; });
      // Fisher–Yates with the seeded RNG
      for (var i = idx.length - 1; i > 0; i--) {
        var j = (rng() * (i + 1)) | 0;
        var tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
      }
      var list = idx.slice(0, Math.min(count, pool.length)).map(function (k) {
        var m = pool[k];
        return { id: m.id, text: m.text, target: m.target, reward: m.reward || 25, prog: 0, done: false };
      });
      set(game, 'missions', { date: today, list: list });
      return list;
    },
    // increment a mission's progress; awards coins once on completion. Returns
    // the mission if it just completed (for a popup), else null.
    // `absolute`: treat `amount` as a high-water value (prog = max(prog, amount))
    // instead of an increment — for "reach combo N / wave N / score N" goals.
    bumpMission: function (game, id, amount, absolute) {
      var store = get(game, 'missions', null);
      if (!store || !store.list) return null;
      var completed = null;
      for (var i = 0; i < store.list.length; i++) {
        var m = store.list[i];
        if (m.id === id && !m.done) {
          if (absolute) m.prog = Math.max(m.prog, amount == null ? 0 : amount);
          else m.prog += (amount == null ? 1 : amount);
          if (m.prog >= m.target) { m.prog = m.target; m.done = true; this.addCoins(game, m.reward); completed = m; }
        }
      }
      set(game, 'missions', store);
      return completed;
    }
  };

  global.Progress = Progress;
})(window);
