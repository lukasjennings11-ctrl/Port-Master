/* shared/portal.js — CrazyGames SDK adapter with a graceful no-op fallback.
 * Global: window.Portal. No build step; include with a plain <script> tag.
 *
 * One build runs everywhere: when the CrazyGames SDK is present (their site,
 * after ship.py injects the SDK <script>), every call routes to the SDK. When
 * it is absent (itch.io, local dev), every call is a safe no-op so the game
 * plays identically. Detection is via window.CrazyGames.SDK.
 *
 * Mirrors the juice.js / retention.js style: an IIFE that hangs one object off
 * window, ES5-flavoured, dependency-free.
 *
 * SDK surface used (CrazyGames SDK v3 — verify against docs.crazygames.com):
 *   SDK.init() -> Promise
 *   SDK.game.sdkGameLoadingStart() / sdkGameLoadingStop()
 *   SDK.game.gameplayStart() / gameplayStop()
 *   SDK.game.happytime()
 *   SDK.ad.requestAd('midgame'|'rewarded', { adStarted, adFinished, adError })
 *   SDK.environment
 * Calls are wrapped in try/catch and feature-detected, so a renamed/missing
 * method degrades to a no-op instead of throwing.
 */
(function (global) {
  'use strict';

  var sdk = null;          // resolved CrazyGames SDK object, or null
  var ready = false;       // init() has resolved
  var loadingOpen = false; // a loading bracket is open
  var playing = false;     // a gameplay bracket is open
  var lastAd = 0;          // timestamp (ms) of the last interstitial
  var AD_GAP_MS = 60000;   // min spacing between interstitials

  function findSdk() {
    try { return (global.CrazyGames && global.CrazyGames.SDK) || null; }
    catch (e) { return null; }
  }

  // call sdk.<path>(...args) defensively; returns true if it ran
  function call(path, args) {
    if (!sdk) return false;
    try {
      var obj = sdk, parts = path.split('.');
      for (var i = 0; i < parts.length - 1; i++) { obj = obj && obj[parts[i]]; }
      var fn = obj && obj[parts[parts.length - 1]];
      if (typeof fn === 'function') { fn.apply(obj, args || []); return true; }
    } catch (e) {}
    return false;
  }

  var Portal = {
    // true once an actual SDK has been detected (CrazyGames environment)
    available: false,

    // Detect + initialise. Safe to call once at boot. Always resolves.
    init: function () {
      sdk = findSdk();
      Portal.available = !!sdk;
      if (!sdk) { ready = true; return Promise.resolve(false); }
      return new Promise(function (resolve) {
        var done = function () { ready = true; resolve(Portal.available); };
        try {
          var p = sdk.init && sdk.init();
          if (p && typeof p.then === 'function') { p.then(done, done); }
          else { done(); }
        } catch (e) { done(); }
      });
    },

    // ---- loading bracket (pairs with the #loader screen) ----
    loadingStart: function () {
      if (loadingOpen) return;
      loadingOpen = true;
      call('game.sdkGameLoadingStart');
    },
    loadingStop: function () {
      if (!loadingOpen) return;
      loadingOpen = false;
      call('game.sdkGameLoadingStop');
    },

    // ---- gameplay bracket (every round) ----
    gameStart: function () {
      if (playing) return;
      playing = true;
      call('game.gameplayStart');
    },
    gameStop: function () {
      if (!playing) return;
      playing = false;
      call('game.gameplayStop');
    },

    // Positive-moment hook (big win / new best). Optional.
    happytime: function () { call('game.happytime'); },

    /* Interstitial at a natural break (restart / next level), frequency-capped.
     * `done` ALWAYS runs exactly once — whether an ad shows, errors, or is
     * skipped by the cap — so callers can use it as their "now restart" step.
     * Audio is muted for the ad's duration and restored after. */
    commercialBreak: function (done) {
      done = typeof done === 'function' ? done : function () {};
      var now = Date.now();
      if (!sdk || (now - lastAd) < AD_GAP_MS) { done(); return; }
      lastAd = now;
      var finished = false;
      var finish = function () { if (finished) return; finished = true; restoreAudio(); done(); };
      var prevMuted = currentMuted();
      var muteForAd = function () { setAudioMuted(true); };
      var restoreAudio = function () { setAudioMuted(prevMuted); };
      var ran = false;
      try {
        ran = call('ad.requestAd', ['midgame', {
          adStarted: muteForAd,
          adFinished: finish,
          adError: finish
        }]);
      } catch (e) { ran = false; }
      if (!ran) { finish(); return; }
      // safety net: never strand the game if no callback fires
      setTimeout(finish, 8000);
    },

    /* Rewarded video. onReward() runs only if the player earned the reward;
     * onSkip() runs on skip/error/unavailable. */
    rewardedAd: function (onReward, onSkip) {
      onReward = typeof onReward === 'function' ? onReward : function () {};
      onSkip = typeof onSkip === 'function' ? onSkip : function () {};
      if (!sdk) { onSkip(); return; }
      var settled = false;
      var prevMuted = currentMuted();
      var reward = function () { if (settled) return; settled = true; setAudioMuted(prevMuted); onReward(); };
      var skip = function () { if (settled) return; settled = true; setAudioMuted(prevMuted); onSkip(); };
      var ran = call('ad.requestAd', ['rewarded', {
        adStarted: function () { setAudioMuted(true); },
        adFinished: reward,
        adError: skip
      }]);
      if (!ran) { skip(); return; }
      setTimeout(skip, 30000);
    },

    // Reflect the in-game mute toggle to the SDK side (best-effort).
    mute: function (isMuted) { setAudioMuted(!!isMuted); },

    // 'crazygames' | 'local' | 'disabled' | '' (unknown)
    environment: function () {
      try { return (sdk && sdk.environment) || ''; } catch (e) { return ''; }
    }
  };

  // ---- audio bridge to juice.js (so ads pause game sound) ----
  function currentMuted() {
    try { return !!(global.Juice && Juice.Audio && Juice.Audio.isMuted()); }
    catch (e) { return false; }
  }
  function setAudioMuted(v) {
    try { if (global.Juice && Juice.Audio && Juice.Audio.setMuted) Juice.Audio.setMuted(v); }
    catch (e) {}
  }

  global.Portal = Portal;
})(window);
