/* HARBOR — render-agnostic economy simulation. window.HARBOR_SIM
 * No WebGL/DOM here so it runs headlessly (Node tests) and the renderer just reads state.
 *
 * EMPIRE + PORTS model (Phase 4): one empire (shared money + era + managers) owns many PORTS,
 * one per founded world (biomeId). Each port has its own resources, buildings, demand and market.
 * Worlds specialise (WORLD_SPEC) so cross-island trade matters: e.g. the Desert makes goods but no
 * timber. tick() advances every founded port, accrues to the shared treasury, then runs the trade
 * network (4b) and hazards (4c). Reaching money+building thresholds advances the empire era, which
 * unlocks new worlds and building tiers. Persists + accrues offline via Retention.
 */
(function (g) {
  'use strict';
  var R = g.Retention || null;

  // ---- era ladder (empire rank) ----
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

  // ---- world specialisation (per founded world) ----
  // Production multipliers per resource + a one-line hint. A 0 multiplier means the world cannot
  // produce that resource at all (its pure-producer buildings are blocked) — forcing trade imports.
  var WORLD_SPEC = {
    green:    { fish: 1.0, timber: 1.0, goods: 1.0, hint: 'Balanced home waters' },
    mountain: { fish: 0.8, timber: 1.6, goods: 0.9, hint: 'Timber-rich fjords' },
    desert:   { fish: 0.7, timber: 0.0, goods: 1.4, hint: 'Industrial — imports timber' },
    tropical: { fish: 1.5, timber: 0.7, goods: 1.1, hint: 'Teeming fisheries' },
    nordic:   { fish: 1.1, timber: 1.3, goods: 1.2, hint: 'Hardy heavy industry' }
  };
  var WORLD_ORDER = ['green', 'mountain', 'desert', 'tropical', 'nordic'];
  function spec(id) { return WORLD_SPEC[id] || WORLD_SPEC.green; }

  // managers: permanent EMPIRE-WIDE multipliers bought with money (a real spend sink)
  var MANAGERS = {
    fishing: { name: 'Master Angler', desc: '+18% all production', cost: 200, costMul: 1.85, per: 0.18, max: 10 },
    sales:   { name: 'Harbourmaster', desc: '+16% all sales', cost: 240, costMul: 1.9, per: 0.16, max: 10 },
    labour:  { name: 'Foreman', desc: '+15% labour, −10% wages', cost: 220, costMul: 1.88, per: 0.15, max: 10 }
  };
  var WAGE = 0.10, DEMAND_SOFT = 14;   // wage/worker/s; sales/s above which demand price softens

  // era advance requirements: money on hand + minimum building counts (EMPIRE-wide counts)
  var ERA_REQ = [
    { money: 250, need: { fishing_hut: 2, cottage: 1 } },           // -> Trading Post
    { money: 1500, need: { jetty: 1, cottage: 2 } },                // -> Industrial Port
    { money: 8000, need: { warehouse: 1, market: 1 } },             // -> Metropolis
    { money: 40000, need: { factory: 1, dock: 1 } },                // -> Megaport
    { money: 200000, need: { dock: 2 } }                            // -> Global Hub
  ];

  var S = null;     // empire root
  var CUR = null;   // the port currently in scope for the per-port helpers below
  function now() { return Date.now ? Date.now() : 0; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---- construction ----
  function freshPort(id) {
    return {
      id: id, res: { fish: 0, timber: 0, goods: 0 }, buildings: [], pop: 0,
      demand: { fish: 1, timber: 1, goods: 1 }, contracts: [], contractSeq: 0
    };
  }
  function fresh() {
    return {
      era: 0, money: 120, lifetimeMoney: 0, lastSeen: now(), founded: false,
      managers: { fishing: 0, sales: 0, labour: 0 },
      active: 'green', ports: {},
      network: { xp: 0, level: 1, routes: [] }
    };
  }
  function setActive(id) { if (id != null) S.active = id; CUR = (S.ports && S.ports[S.active]) || null; }

  // migrate older saves (incl. the pre-Phase-4 single-global economy) into empire+ports shape
  function patch() {
    if (!S) return;
    if (!S.managers) S.managers = { fishing: 0, sales: 0, labour: 0 };
    if (typeof S.lifetimeMoney !== 'number') S.lifetimeMoney = 0;
    if (typeof S.money !== 'number') S.money = 120;
    if (typeof S.era !== 'number') S.era = 0;
    if (!S.network) S.network = { xp: 0, level: 1, routes: [] };
    // LEGACY: a pre-Phase-4 save kept res/buildings/demand at the top level — wrap into one port.
    if (S.res && S.buildings && !S.ports) {
      var lid = S.active || 'green';
      var lp = freshPort(lid);
      lp.res = S.res; lp.buildings = S.buildings;
      lp.demand = S.demand || { fish: 1, timber: 1, goods: 1 };
      lp.contracts = S.contracts || []; lp.contractSeq = S.contractSeq || 0; lp.pop = S.pop || 0;
      S.ports = {}; S.ports[lid] = lp; S.active = lid;
      delete S.res; delete S.buildings; delete S.demand; delete S.contracts; delete S.contractSeq; delete S.pop;
    }
    if (!S.ports) S.ports = {};
    if (!S.active) S.active = 'green';
    for (var id in S.ports) {
      var pt = S.ports[id];
      if (!pt.id) pt.id = id;
      if (!pt.res) pt.res = { fish: 0, timber: 0, goods: 0 };
      if (!pt.demand) pt.demand = { fish: 1, timber: 1, goods: 1 };
      if (!pt.buildings) pt.buildings = [];
      if (!pt.contracts) pt.contracts = [];
      if (typeof pt.contractSeq !== 'number') pt.contractSeq = 0;
      CUR = pt; ensureContracts();
    }
    setActive(S.active);
  }

  // ---- per-port helpers (operate on CUR) ----
  function counts() { var c = {}, B = CUR.buildings; for (var i = 0; i < B.length; i++) { var t = B[i].type; c[t] = (c[t] || 0) + 1; } return c; }
  function countOf(type) { var n = 0, B = CUR.buildings; for (var i = 0; i < B.length; i++) if (B[i].type === type) n++; return n; }
  function empireCounts() { var c = {}; for (var id in S.ports) { var B = S.ports[id].buildings; for (var i = 0; i < B.length; i++) { var t = B[i].type; c[t] = (c[t] || 0) + 1; } } return c; }
  function caps() {
    var cap = { fish: BASE_CAP.fish, timber: BASE_CAP.timber, goods: BASE_CAP.goods }, B = CUR.buildings;
    for (var i = 0; i < B.length; i++) { var b = B[i], t = BT[b.type]; if (t.cap) for (var r in t.cap) cap[r] += t.cap[r] * lvlMul(t, b.level); }
    return cap;
  }
  function pop() { var p = 0, B = CUR.buildings; for (var i = 0; i < B.length; i++) { var b = B[i], t = BT[b.type]; if (t.pop) p += t.pop * lvlMul(t, b.level); } return p; }
  // jobs scale with level (bigger buildings need more crew) — keeps housing meaningful late game
  function jobs() { var j = 0, B = CUR.buildings; for (var i = 0; i < B.length; i++) { var b = B[i], t = BT[b.type]; if (t.jobs) j += t.jobs * (1 + 0.5 * ((b.level || 1) - 1)); } return j; }
  function lvlMul(t, lvl) { return Math.pow(t.lvlGain, (lvl || 1) - 1); }
  function buildCost(type) { var t = BT[type]; return Math.round(t.cost * Math.pow(t.costMul, countOf(type))); }
  function upCost(b) { var t = BT[b.type]; return Math.round(t.cost * 0.6 * Math.pow(t.lvlCost, b.level)); }
  // a building is blocked on this world if every resource it produces has a 0 specialisation
  function blocked(type) {
    var t = BT[type]; if (!t || !t.prod) return false;
    var sp = spec(S.active), any = false;
    for (var r in t.prod) if (sp[r] > 0) any = true;
    return !any;
  }

  // ---- managers (empire-wide multiplier upgrades; a real money sink) ----
  function managerCost(kind) { var m = MANAGERS[kind]; if (!m) return Infinity; return Math.round(m.cost * Math.pow(m.costMul, (S.managers[kind] || 0))); }
  function canBuyManager(kind) { var m = MANAGERS[kind]; return !!m && (S.managers[kind] || 0) < m.max && S.money >= managerCost(kind); }
  function buyManager(kind) { if (!canBuyManager(kind)) return false; S.money -= managerCost(kind); S.managers[kind] = (S.managers[kind] || 0) + 1; save(); return true; }
  function mgrMul(kind) { var m = MANAGERS[kind]; return 1 + m.per * (S.managers[kind] || 0); }

  // ---- contracts (per-port standing orders: deliver a stockpile for a premium lump sum) ----
  var ORDER_LABELS = ['Royal Galley', 'Spice Merchant', 'Naval Quartermaster', 'Coastal Guild', 'Foreign Envoy', 'Cannery Co.', 'Harbour Exchange', 'Northern Traders'];
  function basePrice(res) { for (var k in BT) { var t = BT[k]; if (t.sells && t.sells.from === res) return t.sells.price; } return 5; }
  function genContract() {
    var pool = ['fish']; if (S.era >= 2) { pool.push('timber', 'goods'); } if (S.era >= 1) pool.push('fish');
    var seq = (CUR.contractSeq = (CUR.contractSeq || 0) + 1);
    var res = pool[(seq * 1) % pool.length];
    var base = res === 'goods' ? 24 : 70;
    var amt = Math.round(base * (1 + S.era * 0.55) * (0.8 + ((seq * 7) % 5) * 0.12));
    var premium = 1.7 + ((seq * 3) % 4) * 0.15;                      // 1.7x .. 2.15x passive price
    var reward = Math.round(amt * basePrice(res) * premium);
    var who = ORDER_LABELS[(seq * 5) % ORDER_LABELS.length];
    return { id: CUR.id + 'c' + seq, who: who, res: res, amt: amt, reward: reward };
  }
  function ensureContracts() { if (!CUR.contracts) CUR.contracts = []; var guard = 0; while (CUR.contracts.length < 3 && guard++ < 20) CUR.contracts.push(genContract()); }
  function findContract(id) { for (var i = 0; i < (CUR.contracts || []).length; i++) if (CUR.contracts[i].id === id) return i; return -1; }
  function canFulfill(id) { var i = findContract(id); return i >= 0 && CUR.res[CUR.contracts[i].res] >= CUR.contracts[i].amt; }
  function fulfillContract(id) {
    if (!CUR || !canFulfill(id)) return 0;
    var i = findContract(id), c = CUR.contracts[i];
    CUR.res[c.res] = Math.max(0, CUR.res[c.res] - c.amt);
    S.money += c.reward; S.lifetimeMoney = (S.lifetimeMoney || 0) + c.reward;
    CUR.contracts.splice(i, 1); ensureContracts(); save();
    return c.reward;
  }
  function rerollContract(id) { if (!CUR) return false; var i = findContract(id); if (i < 0) return false; CUR.contracts.splice(i, 1); ensureContracts(); save(); return true; }

  // ---- core tick ----
  // Advance one port; mutate its res/demand/pop; return the money delta it contributed to the empire.
  function tickPort(dt) {
    var port = CUR; if (!port) return 0;
    var sp = spec(port.id);
    var cap = caps(), p = pop(), j = jobs();
    // labour: housing feeds crew. Foreman manager makes the same crew go further.
    var labor = j > 0 ? clamp(p / j, 0, 1) : 1;
    labor = Math.min(1.25, labor * mgrMul('labour'));
    var prodMul = mgrMul('fishing'), salesMul = mgrMul('sales');
    // soft-cap taper: production slows as a store fills (1.0 empty -> 0.35 full) so caps bite gently
    var taper = {};
    for (var r0 in cap) taper[r0] = 1 - 0.65 * clamp((port.res[r0] || 0) / cap[r0], 0, 1);
    var add = { fish: 0, timber: 0, goods: 0 }, money = 0;
    var soldR = { fish: 0, timber: 0, goods: 0 }, revR = { fish: 0, timber: 0, goods: 0 };
    for (var i = 0; i < port.buildings.length; i++) {
      var b = port.buildings[i], t = BT[b.type], m = lvlMul(t, b.level);
      if (t.prod) for (var r in t.prod) add[r] += t.prod[r] * m * labor * prodMul * sp[r] * taper[r] * dt;
      if (t.convert) { var avail = port.res[t.convert.from] + add[t.convert.from]; var amt = Math.min(avail, t.convert.rate * m * labor * prodMul * (sp[t.convert.to] || 1) * taper[t.convert.to] * dt); add[t.convert.from] -= amt; add[t.convert.to] += amt; }
      if (t.sells) { var f = t.sells.from, have = port.res[f] + add[f]; var sold = Math.min(have, t.sells.rate * m * labor * dt); add[f] -= sold; soldR[f] += sold; revR[f] += sold * t.sells.price; }
      if (t.money) money += t.money * m * labor * salesMul * dt;
    }
    // dynamic demand (per port): dumping one resource softens its local price; recovers over time.
    var ease = 1 - Math.exp(-dt / 60);
    for (var s in soldR) {
      var rate = soldR[s] / dt;
      var target = DEMAND_SOFT / (DEMAND_SOFT + rate);
      port.demand[s] = clamp((port.demand[s] || 1) + (target - (port.demand[s] || 1)) * ease, 0.25, 1);
      money += revR[s] * port.demand[s] * salesMul;
    }
    // wages: every working crew costs money/s; Foreman trims the bill
    money -= WAGE * Math.min(p, j) * dt * Math.max(0.2, 1 - 0.10 * (S.managers.labour || 0));
    for (var k in add) { port.res[k] = clamp((port.res[k] + add[k]) || 0, 0, cap[k]); }
    port.pop = p;
    return money;
  }
  function tick(dt) {
    if (!S || !S.ports || dt <= 0) return;
    dt = Math.min(dt, 36000);                                       // safety clamp (10h max chunk)
    var delta = 0;
    for (var id in S.ports) { CUR = S.ports[id]; delta += tickPort(dt); }
    setActive(S.active);                                            // restore scope to the active port
    if (delta > 0) S.lifetimeMoney = (S.lifetimeMoney || 0) + delta;
    S.money = Math.max(0, (S.money + delta) || 0);
  }

  // ---- actions (operate on the active port) ----
  function canBuild(type) { var t = BT[type]; return !!CUR && !!t && S.era >= t.era && !blocked(type) && countOf(type) < t.max && S.money >= buildCost(type); }
  function build(type) { if (!canBuild(type)) return false; S.money -= buildCost(type); CUR.buildings.push({ type: type, level: 1 }); save(); return true; }
  function canUpgrade(i) { var b = CUR && CUR.buildings[i]; return !!b && b.level < BT[b.type].max && S.money >= upCost(b); }
  function upgrade(i) { if (!canUpgrade(i)) return false; var b = CUR.buildings[i]; S.money -= upCost(b); b.level++; save(); return true; }

  function canAdvance() {
    if (!S || S.era >= ERAS.length - 1) return false;
    var req = ERA_REQ[S.era]; if (!req) return false;
    if (S.money < req.money) return false;
    if (req.need) { var c = empireCounts(); for (var k in req.need) if ((c[k] || 0) < req.need[k]) return false; }
    return true;
  }
  function advanceEra() { if (!canAdvance()) return false; S.era++; save(); return true; }

  // ---- found a world's port ----
  function foundPort(id) {
    if (!S) S = fresh();
    id = id || S.active || 'green';
    if (!S.ports[id]) { S.ports[id] = freshPort(id); CUR = S.ports[id]; ensureContracts(); }
    S.founded = true; setActive(id); save();
    return snapshot(id);
  }

  // ---- persistence + offline ----
  function key() { return 'sim'; }
  function save() { if (R && S) R.set('harbor', key(), S); }
  function load() {
    var d = R && R.get('harbor', key(), null);
    if (d && (d.ports || d.buildings)) { S = d; patch(); }
    else { S = fresh(); setActive('green'); }
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

  // ---- views ----
  function managerView() {
    var out = {};
    for (var k in MANAGERS) { var m = MANAGERS[k]; out[k] = { name: m.name, desc: m.desc, lvl: (S.managers[k] || 0), max: m.max, cost: managerCost(k), can: canBuyManager(k) }; }
    return out;
  }
  function portList() {
    var out = [];
    for (var id in S.ports) { var pt = S.ports[id]; out.push({ id: id, hint: spec(id).hint, buildings: pt.buildings.length, res: { fish: Math.floor(pt.res.fish), timber: Math.floor(pt.res.timber), goods: Math.floor(pt.res.goods) } }); }
    return out;
  }
  function snapshot(id) {
    if (!S) return null;
    var pid = id || S.active, port = S.ports[pid] || null, prev = CUR;
    CUR = port;
    var v = {
      era: S.era, eraName: ERAS[S.era], money: Math.floor(S.money),
      world: pid, worldHint: spec(pid).hint, spec: spec(pid),
      founded: S.founded, portFounded: !!port,
      canAdvance: canAdvance(), nextEra: ERAS[S.era + 1] || null,
      managers: managerView(), lifetimeMoney: Math.floor(S.lifetimeMoney || 0),
      network: { level: S.network.level, xp: Math.floor(S.network.xp || 0), routes: (S.network.routes || []).length },
      ports: portList()
    };
    if (port) {
      v.res = { fish: Math.floor(port.res.fish), timber: Math.floor(port.res.timber), goods: Math.floor(port.res.goods) };
      v.caps = caps(); v.pop = Math.floor(pop()); v.jobs = jobs();
      v.buildings = port.buildings.map(function (b, i) { return { i: i, type: b.type, name: BT[b.type].name, level: b.level, up: upCost(b) }; });
      v.counts = counts(); v.demand = { fish: port.demand.fish, timber: port.demand.timber, goods: port.demand.goods };
      v.contracts = port.contracts.map(function (c) { return { id: c.id, who: c.who, res: c.res, amt: c.amt, reward: c.reward, have: Math.floor(port.res[c.res] || 0), can: canFulfill(c.id) }; });
    } else {
      v.res = { fish: 0, timber: 0, goods: 0 }; v.caps = { fish: BASE_CAP.fish, timber: BASE_CAP.timber, goods: BASE_CAP.goods };
      v.pop = 0; v.jobs = 0; v.buildings = []; v.counts = {}; v.demand = { fish: 1, timber: 1, goods: 1 }; v.contracts = [];
    }
    CUR = prev;
    return v;
  }

  g.HARBOR_SIM = {
    BT: BT, ERAS: ERAS, ERA_REQ: ERA_REQ, MANAGERS: MANAGERS, WORLD_SPEC: WORLD_SPEC, WORLD_ORDER: WORLD_ORDER,
    buyManager: buyManager, canBuyManager: canBuyManager, managerCost: managerCost,
    fulfillContract: fulfillContract, canFulfill: canFulfill, rerollContract: rerollContract,
    newGame: function () { S = fresh(); setActive('green'); save(); return snapshot(); },
    load: function () { load(); return snapshot(); },
    state: function (id) { return S ? snapshot(id) : null; },
    raw: function () { return S; },
    port: function (id) { return S && S.ports ? (S.ports[id || S.active] || null) : null; },
    setActive: function (id) { if (S) { setActive(id); save(); } },
    foundPort: foundPort,
    tick: function (dt) { tick(dt); },
    build: build, canBuild: canBuild, buildCost: buildCost, blocked: blocked,
    upgrade: upgrade, canUpgrade: canUpgrade, upCost: function (i) { return CUR && CUR.buildings[i] ? upCost(CUR.buildings[i]) : 0; },
    canAdvance: canAdvance, advanceEra: advanceEra,
    setFounded: function (v) { if (S) { S.founded = !!v; save(); } },
    setEra: function (n) { if (S) { S.era = clamp(n | 0, 0, ERAS.length - 1); save(); } },
    save: save, applyOffline: applyOffline, mark: function () { if (S) { S.lastSeen = now(); save(); } }
  };
})(typeof window !== 'undefined' ? window : globalThis);
