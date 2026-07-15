/* PortMaster — pluggable ad-provider abstraction (Phase 12a).
 * window.ADS is the ONLY surface game.js talks to for monetized attention. It ships today as a
 * free "stub" (no ad account, no network call — just a short charming delay) so Captain's Bonus
 * works on our own site right now. A future portal adapter (poki.js / crazygames.js / admob.js)
 * re-implements the same five members and is dropped in — game.js never changes.
 *
 * Contract (every adapter MUST honour this exactly, so callers can treat all providers the same):
 *   provider              — string id, informational only (shown nowhere critical).
 *   init(cb)               — async setup (load an SDK, etc). MUST call cb() exactly once, whether
 *                             setup succeeded or failed — game boot must never block on this. A
 *                             synchronous/trivial provider may still call cb() on a fresh tick
 *                             (setTimeout 0) rather than synchronously, so callers can always treat
 *                             it as async. Until cb() fires, treat the provider as not-ready
 *                             (game.js hides the bonus button until then).
 *   rewardedAvailable()    — bool, cheap + synchronous (may be polled every HUD tick — no I/O, no
 *                             promises). True only when a reward could plausibly be granted right
 *                             now: network up, an ad is actually ready, and under any provider- or
 *                             game-side daily cap. The stub enforces PortMaster's 6/day cap here via
 *                             Retention('harbor','bonusDay',{date,count}) so the button simply hides
 *                             once the player has claimed enough today — no nagging, no dead click.
 *   showRewarded(onReward, onFail) — opens the ad experience (or, in the stub, a short delay standing
 *                             in for one). Exactly one of onReward()/onFail() fires, exactly once,
 *                             and always asynchronously (never in the same tick as the call) so a
 *                             caller can safely show a "loading" state first. onReward() fires only
 *                             when the player actually completed the flow (watched the ad / the stub
 *                             delay elapsed) — never on a bare tap. onFail() fires on decline, error,
 *                             no-fill, or the daily cap being hit mid-flight; it must NEVER be treated
 *                             as a punishment by the caller — game state must be left exactly as it
 *                             was before the call (no partial reward, no penalty).
 *   commercialBreak(onDone) — optional interstitial hook for natural pauses (era advance, prestige,
 *                             etc). The stub is a no-op that calls onDone() immediately. Portal
 *                             adapters may show a real break here if their SDK allows it at that
 *                             moment. onDone() always fires exactly once, asynchronously, so game
 *                             flow is never blocked waiting on it.
 *
 * Portal lifecycle events (Phase 12b) — the exact hooks Poki/CrazyGames QA checks for. All three
 * are optional, synchronous, fire-and-forget (no callback, must never throw) and no-ops in the
 * stub beyond bookkeeping. A portal adapter maps each straight onto its SDK's loading/gameplay
 * bracket calls (e.g. CrazyGames' sdkGameLoadingStop/gameplayStart/gameplayStop):
 *   loadingFinished()      — called once, when the game has finished booting and the loader is
 *                             about to be hidden. Tells the portal it can stop showing its own
 *                             loading UI over ours.
 *   gameplayStart()        — called whenever the player is actively playing: on founding a port /
 *                             resuming a save with a founded port, and whenever the tab regains
 *                             visibility with a founded port. Portals use this to know when it's
 *                             safe to show ads/prompts and for their own analytics.
 *   gameplayStop()         — called whenever the tab loses visibility (backgrounded/hidden), the
 *                             mirror image of gameplayStart(). Portals pause their own timers here.
 * The stub counts every call (window.ADS._counts = {loadingFinished, gameplayStart, gameplayStop,
 * commercialBreak}) purely so tests can assert the integration points actually fire; real
 * adapters have no obligation to expose counts.
 *
 * Provider selection: reads ?adprovider=<id> from the URL for testing/portal wiring. Only 'stub'
 * ships in this build; an adapter can register itself onto window.ADS_PROVIDERS[id] before this
 * script runs (e.g. a portal build loads poki.js first) — anything unrecognised falls back to the
 * free stub, so the game is never left without a working (if ad-less) provider.
 *
 * Dependency-free, ES5, matches the rest of the codebase (games/harbor/*.js).
 */
(function (global) {
  'use strict';
  var GAME = 'harbor';
  var DAILY_CAP = 6;
  var REWARD_DELAY_MS = 1200;   // stub "signal flags" charm delay — stands in for a real rewarded ad

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

  // test hook: when true, showRewarded resolves on the next tick instead of after the charm delay,
  // so browser tests don't have to eat REWARD_DELAY_MS six-plus times. Never read by real players.
  function fastMode() { return !!global.__ADS_TEST_FAST__; }

  // Phase (portal-readiness): the default provider auto-ROUTES to a real portal SDK when one is
  // hosting us. shared/portal.js exposes window.Portal — a unified CrazyGames/Poki adapter that is
  // .available only after its init() resolves with a real SDK present (never on our own site / itch).
  // When available, rewarded + commercial + gameplay-bracket calls go to the SDK; otherwise the
  // charm-delay stub behaviour below is used unchanged. This keeps ONE integration surface, needs no
  // ?adprovider wiring or fragile script order, and works for whichever portal actually embeds us.
  function activeSDK() {
    try { return (global.Portal && global.Portal.available) ? global.Portal : null; } catch (e) { return null; }
  }

  var STUB = {
    provider: 'stub',
    // Phase 12b: invocation counters for the three portal lifecycle hooks + commercialBreak, so
    // tests (and curious devs) can confirm game.js actually calls each at the right moment.
    _counts: { loadingFinished: 0, gameplayStart: 0, gameplayStop: 0, commercialBreak: 0 },
    init: function (cb) { setTimeout(function () { if (cb) cb(); }, 0); },
    rewardedAvailable: function () { return todayCount() < DAILY_CAP; },
    showRewarded: function (onReward, onFail) {
      if (todayCount() >= DAILY_CAP) { setTimeout(function () { if (onFail) onFail('cap'); }, 0); return; }
      var sdk = activeSDK();
      if (sdk && typeof sdk.rewardedAd === 'function') {
        // real portal rewarded ad — still honour PortMaster's own daily cap (player-friendly), and
        // only bump the count on an actually-earned reward, never on skip/no-fill/error.
        sdk.rewardedAd(function () { if (todayCount() >= DAILY_CAP) { if (onFail) onFail('cap'); return; } bumpCount(); if (onReward) onReward(); },
                       function () { if (onFail) onFail('skip'); });
        return;
      }
      var delay = fastMode() ? 0 : REWARD_DELAY_MS;
      setTimeout(function () {
        // re-check the cap at resolution time too (in case another tab/claim landed meanwhile)
        if (todayCount() >= DAILY_CAP) { if (onFail) onFail('cap'); return; }
        bumpCount();
        if (onReward) onReward();
      }, delay);
    },
    commercialBreak: function (onDone) {
      STUB._counts.commercialBreak++;
      var sdk = activeSDK();
      if (sdk && typeof sdk.commercialBreak === 'function') { sdk.commercialBreak(function () { if (onDone) onDone(); }); return; }
      setTimeout(function () { if (onDone) onDone(); }, 0);
    },
    // ---- Phase 12b portal lifecycle events (see file header) — count them AND, when a real portal
    // SDK is hosting us, forward the gameplay bracket to it (loading bracket is driven directly from
    // game.js boot via window.Portal, so loadingFinished stays a counter here to avoid double-driving). ----
    loadingFinished: function () { STUB._counts.loadingFinished++; },
    gameplayStart: function () { STUB._counts.gameplayStart++; var sdk = activeSDK(); if (sdk && typeof sdk.gameStart === 'function') sdk.gameStart(); },
    gameplayStop: function () { STUB._counts.gameplayStop++; var sdk = activeSDK(); if (sdk && typeof sdk.gameStop === 'function') sdk.gameStop(); }
  };

  function pickProvider() {
    var id = 'stub';
    try {
      var m = /[?&]adprovider=([a-z0-9_-]+)/i.exec(global.location ? global.location.search : '');
      if (m) id = m[1].toLowerCase();
    } catch (e) {}
    if (id !== 'stub' && global.ADS_PROVIDERS && global.ADS_PROVIDERS[id]) return global.ADS_PROVIDERS[id];
    return STUB;   // unknown/unregistered provider id → safe free fallback, game always has a working ADS
  }

  global.ADS = pickProvider();
})(window);
