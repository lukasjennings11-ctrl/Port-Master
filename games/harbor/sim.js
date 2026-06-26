/* HARBOR — render-agnostic economy simulation. window.HARBOR_SIM
 * No WebGL/DOM here so it runs headlessly (Node tests) and the renderer just reads state.
 * Core loop: production buildings make resources (limited by storage caps + labour from housing);
 * selling buildings convert resources -> money; money builds & upgrades more; reaching thresholds
 * advances the era (Fishing Village -> ... -> Global Hub). Persists + accrues offline via Retention.
 */
(function (g) {
  'use strict';
  var R = g.Retention || null;

  // ---- era ladder ----
  var ERAS = ['Fishing Village', 'Trading Post', 'Industrial Port', 'Metropolis', 'Megaport', 'Global Hub'];

  // ---- building catalogue (data-driven) ----
  // prod: {res:rate/s}; sells:{from,rate/s,price}; money:rate/s (direct trade); cap:{res:amount};
  // pop: housing added; jobs: workers needed; era: min era to build; cost/costMul: build price growth;
  // lvlCost: upgrade price growth; lvlGain: per-level output multiplier.
  var BT = {
    fishing_hut: { name: 'Fishing Hut', era: 0, cost: 25, costMul: 1.5, jobs: 2, cat: 'prod', prod: { fish: 0.5 }, lvlCost: 1.58, lvlGain: 1.38, max: 12 },
    jetty:       { name: 'Fishing Jetty', era: 0, cost: 60, costMul: 1.5, jobs: 1, cat: 'sales', sells: { from: 'fish', rate: 0.9, price: 3 }, lvlCost: 1.62, lvlGain: 1.36, max: 12 },
    cottage:     { name: 'Cottage', era: 0, cost: 40, costMul: 1.46, pop: 4, lvlCost: 1.55, lvlGain: 1.35, max: 24 },
    warehouse:   { name: 'Warehouse', era: 1, cost: 120, costMul: 1.55, cap: { fish: 90, timber: 90, goods: 90 }, lvlCost: 1.62, lvlGain: 1.42, max: 12 },
    market:      { name: 'Fish Market', era: 1, cost: 160, costMul: 1.55, jobs: 3, cat: 'sales', sells: { from: 'fish', rate: 1.6, price: 4.5 }, lvlCost: 1.64, lvlGain: 1.38, max: 12 },
    sawmill:     { name: 'Sawmill', era: 2, cost: 320, costMul: 1.55, jobs: 4, cat: 'prod', prod: { timber: 0.8 }, lvlCost: 1.66, lvlGain: 1.4, max: 12 },
    factory:     { name: 'Goods Factory', era: 2, cost: 520, costMul: 1.58, jobs: 6, cat: 'prod', convert: { from: 'timber', to: 'goods', rate: 0.7 }, lvlCost: 1.68, lvlGain: 1.4, max: 12 },
    dock:        { name: 'Cargo Dock', era: 2, cost: 800, costMul: 1.6, jobs: 5, cat: 'sales', sells: { from: 'goods', rate: 0.7, price: 22 }, lvlCost: 1.7, lvlGain: 1.42, max: 12 }
  };
  var BASE_CAP = { fish: 80, timber: 80, goods: 80 };
  // managers: permanent multipliers bought with money (a real spend sink + build-defining choice)
  var MANAGERS = {
    fishing: { name: 'Master Angler', desc: '+18% all production', cost: 200, costMul: 1.85, per: 0.18, max: 10 },
    sales:   { name: 'Harbourmaster', desc: '+16% all sales', cost: 240, costMul: 1.9, per: 0.16, max: 10 },
    labour:  { name: 'Foreman', desc: '+15% labour, −10% wages', cost: 220, costMul: 1.88, per: 0.15, max: 10 }
  };
  var WAGE = 0.10, DEMAND_SOFT = 14;   // wage/worker/s; sales/s above which demand price softens

  // era advance requirements: money on hand OR cumulative + minimum building counts
  var ERA_REQ = [
    { money: 250, need: { fishing_hut: 2, cottage: 1 } },           // -> Trading Post
    { money: 1500, need: { jetty: 1, cottage: 2 } },                // -> Industrial Port
    { money: 8000, need: { warehouse: 1, market: 1 } },             // -> Metropolis
    { money: 40000, need: { factory: 1, dock: 1 } },                // -> Megaport
    { money: 200000, need: { dock: 2 } }                            // -> Global Hub
  ];

  var S = null;
  function now() { return Date.now ? Date.now() : 0; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function fresh() {
    return {
      era: 0, money: 120, res: { fish: 0, timber: 0, goods: 0 }, buildings: [], pop: 0,
      managers: { fishing: 0, sales: 0, labour: 0 },
      demand: { fish: 1, timber: 1, goods: 1 },
      contracts: [], contractSeq: 0,
      lifetimeMoney: 0, lastSeen: now(), founded: false
    };
  }
  // migrate older saves that predate managers/demand/lifetime/contract fields
  function patch() {
    if (!S) return;
    if (!S.managers) S.managers = { fishing: 0, sales: 0, labour: 0 };
    if (!S.demand) S.demand = { fish: 1, timber: 1, goods: 1 };
    if (typeof S.lifetimeMoney !== 'number') S.lifetimeMoney = 0;
    if (!S.contracts) S.contracts = [];
    if (typeof S.contractSeq !== 'number') S.contractSeq = 0;
    ensureContracts();
  }

  function counts() { var c = {}; for (var i = 0; i < S.buildings.length; i++) { var t = S.buildings[i].type; c[t] = (c[t] || 0) + 1; } return c; }
  function countOf(type) { var n = 0; for (var i = 0; i < S.buildings.length; i++) if (S.buildings[i].type === type) n++; return n; }
  function caps() {
    var cap = { fish: BASE_CAP.fish, timber: BASE_CAP.timber, goods: BASE_CAP.goods };
    for (var i = 0; i < S.buildings.length; i++) { var b = S.buildings[i], t = BT[b.type]; if (t.cap) for (var r in t.cap) cap[r] += t.cap[r] * lvlMul(t, b.level); }
    return cap;
  }
  function pop() { var p = 0; for (var i = 0; i < S.buildings.length; i++) { var b = S.buildings[i], t = BT[b.type]; if (t.pop) p += t.pop * lvlMul(t, b.level); } return p; }
  // jobs scale with level (bigger buildings need more crew) — keeps housing meaningful late game
  function jobs() { var j = 0; for (var i = 0; i < S.buildings.length; i++) { var b = S.buildings[i], t = BT[b.type]; if (t.jobs) j += t.jobs * (1 + 0.5 * ((b.level || 1) - 1)); } return j; }
  function lvlMul(t, lvl) { return Math.pow(t.lvlGain, (lvl || 1) - 1); }
  function buildCost(type) { var t = BT[type]; return Math.round(t.cost * Math.pow(t.costMul, countOf(type))); }
  function upCost(b) { var t = BT[b.type]; return Math.round(t.cost * 0.6 * Math.pow(t.lvlCost, b.level)); }

  // ---- managers (permanent multiplier upgrades; a real money sink) ----
  function managerCost(kind) { var m = MANAGERS[kind]; if (!m) return Infinity; return Math.round(m.cost * Math.pow(m.costMul, (S.managers[kind] || 0))); }
  function canBuyManager(kind) { var m = MANAGERS[kind]; return !!m && (S.managers[kind] || 0) < m.max && S.money >= managerCost(kind); }
  function buyManager(kind) { if (!canBuyManager(kind)) return false; S.money -= managerCost(kind); S.managers[kind] = (S.managers[kind] || 0) + 1; save(); return true; }
  function mgrMul(kind) { var m = MANAGERS[kind]; return 1 + m.per * (S.managers[kind] || 0); }

  // ---- contracts (standing orders: deliver a stockpile for a premium lump sum) ----
  // Orders reward holding inventory and pay ABOVE the demand-softened passive price,
  // giving an active goal between builds. Always ~3 open; fulfilling rolls a fresh one.
  var ORDER_LABELS = ['Royal Galley', 'Spice Merchant', 'Naval Quartermaster', 'Coastal Guild', 'Foreign Envoy', 'Cannery Co.', 'Harbour Exchange', 'Northern Traders'];
  function basePrice(res) { for (var k in BT) { var t = BT[k]; if (t.sells && t.sells.from === res) return t.sells.price; } return 5; }
  function genContract() {
    var pool = ['fish']; if (S.era >= 2) { pool.push('timber', 'goods'); } if (S.era >= 1) pool.push('fish');
    var seq = (S.contractSeq = (S.contractSeq || 0) + 1);
    var res = pool[(seq * 1) % pool.length];
    var base = res === 'goods' ? 24 : 70;
    var amt = Math.round(base * (1 + S.era * 0.55) * (0.8 + ((seq * 7) % 5) * 0.12));
    var premium = 1.7 + ((seq * 3) % 4) * 0.15;                      // 1.7x .. 2.15x passive price
    var reward = Math.round(amt * basePrice(res) * premium);
    var who = ORDER_LABELS[(seq * 5) % ORDER_LABELS.length];
    return { id: 'c' + seq, who: who, res: res, amt: amt, reward: reward };
  }
  function ensureContracts() { if (!S.contracts) S.contracts = []; var guard = 0; while (S.contracts.length < 3 && guard++ < 20) S.contracts.push(genContract()); }
  function findContract(id) { for (var i = 0; i < (S.contracts || []).length; i++) if (S.contracts[i].id === id) return i; return -1; }
  function canFulfill(id) { var i = findContract(id); return i >= 0 && S.res[S.contracts[i].res] >= S.contracts[i].amt; }
  function fulfillContract(id) {
    if (!canFulfill(id)) return 0;
    var i = findContract(id), c = S.contracts[i];
    S.res[c.res] = Math.max(0, S.res[c.res] - c.amt);
    S.money += c.reward; S.lifetimeMoney = (S.lifetimeMoney || 0) + c.reward;
    S.contracts.splice(i, 1); ensureContracts(); save();
    return c.reward;
  }
  function rerollContract(id) { var i = findContract(id); if (i < 0) return false; S.contracts.splice(i, 1); ensureContracts(); save(); return true; }

  // ---- core tick ----
  function tick(dt) {
    if (!S || dt <= 0) return;
    dt = Math.min(dt, 36000);                                       // safety clamp (10h max chunk)
    patch();
    var cap = caps(), p = pop(), j = jobs();
    // labour: housing feeds crew. Foreman manager makes the same crew go further.
    var labor = j > 0 ? clamp(p / j, 0, 1) : 1;
    labor = Math.min(1.25, labor * mgrMul('labour'));
    var prodMul = mgrMul('fishing'), salesMul = mgrMul('sales');
    // soft-cap taper: production slows as a store fills (1.0 empty -> 0.35 full) so caps bite gently
    var taper = {};
    for (var r0 in cap) taper[r0] = 1 - 0.65 * clamp((S.res[r0] || 0) / cap[r0], 0, 1);
    var add = { fish: 0, timber: 0, goods: 0 }, money = 0;
    var soldR = { fish: 0, timber: 0, goods: 0 }, revR = { fish: 0, timber: 0, goods: 0 };
    for (var i = 0; i < S.buildings.length; i++) {
      var b = S.buildings[i], t = BT[b.type], m = lvlMul(t, b.level);
      if (t.prod) for (var r in t.prod) add[r] += t.prod[r] * m * labor * prodMul * taper[r] * dt;
      if (t.convert) { var avail = S.res[t.convert.from] + add[t.convert.from]; var amt = Math.min(avail, t.convert.rate * m * labor * prodMul * taper[t.convert.to] * dt); add[t.convert.from] -= amt; add[t.convert.to] += amt; }
      if (t.sells) { var f = t.sells.from, have = S.res[f] + add[f]; var sold = Math.min(have, t.sells.rate * m * labor * dt); add[f] -= sold; soldR[f] += sold; revR[f] += sold * t.sells.price; }
      if (t.money) money += t.money * m * labor * salesMul * dt;
    }
    // dynamic demand: dumping one resource softens its price (target = DEMAND_SOFT/(DEMAND_SOFT+rate)),
    // demand eases toward that target (recovers toward 1 when you sell less). Rewards diversifying.
    var ease = 1 - Math.exp(-dt / 60);
    for (var s in soldR) {
      var rate = soldR[s] / dt;
      var target = DEMAND_SOFT / (DEMAND_SOFT + rate);
      S.demand[s] = clamp((S.demand[s] || 1) + (target - (S.demand[s] || 1)) * ease, 0.25, 1);
      money += revR[s] * S.demand[s] * salesMul;   // revenue weighted by current demand + sales manager
    }
    // wages: every working crew costs money/s; Foreman trims the bill
    var wage = WAGE * Math.min(p, j) * dt * Math.max(0.2, 1 - 0.10 * (S.managers.labour || 0));
    money -= wage;
    for (var k in add) { S.res[k] = clamp((S.res[k] + add[k]) || 0, 0, cap[k]); }
    if (money > 0) S.lifetimeMoney = (S.lifetimeMoney || 0) + money;
    S.money = Math.max(0, (S.money + money) || 0);
    S.pop = p;
  }

  // ---- actions ----
  function canBuild(type) { var t = BT[type]; return !!t && S.era >= t.era && countOf(type) < t.max && S.money >= buildCost(type); }
  function build(type) { if (!canBuild(type)) return false; S.money -= buildCost(type); S.buildings.push({ type: type, level: 1 }); save(); return true; }
  function canUpgrade(i) { var b = S.buildings[i]; return !!b && b.level < BT[b.type].max && S.money >= upCost(b); }
  function upgrade(i) { if (!canUpgrade(i)) return false; var b = S.buildings[i]; S.money -= upCost(b); b.level++; save(); return true; }

  function canAdvance() {
    if (S.era >= ERAS.length - 1) return false;
    var req = ERA_REQ[S.era]; if (!req) return false;
    if (S.money < req.money) return false;
    if (req.need) { var c = counts(); for (var k in req.need) if ((c[k] || 0) < req.need[k]) return false; }
    return true;
  }
  function advanceEra() { if (!canAdvance()) return false; S.era++; save(); return true; }

  // ---- persistence + offline ----
  function key() { return 'sim'; }
  function save() { if (R) R.set('harbor', key(), S); }
  function load() {
    var d = R && R.get('harbor', key(), null);
    if (d && d.buildings) { S = d; if (!S.res) S.res = { fish: 0, timber: 0, goods: 0 }; patch(); }
    else S = fresh();
    return S;
  }
  function applyOffline(maxSec) {
    if (!S) return 0;
    var elapsed = (now() - (S.lastSeen || now())) / 1000;
    elapsed = clamp(elapsed, 0, maxSec || 8 * 3600);
    if (elapsed > 1) tick(elapsed);
    S.lastSeen = now();
    return elapsed;
  }

  function managerView() {
    var out = {};
    for (var k in MANAGERS) { var m = MANAGERS[k]; out[k] = { name: m.name, desc: m.desc, lvl: (S.managers[k] || 0), max: m.max, cost: managerCost(k), can: canBuyManager(k) }; }
    return out;
  }
  function snapshot() {
    return {
      era: S.era, eraName: ERAS[S.era], money: Math.floor(S.money),
      res: { fish: Math.floor(S.res.fish), timber: Math.floor(S.res.timber), goods: Math.floor(S.res.goods) },
      caps: caps(), pop: Math.floor(pop()), jobs: jobs(),
      buildings: S.buildings.map(function (b, i) { return { i: i, type: b.type, name: BT[b.type].name, level: b.level, up: upCost(b) }; }),
      counts: counts(), canAdvance: canAdvance(), nextEra: ERAS[S.era + 1] || null, founded: S.founded,
      managers: managerView(), demand: { fish: S.demand.fish, timber: S.demand.timber, goods: S.demand.goods },
      lifetimeMoney: Math.floor(S.lifetimeMoney || 0),
      contracts: (S.contracts || []).map(function (c) { return { id: c.id, who: c.who, res: c.res, amt: c.amt, reward: c.reward, have: Math.floor(S.res[c.res] || 0), can: canFulfill(c.id) }; })
    };
  }

  g.HARBOR_SIM = {
    BT: BT, ERAS: ERAS, ERA_REQ: ERA_REQ, MANAGERS: MANAGERS,
    buyManager: buyManager, canBuyManager: canBuyManager, managerCost: managerCost,
    fulfillContract: fulfillContract, canFulfill: canFulfill, rerollContract: rerollContract,
    newGame: function () { S = fresh(); ensureContracts(); save(); return snapshot(); },
    load: function () { load(); return snapshot(); },
    state: function () { return S ? snapshot() : null; },
    raw: function () { return S; },
    tick: function (dt) { tick(dt); },
    build: build, canBuild: canBuild, buildCost: buildCost,
    upgrade: upgrade, canUpgrade: canUpgrade, upCost: function (i) { return upCost(S.buildings[i]); },
    canAdvance: canAdvance, advanceEra: advanceEra,
    setFounded: function (v) { if (S) { S.founded = !!v; save(); } },
    setEra: function (n) { if (S) { S.era = clamp(n | 0, 0, ERAS.length - 1); save(); } },
    save: save, applyOffline: applyOffline, mark: function () { if (S) { S.lastSeen = now(); save(); } }
  };
})(typeof window !== 'undefined' ? window : globalThis);
