/* PortMaster — CrazyGames ad-provider adapter (window.ADS contract, see ads.js header).
 *
 * Ships ONLY in the CrazyGames portal build (factory/build-portal.sh --crazygames injects this
 * file plus the CrazyGames SDK v3 tag before ads.js). It registers itself on
 * window.ADS_PROVIDERS.crazygames and — because its presence in a build IS the provider
 * decision — also sets window.ADS_DEFAULT_PROVIDER = 'crazygames', which ads.js honours when no
 * explicit ?adprovider= override is in the URL. The main PortMaster site never loads this file,
 * so nothing there ever talks to CrazyGames.
 *
 * Contract compliance notes (each maps to a MUST in ads.js):
 *   init(cb)            — loads the SDK script if the build didn't (self-contained either way),
 *                          then CrazyGames.SDK.init(). cb() fires EXACTLY once no matter what:
 *                          success, SDK error, network failure, or a 10s watchdog timeout —
 *                          game boot never blocks on CrazyGames being reachable.
 *   rewardedAvailable() — cheap + synchronous: SDK ready, environment not 'disabled', no ad
 *                          already in flight, and under the same 6/day Captain's Bonus cap the
 *                          stub enforces (SAME Retention('harbor','bonusDay') record on purpose —
 *                          switching provider never resets a player's daily count). CrazyGames v3
 *                          has no synchronous "is an ad loaded" query, so no-fill surfaces as
 *                          adError → onFail at show time, which the contract already allows.
 *   showRewarded()      — CrazyGames.SDK.ad.requestAd('rewarded', …). onReward() only from
 *                          adFinished (= watched to completion), never on a bare tap; the daily
 *                          count bumps in the same instant. adError → onFail(reason) with game
 *                          state untouched. Exactly one of the two fires, exactly once, always
 *                          on a fresh tick. Game audio is muted for the ad and restored after
 *                          (CrazyGames QA requirement) — only if WE muted it; a player's own
 *                          mute choice is never overridden.
 *   commercialBreak()   — requestAd('midgame', …) at the era-advance/prestige pauses game.js
 *                          already brackets; onDone() exactly once whether the ad showed,
 *                          errored, or the SDK isn't ready.
 *   loadingFinished()/gameplayStart()/gameplayStop() — mapped 1:1 onto
 *                          CrazyGames.SDK.game.{loadingStop,gameplayStart,gameplayStop}; the
 *                          adapter calls loadingStart() itself once the SDK is up so the
 *                          loading bracket is properly paired. All fire-and-forget, never throw.
 *
 * Dependency-free, ES5, matches ads.js. SDK reference: docs.crazygames.com (HTML5 SDK v3).
 */
(function (global) {
  'use strict';
  var GAME = 'harbor';
  var DAILY_CAP = 6;                 // same cap, same storage record as the stub — see header
  var SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
  var INIT_WATCHDOG_MS = 10000;

  // ---- daily-cap bookkeeping (intentionally identical to ads.js's stub) ----
  function todayStr() { return global.Retention ? global.Retention.todayStr() : ''; }
  function dayRecord() {
    if (!global.Retention) return { date: todayStr(), count: 0 };
    var d = global.Retention.get(GAME, 'bonusDay', null), t = todayStr();
    return (d && d.date === t) ? d : { date: t, count: 0 };
  }
  function todayCount() { return dayRecord().count | 0; }
  function bumpCount() {
    if (!global.Retention) return;
    var d = dayRecord();
    global.Retention.set(GAME, 'bonusDay', { date: d.date, count: (d.count | 0) + 1 });
  }

  // ---- exactly-once + always-async guards ----
  function once(fn) {
    var done = false;
    return function () {
      if (done || typeof fn !== 'function') return;
      done = true;
      var args = arguments;
      setTimeout(function () { fn.apply(null, args); }, 0);
    };
  }

  // ---- audio courtesy: mute during ads, restore after — never override the player ----
  var _weMuted = false;
  function muteForAd() {
    try {
      if (global.Juice && global.Juice.Audio && !global.Juice.Audio.isMuted()) {
        global.Juice.Audio.setMuted(true);
        _weMuted = true;
      }
    } catch (e) {}
  }
  function restoreAfterAd() {
    try {
      if (_weMuted && global.Juice && global.Juice.Audio) global.Juice.Audio.setMuted(false);
    } catch (e) {}
    _weMuted = false;
  }

  // ---- SDK state ----
  var _ready = false;        // SDK.init() resolved
  var _disabled = false;     // environment reported 'disabled' (ads will never fill)
  var _inFlight = false;     // a rewarded/midgame request is currently showing
  var _loadingStarted = false;
  var _loadingFinishedQueued = false;
  var _initStarted = false;  // an init attempt is in flight (SDK.init at most once per page)
  var _initSettled = false;  // the attempt finished (success or degraded) — later init(cb)s resolve immediately
  var _initCbs = [];

  function sdk() { return global.CrazyGames && global.CrazyGames.SDK; }

  function loadSdkScript(onLoaded) {
    if (sdk()) { onLoaded(); return; }
    var s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.onload = function () { onLoaded(); };
    s.onerror = function () { onLoaded(); };   // init() below re-checks sdk() and degrades safely
    document.head.appendChild(s);
  }

  var ADAPTER = {
    provider: 'crazygames',

    init: function (cb) {
      var finish = once(cb || function () {});
      // idempotent: SDK.init() must run at most once per page (the real SDK throws on a second
      // call). Re-entrant callers (game.js's test-only reinitAds, double boots) just get their
      // cb queued onto the one in-flight/settled attempt — still exactly once per caller.
      if (_initSettled) { finish(); return; }
      _initCbs.push(finish);
      if (_initStarted) return;
      _initStarted = true;
      function settleAll() {
        _initSettled = true;
        for (var i = 0; i < _initCbs.length; i++) _initCbs[i]();
        _initCbs.length = 0;
      }
      var watchdog = setTimeout(settleAll, INIT_WATCHDOG_MS);
      loadSdkScript(function () {
        var S = sdk();
        if (!S) { clearTimeout(watchdog); settleAll(); return; }   // offline/blocked → ad-less, game boots
        try {
          S.init().then(function () {
            _ready = true;
            try { _disabled = (S.environment === 'disabled'); } catch (e) {}
            // pair the loading bracket: start now; stop immediately if the game already
            // finished booting while the SDK was still initialising.
            try { S.game.loadingStart(); _loadingStarted = true; } catch (e) {}
            if (_loadingFinishedQueued) ADAPTER.loadingFinished();
            clearTimeout(watchdog);
            settleAll();
          }).catch(function () { clearTimeout(watchdog); settleAll(); });
        } catch (e) { clearTimeout(watchdog); settleAll(); }
      });
    },

    rewardedAvailable: function () {
      return _ready && !_disabled && !_inFlight && todayCount() < DAILY_CAP;
    },

    showRewarded: function (onReward, onFail) {
      var reward = once(function () { bumpCount(); if (onReward) onReward(); });
      var fail = once(onFail || function () {});
      if (!_ready || _disabled || !sdk()) { fail('unavailable'); return; }
      if (_inFlight) { fail('busy'); return; }
      if (todayCount() >= DAILY_CAP) { fail('cap'); return; }
      _inFlight = true;
      var settle = function (fn, arg) {
        _inFlight = false;
        restoreAfterAd();
        fn(arg);
      };
      try {
        sdk().ad.requestAd('rewarded', {
          adStarted: function () { muteForAd(); },
          adFinished: function () { settle(reward); },
          adError: function (err) { settle(fail, err && err.code ? err.code : 'error'); }
        });
      } catch (e) {
        settle(fail, 'error');
      }
    },

    commercialBreak: function (onDone) {
      var done = once(onDone || function () {});
      if (!_ready || _disabled || _inFlight || !sdk()) { done(); return; }
      _inFlight = true;
      var settle = function () { _inFlight = false; restoreAfterAd(); done(); };
      try {
        sdk().ad.requestAd('midgame', {
          adStarted: function () { muteForAd(); },
          adFinished: function () { settle(); },
          adError: function () { settle(); }
        });
      } catch (e) { settle(); }
    },

    // ---- portal lifecycle events: fire-and-forget, never throw (contract) ----
    loadingFinished: function () {
      if (!_ready) { _loadingFinishedQueued = true; return; }
      if (!_loadingStarted) return;   // never send an unpaired loadingStop
      _loadingStarted = false;
      try { sdk().game.loadingStop(); } catch (e) {}
    },
    gameplayStart: function () {
      if (!_ready) return;
      try { sdk().game.gameplayStart(); } catch (e) {}
    },
    gameplayStop: function () {
      if (!_ready) return;
      try { sdk().game.gameplayStop(); } catch (e) {}
    }
  };

  global.ADS_PROVIDERS = global.ADS_PROVIDERS || {};
  global.ADS_PROVIDERS.crazygames = ADAPTER;
  // this file only ships in the CrazyGames build, so its presence IS the default-provider
  // decision; ads.js still lets ?adprovider=stub override for on-portal debugging.
  global.ADS_DEFAULT_PROVIDER = 'crazygames';
  // single-owner rule: shared/portal.js also detects window.CrazyGames and would call
  // SDK.init() a second time (the real v3 SDK rejects + logs on double init). This flag,
  // set at parse time (before game.js boots), tells Portal.init() to stand down — the ADS
  // layer is the one and only SDK surface in this build. See shared/portal.js.
  global.CG_SDK_INIT_OWNED = true;
})(window);
