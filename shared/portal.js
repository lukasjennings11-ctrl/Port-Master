/* shared/portal.js — unified web-game-portal SDK adapter (CrazyGames + Poki) with a no-op fallback.
 * Global: window.Portal. No build step; include with a plain <script> tag.
 *
 * ONE build runs everywhere. At init() we detect which portal SDK (if any) the host page loaded:
 *   - CrazyGames: window.CrazyGames.SDK   (their sdk-v3 <script>, injected by factory/ship.py)
 *   - Poki:       window.PokiSDK          (their poki-sdk <script>, injected by the Poki build)
 * Every method routes to whichever SDK is present; when neither is (itch.io, our own site, local
 * dev) every call is a safe no-op so the game plays identically. `available` is true only after a
 * real SDK has been detected + initialised.
 *
 * Method surface (stable across vendors — game.js and games/harbor/ads.js only ever see these):
 *   init() -> Promise<bool>            detect + initialise; always resolves
 *   loadingStart() / loadingStop()     brackets the #loader screen
 *   gameStart()  / gameStop()          brackets ACTUAL gameplay (open on play, close on break)
 *   commercialBreak(done)              interstitial at a natural pause; `done` runs exactly once
 *   rewardedAd(onReward, onSkip)       rewarded video; exactly one callback runs
 *   happytime([intensity])             positive-moment signal (optional)
 *   mute(isMuted)                      reflect the in-game mute to the SDK
 *   environment()                      vendor/environment string, best-effort
 *
 * Vendor API notes:
 *   CrazyGames v3: SDK.init()->Promise; SDK.game.sdkGameLoadingStart/Stop / gameplayStart/Stop /
 *     happytime; SDK.ad.requestAd('midgame'|'rewarded', {adStarted,adFinished,adError}). No auto
 *     audio-mute, so we mute via the juice.js bridge for the ad's duration.
 *   Poki:          PokiSDK.init()->Promise; gameLoadingFinished(); gameplayStart/Stop();
 *     commercialBreak(beforeAd?)->Promise; rewardedBreak(beforeAd?)->Promise<bool>; happyTime(0..1).
 *     Poki handles its own loading splash + audio during ads; we still mute via the bridge as a
 *     belt-and-braces so nothing leaks under the ad.
 * All calls are wrapped in try/catch + feature-detected, so a renamed/missing method degrades to a
 * no-op instead of throwing. Mirrors the juice.js / retention.js style (ES5 IIFE, dependency-free).
 */
(function (global) {
  'use strict';

  var vendor = '';        // 'crazygames' | 'poki' | '' (none)
  var cg = null;          // resolved CrazyGames SDK object, or null
  var poki = null;        // resolved PokiSDK object, or null
  var ready = false;      // init() has resolved
  var loadingOpen = false;
  var playing = false;
  var lastAd = 0;
  var AD_GAP_MS = 60000;  // min spacing between interstitials

  function detect() {
    try { if (global.CrazyGames && global.CrazyGames.SDK) { cg = global.CrazyGames.SDK; vendor = 'crazygames'; return; } } catch (e) {}
    try { if (global.PokiSDK) { poki = global.PokiSDK; vendor = 'poki'; return; } } catch (e) {}
    vendor = '';
  }

  // call cg.<path>(...args) defensively (CrazyGames nested API); returns true if it ran
  function cgCall(path, args) {
    if (!cg) return false;
    try {
      var obj = cg, parts = path.split('.');
      for (var i = 0; i < parts.length - 1; i++) { obj = obj && obj[parts[i]]; }
      var fn = obj && obj[parts[parts.length - 1]];
      if (typeof fn === 'function') { fn.apply(obj, args || []); return true; }
    } catch (e) {}
    return false;
  }
  // call a flat PokiSDK method defensively; returns the result (or undefined)
  function pokiCall(name, args) {
    if (!poki) return undefined;
    try { var fn = poki[name]; if (typeof fn === 'function') return fn.apply(poki, args || []); } catch (e) {}
    return undefined;
  }

  var Portal = {
    available: false,

    init: function () {
      detect();
      Portal.available = !!(cg || poki);
      if (!Portal.available) { ready = true; return Promise.resolve(false); }
      return new Promise(function (resolve) {
        var settled = false;
        var done = function () { if (settled) return; settled = true; ready = true; resolve(Portal.available); };
        // v87: never let a hung SDK init() block the boot bracket. Off its own domain (e.g. the
        // CrazyGames SDK loaded on Kongregate/itch) init() can wait forever for a parent handshake —
        // resolve anyway after 3s so the game's loading bracket + any init()-gated code always run.
        setTimeout(done, 3000);
        try {
          var p = vendor === 'crazygames' ? (cg.init && cg.init())
                                          : (poki.init && poki.init());
          if (p && typeof p.then === 'function') { p.then(done, done); }
          else { done(); }
        } catch (e) { done(); }
      });
    },

    // ---- loading bracket (pairs with the #loader screen) ----
    loadingStart: function () {
      if (loadingOpen) return;
      loadingOpen = true;
      if (vendor === 'crazygames') cgCall('game.sdkGameLoadingStart');
      // Poki shows its own splash from init() until gameLoadingFinished() — nothing to open.
    },
    loadingStop: function () {
      if (!loadingOpen) return;
      loadingOpen = false;
      if (vendor === 'crazygames') cgCall('game.sdkGameLoadingStop');
      else if (vendor === 'poki') pokiCall('gameLoadingFinished');
    },

    // ---- gameplay bracket (open on actual play, close on break/hidden) ----
    gameStart: function () {
      if (playing) return;
      playing = true;
      if (vendor === 'crazygames') cgCall('game.gameplayStart');
      else if (vendor === 'poki') pokiCall('gameplayStart');
    },
    gameStop: function () {
      if (!playing) return;
      playing = false;
      if (vendor === 'crazygames') cgCall('game.gameplayStop');
      else if (vendor === 'poki') pokiCall('gameplayStop');
    },

    happytime: function (intensity) {
      if (vendor === 'crazygames') cgCall('game.happytime');
      else if (vendor === 'poki') pokiCall('happyTime', [typeof intensity === 'number' ? intensity : 1]);
    },

    /* Interstitial at a natural break, frequency-capped. `done` ALWAYS runs exactly once — whether
     * an ad shows, errors, or is skipped by the cap. Audio is muted for the ad and restored after. */
    commercialBreak: function (done) {
      done = typeof done === 'function' ? done : function () {};
      var now = Date.now();
      if (!Portal.available || (now - lastAd) < AD_GAP_MS) { done(); return; }
      lastAd = now;
      var finished = false;
      var prevMuted = currentMuted();
      var finish = function () { if (finished) return; finished = true; setAudioMuted(prevMuted); done(); };
      var muteForAd = function () { setAudioMuted(true); };
      if (vendor === 'poki') {
        var pr = pokiCall('commercialBreak', [muteForAd]);
        if (pr && typeof pr.then === 'function') { pr.then(finish, finish); } else { finish(); }
        setTimeout(finish, 12000);
        return;
      }
      // crazygames
      var ran = cgCall('ad.requestAd', ['midgame', { adStarted: muteForAd, adFinished: finish, adError: finish }]);
      if (!ran) { finish(); return; }
      setTimeout(finish, 12000);   // safety net: never strand the game if no callback fires
    },

    /* Rewarded video. onReward() runs only if the player earned the reward; onSkip() on
     * skip/error/unavailable. Audio muted during the ad, restored after. */
    rewardedAd: function (onReward, onSkip) {
      onReward = typeof onReward === 'function' ? onReward : function () {};
      onSkip = typeof onSkip === 'function' ? onSkip : function () {};
      if (!Portal.available) { onSkip(); return; }
      var settled = false;
      var prevMuted = currentMuted();
      var reward = function () { if (settled) return; settled = true; setAudioMuted(prevMuted); onReward(); };
      var skip = function () { if (settled) return; settled = true; setAudioMuted(prevMuted); onSkip(); };
      var muteForAd = function () { setAudioMuted(true); };
      if (vendor === 'poki') {
        var pr = pokiCall('rewardedBreak', [muteForAd]);
        if (pr && typeof pr.then === 'function') { pr.then(function (withReward) { withReward ? reward() : skip(); }, skip); }
        else { skip(); }
        setTimeout(skip, 40000);
        return;
      }
      // crazygames
      var ran = cgCall('ad.requestAd', ['rewarded', { adStarted: muteForAd, adFinished: reward, adError: skip }]);
      if (!ran) { skip(); return; }
      setTimeout(skip, 40000);
    },

    mute: function (isMuted) { setAudioMuted(!!isMuted); },

    environment: function () {
      try {
        if (vendor === 'crazygames') return (cg && cg.environment) || 'crazygames';
        if (vendor === 'poki') return 'poki';
      } catch (e) {}
      return '';
    },

    // introspection (used by tests + games/harbor/ads.js routing)
    vendor: function () { return vendor; }
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
