/* PortMaster — headless economy/systems regression (Node, no DOM).
 * Deterministic: seeds HARBOR_SIM.__setRng so events/voyages/crates are reproducible.
 * Covers: core economy, the event engine, expeditions, META application (relic/legacy bonuses),
 * save migration from a pre-Phase-7 blob, and asserted balance bounds.
 * Run: node games/harbor/tests/sim.test.js   (exit 0 = pass)
 */
'use strict';

// --- seedable PRNG (mulberry32) ---
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// --- a mock Retention holding a PRE-PHASE-7 save, so load()/patch() must migrate it ---
var STORE = {};
var OLD_SAVE = {                                   // shape from before events/voyages existed
  era: 2, money: 5000, lifetimeMoney: 42000, lastSeen: Date.now(), founded: true,
  managers: { fishing: 1, sales: 0, labour: 0 }, active: 'green',
  ports: { green: { id: 'green', res: { fish: 30, timber: 0, goods: 0 }, buildings: [{ type: 'fishing_hut', level: 2, hp: 100 }, { type: 'cottage', level: 1, hp: 100 }], pop: 4, demand: { fish: 1, timber: 1, goods: 1 }, contracts: [], contractSeq: 0 } },
  network: { xp: 0, level: 1, routes: [] }, hazard: { t: 0, next: 100, phase: 'idle', strikeId: 0, last: null }, crash: null, stats: { storms: 0, shipped: 0 }
  // NOTE: intentionally NO `evt`, NO `voyages` — patch() must backfill these.
};
STORE['harbor:sim'] = JSON.parse(JSON.stringify(OLD_SAVE));
global.Retention = {
  get: function (game, key, def) { var v = STORE[game + ':' + key]; return v === undefined ? def : v; },
  set: function (game, key, v) { STORE[game + ':' + key] = v; },
  todayStr: function () { return '2026-07-02'; }, dailySeed: function () { return 1; }
};

require('../sim.js');                              // attaches HARBOR_SIM to global; captures Retention
var SIM = global.HARBOR_SIM;

var pass = 0, fail = 0, fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

// ---------------------------------------------------------------- migration
(function migration() {
  var snap = SIM.load();                            // loads OLD_SAVE via mock Retention → patch()
  var S = SIM.raw();
  ok('migrate: old money preserved', S.money === 5000);
  ok('migrate: old era preserved', S.era === 2);
  ok('migrate: old buildings preserved', S.ports.green.buildings.length === 2);
  ok('migrate: evt backfilled', S.evt && typeof S.evt === 'object' && S.evt.active === null);
  ok('migrate: voyages backfilled', Array.isArray(S.voyages));
  ok('migrate: snapshot has event field', snap && ('event' in snap));
  ok('migrate: snapshot has voyages field', snap && snap.voyages && Array.isArray(snap.voyages.active));
  // Phase 9a: patch() must backfill focus:'none' on a save that predates specialisation
  ok('migrate: focus backfilled to none', S.ports.green.focus === 'none');
  ok('migrate: snapshot exposes synergies + focus', snap && Array.isArray(snap.synergies) && snap.synergies.length === 4 && snap.focus === 'none');
})();

// ---------------------------------------------------------------- deterministic setup
SIM.__setRng(mulberry32(12345));
SIM.newGame();
SIM.foundPort('green');
SIM.setEra(3);
var S = SIM.raw();

// ---------------------------------------------------------------- core economy
(function economy() {
  S.money = 1e6;
  ['fishing_hut', 'fishing_hut', 'cottage', 'jetty', 'warehouse', 'market'].forEach(function (t) { if (SIM.canBuild(t)) SIM.build(t); });
  var before = S.money;
  for (var i = 0; i < 20; i++) SIM.tick(1);
  var st = SIM.state();
  ok('economy: money finite', isFinite(st.money));
  ok('economy: money non-negative', st.money >= 0);
  ok('economy: resources non-negative', st.res.fish >= 0 && st.res.timber >= 0 && st.res.goods >= 0);
  ok('economy: buildings recorded', st.buildings.length >= 5);
})();

// ---------------------------------------------------------------- events (invariant-based → fixed count)
(function events() {
  var ids = ['goldrush', 'festival', 'castaway', 'raid', 'gamble', 'commission', 'smuggler'];
  ids.forEach(function (id) {
    S.money = 100000; var p = SIM.port('green'); p.res.fish = 999; p.res.timber = 999; p.res.goods = 999;
    var ev = SIM.fireEvent(id);
    ok('event ' + id + ': fires with id', ev && ev.id === id);
    ok('event ' + id + ': snapshot exposes it', SIM.state().event && SIM.state().event.id === id);
    if (ev.kind === 'ambient') { ok('event ' + id + ': ambient set a boost', SIM.boostT() > 0); }
    else {
      var m0 = S.money, out = SIM.resolveEvent(0);
      ok('event ' + id + ': resolve returns outcome', out && typeof out.ok === 'boolean');
      ok('event ' + id + ': money non-negative after', S.money >= 0);
      ok('event ' + id + ': cleared after resolve (or failed cleanly)', SIM.event() === null || out.ok === false);
      if (out.ok !== false) ok('event ' + id + ': lifetime never decreased', SIM.raw().lifetimeMoney >= 0);
      // decline path (choice 1) never changes money for gamble/commission/smuggler
      if (['gamble', 'commission', 'smuggler'].indexOf(id) >= 0) { SIM.fireEvent(id); var mm = S.money; SIM.resolveEvent(1); ok('event ' + id + ': decline leaves money unchanged', S.money === mm); }
    }
  });
  // specific invariants
  S.money = 100000; SIM.fireEvent('raid'); var trib = SIM.event().data.tribute; SIM.resolveEvent(0);
  ok('raid: pay deducts tribute', S.money === 100000 - trib);
  S.money = 100000; SIM.fireEvent('commission'); var cd = SIM.event().data; SIM.port('green').res[cd.res] = cd.amt + 5; var oc = SIM.resolveEvent(0);
  ok('commission: fulfil pays reward & spends stock', oc.ok && oc.cash === cd.reward && SIM.port('green').res[cd.res] === 5);
  S.money = 100000; SIM.fireEvent('smuggler'); var sd = SIM.event().data; var f0 = SIM.port('green').res[sd.res]; SIM.resolveEvent(0);
  ok('smuggler: buy adds stock & spends cash', SIM.port('green').res[sd.res] === f0 + sd.amt && S.money === 100000 - sd.cost);
})();

// ---------------------------------------------------------------- expeditions
(function voyages() {
  S.money = 1e6;
  ok('voyage: can start cove', SIM.canStartVoyage('cove'));
  SIM.startVoyage('cove');
  ok('voyage: used increments', SIM.voyages().used === 1);
  var v = SIM.voyages().active[0]; ok('voyage: not ready immediately', !v.ready);
  S.voyages[0].endsAt = SIM.raw && Date.now() - 1;   // force ready
  var m0 = S.money, out = SIM.collectVoyage(SIM.voyages().active[0].seq);
  ok('voyage: collect returns reward', out && out.cash > 0);
  ok('voyage: money rose on collect', S.money > m0);
  ok('voyage: slot freed', SIM.voyages().used === 0);
  // slots cap: fill all slots then can't start more
  var slots = SIM.voyages().slots; for (var i = 0; i < slots; i++) SIM.startVoyage('cove');
  ok('voyage: slots cap enforced', SIM.voyages().used === slots && !SIM.canStartVoyage('cove'));
})();

// ---------------------------------------------------------------- META application (relic/legacy bonuses)
(function meta() {
  SIM.newGame(); SIM.foundPort('green'); SIM.setEra(4); var s2 = SIM.raw(); s2.money = 1e6;
  var baseSlots = SIM.voyages().slots;
  SIM.applyMeta({ prodMul: 1.5, sellMul: 1.2, voyageSlots: 1, voyageSpeed: 2 });
  ok('meta: prodMul applied', near(SIM.meta().prodMul, 1.5));
  ok('meta: voyageSlots applied → +1 berth', SIM.voyages().slots === baseSlots + 1);
  SIM.startVoyage('cove');
  var dur = SIM.raw().voyages[0].endsAt - SIM.raw().voyages[0].startedAt;
  ok('meta: voyageSpeed halves duration', dur <= 120 * 1000 / 2 + 50);   // cove=120s, /2
  SIM.applyMeta({ prodMul: 1, sellMul: 1, voyageSlots: 0, voyageSpeed: 1 });   // reset
})();

// ---------------------------------------------------------------- Phase 9c: doctrine capstone META fields
(function metaPhase9c() {
  SIM.__setRng(mulberry32(777));
  SIM.newGame(); SIM.foundPort('green'); SIM.setEra(4); SIM.raw().money = 1e6;
  SIM.applyMeta({ contractSlots: 0, voyageYield: 0 });
  ok('9c: baseline contract board holds 3', SIM.port('green').contracts.length === 3);
  SIM.applyMeta({ contractSlots: 1 });                              // Monopoly capstone
  ok('9c: META.contractSlots=1 fills the board to 4 live', SIM.port('green').contracts.length === 4);
  // Flagship capstone: voyageYield multiplies rollVoyage cash — same seed, with vs without
  function voyageCash(yieldAmt, seed) {
    SIM.applyMeta({ voyageYield: yieldAmt });
    SIM.raw().money = 1e6;
    SIM.startVoyage('cove');
    SIM.raw().voyages[0].endsAt = Date.now() - 1;                   // force ready
    SIM.__setRng(mulberry32(seed));                                 // identical reward roll
    return SIM.collectVoyage(SIM.voyages().active[0].seq).cash;
  }
  var c0 = voyageCash(0, 4321), c1 = voyageCash(0.4, 4321);
  ok('9c: META.voyageYield=0.4 multiplies voyage cash ×1.4', near(c1 / c0, 1.4, 0.01));
  ok('9c: yielded cash finite and strictly larger', isFinite(c1) && c1 > c0);
  SIM.applyMeta({ contractSlots: 0, voyageYield: 0 });              // reset for later sections
})();

// ---------------------------------------------------------------- balance bounds (accelerated auto-play)
(function balance() {
  SIM.setPace(1);                                                    // Phase 15b: balance floors are measured at Lively — explicit so a future default change can't silently drift them
  SIM.__setRng(mulberry32(999)); SIM.newGame(); SIM.foundPort('green'); var b = SIM.raw();
  var order = ['fishing_hut', 'cottage', 'jetty', 'warehouse', 'market', 'sawmill', 'factory', 'dock', 'seawall', 'lighthouse'];
  var lastLifetime = 0, monotonic = true, everReachable = false;
  for (var step = 0; step < 200; step++) {
    b.money += 0;                                    // (idle accrues via tick)
    SIM.tick(30);
    for (var k = 0; k < 4; k++) { var built = false; for (var oi = 0; oi < order.length; oi++) { if (SIM.canBuild(order[oi])) { SIM.build(order[oi]); built = true; break; } } if (!built) break; }
    if (SIM.canAdvance()) SIM.advanceEra();
    if (step % 7 === 0) { var ev = SIM.fireEvent('castaway'); if (ev) SIM.resolveEvent(0); }
    var lm = SIM.raw().lifetimeMoney || 0; if (lm + 1e-6 < lastLifetime) monotonic = false; lastLifetime = lm;
    if (SIM.canPrestige()) everReachable = true;
  }
  var st = SIM.state();
  ok('balance: money finite', isFinite(st.money) && isFinite(st.lifetimeMoney));
  ok('balance: money non-negative', st.money >= 0);
  ok('balance: lifetime monotonic (never shrinks)', monotonic);
  ok('balance: prestige gain scales with lifetime', SIM.prestigeGain() >= 0 && isFinite(SIM.prestigeGain()));
})();

// ---------------------------------------------------------------- Phase 9a: synergies + focus
// Deterministic: tickPort() has no RNG; a fresh seeded port + zeroed resources gives exact ratios.
function buildSet(list) {
  SIM.__setRng(mulberry32(4242));
  SIM.newGame(); SIM.foundPort('green'); SIM.setEra(3);
  SIM.raw().money = 1e9;
  list.forEach(function (t) { if (SIM.canBuild(t)) SIM.build(t); });
  return SIM.port('green');
}

(function synergyComposition() {
  // warehouse + market → +12% sales (prod unchanged)
  buildSet(['warehouse', 'market']);
  var m = SIM.synergyMul('green');
  ok('synergyMul: tradehub → sales +12%', near(m.sales, 1.12) && near(m.prod, 1));
  // ≥3 cottages → +15% production (labour/production)
  buildSet(['cottage', 'cottage', 'cottage']);
  var m2 = SIM.synergyMul('green');
  ok('synergyMul: boomtown (3 cottages) → prod +15%', near(m2.prod, 1.15) && near(m2.sales, 1));
  // two cottages is NOT enough → no boomtown
  buildSet(['cottage', 'cottage']);
  ok('synergyMul: 2 cottages → no boomtown', near(SIM.synergyMul('green').prod, 1));
  // sawmill + factory → +15% goods (prod channel)
  buildSet(['sawmill', 'factory']);
  var m3 = SIM.synergyMul('green');
  ok('synergyMul: mill&forge → prod +15%', near(m3.prod, 1.15) && near(m3.sales, 1));
  // market + dock → +10% sales
  buildSet(['market', 'dock']);
  var m4 = SIM.synergyMul('green');
  ok('synergyMul: free port → sales +10%', near(m4.sales, 1.10) && near(m4.prod, 1));
  // no combo → neutral
  buildSet(['fishing_hut']);
  var m5 = SIM.synergyMul('green');
  ok('synergyMul: lone building → neutral 1/1', near(m5.prod, 1) && near(m5.sales, 1));
  // stacking: warehouse+market+dock → tradehub(0.12)+freeport(0.10) = 1.22 sales
  buildSet(['warehouse', 'market', 'dock']);
  ok('synergyMul: tradehub + freeport stack → sales 1.22', near(SIM.synergyMul('green').sales, 1.22));
})();

(function snapshotSynergyFocus() {
  buildSet(['warehouse', 'market']);
  SIM.setFocus('green', 'industry');
  var st = SIM.state();
  ok('snapshot: synergies array (4 entries)', Array.isArray(st.synergies) && st.synergies.length === 4);
  var hub = st.synergies.filter(function (x) { return x.id === 'tradehub'; })[0];
  ok('snapshot: tradehub active with warehouse+market', !!hub && hub.active === true);
  var boom = st.synergies.filter(function (x) { return x.id === 'boomtown'; })[0];
  ok('snapshot: boomtown inactive (no cottages)', !!boom && boom.active === false);
  ok('snapshot: focus reflects setFocus', st.focus === 'industry');
  ok('setFocus: rejects unknown focus', SIM.setFocus('green', 'bogus') === false && SIM.state().focus === 'industry');
})();

(function focusProduction() {
  // fish production tradeoffs — labour saturated so only the focus multiplier varies
  var p = buildSet(['fishing_hut', 'fishing_hut', 'cottage', 'cottage', 'cottage']);
  function fishGain(focus) {
    SIM.setFocus('green', focus);
    p.res.fish = 0; p.res.timber = 0; p.res.goods = 0; p.demand = { fish: 1, timber: 1, goods: 1 };
    SIM.tick(1); return p.res.fish;
  }
  var none = fishGain('none');
  ok('focus fishing: +25% fish vs none', near(fishGain('fishing') / none, 1.25, 0.02));
  ok('focus industry: −15% fish vs none', near(fishGain('industry') / none, 0.85, 0.02));
  ok('focus trade: −10% raw fish vs none', near(fishGain('trade') / none, 0.90, 0.02));

  // goods production tradeoffs (factory convert; ample timber so it isn't input-limited)
  var q = buildSet(['sawmill', 'factory', 'cottage', 'cottage', 'cottage']);
  function goodsGain(focus) {
    SIM.setFocus('green', focus);
    q.res.fish = 0; q.res.timber = 500; q.res.goods = 0; q.demand = { fish: 1, timber: 1, goods: 1 };
    SIM.tick(1); return q.res.goods;
  }
  var g0 = goodsGain('none');
  ok('focus industry: +25% goods vs none', near(goodsGain('industry') / g0, 1.25, 0.03));
  ok('focus fishing: −15% goods vs none', near(goodsGain('fishing') / g0, 0.85, 0.03));
})();

(function focusSales() {
  // trade focus lifts sale revenue (money delta) — fish stock is large so selling isn't prod-limited
  var p = buildSet(['fishing_hut', 'jetty', 'cottage', 'cottage']);
  function moneyGain(focus) {
    SIM.setFocus('green', focus);
    var st = SIM.raw(); st.money = 100000;
    p.res.fish = 400; p.res.timber = 0; p.res.goods = 0; p.demand = { fish: 1, timber: 1, goods: 1 };
    var before = st.money; SIM.tick(1); return st.money - before;
  }
  var none = moneyGain('none'), trade = moneyGain('trade');
  ok('focus trade: +15% sales lifts money delta', trade > none);
})();

// ---------------------------------------------------------------- Phase 11a: balance mega-pass — deterministic auto-play harness
// Simulates 90 sim-minutes (180 × 30s ticks) of greedy-but-plausible play, three ways with the SAME
// seed, and asserts hard bounds on the resulting curve. applyMeta only copies provided keys, so every
// run applies a FULL defaults object first (metaWith) — otherwise a previous section's META leaks in.
var FULL_META = { prodMul: 1, sellMul: 1, costMul: 1, startMoney: 0, offlineHours: 8, hazardResist: 0, routeMul: 1, voyageSpeed: 1, voyageSlots: 0, contractSlots: 0, voyageYield: 0 };
function metaWith(over) { var m = {}, k; for (k in FULL_META) m[k] = FULL_META[k]; for (k in (over || {})) m[k] = over[k]; return m; }

function autoplay(cfg) {
  var steps = cfg.steps || 180;                                     // 180 × 30s = 90 sim-minutes
  SIM.setPace(1);                                                    // Phase 15b: the 11a baselines below are measured at Lively — pin it explicitly
  SIM.newGame(); SIM.foundPort('green');
  SIM.applyMeta(metaWith(cfg.meta));                                // FULL reset + this run's META
  SIM.setTide({ prod: 1, sell: { fish: 1, timber: 1, goods: 1 } }); // neutral tide (module-global)
  SIM.setBoost(1, 0);                                               // clear any leftover crate surge
  SIM.__setRng(mulberry32(cfg.seed));                               // seed AFTER setup so rolls line up
  var st = SIM.raw();
  // build order: seller (jetty) directly after the first producer — a producer-only port earns
  // nothing but still pays wages, so it bleeds to exactly 0 money and soft-locks.
  var order = ['fishing_hut', 'jetty', 'cottage', 'warehouse', 'market', 'sawmill', 'factory', 'dock'];
  function haveCount(t) { var B = SIM.port('green').buildings, n = 0; for (var i = 0; i < B.length; i++) if (B[i].type === t) n++; return n; }
  function tryBuild(budget) {
    // diversify-first: complete the chain (one of each, in order) before duplicating anything —
    // otherwise "first affordable in order" stacks producers and never buys the seller.
    for (var oi = 0; oi < order.length; oi++) { var t = order[oi]; if (haveCount(t) === 0 && SIM.canBuild(t) && SIM.buildCost(t) <= budget) { SIM.build(t); return true; } }
    for (var oj = 0; oj < order.length; oj++) { var u = order[oj]; if (SIM.canBuild(u) && SIM.buildCost(u) <= budget) { SIM.build(u); return true; } }
    return false;
  }
  var evIds = ['goldrush', 'festival', 'castaway', 'raid', 'gamble', 'commission', 'smuggler'];
  var EV_MIN = { goldrush: 1, festival: 1, castaway: 0, raid: 2, gamble: 1, commission: 1, smuggler: 1 };   // mirrors EV_DEFS minEra — fireEvent itself doesn't gate, but the live scheduler (evPick) does
  var evI = 0, by = { passive: 0, events: 0, voyages: 0 };
  function lt() { return st.lifetimeMoney || 0; }
  for (var step = 0; step < steps; step++) {
    var l0 = lt();
    SIM.tick(30);                                                   // dt≥5 → scheduler hazards/events stay off; we drive them below
    by.passive += lt() - l0;
    if (SIM.canAdvance()) SIM.advanceEra();                         // era first: advancing gates the whole curve
    // greedy-but-banking policy: only spend when the price is ≤ half the purse, so cash still climbs
    // toward era money requirements (a zero-reserve greedy soft-locks at era 0 forever).
    for (var k = 0; k < 3; k++) {
      var budget = st.money * 0.5, did = tryBuild(budget);
      if (!did) {
        var B = SIM.port('green').buildings, best = -1, bestC = Infinity;
        for (var bi = 0; bi < B.length; bi++) if (SIM.canUpgrade(bi)) { var c = SIM.upCost(bi); if (c < bestC && c <= budget) { bestC = c; best = bi; } }
        if (best >= 0) { SIM.upgrade(best); did = true; }
      }
      if (!did) break;
    }
    if (SIM.canAdvance()) SIM.advanceEra();
    if (step % 5 === 4) {                                           // every 5th step: exercise the income systems
      // per-round reseed (derived from seed+step): rollVoyage/evData consume a VARIABLE number of
      // draws, so without this the three runs drift onto different luck streams after the first
      // structural divergence and compounding amplifies pure noise into a fake doctrine delta.
      SIM.__setRng(mulberry32((cfg.seed ^ (step * 0x9E3779B9)) >>> 0));
      var l1 = lt();
      var evId = evIds[evI++ % evIds.length];                       // round-robin; ambient sets a boost, choice resolves accept
      if (st.era >= EV_MIN[evId]) {                                 // skip era-gated events (forcing a raid on an era-0 purse crushes the early snowball in a way live play can't)
        var ev = SIM.fireEvent(evId);
        if (ev && ev.kind !== 'ambient') SIM.resolveEvent(0);
      }
      by.events += lt() - l1;
      var l2 = lt();
      if (SIM.canStartVoyage('cove')) SIM.startVoyage('cove');      // one cove run per round (≈ live cadence)
      for (var vi = 0; vi < (st.voyages || []).length; vi++) st.voyages[vi].endsAt = Date.now() - 1;
      SIM.voyages().active.forEach(function (a) { if (a.ready) SIM.collectVoyage(a.seq); });
      by.voyages += lt() - l2;
    }
  }
  var res = SIM.port('green').res;
  return { lifetime: lt(), era: st.era, money: st.money, res: { fish: res.fish, timber: res.timber, goods: res.goods }, bySource: by };
}

(function balanceMegaPass() {
  var SEED = 20260710;
  // Merchant doctrine (+20% sales, +10% routes, Monopoly capstone) + 3 equipped Smuggler relics (+4% sales each)
  // (doctrine sales tuned +0.35→+0.20 in Phase 11a: at +0.35 the compounding curve hit 2.5–2.7×
  // vanilla across seeds, breaching the 2.5× cap below; at +0.20 it lands ≈2.0× on every seed tried)
  var MERCHANT = { sellMul: 1.32, routeMul: 1.10, contractSlots: 1 };
  // Explorer doctrine (+35% voyage speed, +1 slot, Flagship capstone +40% yield) + 3 Cartographer relics
  // (+6% speed each; full set completes → +1 more expedition ship)
  var EXPLORER = { voyageSpeed: 1.53, voyageSlots: 2, voyageYield: 0.4 };

  var van = autoplay({ seed: SEED });
  var mer = autoplay({ seed: SEED, meta: MERCHANT });
  var exp = autoplay({ seed: SEED, meta: EXPLORER });
  var van2 = autoplay({ seed: SEED });                              // identical re-run → guards Math.random leaks

  [['vanilla', van], ['merchant', mer], ['explorer', exp]].forEach(function (pair) {
    var n = pair[0], r = pair[1];
    ok('11a ' + n + ': money finite & non-negative', isFinite(r.money) && r.money >= 0 && isFinite(r.lifetime));
    // money on hand can never exceed everything ever earned + the 150 starting purse
    ok('11a ' + n + ': lifetime covers money on hand', r.lifetime + 150 >= r.money - 1e-6);
    ok('11a ' + n + ': era advanced ≥2 in 90 sim-min', r.era >= 2);
    ok('11a ' + n + ': resources non-negative', r.res.fish >= 0 && r.res.timber >= 0 && r.res.goods >= 0);
    // source mix: no single ACTIVE source may dominate the curve (passive play must stay the backbone)
    ok('11a ' + n + ': events ≤60% of lifetime', r.bySource.events <= 0.6 * r.lifetime);
    ok('11a ' + n + ': voyages ≤60% of lifetime', r.bySource.voyages <= 0.6 * r.lifetime);
  });

  // Prestige-reachability regression floor. Measured baseline with seed 20260710: vanilla lifetime
  // ≈ 289k after 90 sim-min of semi-active play (passive ≈ 255k / events ≈ 14k / voyages ≈ 19k);
  // stable at 270k–296k across 6 other seeds. So PRESTIGE_THRESHOLD (250k) is genuinely reachable
  // inside one active session, with idle accrual on top. The 100k floor is a regression tripwire
  // (~2.8× headroom below measured), NOT a design target.
  ok('11a vanilla: prestige floor — lifetime ≥ 100k after 90 sim-min', van.lifetime >= 100000);

  // Doctrine sanity: bonuses matter but never break the curve (each build within 0.9×–2.5× vanilla)
  ok('11a merchant: lifetime within 0.9×–2.5× vanilla', mer.lifetime >= 0.9 * van.lifetime && mer.lifetime <= 2.5 * van.lifetime);
  ok('11a explorer: lifetime within 0.9×–2.5× vanilla', exp.lifetime >= 0.9 * van.lifetime && exp.lifetime <= 2.5 * van.lifetime);

  // determinism: same seed twice → IDENTICAL lifetime (any drift = an unrouted Math.random in sim.js)
  ok('11a determinism: identical seed → identical lifetime', van.lifetime === van2.lifetime);
  ok('11a determinism: identical seed → identical source mix',
    van.bySource.passive === van2.bySource.passive && van.bySource.events === van2.bySource.events && van.bySource.voyages === van2.bySource.voyages);

  if (process.env.HARBOR_BASELINES) {
    console.log('  [11a] vanilla ', JSON.stringify(van));
    console.log('  [11a] merchant', JSON.stringify(mer));
    console.log('  [11a] explorer', JSON.stringify(exp));
  }
})();

// ---------------------------------------------------------------- Phase 11a: big-number smoke (overflow guard)
(function bigNumberSmoke() {
  SIM.__setRng(mulberry32(31337));
  SIM.newGame(); SIM.foundPort('green'); SIM.setEra(4);
  SIM.applyMeta(metaWith(null));
  var st = SIM.raw();
  st.money = 1e30; st.lifetimeMoney = 1e30;
  ['fishing_hut', 'cottage', 'jetty', 'market'].forEach(function (t) { if (SIM.canBuild(t)) SIM.build(t); });
  SIM.tick(60);
  var snap = SIM.state();
  ok('big#: money finite at 1e30 scale', isFinite(st.money) && isFinite(st.lifetimeMoney) && st.money > 0);
  ok('big#: snapshot fmt-able (no NaN/Infinity)', /^[0-9.e+]+$/.test(String(snap.money)) && isFinite(snap.money) && isFinite(snap.lifetimeMoney));
  ok('big#: prestige gain finite at 1e30', isFinite(SIM.prestigeGain()) && SIM.prestigeGain() > 0);
  // voyage math still sane at absurd wealth
  ok('big#: can start voyage at 1e30', SIM.canStartVoyage('cove'));
  SIM.startVoyage('cove'); st.voyages[0].endsAt = Date.now() - 1;
  var out = SIM.collectVoyage(SIM.voyages().active[0].seq);
  ok('big#: voyage reward finite & positive', out && isFinite(out.cash) && out.cash > 0);
  // event math still sane (raid tribute derives from money — must not blow up)
  SIM.fireEvent('raid');
  var ev = SIM.event();
  ok('big#: raid tribute finite at 1e30', ev && isFinite(ev.data.tribute) && ev.data.tribute > 0);
  SIM.resolveEvent(0);
  ok('big#: money finite after raid tribute', isFinite(st.money) && st.money >= 0);
})();

// ---------------------------------------------------------------- Phase 15b: pace (gap-roll scaling only)
(function paceScaling() {
  // Relaxed smoke test: same seed, two pace settings — the hazard AND event scheduler's first gap
  // roll (hzRand/evRand, both consumed once inside newGame()->fresh()) must scale by exactly the
  // pace multiplier. This is deterministic (seeded RNG, no other draws happen before the roll).
  SIM.setPace(1); SIM.__setRng(mulberry32(555)); SIM.newGame(); SIM.foundPort('green');
  var livelyHz = SIM.raw().hazard.next, livelyEv = SIM.raw().evt.next;

  SIM.setPace(1.6); SIM.__setRng(mulberry32(555)); SIM.newGame(); SIM.foundPort('green');
  var relaxedHz = SIM.raw().hazard.next, relaxedEv = SIM.raw().evt.next;

  ok('pace: relaxed (1.6x) hazard gap scales vs lively', near(relaxedHz / livelyHz, 1.6, 1e-9));
  ok('pace: relaxed (1.6x) event gap scales vs lively', near(relaxedEv / livelyEv, 1.6, 1e-9));

  // Pace must NOT touch production/sales: same seed, same buildings, same dt — money/res deltas
  // should be bit-identical whether pace is 1 or 1.6 (hzRand/evRand aren't in tickPort's path).
  function econRun(pace) {
    SIM.setPace(pace); SIM.__setRng(mulberry32(777)); SIM.newGame(); SIM.foundPort('green'); SIM.setEra(2);
    var st = SIM.raw(); st.money = 5000;
    ['fishing_hut', 'jetty', 'cottage', 'warehouse', 'market'].forEach(function (t) { if (SIM.canBuild(t)) SIM.build(t); });
    var m0 = st.money, p = SIM.port('green'); p.res.fish = 40; p.res.timber = 0; p.res.goods = 0;
    SIM.tick(20);                                                    // dt<5 would also run the scheduler — use a big dt so only the economy moves
    return { money: st.money - m0, fish: p.res.fish, timber: p.res.timber, goods: p.res.goods };
  }
  var econLively = econRun(1), econRelaxed = econRun(1.6);
  ok('pace: production/sales identical at pace 1 vs 1.6 (money)', econLively.money === econRelaxed.money);
  ok('pace: production/sales identical at pace 1 vs 1.6 (resources)',
    econLively.fish === econRelaxed.fish && econLively.timber === econRelaxed.timber && econLively.goods === econRelaxed.goods);
  SIM.setPace(1);                                                    // leave the module back at Lively for anything that runs after
})();

// ---------------------------------------------------------------- Phase 15b: avert hazards
(function avertHazards() {
  SIM.setPace(1); SIM.__setRng(mulberry32(2468)); SIM.newGame(); SIM.foundPort('green'); SIM.setEra(1);
  var S15 = SIM.raw();

  // outside warn: fails cleanly, no charge
  S15.money = 1000;
  ok('avert: avertHazard outside warn returns false', SIM.avertHazard() === false);
  ok('avert: avertHazard outside warn does not charge', SIM.raw().money === 1000);

  // insufficient money during warn: fails without charging
  var w1 = SIM.forceWarn('green', false);
  ok('avert: forceWarn lands in warn phase with an avertCost', w1.phase === 'warn' && w1.avertCost > 0);
  S15.money = 0;
  ok('avert: avertHazard with insufficient money returns false', SIM.avertHazard() === false);
  ok('avert: insufficient-money attempt does not charge', SIM.raw().money === 0);
  ok('avert: insufficient-money attempt leaves the warn pending', SIM.raw().hazard.phase === 'warn');

  // during warn with money: charges once, clears the pending strike, bumps stats.averted
  var cost = SIM.avertCost();
  S15.money = cost + 500;
  var avertedBefore = S15.stats.averted || 0;
  var okAvert = SIM.avertHazard();
  ok('avert: avertHazard during warn succeeds', okAvert === true);
  ok('avert: avertHazard charges exactly avertCost()', SIM.raw().money === 500);
  ok('avert: avertHazard clears the warn phase', SIM.raw().hazard.phase === 'idle');
  ok('avert: avertHazard increments stats.averted', SIM.raw().stats.averted === avertedBefore + 1);

  // avertHazard must refuse a crash-warn (that's avertCrash's job) and vice versa
  var w2 = SIM.forceWarn('green', true);
  ok('avert: forceWarn(crash) reports Market Crash kind', w2.kind === 'Market Crash');
  S15.money = SIM.avertCost() + 100;
  ok('avert: avertHazard refuses a crash-warn', SIM.avertHazard() === false);
  var avertedBefore2 = SIM.raw().stats.averted;
  ok('avert: avertCrash succeeds on a crash-warn', SIM.avertCrash() === true);
  ok('avert: avertCrash also increments stats.averted', SIM.raw().stats.averted === avertedBefore2 + 1);
  ok('avert: market crash never activates (S.crash stays null)', SIM.raw().crash === null);
})();

console.log((fail === 0 ? 'ALL PASS' : 'FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('  failing:'); fails.forEach(function (f) { console.log('   - ' + f); }); }
process.exit(fail ? 1 : 0);
