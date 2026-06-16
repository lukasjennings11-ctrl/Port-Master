/* Coin Forge — idle/incremental clicker. Vanilla JS, mobile-first, DOM-driven.
 * Tap the ore for coins; buy helpers that generate coins/sec even offline.
 * Costs scale geometrically (classic cookie-clicker curve). State persists
 * via shared/retention.js's generic get/set; offline time is credited on load.
 * Uses ../../shared/juice.js (audio/haptics/shake) and ../../shared/retention.js.
 */
(function () {
  'use strict';

  var GAME = 'idle';

  // ---- DOM ----
  var coinsEl  = document.getElementById('coins');
  var cpsEl    = document.getElementById('cps');
  var cpEl     = document.getElementById('click-power');
  var streakEl = document.getElementById('streak');
  var mineBtn  = document.getElementById('mine-btn');
  var popLayer = document.getElementById('popups');
  var shopEl   = document.getElementById('shop');
  var overlay  = document.getElementById('overlay');
  var ovAmount = document.getElementById('ov-amount');
  var ovClose  = document.getElementById('ov-close');
  var appEl    = document.getElementById('app');

  // ---- helpers ----
  function fmt(n) {
    if (n > 0 && n < 1) return n.toFixed(2);
    if (n < 1000) return Math.floor(n).toString();
    var units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp'];
    var u = 0;
    while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
    var s = n < 10 ? n.toFixed(2) : (n < 100 ? n.toFixed(1) : Math.floor(n).toString());
    return s + units[u];
  }

  // ---- building catalog ----
  // cost(owned) = baseCost * 1.15^owned ; each unit produces `cps` coins/sec.
  var BUILDINGS = [
    { id: 'cursor',    icon: '👆', name: 'Extra Hand',  desc: 'Taps for you',        baseCost: 15,      cps: 0.1 },
    { id: 'drill',     icon: '🔩', name: 'Drill Rig',   desc: 'Bores for ore',       baseCost: 100,     cps: 1 },
    { id: 'cart',      icon: '🛒', name: 'Ore Cart',    desc: 'Hauls bigger loads',  baseCost: 1100,    cps: 8 },
    { id: 'excavator', icon: '🚜', name: 'Excavator',   desc: 'Digs whole seams',    baseCost: 12000,   cps: 47 },
    { id: 'factory',   icon: '🏭', name: 'Smeltery',    desc: 'Refines ore to coin', baseCost: 130000,  cps: 260 },
    { id: 'mine',      icon: '⛰️', name: 'Deep Mine',   desc: 'A whole mountain',    baseCost: 1400000, cps: 1400 },
    { id: 'satellite', icon: '🛰️', name: 'Orbital Rig', desc: 'Mines from space',    baseCost: 20000000,cps: 7800 }
  ];
  var GROWTH = 1.15;
  var CLICK_UPGRADE_BASE = 50, CLICK_UPGRADE_GROWTH = 3.2;

  function costOf(b, owned) { return b.baseCost * Math.pow(GROWTH, owned); }

  // ---- state ----
  var coins, owned, clickPower, clickUpgrades, totalEarned, best;
  var cps = 0;

  function recalcCps() {
    cps = 0;
    for (var i = 0; i < BUILDINGS.length; i++) cps += BUILDINGS[i].cps * (owned[BUILDINGS[i].id] || 0);
  }

  function save() {
    Retention.set(GAME, 'state', {
      coins: coins, owned: owned, clickPower: clickPower,
      clickUpgrades: clickUpgrades, totalEarned: totalEarned, t: Date.now()
    });
    if (totalEarned > best) { best = totalEarned; Retention.set(GAME, 'best', best); }
  }

  var OFFLINE_CAP_SEC = 8 * 3600; // cap offline credit at 8 hours

  function load() {
    var st = Retention.get(GAME, 'state', null);
    best = Retention.best(GAME);
    if (!st) {
      coins = 0; owned = {}; clickPower = 1; clickUpgrades = 0; totalEarned = 0;
      for (var i = 0; i < BUILDINGS.length; i++) owned[BUILDINGS[i].id] = 0;
      recalcCps();
      return;
    }
    coins = st.coins || 0;
    owned = st.owned || {};
    for (var j = 0; j < BUILDINGS.length; j++) if (owned[BUILDINGS[j].id] == null) owned[BUILDINGS[j].id] = 0;
    clickPower = st.clickPower || 1;
    clickUpgrades = st.clickUpgrades || 0;
    totalEarned = st.totalEarned || 0;
    recalcCps();

    var elapsedSec = Math.max(0, (Date.now() - (st.t || Date.now())) / 1000);
    var creditSec = Math.min(elapsedSec, OFFLINE_CAP_SEC);
    if (creditSec > 30 && cps > 0) {
      var earned = cps * creditSec;
      coins += earned; totalEarned += earned;
      ovAmount.textContent = '+' + fmt(earned) + ' coins';
      overlay.classList.remove('hidden');
    }
  }

  // ---- click ----
  function mine(clientX, clientY) {
    Juice.Audio.unlock();
    coins += clickPower; totalEarned += clickPower;
    Juice.Audio.play('pop'); Juice.vibrate(6);
    spawnFloatPop(clientX, clientY, '+' + fmt(clickPower));
    renderTop();
  }

  function spawnFloatPop(clientX, clientY, text) {
    var rect = popLayer.getBoundingClientRect();
    var x = (clientX != null ? clientX - rect.left : rect.width / 2) + (Math.random() * 30 - 15);
    var y = (clientY != null ? clientY - rect.top  : rect.height / 2);
    var el = document.createElement('div');
    el.className = 'float-pop'; el.textContent = text;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    popLayer.appendChild(el);
    setTimeout(function () { el.remove(); }, 950);
  }

  mineBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    mineBtn.style.transform = 'scale(.9)';
    mine(e.clientX, e.clientY);
  });
  mineBtn.addEventListener('pointerup', function () { mineBtn.style.transform = ''; });

  // ---- shop ----
  function buy(id) {
    var b = null;
    for (var i = 0; i < BUILDINGS.length; i++) if (BUILDINGS[i].id === id) b = BUILDINGS[i];
    if (!b) return false;
    var cost = costOf(b, owned[id]);
    if (coins < cost) return false;
    coins -= cost; owned[id]++;
    recalcCps();
    Juice.Audio.play('score'); Juice.vibrate(10);
    if (owned[id] % 10 === 0) shake.add(4, 0.2);
    renderShop(); renderTop();
    return true;
  }

  function buyClickUpgrade() {
    var cost = CLICK_UPGRADE_BASE * Math.pow(CLICK_UPGRADE_GROWTH, clickUpgrades);
    if (coins < cost) return false;
    coins -= cost; clickUpgrades++;
    clickPower = 1 + clickUpgrades; // linear bump, simple & predictable
    Juice.Audio.play('win'); Juice.vibrate([10, 15, 10]);
    renderShop(); renderTop();
    return true;
  }

  function renderShop() {
    shopEl.innerHTML = '';

    // click-power upgrade card, always first
    var cuCost = CLICK_UPGRADE_BASE * Math.pow(CLICK_UPGRADE_GROWTH, clickUpgrades);
    shopEl.appendChild(buildItem({
      icon: '💪', name: 'Stronger Arm', desc: 'Tap power +1',
      ownedText: 'lvl ' + clickUpgrades, cost: cuCost, afford: coins >= cuCost,
      onBuy: buyClickUpgrade
    }));

    for (var i = 0; i < BUILDINGS.length; i++) {
      var b = BUILDINGS[i];
      var n = owned[b.id] || 0;
      var cost = costOf(b, n);
      var afford = coins >= cost;
      shopEl.appendChild(buildItem({
        icon: b.icon, name: b.name, desc: b.desc + ' · ' + fmt(b.cps) + '/sec each',
        ownedText: 'x' + n, cost: cost, afford: afford,
        onBuy: function (id) { return function () { buy(id); }; }(b.id)
      }));
    }
  }

  function buildItem(opts) {
    var div = document.createElement('div');
    div.className = 'item' + (opts.afford ? ' affordable' : '');
    div.innerHTML =
      '<div class="icon">' + opts.icon + '</div>' +
      '<div class="info"><div class="name">' + opts.name + '</div>' +
      '<div class="desc">' + opts.desc + '</div></div>' +
      '<div class="right"><div class="cost">' + fmt(opts.cost) + '</div>' +
      '<div class="owned">' + opts.ownedText + '</div></div>';
    div.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (opts.onBuy()) spawnFloatPop(e.clientX, e.clientY, 'bought!');
    });
    return div;
  }

  // ---- HUD ----
  function renderTop() {
    coinsEl.textContent = fmt(coins);
    cpsEl.textContent = fmt(cps);
    cpEl.textContent = fmt(clickPower);
    renderShop(); // refresh affordability highlighting
  }

  // ---- juice (shake via CSS transform on #app) ----
  var shake = new Juice.Shake();
  var lastT = performance.now();
  function tick(now) {
    var dt = Math.min(0.25, (now - lastT) / 1000); lastT = now;
    coins += cps * dt; totalEarned += cps * dt;
    var off = shake.update(dt);
    appEl.style.transform = (off.x || off.y) ? 'translate(' + off.x.toFixed(1) + 'px,' + off.y.toFixed(1) + 'px)' : '';
    coinsEl.textContent = fmt(coins);
    cpsEl.textContent = fmt(cps);
    requestAnimationFrame(tick);
  }

  // ---- reset ----
  function reset() {
    if (totalEarned > 0 && !window.__idleSkipConfirm) {
      var ok = confirm('Reset all progress? This cannot be undone.');
      if (!ok) return;
    }
    coins = 0; owned = {}; clickPower = 1; clickUpgrades = 0; totalEarned = 0;
    for (var i = 0; i < BUILDINGS.length; i++) owned[BUILDINGS[i].id] = 0;
    recalcCps(); save(); renderTop();
  }

  // ---- lifecycle ----
  document.getElementById('new').addEventListener('click', reset);
  document.getElementById('mute').addEventListener('click', function () {
    this.textContent = Juice.Audio.toggleMute() ? '🔇' : '🔊';
  });
  ovClose.addEventListener('click', function () { overlay.classList.add('hidden'); save(); });

  function boot() {
    load();
    streakEl.innerHTML = '🔥 ' + Retention.touchStreak(GAME) + '&nbsp;day streak';
    renderTop();
    lastT = performance.now();
    requestAnimationFrame(tick);
    setInterval(save, 5000);
    window.addEventListener('beforeunload', save);
  }

  // ---- headless test hook ----
  window.__idle = {
    click: function () { mine(); },
    buy: function (id) { return id === 'click' ? buyClickUpgrade() : buy(id); },
    state: function () {
      return { coins: Math.floor(coins), cps: cps, clickPower: clickPower, owned: Object.assign({}, owned), totalEarned: Math.floor(totalEarned) };
    },
    grant: function (n) { coins += n; totalEarned += n; renderTop(); }, // test-only cheat to skip grinding
    tick: function (n, dtSec) {
      dtSec = dtSec || 1;
      for (var i = 0; i < (n || 1); i++) { coins += cps * dtSec; totalEarned += cps * dtSec; }
      renderTop();
    },
    reset: function () { window.__idleSkipConfirm = true; reset(); window.__idleSkipConfirm = false; }
  };

  boot();
})();
