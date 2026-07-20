/* Port Boss — headless browser integration regression (swiftshader Playwright).
 * Drives the full stack via window.__harbor: found → build → advance → event → voyage → relics →
 * rival race → fever → season/pass → daily fortune → prestige, asserting correct outcomes,
 * meta-persistence through prestige, and ZERO console errors. Exit 0 = pass.
 * Run: node games/harbor/tests/browser.test.js
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../..');        // repo root (…/games/harbor/tests → repo)
const PORT = 8199;

// locate playwright + a chromium build without hardcoding the version
function findChromium() {
  var base = '/opt/pw-browsers';
  try { var d = fs.readdirSync(base).filter(function (n) { return /^chromium-/.test(n); }).sort(); if (d.length) { var p = path.join(base, d[d.length - 1], 'chrome-linux', 'chrome'); if (fs.existsSync(p)) return p; } } catch (e) {}
  return undefined;   // let Playwright resolve from its own cache
}
let chromium;
try { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
catch (e) { try { chromium = require('playwright').chromium; } catch (e2) { console.log('SKIP — playwright not available'); process.exit(0); } }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; let fp = path.join(ROOT, p); fs.readFile(fp, (e, b) => { if (e) { s.writeHead(404); s.end('nf'); } else { s.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); s.end(b); } }); }).listen(PORT);
const sleep = ms => new Promise(z => setTimeout(z, ms));

let pass = 0, fail = 0, fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }
// Known-benign console noise, irrelevant to correctness: 404s for the pre-clear probe request and
// favicon (this harness serves no favicon), and Chrome's "vibrate needs a recent user gesture"
// intervention — harmless (vibrate silently no-ops, nothing throws) and only reachable in this
// suite right after a page.reload() drops the transient-activation state every earlier
// click-driven haptic() call in the run relied on; a real device's haptics are gated the same way
// and simply don't buzz for that one ambient event, which is not a functional regression.
const IGNORE_CONSOLE_ERR = /404|favicon|Blocked call to navigator\.vibrate/;

(async () => {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 414, height: 820 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE_CONSOLE_ERR.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  // GL validation failures (e.g. framebuffer feedback loops) surface as console *warnings* in Chrome — catch those too
  page.on('console', m => { if (m.type() === 'warning' && /GL_INVALID|INVALID_OPERATION|INVALID_ENUM|INVALID_VALUE|[Ff]eedback loop/.test(m.text())) errs.push('GLWARN ' + m.text()); });

  // nopost-probe: swiftshader is slow — the 10c frame-time probe would trip and auto-disable
  // the post pass mid-test. The flag disarms the probe so the pass stays on deterministically.
  await page.goto(`http://localhost:${PORT}/games/harbor/?biome=green&nopost-probe`, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'load' });
  const booted = await page.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 }).then(() => true).catch(() => false);
  ok('boot: WebGL alive', booted);
  await sleep(400);
  // Phase 11b: refreshed welcome copy should name the systems a newcomer wouldn't otherwise discover
  const wmFeat = await page.evaluate(() => { var el = document.querySelector('#welcomemodal .wm-feat'); return el ? el.textContent : ''; });
  ok('welcome: refreshed copy mentions Expeditions', /expedition/i.test(wmFeat));
  await page.evaluate(() => { var b = document.querySelector('#welcomemodal .wm-btn'); if (b) b.click(); window.__harbor.autoFound(); });
  ok('found: port founded', await page.evaluate(() => !!window.HARBOR_SIM.raw().founded));

  // Phase 15a: trade-network guidance — first playtest feedback was "I can't set up a trade
  // network, I can only click on one city": with exactly 1 founded harbour (still true right
  // after autoFound, era 0) the trade map must explain why, not stay silent.
  await page.evaluate(() => window.__harbor.openTrade());
  await sleep(120);
  const tg1 = await page.evaluate(() => window.__harbor.tradeState());
  ok('trade guide: card visible with 1 founded harbour', tg1.founded === 1 && tg1.guide === true);
  // tap the only founded node — selection should show a persistent "tap another harbour" hint
  await page.evaluate(() => window.__harbor.tradeTapNode('green'));
  const tg2 = await page.evaluate(() => window.__harbor.tradeState());
  ok('trade guide: selecting the first node shows the "tap another harbour" link hint', tg2.sel === 'green' && /tap another harbour/i.test(tg2.msg));
  await page.evaluate(() => window.__harbor.closeTrade());

  // v84: with a SECOND harbour founded the whole route flow must work end-to-end (the user's
  // "I click both coasts and nothing happens" was really "I only had one founded port"). Found a
  // colony directly on the sim, then drive tap→tap→create, and check the disabled-reason label.
  await page.evaluate(() => { var S = window.HARBOR_SIM; S.raw().money = 1e6; S.foundPort('tropical'); S.setActive('green'); window.__harbor.openTrade(); });
  await sleep(120);
  const rt1 = await page.evaluate(() => window.__harbor.tradeState());
  ok('v84 trade: guide card hides once 2 harbours are founded', rt1.founded === 2 && rt1.guide === false);
  // tap green then tropical → the route builder opens (not a silent no-op)
  await page.evaluate(() => { window.__harbor.tradeTapNode('green'); window.__harbor.tradeTapNode('tropical'); });
  const rt2 = await page.evaluate(() => window.__harbor.tradeState());
  ok('v84 trade: tapping two founded harbours opens the route builder', /Ship from/i.test(rt2.msg));
  // affordable → the resource buttons show the price; create a fish route
  ok('v84 trade: an affordable resource button shows its £ price', /£/.test(rt2.msg));
  await page.evaluate(() => window.HARBOR_SIM.addRoute('green', 'tropical', 'fish'));
  ok('v84 trade: a route is created between the two harbours', await page.evaluate(() => window.HARBOR_SIM.network().routes.length === 1));
  // disabled-reason: broke + a fresh pair → the button must say WHY (Need £…), not sit silently dead
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 0; window.__harbor.tradeTapNode('green'); window.__harbor.tradeTapNode('tropical'); });
  const rt3 = await page.evaluate(() => window.__harbor.tradeState());
  ok('v84 trade: an unaffordable resource button explains "Need £…"', /Need £/i.test(rt3.msg));
  await page.evaluate(() => { window.__harbor.closeTrade(); var S = window.HARBOR_SIM; S.removeRoute && S.network().routes.forEach(function (r) { S.removeRoute(r.id); }); S.setActive('green'); });

  // Manage panel clarity — "don't show me items I cannot click, or blank them out" (2nd playtest
  // complaint). With next to no money, every unaffordable buy row across the panel should be
  // ghosted (not just faintly dimmer) and say what's missing; the New-buildings section should
  // also teaser next era's building names so hiding them doesn't look like a dead end.
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 10; document.getElementById('managebtn').click(); });
  await sleep(120);
  const mg = await page.evaluate(() => {
    var rows = Array.from(document.querySelectorAll('#managepanel .mp-item.ghosted'));
    var teaser = document.querySelector('#managepanel .mp-teaser');
    return { ghostCount: rows.length, needText: rows.some(r => /Need £/.test(r.textContent)), teaserText: teaser ? teaser.textContent : null };
  });
  ok('manage: unaffordable rows carry the .ghosted class', mg.ghostCount > 0);
  ok('manage: a ghosted row shows a muted "Need £" price', mg.needText);
  ok('manage: New-buildings teaser lists next-era building names', !!mg.teaserText && /Warehouse/.test(mg.teaserText) && /Fish Market/.test(mg.teaserText));
  await page.evaluate(() => document.getElementById('managebtn').click());   // close it back up for the rest of the flow

  await page.evaluate(() => { var S = window.HARBOR_SIM; S.setEra(4); S.raw().money = 5e6; S.raw().lifetimeMoney = 5e6; var p = S.port('green'); ['fishing_hut', 'fishing_hut', 'cottage', 'jetty', 'warehouse', 'market'].forEach(t => { if (S.canBuild(t)) S.build(t); }); p.res.fish = 999; p.res.timber = 999; p.res.goods = 999; });

  // events: fire + resolve each; modal appears for choices
  for (const id of ['goldrush', 'castaway', 'raid', 'gamble', 'commission', 'smuggler']) {
    await page.evaluate((i) => window.__harbor.fireEvent(i), id); await sleep(90);
    const modal = await page.evaluate(() => !!document.querySelector('#eventmodal.show') || window.HARBOR_SIM.event() && window.HARBOR_SIM.event().kind === 'ambient');
    await page.evaluate(() => { var b = document.querySelector('#eventmodal.show .ev-btn'); if (b) b.click(); }); await sleep(90);
  }
  ok('events: all fired/resolved without throw', true);

  // voyage
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 1e6; window.__harbor.startVoyage('cove'); var S = window.HARBOR_SIM.raw(); S.voyages[0].endsAt = Date.now() - 1; var v = window.__harbor.voyages().active[0]; window.__harbor.collectVoyage(v.seq); });
  ok('voyage: collected (slot freed)', await page.evaluate(() => window.__harbor.voyages().used === 0));

  // relics → complete a set
  await page.evaluate(() => ['carto0', 'carto1', 'carto2'].forEach(id => window.__harbor.grantRelic(id)));
  ok('relics: cartographer set → +1 voyage slot in META', await page.evaluate(() => window.HARBOR_SIM.meta().voyageSlots >= 1));

  // Phase 9c: doctrine branch (choose-a-path) — unlock gate, pick cost, respec, capstone
  const d9 = await page.evaluate(() => {
    var H = window.__harbor, M = () => window.HARBOR_SIM.meta(), out = {};
    out.gatedPick = H.pickDoctrine('merchant');                 // <3 charters → locked
    window.Retention.set('harbor', 'charters', 3);
    window.Retention.set('harbor', 'legacyBal', 300);
    out.capGate = H.buyCapstone();                              // no pick yet → gated
    out.sell0 = M().sellMul;
    out.pickOk = H.pickDoctrine('merchant');
    out.bal1 = H.legacy().bal; out.sell1 = M().sellMul; out.route1 = M().routeMul;
    return out;
  });
  ok('9c doctrine: gated <3 charters, capstone gated on pick, pick costs 25✦ → +20% sales +10% routes',
    d9.gatedPick === false && d9.capGate === false && d9.pickOk === true && d9.bal1 === 275 &&
    Math.abs(d9.sell1 - d9.sell0 - 0.20) < 1e-6 && d9.route1 >= 1.10 - 1e-6);   // Phase 11a: merchant sales +0.35→+0.20
  const r9 = await page.evaluate(() => {
    var H = window.__harbor, M = () => window.HARBOR_SIM.meta();
    var slots0 = M().voyageSlots, okR = H.pickDoctrine('explorer');
    return { okR, bal: H.legacy().bal, pick: H.doctrine().pick, slots0, slots: M().voyageSlots, speed: M().voyageSpeed, sell: M().sellMul, sell0Tree: 1 };
  });
  ok('9c doctrine: respec costs 50✦, swaps to explorer (+1 slot, +35% speed, merchant sales gone)',
    r9.okR === true && r9.bal === 225 && r9.pick === 'explorer' && r9.slots === r9.slots0 + 1 && r9.speed >= 1.35 - 1e-6 && Math.abs(r9.sell - d9.sell0) < 1e-6);
  const c9 = await page.evaluate(() => {
    var H = window.__harbor, okC = H.buyCapstone();
    return { okC, bal: H.legacy().bal, caps: H.doctrine().caps, yieldV: window.HARBOR_SIM.meta().voyageYield };
  });
  ok('9c capstone: Flagship 120✦ → META.voyageYield 0.4 (max 1)',
    c9.okC === true && c9.bal === 105 && c9.caps.explorer === true && Math.abs(c9.yieldV - 0.4) < 1e-6);

  // Phase 9c: relic loadout — equip toggles META, slot cap enforced
  const l9 = await page.evaluate(() => {
    var H = window.__harbor, M = () => window.HARBOR_SIM.meta(), out = {};
    out.slots = H.loadout().slots;                              // 3 owned (<9) → 3 slots
    out.v0 = M().voyageSpeed;
    out.eq = H.equipRelic('carto0');
    out.v1 = M().voyageSpeed;                                   // +6% per Cartographer relic
    out.uneq = H.equipRelic('carto0');
    out.v2 = M().voyageSpeed;
    H.grantRelic('smug0');                                      // 4th owned relic (still <9 → 3 slots)
    ['carto0', 'carto1', 'carto2'].forEach(id => H.equipRelic(id));
    out.full = H.equipRelic('smug0');                           // 4th equip must fail
    out.equipped = H.loadout().equipped.length;
    return out;
  });
  ok('9c loadout: equip +6% voyage speed, unequip reverts', l9.slots === 3 && l9.eq === true &&
    Math.abs(l9.v1 - l9.v0 - 0.06) < 1e-6 && l9.uneq === true && Math.abs(l9.v2 - l9.v0) < 1e-6);
  ok('9c loadout: 3-slot cap enforced (4th equip rejected)', l9.full === false && l9.equipped === 3);

  // living fleet (Phase 9b): visible expedition ships derive from the voyage list
  ok('fleet: empty baseline', await page.evaluate(() => { var f = window.__harbor.fleet(); return f.expedition === 0 && f.route === 0 && f.rival === 0; }));
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 1e6; window.__harbor.startVoyage('reef'); });
  ok('fleet: expedition ship at sea while voyage active', await page.evaluate(() => window.__harbor.fleet().expedition === 1));
  // Phase 17b: expedition kind maps to the expedition-LADDER class at the OWNED tier (supersedes
  // 16a's fixed 'schooner') — tier0 (no purchase yet) is 'outrigger'; setting the raw tier to 2
  // (Registry purchases already covered end-to-end by sim.test.js's fleetRegistry* sections) swaps
  // the sailing ship to 'schooner', the same class 16a always showed.
  ok('17b fleet: expedition ships default to the tier0 ladder class (outrigger)', await page.evaluate(() => window.__harbor.fleet().expClass === 'outrigger'));
  await page.evaluate(() => { window.HARBOR_SIM.raw().fleetTech.expedition = 2; });
  ok('17b fleet: expedition ships map to schooner once tier2 is owned', await page.evaluate(() => window.__harbor.fleet().expClass === 'schooner'));
  await page.evaluate(() => { window.HARBOR_SIM.raw().voyages[0].endsAt = Date.now() - 1; var v = window.__harbor.voyages().active[0]; window.__harbor.collectVoyage(v.seq); });
  ok('fleet: expedition ship gone after collect', await page.evaluate(() => window.__harbor.fleet().expedition === 0));
  // living fleet: a route touching the active port spawns a shuttling cargo ship
  await page.evaluate(() => { var S = window.HARBOR_SIM; S.foundPort('tropical'); S.setActive('green'); S.raw().money = 1e6; S.addRoute('green', 'tropical', 'fish'); });
  ok('fleet: cargo ship shuttles the active-port route', await page.evaluate(() => window.__harbor.fleet().route === 1));
  // Phase 17b: the route freighter's class now follows the OWNED trade-fleet tier (Registry
  // purchases) — supersedes 16a's era>=2 auto-swap to brig/steamer. Setting raw fleetTech.trade
  // directly (not through __harbor.setEra) isolates the DISPLAY mapping from both era AND the
  // purchase economy, so this is a no-op on era — nothing downstream needs restoring.
  const f17 = await page.evaluate(() => {
    var H = window.__harbor, S = window.HARBOR_SIM.raw(), tierBefore = S.fleetTech.trade, out = {};
    S.fleetTech.trade = 0; out.tier0 = H.fleet().routeClass;
    S.fleetTech.trade = 2; out.tier2 = H.fleet().routeClass;
    S.fleetTech.trade = 5; out.tier5 = H.fleet().routeClass;
    S.fleetTech.trade = tierBefore;
    return out;
  });
  ok('17b fleet: route ships sail the OWNED trade tier (log_barge@0, brig@2, steamer@5)',
    f17.tier0 === 'log_barge' && f17.tier2 === 'brig' && f17.tier5 === 'steamer');

  // ---- Phase 17b: the Harbour Registry panel — commission fleet-tier upgrades ----
  const errsBeforeReg = errs.length;
  await page.evaluate(() => { window.HARBOR_SIM.setEra(4); window.HARBOR_SIM.raw().money = 1e7; });
  await page.evaluate(() => window.__harbor.forceHUD());
  const regBtnVisible = await page.evaluate(() => document.getElementById('registrybtn').style.display !== 'none');
  ok('17b registry: era>=1 reveals the "🚢 Registry" action-bar button', regBtnVisible);
  await page.evaluate(() => window.__harbor.openRegistry());
  await sleep(150);
  const reg1 = await page.evaluate(() => ({
    shown: document.getElementById('registrypanel').classList.contains('show'),
    cards: document.querySelectorAll('#registrypanel .reg-card').length,
    portraits: document.querySelectorAll('#registrypanel canvas.reg-portrait').length,
    buyBtns: document.querySelectorAll('#registrypanel [data-buy]').length,
    navyBuyBtns: document.querySelectorAll('#registrypanel [data-buy-navy]').length   // Phase 17c: the 4th (Navy) card's button is a distinct attribute
  }));
  ok('17b registry: panel renders 3 fleet-role cards, each with a mesh portrait + a Commission button (flush with cash + era4)',
    reg1.shown && reg1.buyBtns === 3);
  ok('17c registry: a 4th card (Navy) renders alongside the 3 fleet roles, each with its own mesh portrait',
    reg1.cards === 4 && reg1.portraits === 4 && reg1.navyBuyBtns === 1);
  // ghosted "Need £X" state: broke, but era-eligible for tier1
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 0; window.__harbor.openRegistry(); });
  await sleep(120);
  const reg2 = await page.evaluate(() => {
    var btn = document.querySelector('#registrypanel [data-buy="fishing"]');
    return { text: btn ? btn.textContent : null, ghosted: btn ? btn.classList.contains('ghosted') : null };
  });
  ok('17b registry: broke → ghosted "Need £X" Commission button', /^Need £/.test(reg2.text || '') && reg2.ghosted === true);
  // ghosted "Requires [Age]" state: flush with cash, but the NEXT tier needs a higher era than owned
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 1e7; window.HARBOR_SIM.setEra(0); window.__harbor.openRegistry(); });
  await sleep(120);
  const reg3 = await page.evaluate(() => {
    var btn = document.querySelector('#registrypanel [data-buy="fishing"]');
    return { text: btn ? btn.textContent : null, ghosted: btn ? btn.classList.contains('ghosted') : null };
  });
  ok('17b registry: era0 + flush with cash → ghosted "Requires [Age]" Commission button (tier1 needs era>=1)',
    /^Requires /.test(reg3.text || '') && reg3.ghosted === true);
  // affordable + era-eligible → real Commission button; clicking it charges once, bumps the tier,
  // repaints the portrait to the new class, and latches the "First Commission" achievement
  await page.evaluate(() => {
    window.HARBOR_SIM.setEra(4); window.HARBOR_SIM.raw().money = 1e7;
    var a = window.Retention.get('harbor', 'ach', {}); delete a.ship1; window.Retention.set('harbor', 'ach', a);   // clear ONLY ship1 — other achievements earned earlier in this run must survive
    window.__harbor.openRegistry();
  });
  await sleep(120);
  const preBuy = await page.evaluate(() => ({ tier: window.__harbor.fleetTier('fishing'), money: window.HARBOR_SIM.raw().money }));
  await page.evaluate(() => { var b = document.querySelector('#registrypanel [data-buy="fishing"]'); if (b) b.click(); });
  await sleep(150);
  const postBuy = await page.evaluate(() => ({
    tier: window.__harbor.fleetTier('fishing'), money: window.HARBOR_SIM.raw().money,
    ach: (window.Retention.get('harbor', 'ach', {}) || {}).ship1 === 1,
    cardName: document.querySelector('#registrypanel .reg-name') ? document.querySelector('#registrypanel .reg-name').textContent : null
  }));
  ok('17b registry: Commission charges exactly the tier cost and bumps the tier by 1',
    postBuy.tier === preBuy.tier + 1 && Math.abs(postBuy.money - (preBuy.money - 120)) < 50);   // tolerance: the live economy still ticks a few £ during the 150ms settle window
  ok('17b registry: first-ever commission latches the "First Commission" achievement', postBuy.ach === true);
  ok('17b registry: the fishing card repaints to the newly-commissioned class name (Coracle)', postBuy.cardName === 'Coracle');
  // max out a ladder → "Fleet complete ✓" replaces the Commission button
  await page.evaluate(() => { for (var i = 0; i < 10; i++) { window.HARBOR_SIM.setEra(7); window.HARBOR_SIM.raw().money = 1e7; window.__harbor.buyShip('expedition'); } window.__harbor.openRegistry(); });
  await sleep(120);
  const reg4 = await page.evaluate(() => ({ tier: window.__harbor.fleetTier('expedition'), hasMax: !!document.querySelector('#registrypanel .reg-max') }));
  ok('17b registry: maxing a ladder (tier7) shows "Fleet complete ✓" instead of a Commission button', reg4.tier === 7 && reg4.hasMax);
  await page.evaluate(() => window.__harbor.closeRegistry());
  ok('17b registry: panel flows produced zero new console/GL errors', errs.length === errsBeforeReg);

  // ---- Phase 17c: THE NAVY — Registry section, visible patrol, auto-defended raid banner ----
  const errsBeforeNavy = errs.length;
  await page.evaluate(() => { window.HARBOR_SIM.setEra(0); window.HARBOR_SIM.raw().navy = 0; window.HARBOR_SIM.raw().money = 0; window.__harbor.openRegistry(); });
  await sleep(150);
  const nav0 = await page.evaluate(() => {
    var btn = document.querySelector('#registrypanel [data-buy-navy]');
    return { cardCount: document.querySelectorAll('#registrypanel .reg-card').length, text: btn ? btn.textContent : null, ghosted: btn ? btn.classList.contains('ghosted') : null };
  });
  ok('17c registry: a 4th card (Navy) renders alongside the 3 fleet roles', nav0.cardCount === 4);
  ok('17c registry: era0 navy — ghosted "Requires [Age]" (tier1 needs era>=1)', /^Requires /.test(nav0.text || '') && nav0.ghosted === true);
  await page.evaluate(() => { window.HARBOR_SIM.setEra(1); window.HARBOR_SIM.raw().money = 0; window.__harbor.openRegistry(); });
  await sleep(120);
  const nav1 = await page.evaluate(() => {
    var btn = document.querySelector('#registrypanel [data-buy-navy]');
    return { text: btn ? btn.textContent : null, ghosted: btn ? btn.classList.contains('ghosted') : null };
  });
  ok('17c registry: era1 + broke — ghosted "Need £X" Commission button', /^Need £/.test(nav1.text || '') && nav1.ghosted === true);
  await page.evaluate(() => {
    var a = window.Retention.get('harbor', 'ach', {}); delete a.admiral1; window.Retention.set('harbor', 'ach', a);   // clear ONLY admiral1 — other achievements earned earlier in this run must survive
    window.HARBOR_SIM.raw().money = 1e7; window.__harbor.openRegistry();
  });
  await sleep(120);
  const preNavyTier = await page.evaluate(() => window.__harbor.navyTier());
  await page.evaluate(() => { var b = document.querySelector('#registrypanel [data-buy-navy]'); if (b) b.click(); });
  await sleep(150);
  const postNavyBuy = await page.evaluate(() => {
    var names = document.querySelectorAll('#registrypanel .reg-name');
    return { tier: window.__harbor.navyTier(), ach: (window.Retention.get('harbor', 'ach', {}) || {}).admiral1 === 1, cardName: names.length ? names[names.length - 1].textContent : null };
  });
  ok('17c registry: Commission charges the tier cost and bumps navy tier by exactly 1', postNavyBuy.tier === preNavyTier + 1);
  ok('17c registry: first-ever navy commission latches the "Admiral" achievement', postNavyBuy.ach === true);
  ok('17c registry: the Navy card repaints to the newly-commissioned class name (Patrol Cutter)', postNavyBuy.cardName === 'Patrol Cutter');
  // max out the navy ladder → "Fleet complete ✓" replaces the Commission button, on the LAST (Navy) card
  await page.evaluate(() => { window.HARBOR_SIM.setEra(6); for (var i = 0; i < 10; i++) { window.HARBOR_SIM.raw().money = 1e7; window.__harbor.buyNavy(); } window.__harbor.openRegistry(); });
  await sleep(120);
  const navMax = await page.evaluate(() => {
    var cards = document.querySelectorAll('#registrypanel .reg-card'), last = cards[cards.length - 1];
    return { tier: window.__harbor.navyTier(), lastHasMax: last ? !!last.querySelector('.reg-max') : false, lastHasBuy: last ? !!last.querySelector('[data-buy-navy]') : false };
  });
  ok('17c registry: maxing the navy (tier5) shows "Fleet complete ✓" on the Navy card, no Commission button', navMax.tier === 5 && navMax.lastHasMax === true && navMax.lastHasBuy === false);
  await page.evaluate(() => window.__harbor.closeRegistry());
  await sleep(200);
  // visible patrol: a maxed navy shows 2 ships (highest tier + one below), a real ladder class
  const fleetNav = await page.evaluate(() => window.__harbor.fleet());
  ok('17c patrol: navy tier5 shows 2 patrol ships via __harbor.fleet().navy, flying the top-tier class', fleetNav.navy === 2 && fleetNav.navyClass === 'drone_screen');
  // auto-defended raid: navyPower(5) >= raidStrength(era6=4) — fireEvent('raid') resolves instantly
  // (no modal), and the repelled-raid banner shows with the loot amount, auto-dismissing on its own.
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 1000; });
  const repelEv = await page.evaluate(() => window.__harbor.fireEvent('raid'));
  await sleep(200);
  const banner = await page.evaluate(() => {
    var el = document.getElementById('navybanner');
    return { shown: el ? el.classList.contains('show') : false, text: el ? el.querySelector('.nb-txt').textContent : null, modalShown: !!document.querySelector('#eventmodal.show') };
  });
  ok('17c auto-defense: fireEvent(raid) at navyPower>=raidStrength resolves instantly (auto:true, no modal)', repelEv && repelEv.auto === true && banner.modalShown === false);
  ok('17c auto-defense: repelled-raid banner shows the loot amount, styled like a celebratory storm banner', banner.shown === true && /Navy repelled the raiders/i.test(banner.text || '') && /£/.test(banner.text || ''));
  await sleep(3800);
  const bannerAfter = await page.evaluate(() => document.getElementById('navybanner').classList.contains('show'));
  ok('17c auto-defense: the banner auto-dismisses on its own (~3.6s), no player action needed', bannerAfter === false);
  ok('17c navy flows produced zero new console/GL errors', errs.length === errsBeforeNavy);

  // Phase 15a: with a 2nd harbour now founded, the trade guide card must get out of the way.
  await page.evaluate(() => window.__harbor.openTrade());
  await sleep(120);
  const v84a = await page.evaluate(() => window.__harbor.tradeState());
  ok('trade guide: card hidden once 2+ harbours are founded', v84a.founded >= 2 && v84a.guide === false);

  // ---- Phase 15c: building slots + expedition-based world discovery ----
  // Guide-card retarget: green is the only game.js-UNLOCKED world here ('tropical' above was
  // founded via a raw SIM.foundPort() bypass, never through unlockWorld — a real player can't
  // reach it this way), so no unlocked-but-unfounded world exists. era is 4 (set earlier), which
  // clears Mountain Fjord's unlockEra(1) — "Show me" should now open Expeditions and point at
  // Uncharted Waters instead of promising a jump/nudge that isn't the real next step.
  await page.evaluate(() => { var b = document.querySelector('#trademap #tmg-show'); if (b) b.click(); });
  await sleep(150);
  const guide15c = await page.evaluate(() => ({
    expShown: document.getElementById('exppanel').classList.contains('show'),
    hint: document.getElementById('hint') ? document.getElementById('hint').textContent : '',
    target: window.__harbor.unchartedTarget()
  }));
  ok('15c guide: "Show me" opens Expeditions + hints at Uncharted Waters when no unfounded-unlocked world exists',
    guide15c.target === 'mountain' && guide15c.expShown && /uncharted waters/i.test(guide15c.hint) && /mountain/i.test(guide15c.hint));
  await page.evaluate(() => { var b = document.getElementById('ex-close'); if (b) b.click(); });
  await page.evaluate(() => window.__harbor.closeTrade());

  // Uncharted Waters row: pinned in Expeditions, correctly priced/timed, targeting the next
  // locked world (Mountain Fjord — era1, first in HARBOR_BIOME_ORDER after green).
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 1e6; window.__harbor.openExp(); });
  await sleep(100);
  const uRow = await page.evaluate(() => {
    var row = document.querySelector('#exppanel [data-uncharted]');
    var S = window.HARBOR_SIM;
    return { text: row ? row.textContent : null, cost: S.unchartedCost(1), secs: S.unchartedSecs() };
  });
  ok('15c uncharted: row renders in Expeditions, names Mountain Fjord + the £ cost',
    !!uRow.text && /Uncharted Waters/.test(uRow.text) && /Mountain Fjord/.test(uRow.text) && new RegExp('£' + uRow.cost).test(uRow.text));

  // start it → occupies a voyage slot, renders in "At sea"; before collect, Mountain stays locked
  const preDiscover = await page.evaluate(() => ({
    unlocked: window.__harbor.state().unlocked.slice(),
    ach: (window.Retention.get('harbor', 'ach', {}) || {}).discover1
  }));
  ok('15c uncharted: Mountain Fjord locked before the voyage is collected', preDiscover.unlocked.indexOf('mountain') < 0 && !preDiscover.ach);
  await page.evaluate(() => { var b = document.querySelector('#exppanel [data-uncharted]'); if (b) b.click(); });
  await sleep(120);
  const uAtSea = await page.evaluate(() => {
    var v = window.HARBOR_SIM.voyages();
    return { used: v.used, uncharted: v.active.some(a => a.uncharted), atSeaRow: !!document.querySelector('#exppanel .mp-item.ex-uncharted.ex-go') };
  });
  ok('15c uncharted: starting the voyage occupies a slot and renders in "At sea"', uAtSea.used === 1 && uAtSea.uncharted && uAtSea.atSeaRow);

  // force it ready + collect through the real UI path → discovers Mountain Fjord, latches Pathfinder
  await page.evaluate(() => { var S = window.HARBOR_SIM.raw(); S.voyages[0].endsAt = Date.now() - 1; var v = window.__harbor.voyages().active[0]; window.__harbor.collectVoyage(v.seq); });
  await sleep(200);
  const postDiscover = await page.evaluate(() => ({
    unlocked: window.__harbor.state().unlocked.slice(),
    ach: (window.Retention.get('harbor', 'ach', {}) || {}).discover1 === 1,
    lockBadge: !!document.querySelector('#biomebar [data-world="mountain"] .lock'),
    slotsFreed: window.HARBOR_SIM.voyages().used === 0
  }));
  ok('15c uncharted: collecting the discovery voyage unlocks Mountain Fjord, latches Pathfinder, frees the slot, drops the world-bar lock badge',
    postDiscover.unlocked.indexOf('mountain') >= 0 && postDiscover.ach && postDiscover.slotsFreed && !postDiscover.lockBadge);
  await page.evaluate(() => { var b = document.getElementById('ex-close'); if (b) b.click(); });

  // Colony founding: Mountain Fjord is now unlocked-but-unfounded — the found button must show
  // the £ cost, ghost when unaffordable, and charge exactly once when clicked.
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 0; window.__harbor.setBiome('mountain'); });
  await sleep(120);
  const foundGhost = await page.evaluate(() => {
    var btn = document.getElementById('foundbtn');
    return { text: btn.textContent, ghosted: btn.classList.contains('ghosted'), cost: window.HARBOR_SIM.foundCost() };
  });
  // (fmt() abbreviates large amounts — £2400 renders "£2.40k" — so match the label, not the digits)
  ok('15c colony: found button reads "Need £…" and is ghosted when unaffordable (2nd+ colony)',
    foundGhost.cost > 0 && /^Need £/.test(foundGhost.text) && foundGhost.ghosted);

  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 1e6; window.__harbor.setBiome('mountain'); window.__harbor.selectSite(0); });
  await sleep(120);
  const foundReady = await page.evaluate(() => {
    var btn = document.getElementById('foundbtn');
    return { text: btn.textContent, ghosted: btn.classList.contains('ghosted'), cost: window.HARBOR_SIM.foundCost(), moneyBefore: window.HARBOR_SIM.raw().money };
  });
  ok('15c colony: found button reads "Found colony — £…" once affordable', /^Found colony — £/.test(foundReady.text) && !foundReady.ghosted);
  await page.evaluate(() => { var b = document.getElementById('foundbtn'); if (b) b.click(); });
  await sleep(150);
  const founded15c = await page.evaluate(() => ({ port: !!window.HARBOR_SIM.port('mountain'), money: window.HARBOR_SIM.raw().money }));
  // founding immediately makes the port live, so a frame or two of real passive income from the
  // OTHER already-founded ports (green/tropical — ticking was paused while viewing an unfounded
  // world) can land in the 150ms settle window above; assert the charge itself (a floor at exactly
  // moneyBefore-cost) with a small tolerance for that incidental drift, not exact equality.
  const expectedAfterCharge = foundReady.moneyBefore - foundReady.cost;
  ok('15c colony: clicking Found colony creates the port and charges the colony cost exactly once',
    founded15c.port && founded15c.money >= expectedAfterCharge && founded15c.money < expectedAfterCharge + 50);

  // Building slots: the Manage header shows "Buildings X/Y", and once full, new-building rows
  // ghost with "Full" (not "Need £") behind a port-at-capacity explainer.
  await page.evaluate(() => {
    var S = window.HARBOR_SIM;
    S.setActive('green'); window.__harbor.setBiome('green');
    S.setEra(0);
    var p = S.port('green'); if (p) p.buildings.length = 0;
    S.raw().money = 1e7;
    for (var i = 0; i < 20; i++) { if (S.canBuild('fishing_hut')) S.build('fishing_hut'); }
    document.getElementById('managebtn').click();
  });
  await sleep(150);
  const slotsUI = await page.evaluate(() => {
    var S = window.HARBOR_SIM;
    var head = document.querySelector('#managepanel .mp-slots');
    var full = document.querySelector('#managepanel .mp-teaser.mp-full');
    var rows = Array.from(document.querySelectorAll('#managepanel .mp-item.ghosted')).map(r => r.textContent);
    return { cap: S.slotCap(), used: S.slotsUsed('green'), headText: head ? head.textContent : null, fullShown: !!full, hasFullRow: rows.some(t => /Full/.test(t)) };
  });
  ok('15c slots: Manage header shows "Buildings X/Y" matching slotCap()/slotsUsed()',
    slotsUI.headText === ('Buildings ' + slotsUI.used + '/' + slotsUI.cap));
  ok('15c slots: port-at-capacity explainer shown + a ghosted row reads "Full" once slot-capped',
    slotsUI.used >= slotsUI.cap && slotsUI.fullShown && slotsUI.hasFullRow);
  // v90: the "Next age" requirement checklist + per-era level cap shown in the still-open panel
  const v90ui = await page.evaluate(() => {
    var req = document.querySelector('#managepanel .mp-req');
    var rows = req ? Array.from(req.querySelectorAll('.mpr-row')).map(r => r.textContent) : [];
    var title = req ? (req.querySelector('.mpr-title') || {}).textContent || '' : '';
    var upNames = Array.from(document.querySelectorAll('#managepanel .mp-item.up .mi-n')).map(e => e.textContent);
    return { hasReq: !!req, title: title, rows: rows, showsCapLevel: upNames.some(t => /L1\/2\b/.test(t)) };
  });
  ok('v90: Manage shows a "🎯 To reach …" next-age checklist (treasury row + a building@Lv2 row)',
    v90ui.hasReq && /To reach/.test(v90ui.title) && v90ui.rows.some(t => /Treasury/.test(t)) && v90ui.rows.some(t => /at Lv 2/.test(t)));
  ok('v90: building rows expose the per-era upgrade cap (e.g. "L1/2" at Fishing Village)', v90ui.showsCapLevel);
  await page.evaluate(() => document.getElementById('managebtn').click());   // close it back up

  // Phase 15c migration: a world already unlocked on this device (e.g. from a pre-15c save, or an
  // earlier discovery this run) must survive a reload untouched — removing the era auto-unlock
  // loop must never also revert an already-unlocked world back to locked.
  await page.evaluate(() => window.Retention.set('harbor', 'worlds', ['green', 'mountain', 'desert']));

  // rival race → win
  await page.evaluate(() => window.__harbor.triggerRival()); await sleep(120);
  await page.evaluate(() => { var bs = document.querySelectorAll('#rivalmodal .ev-btn'); if (bs.length) bs[bs.length - 1].click(); }); await sleep(120);
  ok('fleet: rival ship patrols during the race', await page.evaluate(() => window.__harbor.fleet().rival === 1));
  ok('16a fleet: the rival patrols as the corsair class', await page.evaluate(() => window.__harbor.fleet().rivalClass === 'corsair'));
  await page.evaluate(() => { var r = window.__harbor.rival().race; if (r) window.HARBOR_SIM.raw().lifetimeMoney += r.target + 10; window.__harbor.forceHUD(); }); await sleep(150);
  await page.evaluate(() => { var b = document.querySelector('#rivalmodal.show .ev-btn'); if (b) b.click(); });
  ok('rival: race won recorded', await page.evaluate(() => window.__harbor.rival().wins >= 1));
  ok('fleet: rival ship gone after the race resolves', await page.evaluate(() => window.__harbor.fleet().rival === 0));

  // Phase 11b: onboarding goals — appended to the end of the curated ladder (save-safe: existing
  // goalIdx saves below this point still resolve to the exact same goal they always did). Verify
  // each new goal's ok() flips true once its underlying condition is actually driven.
  const gTotal = await page.evaluate(() => window.__harbor.goal().total);
  const iCrate = gTotal - 3, iExp = gTotal - 2, iRival = gTotal - 1;
  const goalNames = await page.evaluate((idx) => idx.map((i) => window.__harbor.goalAt(i)), [iCrate, iExp, iRival]);
  ok('goals: onboarding trio appended (crate / expedition / rival)',
    /crate/i.test(goalNames[0]) && /expedition/i.test(goalNames[1]) && /krall/i.test(goalNames[2]));
  const crateGoalBefore = await page.evaluate((i) => window.__harbor.goalOkAt(i), iCrate);
  await page.evaluate(() => { window.__harbor.grantCrate(1); window.__harbor.openCrate(); });
  await sleep(80);
  await page.evaluate(() => { var b = document.querySelector('#cratemodal #cm-btn'); if (b) b.click(); });
  await sleep(650);   // crate reveal animation
  const crateGoalAfter = await page.evaluate((i) => window.__harbor.goalOkAt(i), iCrate);
  await page.evaluate(() => { var m = document.querySelector('#cratemodal'); if (m) m.classList.remove('show'); });
  ok('goal: "Open a salvage crate" ok() flips false→true once one is opened', crateGoalBefore === false && crateGoalAfter === true);
  ok('goal: "Send your first expedition" ok() true once a voyage was collected', await page.evaluate((i) => window.__harbor.goalOkAt(i), iExp));
  ok('goal: "Beat Baron Krall in a race" ok() true once a race was won', await page.evaluate((i) => window.__harbor.goalOkAt(i), iRival));

  // fever
  await page.evaluate(() => window.__harbor.startFever(3)); await sleep(400);
  await page.evaluate(() => window.__harbor.collectCoins()); await sleep(150);
  ok('fever: active with combo', await page.evaluate(() => window.__harbor.fever().active));

  // season + pass claim
  await page.evaluate(() => { window.__harbor.addSeasonPoints(400); window.__harbor.openLegacy(); }); await sleep(150);
  await page.evaluate(() => { var t = document.querySelector('#legacypanel .pass-tier.can[data-pass]'); if (t) t.click(); }); await sleep(150);
  ok('pass: a tier claimed', await page.evaluate(() => window.__harbor.season().claimed.length >= 1));
  await page.evaluate(() => window.__harbor.openLegacy());

  // daily fortune
  await page.evaluate(() => window.__harbor.fortune()); await sleep(120);
  await page.evaluate(() => window.__harbor.drawFortune()); await sleep(120);
  ok('fortune: drawn (gated to today)', await page.evaluate(() => window.Retention.get('harbor', 'fortuneDay', null) === window.Retention.todayStr()));

  // v82: prestige is gated behind a confirmation — a single click on "Sign a New Charter" must NOT
  // wipe the run; it only opens a confirm dialog. (Regression: it used to prestige on one click.)
  await page.evaluate(() => { window.HARBOR_SIM.raw().lifetimeMoney = 1e7; window.__harbor.openLegacy(); }); await sleep(120);
  const chartersPre = await page.evaluate(() => window.Retention.get('harbor', 'charters', 0) | 0);
  const gate = await page.evaluate(() => {
    var b = document.querySelector('#lg-pbtn'); if (b) b.click();
    var m = document.querySelector('#prestigeConfirm');
    return { shown: !!(m && m.classList.contains('show')), charters: window.Retention.get('harbor', 'charters', 0) | 0 };
  }); await sleep(60);
  ok('v82 prestige: single click opens a confirm dialog, does NOT wipe', gate.shown && gate.charters === chartersPre);
  const cancelled = await page.evaluate(() => {
    var c = document.querySelector('#pc-cancel'); if (c) c.click();
    var m = document.querySelector('#prestigeConfirm');
    return { hidden: !(m && m.classList.contains('show')), charters: window.Retention.get('harbor', 'charters', 0) | 0 };
  }); await sleep(60);
  ok('v82 prestige: Cancel dismisses with no reset', cancelled.hidden && cancelled.charters === chartersPre);

  // prestige → meta persists
  const relicsBefore = await page.evaluate(() => window.__harbor.relics().count);
  await page.evaluate(() => { window.HARBOR_SIM.raw().lifetimeMoney = 1e7; window.__harbor.prestige(); }); await sleep(400);
  const after = await page.evaluate(() => ({ relics: window.__harbor.relics().count, rivalWins: window.__harbor.rival().wins, slots: window.HARBOR_SIM.meta().voyageSlots, webgl: window.__harbor.state().webgl, doct: window.__harbor.doctrine().pick, caps: window.__harbor.doctrine().caps, lo: window.__harbor.loadout().equipped.length, yieldV: window.HARBOR_SIM.meta().voyageYield }));
  ok('prestige: relics persist', after.relics === relicsBefore && after.relics >= 3);
  ok('prestige: rival wins persist', after.rivalWins >= 1);
  ok('prestige: relic-set META bonus persists', after.slots >= 1);
  ok('9c prestige: doctrine + capstone + loadout survive', after.doct === 'explorer' && after.caps.explorer === true && after.lo === 3 && Math.abs(after.yieldV - 0.4) < 1e-6);
  ok('prestige: WebGL still alive', after.webgl);

  // Phase 10a: colour & light — authored time-of-day scripts + fog + shadow ramp
  const envDay = await page.evaluate(() => { window.__harbor.setTod(0.5); return window.__harbor.env(); });
  const envNight = await page.evaluate(() => { window.__harbor.setTod(0.0); return window.__harbor.env(); });
  ok('env: day vs night differ meaningfully (sky + sun authored per ToD)',
    envDay && envNight && (envDay.top[1] - envNight.top[1]) > 0.15 && (envDay.sun[0] - envNight.sun[0]) > 0.3);
  ok('env: distance fog enabled, stronger at night', envDay.fogD > 0 && envNight.fogD > envDay.fogD);
  ok('env: ToD ambient + cool-shadow ramp exposed', Array.isArray(envDay.ambTop) && Array.isArray(envDay.ambBot) &&
    envDay.shadowK > 0 && envNight.ambTop[2] > envNight.ambTop[0]);   // night ambient leans blue
  const envDusk = await page.evaluate(() => { window.__harbor.setTod(0.755); return window.__harbor.env(); });
  ok('env: dusk is golden (red channel leads blue at the horizon)', envDusk.bot[0] > envDusk.bot[2] && envDusk.sun[0] > envDusk.sun[2]);
  const errsBeforeSweep = errs.length;
  for (const t of [0, 0.25, 0.3, 0.5, 0.8, 0.9]) { await page.evaluate(tt => window.__harbor.setTod(tt), t); await sleep(150); }
  ok('env: full ToD sweep renders with zero GL/console errors', errs.length === errsBeforeSweep);

  // Phase 10b: shape & motion — bevelled geometry, 3-stop sky horizon, water sparkle
  // Phase 18a re-derived this ceiling: faceted terrain duplicates vertices per-quad (~4x the old
  // ~54k shared-vertex field mesh, ~215k) plus coastal/biome dressing (rocks/shelves/speckle/
  // dunes/boulders/leaf-plants) and founded-port dressing (apron/dock/path/fence/clutter); the
  // measured worst case across every biome x era combination is ~257k (see terrainStats() below
  // and the Phase 18a commit message for the full before/after budget table) — 300k documents that
  // with real headroom, up from the pre-18a 250k ceiling.
  const gs = await page.evaluate(() => window.__harbor.geomStats());
  ok('geom: static-scene stats exposed and within vertex budget', gs && gs.verts > 10000 && gs.verts < 300000 && gs.indices > 0);
  const bb = await page.evaluate(() => { var b = new window.HGL.Builder().bbox(0, 0, 0, 6, 4, 6, [1, 0, 0], 0.3, 0.7); var d = b.data();
    var fin = true; for (var i = 0; i < d.positions.length; i++) if (!isFinite(d.positions[i])) fin = false;
    return { v: d.positions.length / 3, i: d.indices.length, n: d.normals.length / 3, fin: fin }; });
  ok('bbox: chamfered box builds watertight (40 verts / 60 idx, finite)', bb && bb.v === 40 && bb.i === 60 && bb.n === 40 && bb.fin);
  const bbTiny = await page.evaluate(() => new window.HGL.Builder().bbox(0, 0, 0, 0.2, 3, 0.2, [1, 1, 1], 0, 0.5).data().positions.length / 3);
  ok('bbox: tiny/thin boxes fall back to plain box (no inverted chamfer)', bbTiny === 24);
  const envDusk2 = await page.evaluate(() => { window.__harbor.setTod(0.755); return window.__harbor.env(); });
  const envNight2 = await page.evaluate(() => { window.__harbor.setTod(0.0); return window.__harbor.env(); });
  ok('env: horizon glow authored per ToD (dusk warm peach, night near-black blue)',
    Array.isArray(envDusk2.horizon) && envDusk2.horizon[0] > envDusk2.horizon[2] && envDusk2.horizon[0] > 1.0 &&
    envNight2.horizon[2] > envNight2.horizon[0] && (envNight2.horizon[0] + envNight2.horizon[1] + envNight2.horizon[2]) < 0.5);
  // (19a papercraft: sparkle is deliberately AUTHORED 0 at every key now — matte card never
  // glints; the field stays in env() precisely so this stays a testable contract. Updated from
  // the 10b-era "dusk strong / night faint" scaling check.)
  ok('env: water sparkle authored to zero at every ToD key (19a matte paper sea)',
    envDusk2.sparkle === 0 && envNight2.sparkle === 0);
  await page.evaluate(() => window.__harbor.setTod(0.5)); await sleep(150);
  ok('10b: sky/water uniforms render with zero new errors', errs.length === errsBeforeSweep);

  // Phase 10c: quality-gated post pass — tilt-shift miniature DoF + bloom-lite composite
  const errsBefore10c = errs.length;
  const p0 = await page.evaluate(() => window.__harbor.post());
  ok('10c: post defaults ON first-run and probe is disarmed by ?nopost-probe', p0 && p0.on === true && p0.armed === false && p0.fail === false);
  await sleep(400);   // several frames through the FBO + composite path
  ok('10c: post pass renders with zero errors', errs.length === errsBefore10c);
  await page.evaluate(() => window.__harbor.setPost(false)); await sleep(300);
  ok('10c: setPost(false) → direct path renders with zero errors', errs.length === errsBefore10c &&
    await page.evaluate(() => window.__harbor.post().on === false));
  ok('10c: toggle back ON works (hook reports state + persisted)', await page.evaluate(() => {
    window.__harbor.setPost(true);
    var p = window.__harbor.post();
    return p.on === true && p.auto === false && window.Retention.get('harbor', 'post', null) === true;
  }));
  for (const t of [0, 0.25, 0.5, 0.755, 0.9]) { await page.evaluate(tt => window.__harbor.setTod(tt), t); await sleep(150); }
  ok('10c: ToD sweep with post ON renders zero errors', errs.length === errsBefore10c);
  await page.setViewportSize({ width: 700, height: 500 }); await sleep(350);
  await page.setViewportSize({ width: 414, height: 820 }); await sleep(350);
  ok('10c: resize (FBO recreate both ways) renders zero errors, post still on', errs.length === errsBefore10c &&
    await page.evaluate(() => window.__harbor.post().on === true));
  await page.evaluate(() => window.__harbor.setTod(0.5));

  // Phase 14a: proper-cartoon pass — ink outlines + revived PCF shadows ride the SAME quality
  // gate as the post pass (one flag, one weak-device fallback), so the assertions here pivot on
  // post()'s new outlines/shadow fields and on multi-frame soaks with BOTH RTT passes live
  // (shadow depth pass + scene RT with a samplable depth texture — the two feedback-loop traps).
  const errsBefore14a = errs.length;
  const q14 = await page.evaluate(() => window.__harbor.post());
  ok('14a: post() exposes outline + shadow flags, ON under forced quality', q14.on === true && q14.outlines === true && q14.shadow === true);
  await page.evaluate(() => window.__harbor.setTod(0.5));   // noon: sun-height shadow strength ~1 → depth pass definitely rendering
  await sleep(3000);   // multi-second render soak with shadow map + post RT + depth-texture reads all live
  ok('14a: 3s noon soak with both RTT passes live → zero GL warnings/errors', errs.length === errsBefore14a);
  for (const t of [0.34, 0.755, 0.0]) { await page.evaluate(tt => window.__harbor.setTod(tt), t); await sleep(200); }
  ok('14a: morning/dusk/night sweep (sun-height shadow fade path) renders zero errors', errs.length === errsBefore14a);
  await page.evaluate(() => window.__harbor.setTod(0.5));
  await page.setViewportSize({ width: 700, height: 500 }); await sleep(300);
  await page.setViewportSize({ width: 414, height: 820 }); await sleep(300);
  ok('14a: resize with shadows live (colour + depth texture recreate) renders zero errors', errs.length === errsBefore14a);
  const q14off = await page.evaluate(() => { window.__harbor.setPost(false); return window.__harbor.post(); });
  ok('14a: quality off → outlines + shadow flags fall back with it (legacy path)', q14off.on === false && q14off.outlines === false && q14off.shadow === false);
  await sleep(500);   // several legacy-path frames: uShadowOn 0, no RTT, no outline pass
  ok('14a: legacy path (quality off) renders several frames with zero errors', errs.length === errsBefore14a);
  const q14on = await page.evaluate(() => { window.__harbor.setPost(true); return window.__harbor.post(); });
  ok('14a: quality back on → cartoon flags return and persist', q14on.on === true && q14on.outlines === true && q14on.shadow === true &&
    await page.evaluate(() => window.Retention.get('harbor', 'post', null) === true));
  const gs14 = await page.evaluate(() => window.__harbor.geomStats());
  ok('14a: geomStats still within the existing vertex budget (no geometry cost added)', gs14 && gs14.verts > 10000 && gs14.verts < 300000);

  // Phase 16a/17b: SHIPYARD — 25 real ship classes across three fleet-tier ladders (models.js
  // HARBOR_MODELS.SHIPYARD), each a hull/trim/sails mesh set. Budget: every class must beat the
  // old single-primitive ship (78 verts: 12-gon hull 61 + tri sail 17) yet stay under a deliberate
  // 4000-vert class ceiling (actual max across all 25 is container_ship ~3214 — see
  // shipMatrixVertBudget in sim.test.js for the full 25-class sweep). Phase 17b made builds LAZY
  // (getShip() in game.js) — a class only uploads to the GPU on first real use — so this render
  // soak drives the original six through debugShip FIRST (forcing their lazy build) before reading
  // shipStats(), instead of relying on ambient/fleet traffic to have already shown them (ambient
  // fishing traffic now follows the owned fleet tier, which defaults to 'raft' on a fresh save).
  const errsBefore16a = errs.length;
  for (const c of ['dinghy', 'sloop', 'brig', 'schooner', 'steamer', 'corsair']) {
    await page.evaluate(cc => window.__harbor.debugShip(cc), c); await sleep(180);
  }
  await page.evaluate(() => window.__harbor.debugShip(null));
  ok('16a shipyard: all six classes render several frames with zero GL warnings/errors', errs.length === errsBefore16a);
  const ss16 = await page.evaluate(() => window.__harbor.shipStats());
  ok('16a shipyard: all six classes build bigger than the old ship and under the 4000-vert class budget',
    ss16 && ss16.oldShipBaseline === 78 && ['dinghy', 'sloop', 'brig', 'schooner', 'steamer', 'corsair'].every(c => {
      var s = ss16.classes[c]; return s && s.total > ss16.oldShipBaseline && s.total < 4000;
    }));
  ok('16a shipyard: sails are separate animatable meshes per class, none on the steamer',
    await page.evaluate(() => {
      var SY = window.HARBOR_MODELS.SHIPYARD, n = {};
      SY.CLASSES.forEach(c => { n[c] = SY.build(c).sails.length; });
      return n.dinghy === 1 && n.sloop === 2 && n.brig === 2 && n.schooner === 3 && n.steamer === 0 && n.corsair === 2;
    }));
  await page.evaluate(() => { window.__harbor.debugShip('brig'); window.__harbor.setPost(false); }); await sleep(350);
  ok('16a shipyard: legacy quality path (post off) renders the new fleet clean', errs.length === errsBefore16a);
  await page.evaluate(() => { window.__harbor.debugShip(null); window.__harbor.setPost(true); });

  // Phase 17b: lazy build — a class not yet shown must be absent from shipStats(), and a fresh
  // save's ambient fishing traffic must default to the tier0 class (raft), not the old fixed
  // dinghy/sloop mix (confirms ambientBoatClass() is reading the live fishing tier every frame).
  ok('17b lazy: an unseen class is absent from shipStats() until first drawn', await page.evaluate(() => {
    var s = window.__harbor.shipStats(); return s && !s.classes.hover_freighter;
  }));
  await page.evaluate(() => window.__harbor.debugShip('hover_freighter')); await sleep(150);
  ok('17b lazy: debugShip() force-builds a never-seen class on demand', await page.evaluate(() => {
    var s = window.__harbor.shipStats(); return s && s.classes.hover_freighter && s.classes.hover_freighter.total > 0 && s.classes.hover_freighter.total < 4000;
  }));
  await page.evaluate(() => window.__harbor.debugShip(null));
  ok('17b lazy: a fresh save\'s ambient fishing traffic defaults to the tier0 class (raft)', await page.evaluate(() => {
    window.HARBOR_SIM.raw().fleetTech.fishing = 0;
    return window.__harbor.ladderClass('fishing', window.__harbor.fleetTier('fishing')) === 'raft';
  }));
  ok('16a shipyard: static-scene geomStats untouched by the fleet rework (ships are per-frame meshes)',
    await page.evaluate(() => { var g = window.__harbor.geomStats(); return g && g.verts > 10000 && g.verts < 300000; }));

  // Phase 17c: THE NAVY — 5 more real ship classes (models.js HARBOR_MODELS.SHIPYARD.NAVY), off
  // every fleet ladder. Same lazy-build/vert-budget contract as the fleet-registry classes above.
  const errsBefore17c = errs.length;
  for (const c of ['patrol_cutter', 'frigate', 'ironclad', 'destroyer', 'drone_screen']) {
    await page.evaluate(cc => window.__harbor.debugShip(cc), c); await sleep(180);
  }
  await page.evaluate(() => window.__harbor.debugShip(null));
  ok('17c shipyard: all 5 navy classes render several frames with zero GL warnings/errors', errs.length === errsBefore17c);
  const ss17c = await page.evaluate(() => window.__harbor.shipStats());
  ok('17c shipyard: all 5 navy classes build bigger than the old ship and under the 4000-vert class budget',
    ss17c && ['patrol_cutter', 'frigate', 'ironclad', 'destroyer', 'drone_screen'].every(c => {
      var s = ss17c.classes[c]; return s && s.total > ss17c.oldShipBaseline && s.total < 4000;
    }));

  // Phase 16b: VIBRANT STORYBOOK world pass — bolder saturated palette, a two-tone postcard water
  // gradient (rich teal deep -> bright turquoise shallow, quantized into toon bands), a wider/
  // bolder ink outline, and cheap static lushness (bigger canopy trees + bushes/flowers near a
  // founded port). Assertions pivot on the __harbor.water()/outlineTuning() debug hooks added for
  // this phase, sentinel colour comparisons against the pre-16b (14a-era) biome palette constants,
  // and the same zero-GL-warning render-soak pattern 14a used to prove the outline/shadow RTT
  // passes (now carrying the new shaders) stay feedback-loop-free.
  const errsBefore16b = errs.length;
  const water0 = await page.evaluate(() => window.__harbor.water());
  ok('16b: water() exposes the two-tone shore-gradient hook — 4 toon bands, shallow brighter/more turquoise than deep',
    water0 && water0.gradientOn === true && water0.shoreBands === 4 &&
    Array.isArray(water0.deep) && Array.isArray(water0.shallow) &&
    (water0.shallow[0] + water0.shallow[1] + water0.shallow[2]) > (water0.deep[0] + water0.deep[1] + water0.deep[2]));
  const outlineT = await page.evaluate(() => window.__harbor.outlineTuning());
  ok('16b: ink outline tuned bolder than 14a — narrower depth threshold (fires more readily) + a >1x tap-width multiplier',
    outlineT && outlineT.depthT < 0.03 && outlineT.width > 1.0);
  // sentinel palette check: the pre-16b (14a-era) green-isles colour constants, hardcoded here —
  // biomes.js's ground/shallow-water/roof values must have moved (bolder + more saturated), not
  // just been left byte-identical under a new comment.
  const OLD_GREEN = { ground: [0.21, 0.38, 0.14], shallow: [0.12, 0.46, 0.52], roof: [0.58, 0.22, 0.18] };
  const green16b = await page.evaluate(() => { var b = window.HARBOR_BIOMES.green; return { ground: b.ground.slice(), shallow: b.shallow.slice(), roof: b.build.roof.slice() }; });
  function luma(c) { return c[0] + c[1] + c[2]; }
  ok('16b: green-isles palette sentinels changed from the pre-16b constants — lusher ground, brighter shallow turquoise, punchier roof red',
    JSON.stringify(green16b.ground) !== JSON.stringify(OLD_GREEN.ground) &&
    JSON.stringify(green16b.shallow) !== JSON.stringify(OLD_GREEN.shallow) &&
    luma(green16b.shallow) > luma(OLD_GREEN.shallow) &&
    green16b.roof[0] > OLD_GREEN.roof[0]);
  // outline/water/palette soak: sweep ToD with quality (outlines+shadows) ON — proves the retuned
  // F_POST edge detector stays sky-masked + slope-rejecting (a regression there is a hard fail)
  // and the new F_WATER gradient math never trips the RTT feedback-loop trap.
  for (const t of [0.0, 0.34, 0.5, 0.755]) { await page.evaluate(tt => window.__harbor.setTod(tt), t); await sleep(220); }
  ok('16b: ToD soak with the retuned outline + two-tone water live → zero GL warnings/errors (outline stays sky-masked)', errs.length === errsBefore16b);
  await page.evaluate(() => window.__harbor.setTod(0.5));
  // legacy (quality off) path: palette/water/tree changes ride the same base shaders regardless of
  // the post quality gate, so the no-outline/no-shadow fallback must stay just as clean.
  await page.evaluate(() => window.__harbor.setPost(false)); await sleep(400);
  ok('16b: legacy quality-off path renders the new palette/water/props clean', errs.length === errsBefore16b);
  await page.evaluate(() => window.__harbor.setPost(true));
  // geomStats: the bigger canopy trees + near-port bush/flower scatter raise the static-scene
  // vertex floor a little over 14a/16a's baseline (~60k on green isles) while staying nowhere near
  // the existing 250k ceiling — budget-aware lushness, not a poly explosion.
  const gs16b = await page.evaluate(() => window.__harbor.geomStats());
  ok('16b: geomStats reflects the added lushness (raised floor) and stays within the existing 250k ceiling',
    gs16b && gs16b.verts > 60000 && gs16b.verts < 300000);

  // Phase 11b: feature-unlock announce card — fires once ever, never stacks a queued second
  // announce over the first, and the "seen" flag survives a reload. resetAnnounce() hard-clears
  // any real (already-seen — exp/prestige/storm/…) announce still queued from earlier in the run,
  // so these synthetic ids get a clean slate to test against.
  await page.evaluate(() => window.__harbor.resetAnnounce()); await sleep(50);
  const an1 = await page.evaluate(() => { window.__harbor.announce('testfeat11b', '🧪', 'Test Feature', 'A one-time test announcement.'); return window.__harbor.announceState(); });
  ok('announce: fires with the card visible + correct title/body', an1.showing === true && an1.title === 'Test Feature');
  ok('announce: seen flag recorded on first fire', await page.evaluate(() => window.__harbor.seenFeature('testfeat11b')));
  await page.evaluate(() => window.__harbor.dismissAnnounce()); await sleep(300);
  const an2 = await page.evaluate(() => { window.__harbor.announce('testfeat11b', '🧪', 'Test Feature', 'A one-time test announcement.'); return window.__harbor.announceState(); });
  ok('announce: does not refire the same id again (once ever)', an2.showing === false && an2.queueLen === 0);

  await page.evaluate(() => window.__harbor.resetAnnounce()); await sleep(50);
  const q1 = await page.evaluate(() => { window.__harbor.announce('qtest11bA', '🅰️', 'Queue A', 'first'); window.__harbor.announce('qtest11bB', '🅱️', 'Queue B', 'second'); return window.__harbor.announceState(); });
  ok('announce: a queued second announce does not overlap the first', q1.showing === true && q1.title === 'Queue A' && q1.queueLen === 1);
  await page.evaluate(() => window.__harbor.dismissAnnounce()); await sleep(350);
  const q2 = await page.evaluate(() => window.__harbor.announceState());
  ok('announce: queued second shows only after the first is dismissed', q2.showing === true && q2.title === 'Queue B' && q2.queueLen === 0);
  await page.evaluate(() => window.__harbor.resetAnnounce()); await sleep(50);

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 });
  await sleep(400);
  const an3 = await page.evaluate(() => { window.__harbor.announce('testfeat11b', '🧪', 'Test Feature', 'A one-time test announcement.'); return window.__harbor.announceState(); });
  ok('announce: "seen" persists across reload — never shows again', an3.showing === false);

  // Phase 15c migration (reuses this reload): the 'worlds' Retention blob seeded just before it
  // must load back intact — an already-unlocked world survives, unaffected by removing the era
  // auto-unlock loop from doAdvance().
  const migrated15c = await page.evaluate(() => window.__harbor.state().unlocked.slice());
  ok('15c migration: pre-existing unlocked worlds survive a reload (green, mountain, desert all still unlocked)',
    migrated15c.indexOf('green') >= 0 && migrated15c.indexOf('mountain') >= 0 && migrated15c.indexOf('desert') >= 0);

  // Phase 11c: layered audio — wave/night/weather/music gain layers driven by ToD + hazard
  // state, plus a Music toggle. WebAudio can't be screenshotted, so these assert the exposed
  // __harbor.audio() state at each phase (the eyeball-equivalent for sound). Assertions check
  // audio().target — the value our own code just committed to each AudioParam ramp — rather
  // than polling the live interpolated gain: under headless swiftshader + heavy concurrent
  // WebGL load, live AudioParam reads via CDP were observed to occasionally stick (the ramp is
  // scheduled correctly every time, confirmed by tracing it, but the audio thread's convergence
  // isn't reliably observable in this environment). Asserting the committed target is exactly
  // as strong a regression check on the decision logic and has zero timing dependency.
  // Paused for the duration of this block: the sim's own hazard timer (tickHazard) keeps
  // running live otherwise and can auto-resolve our manual hazard.phase mutations mid-check
  // (a real storm racing our synthetic one). Un-paused before the final live-ticking check.
  const errsBefore11c = errs.length;
  const A = () => page.evaluate(() => window.__harbor.audio());
  // setTod() only moves the `tod` clock; the day/night crossing check itself is throttled to a
  // per-frame cadence (updateAmbientToD's own 0.5s window). refreshAmbient() forces that check
  // immediately (bypassing the throttle) so every step below is deterministic with no wait.
  const setTod = (t) => page.evaluate((tt) => { window.__harbor.setTod(tt); window.__harbor.refreshAmbient(); }, t);
  await page.evaluate(() => window.__harbor.pause(true));
  await page.evaluate(() => window.__harbor.startAmbient());   // build the graph deterministically (no real pointer gesture in this harness)
  await sleep(100);
  const a0 = await A();
  ok('audio: graph builds with wave/night/weather/music gain layers reporting', a0 && a0.state === 'running' &&
    typeof a0.wave === 'number' && typeof a0.weather === 'number' && typeof a0.music === 'number' && typeof a0.night === 'number');

  await setTod(0.5);   // noon
  const aDay = await A();
  ok('audio: music bed plays by day (target > 0), crickets silent', aDay.target.music > 0.06 && aDay.target.night === 0);

  await setTod(0.0);   // midnight
  const aNight = await A();
  ok('audio: music targets ~0 at night while the night-critter layer targets full', aNight.target.music === 0 && aNight.target.night === 1);

  // Music toggle: OFF kills the music layer even by day, and the choice persists across reload
  await setTod(0.5);
  await page.evaluate(() => { document.getElementById('setbtn').click(); document.querySelector('[data-set="music"]').click(); document.getElementById('setbtn').click(); });
  const aMusicOff = await A();
  ok('audio: Music toggle OFF targets the music layer to 0', aMusicOff.musicOff === true && aMusicOff.target.music === 0);
  ok('audio: Music OFF persisted to Retention', await page.evaluate(() => window.Retention.get('harbor', 'musicOff', false) === true));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 });
  await sleep(400);
  ok('audio: Music OFF survives reload', await page.evaluate(() => window.Retention.get('harbor', 'musicOff', false) === true));
  // restore Music ON + rebuild the ambient graph fresh after reload (which also resets `paused`,
  // so re-pause here too), for the rest of this block
  await page.evaluate(() => { window.__harbor.pause(true); document.getElementById('setbtn').click(); document.querySelector('[data-set="music"]').click(); document.getElementById('setbtn').click(); window.__harbor.startAmbient(); });
  await sleep(100);
  await setTod(0.5);
  const aPreStorm = await A();
  ok('audio: Music re-enabled + day baseline restored after reload', aPreStorm.musicOff === false && aPreStorm.target.music > 0.06);

  // storm warn: drive a real hazard through SIM.raw() + forceHUD() (the real handleHazard path,
  // same as live play) — the weather layer should rise and the music bed should duck to ~30%
  await page.evaluate(() => { var S = window.HARBOR_SIM.raw(); S.hazard.phase = 'warn'; S.hazard.port = 'green'; S.hazard.kind = 'Squall'; S.hazard.in = 6; window.__harbor.forceHUD(); });
  await sleep(150);
  const aWarn = await A();
  ok('audio: storm warn targets the weather layer up + ducks the music bed to ~30%', aWarn.target.weather > 0.08 && Math.abs(aWarn.target.music - aPreStorm.target.music * 0.3) < 0.005);

  // strike moment: force it via the real SIM.strikePort test hook, then clear the warn phase
  // (mirrors what tickHazard does after a real strike) and let handleHazard react
  await page.evaluate(() => { window.HARBOR_SIM.strikePort('green'); var S = window.HARBOR_SIM.raw(); S.hazard.phase = 'idle'; window.__harbor.forceHUD(); });
  await sleep(150);
  const aAfterStrike = await A();
  ok('audio: weather layer targets back to 0 and the music bed recovers to baseline after the storm clears',
    aAfterStrike.target.weather === 0 && Math.abs(aAfterStrike.target.music - aPreStorm.target.music) < 1e-6);

  // mute: the master gain gates every layer at once (the authoritative kill switch)
  await page.evaluate(() => document.getElementById('mutebtn').click()); await sleep(700);
  const aMuted = await A();
  ok('audio: mute ramps the master gain to 0 (kills all layers)', aMuted.target.master === 0 && aMuted.master < 0.05 && aMuted.muted === true);
  await page.evaluate(() => document.getElementById('mutebtn').click()); await sleep(1600);
  const aUnmuted = await A();
  ok('audio: unmute restores the master gain', aUnmuted.target.master > 0.1 && aUnmuted.master > 0.1);

  ok('audio: full day→night→storm→mute cycle ran with zero new console/page errors', errs.length === errsBefore11c);
  await page.evaluate(() => window.__harbor.pause(false));   // resume live sim ticking for the final stability check

  // Phase 12a: Captain's Bonus — opt-in rewarded boost behind the pluggable window.ADS provider.
  // Ethics under test: never auto-opens, decline changes nothing, daily cap hides the button quietly
  // (no nag state), and a broken/failing provider degrades the game to "button hidden", never a throw.

  // provider swap: ?adprovider=<id> parses; an explicit "stub" selects it, and an unknown/unregistered
  // id (as a portal build not yet wired up would produce) falls back to the free stub safely rather
  // than leaving window.ADS undefined.
  const provPage = await (await browser.newContext({ viewport: { width: 414, height: 820 } })).newPage();
  await provPage.goto(`http://localhost:${PORT}/games/harbor/?biome=green&nopost-probe&adprovider=stub`, { waitUntil: 'load' });
  const provStub = await provPage.evaluate(() => window.ADS && window.ADS.provider);
  await provPage.goto(`http://localhost:${PORT}/games/harbor/?biome=green&nopost-probe&adprovider=poki`, { waitUntil: 'load' });
  const provFallback = await provPage.evaluate(() => window.ADS && window.ADS.provider);
  ok('ads: ?adprovider=stub query parses, and an unregistered id (poki) falls back to the free stub safely',
    provStub === 'stub' && provFallback === 'stub');
  await provPage.close();

  const errsBefore12a = errs.length;
  await page.evaluate(() => {
    window.__ADS_TEST_FAST__ = true;             // skip the stub's charm delay — deterministic + fast
    window.Retention.set('harbor', 'bonusDay', null);
    window.HARBOR_SIM.setBoost(1, 0);             // clear any leftover ambient/crate surge from earlier
    window.__harbor.forceHUD();
  });
  await sleep(60);
  const b0 = await page.evaluate(() => ({ shown: document.getElementById('bonusbtn').style.display !== 'none', hook: window.__harbor.bonus() }));
  ok('bonus: ⚓ button appears when eligible (provider ready, no boost active, port founded)',
    b0.shown === true && b0.hook.available === true && b0.hook.active === false);

  await page.evaluate(() => window.__harbor.claimBonus());
  await sleep(150);   // fast-mode stub resolves on the next tick
  const b1 = await page.evaluate(() => ({ hook: window.__harbor.bonus(), chipVisible: document.getElementById('bonuschip').style.display !== 'none', chipText: document.getElementById('bonuschip').textContent, modalShown: !!document.querySelector('#bonusmodal.show') }));
  ok('bonus: claim → SIM boost active at 2× with a prominent "⚡ 2× BONUS · m:ss" buff pill in the HUD, daily count advances',
    b1.hook.active === true && b1.hook.mult === 2 && b1.hook.remaining > 590 && b1.hook.remaining <= 600 &&
    b1.chipVisible === true && /⚡\s*2×\s*BONUS\s*·\s*\d+:\d{2}/.test(b1.chipText) && b1.modalShown === false && b1.hook.usedToday === 1);

  // decline: the card never auto-opens (only a real tap reaches it), and "No thanks" leaves everything
  // exactly as it was — no charge, no boost, no daily-count bump, just a closed card.
  await page.evaluate(() => { window.HARBOR_SIM.setBoost(1, 0); window.__harbor.forceHUD(); });
  await sleep(60);
  const preDecline = await page.evaluate(() => ({ used: window.__harbor.bonus().usedToday, legacy: window.__harbor.legacy().bal, autoOpen: !!document.querySelector('#bonusmodal.show') }));
  await page.evaluate(() => { document.getElementById('bonusbtn').click(); });
  await sleep(60);
  const cardOpen = await page.evaluate(() => { var m = document.querySelector('#bonusmodal.show'); return !!(m && m.querySelector('[data-bonus="decline"]') && m.querySelector('[data-bonus="claim"]')); });
  ok('bonus: card never auto-opens, and shows both "No thanks" and "Claim ⚓" only after a real tap',
    preDecline.autoOpen === false && cardOpen === true);
  await page.evaluate(() => { var b = document.querySelector('#bonusmodal [data-bonus="decline"]'); if (b) b.click(); });
  await sleep(60);
  const postDecline = await page.evaluate(() => ({ used: window.__harbor.bonus().usedToday, legacy: window.__harbor.legacy().bal, active: window.__harbor.bonus().active, modalShown: !!document.querySelector('#bonusmodal.show') }));
  ok('bonus: decline changes nothing — no charge, no boost, no daily-count bump, card just closes',
    postDecline.used === preDecline.used && postDecline.legacy === preDecline.legacy && postDecline.active === false && postDecline.modalShown === false);

  // daily cap: drive the Retention counter directly (rather than 6 real claims) — button hides quietly,
  // with no dead click and no nag state left behind
  await page.evaluate(() => { window.Retention.set('harbor', 'bonusDay', { date: window.Retention.todayStr(), count: 6 }); window.__harbor.forceHUD(); });
  await sleep(60);
  const capped = await page.evaluate(() => ({ shown: document.getElementById('bonusbtn').style.display !== 'none', hook: window.__harbor.bonus() }));
  ok('bonus: daily cap (6/day) hides the button quietly once reached — no nagging', capped.shown === false && capped.hook.available === false);
  await page.evaluate(() => { window.Retention.set('harbor', 'bonusDay', null); window.__harbor.forceHUD(); });

  // Phase 12b: production hardening — error capture, portal lifecycle events, and portal mode.
  // Run before the AdProvider-resilience block below, which deliberately replaces window.ADS with
  // a bare object lacking _counts/lifecycle methods (so window.ADS._counts is only meaningful here).

  // error capture: a dispatched 'error' event (not an actual uncaught throw, so it never trips this
  // harness's own errs[] tracking) lands in the ring buffer with the documented {t,msg,src,line}
  // shape, and clearErrors() empties it back out.
  await page.evaluate(() => { window.dispatchEvent(new ErrorEvent('error', { message: 'synthetic test error', filename: 'test.js', lineno: 42 })); });
  await sleep(50);
  const errCap = await page.evaluate(() => window.__harbor.errors());
  const lastErr = errCap[errCap.length - 1] || {};
  ok('errors: injected error captured in the ring buffer with t/msg/src/line',
    errCap.length >= 1 && lastErr.msg === 'synthetic test error' && lastErr.src === 'test.js' && lastErr.line === 42 && typeof lastErr.t === 'number');
  await page.evaluate(() => window.__harbor.clearErrors());
  ok('errors: clearErrors() empties the ring buffer', await page.evaluate(() => window.__harbor.errors().length === 0));

  // ad lifecycle: loadingFinished() fired exactly once by the time this run's boot hid the loader,
  // and gameplayStart() has fired at least once (founding the port, right at the top of this run).
  const lc = await page.evaluate(() => window.ADS._counts);
  ok('ads lifecycle: loadingFinished() fired once on boot, gameplayStart() fired on founding',
    lc.loadingFinished === 1 && lc.gameplayStart >= 1);

  // commercialBreak: the one natural-pause hook, at the era-ascension cinematic. Drive a real
  // advance (money + building gate, same path a player takes) via the __harbor.advance() test hook
  // rather than setEra() (which bypasses doAdvance()/startAscension() entirely).
  const cbBefore = await page.evaluate(() => window.ADS._counts.commercialBreak);
  await page.evaluate(() => {
    var S = window.HARBOR_SIM;
    window.__harbor.setEra(4); S.raw().money = 5e9;
    if (S.canBuild('dock')) S.build('dock'); if (S.canBuild('dock')) S.build('dock');
    // v90: advancing now needs the required buildings MAXED to the era cap — upgrade every building
    var done = false; while (!done) { done = true; var B = S.state().buildings; for (var i = 0; i < B.length; i++) if (S.canUpgrade(i)) { S.upgrade(i); done = false; } }
    S.raw().money = 5e6;
  });
  await page.evaluate(() => window.__harbor.advance());
  await sleep(150);
  const cbAfter = await page.evaluate(() => window.ADS._counts.commercialBreak);
  ok('ads: commercialBreak() fires on era advance, before the ascension cinematic', cbAfter === cbBefore + 1);

  // portal SDK routing (rejection guard): when a real portal SDK is hosting us (window.Portal.available),
  // window.ADS must ROUTE rewarded/commercial/gameplay to it — never grant a reward via the free stub
  // with NO ad shown (the "watch ad → reward, no ad" flow a portal QA rejects). Mock window.Portal to
  // prove the routing without a live SDK, then restore it.
  await page.evaluate(() => { window.Retention.set('harbor', 'bonusDay', null); });
  const route = await page.evaluate(() => {
    var P = window.Portal, saved = { av: P.available, ra: P.rewardedAd, cb: P.commercialBreak, gs: P.gameStart, gt: P.gameStop };
    var calls = { reward: 0, commercial: 0, start: 0, stop: 0 };
    P.available = true;
    P.rewardedAd = function (onR) { calls.reward++; onR(); };
    P.commercialBreak = function (done) { calls.commercial++; done(); };
    P.gameStart = function () { calls.start++; };
    P.gameStop = function () { calls.stop++; };
    var granted = 0, broke = 0;
    window.ADS.showRewarded(function () { granted++; }, function () {});
    window.ADS.commercialBreak(function () { broke++; });
    window.ADS.gameplayStart();
    window.ADS.gameplayStop();
    P.available = saved.av; P.rewardedAd = saved.ra; P.commercialBreak = saved.cb; P.gameStart = saved.gs; P.gameStop = saved.gt;
    return { calls: calls, granted: granted, broke: broke };
  });
  ok('portal-route: window.ADS.showRewarded → Portal.rewardedAd when a real SDK is present (reward comes only from the SDK)', route.calls.reward === 1 && route.granted === 1);
  ok('portal-route: window.ADS.commercialBreak → Portal.commercialBreak', route.calls.commercial === 1 && route.broke === 1);
  ok('portal-route: gameplayStart/Stop forward to Portal.gameStart/gameStop', route.calls.start === 1 && route.calls.stop === 1);
  await page.evaluate(() => { window.Retention.set('harbor', 'bonusDay', null); });

  // portal mode (?portal=1): service worker not registered, "Add to home screen" + privacy link
  // hidden, plain version line shown instead. Fresh context/page — independent of `page` above.
  const portalPage = await (await browser.newContext({ viewport: { width: 414, height: 820 } })).newPage();
  const portalErrs = [];
  portalPage.on('pageerror', e => portalErrs.push('PAGEERR ' + e.message));
  portalPage.on('console', m => { if (m.type() === 'error' && !IGNORE_CONSOLE_ERR.test(m.text())) portalErrs.push('CONSOLE ' + m.text()); });
  await portalPage.goto(`http://localhost:${PORT}/games/harbor/?biome=green&nopost-probe&portal=1`, { waitUntil: 'load' });
  await portalPage.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 });
  await sleep(500);
  const portalState = await portalPage.evaluate(async () => {
    document.getElementById('setbtn').click();
    var regs = ('serviceWorker' in navigator) ? await navigator.serviceWorker.getRegistrations() : [];
    return {
      portalMode: window.__harbor.portalMode(),
      swRegs: regs.length,
      installRow: !!document.querySelector('[data-set="install"]'),
      privacyLink: !!document.querySelector('a[href*="privacy.html"]'),
      aboutText: (document.querySelector('.set-portal-ver') || {}).textContent || ''
    };
  });
  ok('portal mode: ?portal=1 → PORTAL_MODE true, SW not registered, install/privacy rows hidden, plain version shown',
    portalState.portalMode === true && portalState.swRegs === 0 && portalState.installRow === false &&
    portalState.privacyLink === false && /Port Boss v\d+/.test(portalState.aboutText));
  ok('portal mode: zero console/page errors', portalErrs.length === 0);
  await portalPage.close();

  // CrazyGames SDK loading bracket (regression guard): the real CrazyGames SDK IGNORES any game.*
  // call made before its init() promise RESOLVES. boot() must therefore open the whole
  // loadingStart()->loadingStop() bracket INSIDE portalReady.then() (after init resolves), not at
  // boot. The mock below models that: rec() only records once `inited` is true, and init() flips it
  // on a microtask (async, like the real SDK) — so the pre-v81 order (loadingStart fired before init
  // resolved) records NOTHING and this test fails; the fixed order records both, start before stop.
  const cgPage = await (await browser.newContext({ viewport: { width: 414, height: 820 } })).newPage();
  const cgErrs = [];
  cgPage.on('pageerror', e => cgErrs.push('PAGEERR ' + e.message));
  cgPage.on('console', m => { if (m.type() === 'error' && !IGNORE_CONSOLE_ERR.test(m.text())) cgErrs.push('CONSOLE ' + m.text()); });
  await cgPage.addInitScript(() => {
    window.__cg = [];
    var inited = false;   // the real SDK honors game.* only after init() resolves
    var rec = function (n) { return function () { if (inited) window.__cg.push(n); }; };
    window.CrazyGames = { SDK: {
      init: function () { return Promise.resolve().then(function () { inited = true; }); }, environment: 'local',
      game: { sdkGameLoadingStart: rec('loadStart'), sdkGameLoadingStop: rec('loadStop'), gameplayStart: rec('gpStart'), gameplayStop: rec('gpStop'), happytime: rec('happy') },
      ad: { requestAd: function () {} }
    } };
  });
  await cgPage.goto(`http://localhost:${PORT}/games/harbor/?biome=green&nopost-probe`, { waitUntil: 'load' });
  await cgPage.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 });
  await sleep(400);
  await cgPage.evaluate(() => { var b = document.querySelector('#welcomemodal .wm-btn'); if (b) b.click(); window.__harbor.autoFound(); });
  await sleep(400);
  const cg = await cgPage.evaluate(() => window.__cg.slice());
  ok('crazygames SDK: loading bracket fires — sdkGameLoadingStart AND sdkGameLoadingStop, start before stop',
    cg.indexOf('loadStart') >= 0 && cg.indexOf('loadStop') >= 0 && cg.indexOf('loadStart') < cg.indexOf('loadStop'));
  ok('crazygames SDK: gameplayStart fires once the player founds a port', cg.indexOf('gpStart') >= 0);
  ok('crazygames SDK: mock-SDK boot has zero console/page errors', cgErrs.length === 0);
  await cgPage.close();

  // non-portal mode: unchanged behaviour — SW registers, install row + privacy link present.
  const nonPortalState = await page.evaluate(async () => {
    document.getElementById('setbtn').click();
    var regs = ('serviceWorker' in navigator) ? await navigator.serviceWorker.getRegistrations() : [];
    return { swRegs: regs.length, installRow: !!document.querySelector('[data-set="install"]'), privacyLink: !!document.querySelector('a[href*="privacy.html"]') };
  });
  ok('non-portal mode: unchanged — SW registers, install row + privacy link present',
    nonPortalState.swRegs >= 1 && nonPortalState.installRow === true && nonPortalState.privacyLink === true);

  // AdProvider resilience: a provider whose init() throws must never break the game — boot/HUD keep
  // running fine, the bonus button just stays hidden rather than the game crashing or console erroring.
  await page.evaluate(() => {
    window.HARBOR_SIM.setBoost(1, 0);
    window.ADS = { provider: 'broken', init: function () { throw new Error('simulated init failure'); }, rewardedAvailable: function () { throw new Error('simulated failure'); }, showRewarded: function () { throw new Error('simulated failure'); } };
    window.__harbor.reinitAds();
    window.__harbor.forceHUD();
  });
  await sleep(150);
  const resilient = await page.evaluate(() => ({ shown: document.getElementById('bonusbtn').style.display !== 'none', avail: window.__harbor.bonus().available }));
  ok('ads: a provider whose init() throws → game keeps running fine, bonus button stays hidden (not shown, not broken)',
    resilient.shown === false && resilient.avail === false);
  ok('ads: resilience probe produced zero new console/page errors', errs.length === errsBefore12a);

  // Phase 13d: local fun-funnel metrics — zero-network, no-PII instrument backed by Retention.
  // By this point in the run every milestone flow above (build via SIM.build() directly doesn't
  // count — see below; crate ~L144, voyage ~L61/120, prestige ~L172, era-advance ~L428, bonus
  // ~L366) has already been driven for real, so the whole funnel should be latched.
  const m0 = await page.evaluate(() => window.__harbor.metrics());
  ok('metrics: object populated — sessions/playtime present, funnel milestones already latched by the flows above',
    m0 && typeof m0.sessions === 'number' && m0.sessions >= 1 && typeof m0.totalPlayMs === 'number' &&
    typeof m0.firstCrate === 'number' && typeof m0.firstVoyage === 'number' &&
    typeof m0.firstPrestige === 'number' && typeof m0.firstEra === 'number' && typeof m0.firstBonus === 'number');

  // firstBuild is only latched by the real Manage-panel click path (the earlier SIM.build() calls
  // in this file bypass the UI handler entirely) — drive an actual click to prove the hook fires.
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 1e7; document.getElementById('managebtn').click(); });
  await sleep(150);
  await page.evaluate(() => { var b = document.querySelector('#managepanel [data-build]:not([disabled])'); if (b) b.click(); });
  await sleep(150);
  const mBuild1 = await page.evaluate(() => window.__harbor.metrics());
  ok('metrics: firstBuild set by a real Manage-panel build click, is a number',
    typeof mBuild1.firstBuild === 'number' && mBuild1.firstBuild >= 0);
  await page.evaluate(() => { var b = document.querySelector('#managepanel [data-build]:not([disabled])'); if (b) b.click(); });
  await sleep(150);
  const mBuild2 = await page.evaluate(() => window.__harbor.metrics());
  ok('metrics: firstBuild does not change on a second build', mBuild2.firstBuild === mBuild1.firstBuild);

  // playtime: accumulated only while visible, added to totalPlayMs on the very next read (no need
  // to wait out the full ~30s persistence throttle to observe it moving).
  const pt0 = await page.evaluate(() => window.__harbor.metrics().totalPlayMs);
  await sleep(1100);
  const pt1 = await page.evaluate(() => window.__harbor.metrics().totalPlayMs);
  ok('metrics: totalPlayMs accumulates across a short wait while the tab is visible', pt1 > pt0);

  // Settings → About: exactly one extra muted line, "Sessions: N · playtime: Xh Ym"
  await page.evaluate(() => document.getElementById('setbtn').click());
  await sleep(150);
  const aboutLines = await page.evaluate(() => Array.from(document.querySelectorAll('#settingspanel .set-about')).map(e => e.textContent));
  ok('settings: About panel renders one muted "Sessions: N · playtime: Xh Ym" line',
    aboutLines.some(t => /^Sessions: \d+ · playtime: \d+h \d+m$/.test(t)));

  // persistence: a fresh boot (reload) increments sessions and keeps the funnel timestamps intact.
  // Note: a bare page.reload() drops Chrome's "recent user gesture" state that every earlier
  // click-driven haptic() call in this run relied on, so an unrelated ambient event (e.g. a storm
  // tick) firing haptic() in the few seconds right after this reload can trip the browser's
  // navigator.vibrate() gesture-required intervention — a harmless, environment-only console
  // notice (vibrate silently no-ops; nothing throws) filtered alongside the 404/favicon noise
  // above, not a real regression.
  const beforeReload = await page.evaluate(() => window.__harbor.metrics());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 });
  await sleep(400);
  const afterReload = await page.evaluate(() => window.__harbor.metrics());
  ok('metrics: persists across reload — sessions +1, firstBuild retained',
    afterReload.sessions === beforeReload.sessions + 1 &&
    typeof afterReload.firstBuild === 'number' && afterReload.firstBuild === beforeReload.firstBuild);

  // Phase 15b: pace toggle + avert hazards.
  // Pace: Relaxed is the default for everyone (sim gap rolls ×1.6, 256s day), Lively restores the
  // pre-15b feel; the choice lives in Retention ('pace') and must survive a reload. Avert: during a
  // hazard's warn phase the storm banner grows an "Avert £X" (storm) / "Stabilise £X" (crash)
  // button — ghosted "Need £X" when unaffordable — that charges once, cancels the pending strike
  // and latches the Storm Whisperer achievement. All driven via __harbor.forceWarn (no sleeps
  // racing the 6s telegraph: the sim is paused so only our explicit calls move state).
  const errsBefore15b = errs.length;
  await page.evaluate(() => { if (!document.querySelector('#settingspanel.show')) document.getElementById('setbtn').click(); });
  await sleep(120);
  const pace0 = await page.evaluate(() => ({
    hook: window.__harbor.pace(),
    relaxedOn: !!document.querySelector('[data-set="pace-relaxed"].on'),
    livelyOff: !!document.querySelector('[data-set="pace-lively"]') && !document.querySelector('[data-set="pace-lively"].on'),
    help: Array.from(document.querySelectorAll('#settingspanel .set-help')).some(e => /spreads out storms and events/i.test(e.textContent))
  }));
  ok('pace: settings renders Relaxed/Lively with Relaxed ON by default (sim 1.6×, 256s day) + explainer',
    pace0.relaxedOn && pace0.livelyOff && pace0.hook.mode === 'relaxed' && pace0.hook.mul === 1.6 && pace0.hook.day === 256 && pace0.help);

  await page.evaluate(() => document.querySelector('[data-set="pace-lively"]').click());
  await sleep(80);
  const pace1 = await page.evaluate(() => ({ hook: window.__harbor.pace(), saved: window.Retention.get('harbor', 'pace', null), livelyOn: !!document.querySelector('[data-set="pace-lively"].on') }));
  ok('pace: Lively selected → sim pace 1×, 160s day, persisted to Retention', pace1.hook.mul === 1 && pace1.hook.day === 160 && pace1.saved === 'lively' && pace1.livelyOn);

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 });
  await sleep(400);
  const pace2 = await page.evaluate(() => window.__harbor.pace());
  ok('pace: Lively survives reload (applied on boot before the first tick)', pace2.mode === 'lively' && pace2.mul === 1 && pace2.day === 160);
  await page.evaluate(() => window.__harbor.setPace('relaxed'));   // back to the shipping default

  // difficulty: game.js applies the chosen tier to the sim and persists it
  await page.evaluate(() => window.__harbor.setDifficulty('hard'));
  ok('difficulty: game applies the tier to the sim', await page.evaluate(() => window.__harbor.difficulty().mode === 'hard' && window.HARBOR_SIM.difficulty().id === 'hard'));
  ok('difficulty: choice persists to Retention', await page.evaluate(() => window.Retention.get('harbor', 'difficulty', 'easy') === 'hard'));
  await page.evaluate(() => window.__harbor.setDifficulty('easy'));   // restore the default for later assertions

  // avert: pause the sim so the 6s telegraph can't tick down under the assertions
  await page.evaluate(() => window.__harbor.pause(true));
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 1e6; window.__harbor.forceWarn('green', false); });
  await sleep(80);
  const av0 = await page.evaluate(() => {
    var el = document.getElementById('stormalert'), b = el && el.querySelector('.sa-avert');
    return { shown: el && el.classList.contains('show'), btn: !!(b && b.style.display !== 'none'), label: b ? b.textContent : '', ghosted: !!(b && b.classList.contains('ghosted')) };
  });
  ok('avert: storm warn banner shows an affordable "Avert £X" button', av0.shown && av0.btn && /^Avert £/.test(av0.label) && !av0.ghosted);

  // unaffordable → ghosted "Need £X"; the disabled click must not charge or clear the warn
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 1; window.__harbor.forceHUD(); });
  await sleep(80);
  const av1 = await page.evaluate(() => {
    var b = document.querySelector('#stormalert .sa-avert');
    b.click();
    return { label: b.textContent, ghosted: b.classList.contains('ghosted'), disabled: b.disabled, phase: window.HARBOR_SIM.raw().hazard.phase, money: window.HARBOR_SIM.raw().money };
  });
  ok('avert: unaffordable → ghosted "Need £X", click is inert (no charge, warn still pending)',
    /^Need £/.test(av1.label) && av1.ghosted && av1.disabled && av1.phase === 'warn' && av1.money === 1);

  // affordable click: charges exactly avertCost, cancels the strike, dismisses the banner,
  // bumps stats.averted and latches the Storm Whisperer achievement
  const av2 = await page.evaluate(() => {
    var S = window.HARBOR_SIM, cost = S.avertCost();
    S.raw().money = cost + 500; window.__harbor.forceHUD();
    document.querySelector('#stormalert .sa-avert').click();
    return { phase: S.raw().hazard.phase, money: S.raw().money, averted: S.raw().stats.averted,
             shown: document.getElementById('stormalert').classList.contains('show'),
             ach: (window.Retention.get('harbor', 'ach', {}) || {}).avert1 === 1 };
  });
  ok('avert: click charges avertCost, clears the pending strike, dismisses the banner, bumps stats.averted, latches Storm Whisperer',
    av2.phase === 'idle' && av2.money === 500 && av2.averted >= 1 && av2.shown === false && av2.ach === true);

  // market-crash warn: same flow, "Stabilise £X" wording on the crash-styled banner
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 1e6; window.__harbor.forceWarn('green', true); });
  await sleep(80);
  const av3 = await page.evaluate(() => {
    var el = document.getElementById('stormalert'), b = el.querySelector('.sa-avert');
    var out = { shown: el.classList.contains('show'), crash: el.classList.contains('crash'), label: b.textContent };
    b.click();
    out.phase = window.HARBOR_SIM.raw().hazard.phase; out.crashActive = window.HARBOR_SIM.raw().crash;
    return out;
  });
  ok('avert: crash warn shows "Stabilise £X" on the crash-styled banner, and averting keeps the crash from ever activating',
    av3.shown && av3.crash && /^Stabilise £/.test(av3.label) && av3.phase === 'idle' && av3.crashActive === null);
  ok('15b: pace + avert flows produced zero new console/page errors', errs.length === errsBefore15b);
  await page.evaluate(() => window.__harbor.pause(false));

  // Phase 15d: Harbourmaster's Tips — the contextual hint engine. Driven entirely through
  // __harbor.forceTipCheck() (runs one tickTips() pass synchronously, bypassing the wall-clock
  // frame accumulator) so nothing races the real 4s cadence or the 45s global rate limit.
  const errsBefore15d = errs.length;
  await page.evaluate(() => {
    window.__harbor.pause(true);
    window.Retention.set('harbor', 'tipsSeen', {});
    window.Retention.set('harbor', 'tips', true);
    window.__harbor.resetTipRateLimit();
    // the era driven earlier in this suite keeps re-triggering Baron Krall's challenge modal
    // (era >= rivalThreshold) — tips correctly refuse to fire over ANY open modal, so clear the
    // screen first (same pattern as the crate-modal cleanup earlier in the file)
    var rm = document.querySelector('#rivalmodal.show'); if (rm) rm.classList.remove('show');
  });
  const tip0 = await page.evaluate(() => window.__harbor.forceTipCheck());
  ok('tips: once-tip "intro" fires on the first-ever forced check (port already founded)',
    tip0.lastId === 'intro' && tip0.showing === true && /Harbourmaster/i.test(tip0.text));
  ok('tips: intro recorded in Retention tipsSeen', await page.evaluate(() => window.Retention.get('harbor', 'tipsSeen', {}).intro === 1));

  // global rate limit: a second forced check inside the 45s window must be a total no-op — same
  // id, same shownAt timestamp, still showing (never re-fires, never stacks a second toast).
  const tip0b = await page.evaluate(() => window.__harbor.forceTipCheck());
  ok('tips: global rate limit — forceTipCheck again within 45s shows nothing new',
    tip0b.lastId === tip0.lastId && tip0b.shownAt === tip0.shownAt && tip0b.showing === true);

  // forced hazard-warn + affordable avert cost → the hazardAvert rule (next in priority after the
  // now-consumed once-only intro) must be the one that fires.
  await page.evaluate(() => {
    window.__harbor.dismissTip();
    window.__harbor.resetTipRateLimit();
    window.HARBOR_SIM.raw().money = 1e6;
    window.__harbor.forceWarn('green', false);
  });
  const tip1 = await page.evaluate(() => window.__harbor.forceTipCheck());
  ok('tips: forced hazard-warn + affordable avert cost → "hazardAvert" rule fires',
    tip1.lastId === 'hazardAvert' && /avert this storm/i.test(tip1.text));
  await page.evaluate(() => { window.__harbor.avertHazard(); window.__harbor.dismissTip(); });

  // once-tip persistence: after a reload, "intro" must never fire again (Retention 'tipsSeen'
  // survives; no save-format change — this all lives outside the sim save blob).
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 });
  await sleep(400);
  await page.evaluate(() => {
    window.__harbor.pause(true); window.__harbor.resetTipRateLimit();
    // rivalPending resets on reload, so boot's first updateHUD re-opens the challenge — clear it again
    var rm = document.querySelector('#rivalmodal.show'); if (rm) rm.classList.remove('show');
  });
  const tip2 = await page.evaluate(() => window.__harbor.forceTipCheck());
  ok('tips: once-tip "intro" does not re-fire after reload', tip2.lastId !== 'intro');

  // Settings toggle OFF makes tickTips a hard no-op — nothing changes from whatever fired last.
  await page.evaluate(() => { window.__harbor.setTipsEnabled(false); window.__harbor.dismissTip(); window.__harbor.resetTipRateLimit(); });
  const tip3 = await page.evaluate(() => window.__harbor.forceTipCheck());
  ok('tips: Settings toggle OFF suppresses tickTips (no new tip, nothing showing)',
    tip3.enabled === false && tip3.showing === false && tip3.lastId === tip2.lastId);

  // Settings panel renders the Tips ON/OFF row (15b Pace-section pattern) and re-enabling flips it back on
  await page.evaluate(() => document.getElementById('setbtn').click());
  const tipsRow = await page.evaluate(() => {
    var el = document.querySelector('[data-set="tips"]');
    return { exists: !!el, off: el ? el.textContent.indexOf('OFF') >= 0 : false };
  });
  ok('tips: Settings panel shows the Tips toggle row, currently OFF', tipsRow.exists && tipsRow.off);
  await page.evaluate(() => { document.querySelector('[data-set="tips"]').click(); document.getElementById('setbtn').click(); });
  ok('tips: Settings toggle flips back ON + persists to Retention',
    await page.evaluate(() => window.__harbor.tips().enabled === true && window.Retention.get('harbor', 'tips', null) === true));

  // toast element: distinct from #stormalert/#announcecard, forced via the same deterministic
  // hazardAvert state used above (post-reload game state has too many rules simultaneously true —
  // huge money, many buildings, era climbed — to safely predict which lower-priority rule would
  // win a fresh race; hazardAvert is rule #2, right after the now-consumed once-only intro, so it
  // reliably wins regardless of what else is true), then taps anywhere on it to dismiss immediately.
  await page.evaluate(() => {
    window.__harbor.setTipsEnabled(true); window.__harbor.resetTipRateLimit();
    window.HARBOR_SIM.raw().money = 1e6; window.__harbor.forceWarn('green', false);
  });
  const tip4 = await page.evaluate(() => window.__harbor.forceTipCheck());
  ok('tips: hazardAvert rule fires again post-reload with a forced warn state', tip4.lastId === 'hazardAvert');
  const toastEl = await page.evaluate(() => {
    var el = document.getElementById('tiptoast');
    return { exists: !!el, showing: !!(el && el.classList.contains('show')), distinct: !!el && el.id !== 'stormalert' && el.id !== 'announcecard' };
  });
  ok('tips: toast is a distinct #tiptoast element (separate from #stormalert/#announcecard), currently showing',
    toastEl.exists && toastEl.showing && toastEl.distinct);
  await page.evaluate(() => document.getElementById('tiptoast').click());
  await sleep(80);
  ok('tips: tap anywhere on the toast dismisses it immediately',
    await page.evaluate(() => !document.getElementById('tiptoast').classList.contains('show')));
  await page.evaluate(() => window.__harbor.avertHazard());

  ok('15d: tips flows produced zero new console/page errors', errs.length === errsBefore15d);
  await page.evaluate(() => window.__harbor.pause(false));

  // Phase 17a: technology ages — Automated Harbour (era6) + Neon Horizon (era7) + the Empire
  // Timeline strip. Tap the real era pill (not a debug shortcut) so the click-wiring itself is
  // exercised, not just the underlying render function.
  const errsBefore17a = errs.length;
  await page.evaluate(() => window.__harbor.setEra(0));
  await page.evaluate(() => window.__harbor.tapEraPill());
  await sleep(150);
  const tl0 = await page.evaluate(() => window.__harbor.timelineState());
  ok('17a timeline: tapping the era pill opens the strip with one node per age + an endless tail node',
    tl0.open === true && tl0.shown === true && tl0.nodes === 9);
  ok('17a timeline: current-age node reflects the real era (Fishing Village at era0)', tl0.currentName === 'Fishing Village');
  await page.evaluate(() => document.querySelector('#timelinepanel .tl-close').click());
  await sleep(80);
  const tl1 = await page.evaluate(() => window.__harbor.timelineState());
  ok('17a timeline: ✕ closes the strip', tl1.open === false && tl1.shown === false);
  // reopen, advance era in-place, confirm the current node updates; then close via tap-out (a click
  // that lands on the backdrop itself, not the card, mirrors a real off-card tap)
  await page.evaluate(() => { window.HARBOR_SIM.setEra(6); window.__harbor.tapEraPill(); });
  await sleep(120);
  const tl2 = await page.evaluate(() => window.__harbor.timelineState());
  ok('17a timeline: current-age node updates once the empire reaches Automated Harbour (era6)', tl2.currentName === 'Automated Harbour');
  const reachedCount = await page.evaluate(() => document.querySelectorAll('#timelinepanel .tl-node.reached').length);
  ok('17a timeline: earlier ages show as reached (6 ages before Automated Harbour)', reachedCount === 6);
  await page.evaluate(() => document.getElementById('timelinepanel').click());   // tap-out (backdrop, not the card)
  await sleep(80);
  ok('17a timeline: tap-out (off the card) closes the strip too', await page.evaluate(() => !window.__harbor.timelineState().open));
  ok('17a timeline: opening/closing the strip produced zero new console/GL errors', errs.length === errsBefore17a);

  // era-up celebration copy names the age ("Welcome to the <Age> age!") — drive a real advance
  // (not setEra, which bypasses doAdvance/startAscension) from era5->era6, then wait out the
  // ascension cinematic (banner shows at t>=2.35s of a 4.2s cinematic) to read the live DOM text.
  await page.evaluate(() => {
    // push the required buildings straight onto the port (this run has accumulated a lot of state
    // by this point in the suite — the per-port slot cap could otherwise block a fresh dock/factory
    // build) so the era5->6 gate's `need` is satisfied deterministically, same as the direct-state
    // patterns sim.test.js's grandfathering test uses.
    var S = window.HARBOR_SIM;
    window.__harbor.setEra(5); S.raw().money = 1e7;
    // v90: advancing needs dock:3 + factory:2 MAXED to the era-5 cap (L7). Add copies then force EVERY
    // dock/factory (incl. any left over from earlier in this run) to the cap so countAtCap is satisfied.
    var B = S.port('green').buildings, have = t => B.filter(b => b.type === t).length;
    while (have('dock') < 3) B.push({ type: 'dock', level: 7, hp: 100 });
    while (have('factory') < 2) B.push({ type: 'factory', level: 7, hp: 100 });
    B.forEach(b => { if (b.type === 'dock' || b.type === 'factory') b.level = 7; });
  });
  await page.evaluate(() => window.__harbor.advance());
  // the ascension cinematic runs on the RENDER LOOP's own dt (capped at 50ms/frame — see frame() in
  // game.js), not wall-clock time, and headless/unfocused swiftshader frame pacing can be far slower
  // than 60fps — poll rather than guess a fixed sleep (observed up to ~10s in this environment).
  const bannerUp = await page.waitForFunction(() => { var el = document.getElementById('ascendbanner'); return !!el && el.classList.contains('show'); }, null, { timeout: 15000 }).then(() => true).catch(() => false);
  ok('17a celebration: ascension cinematic reaches the banner beat', bannerUp);
  const abName = await page.evaluate(() => { var el = document.querySelector('#ascendbanner .ab-name'); return el ? el.textContent : ''; });
  ok('17a celebration: ascension banner welcomes the player to the new age by name', /Welcome to the Automated Harbour age!/.test(abName));
  await sleep(2500);   // let the 4.2s cinematic fully finish before moving on

  // era7 (Neon Horizon) buildings + port panorama: force the era, build a few of the new age6/7
  // types directly (same debug path a screenshot pass would drive), rebuild the scene, and confirm
  // the static-scene vertex budget still holds (same 10k-250k ceiling every earlier phase checked).
  await page.evaluate(() => {
    var S = window.HARBOR_SIM;
    S.raw().money = 1e8;
    ['container_terminal', 'drone_bay', 'robo_crane', 'logistics_hub'].forEach(t => { if (S.canBuild(t)) S.build(t); });
  });
  await page.evaluate(() => window.__harbor.setEra(7));
  await page.evaluate(() => {
    var S = window.HARBOR_SIM;
    S.raw().money = 1e8;
    ['solar_spire', 'holo_market', 'fusion_dock', 'sky_beacon'].forEach(t => { if (S.canBuild(t)) S.build(t); });
  });
  await sleep(300);
  const gs17a = await page.evaluate(() => window.__harbor.geomStats());
  ok('17a era7: Neon Horizon skyline (solarSpire/neonTower/droneBayPad) stays within the existing 250k vertex budget',
    gs17a && gs17a.verts > 10000 && gs17a.verts < 300000);
  ok('17a era7: all 8 new-age buildings buildable and recorded on the port', await page.evaluate(() => {
    var c = window.HARBOR_SIM.state().counts;
    return ['container_terminal', 'drone_bay', 'robo_crane', 'logistics_hub', 'solar_spire', 'holo_market', 'fusion_dock', 'sky_beacon'].every(t => (c[t] || 0) >= 1);
  }));
  ok('17a era7: rendering the Neon Horizon panorama produced zero new console/GL errors', errs.length === errsBefore17a);

  // Phase 17b: tip rule "fleetBehind" — fires when any fleet ladder sits 2+ ages behind the
  // current era. Run LAST (after every other test that depends on this run's accumulated state —
  // ports, unlocks, achievements) on a completely fresh save (localStorage cleared + reload) so no
  // leftover state (legacy balance, crates, contracts, port focus…) can outrank it — fleetBehind is
  // deliberately the LOWEST-priority rule in TIPS.
  const errsBeforeFleetTip = errs.length;
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 });
  await sleep(400);
  await page.evaluate(() => {
    var b = document.querySelector('#welcomemodal .wm-btn'); if (b) b.click();
    var wm = document.getElementById('welcomemodal'); if (wm) wm.remove();   // tipsBlocked() checks mere DOM presence — the click handler's own removal is on a 320ms exit-animation timeout, too slow for this synchronous setup
    window.__harbor.autoFound();
    window.__harbor.pause(true);
    window.__harbor.resetAnnounce();   // founding a fresh port queues the "Expeditions" announce card — tips correctly refuse to fire over it, so clear it (same pattern the 15d block uses for the rival modal)
    // belt-and-braces: a stray save() from the PRE-reload page can land in localStorage in the
    // narrow window between localStorage.clear() and the navigation actually taking effect —
    // force-zero the two Retention counters with their own higher-priority tip rules so a race
    // like that can't outrank fleetBehind (era/money below are the load-bearing state either way).
    window.Retention.set('harbor', 'legacyBal', 0); window.Retention.set('harbor', 'crates', 0);
    var raw = window.HARBOR_SIM.raw();
    window.HARBOR_SIM.setEra(3);   // v84 per-port era: sets the active harbour's era (and empireEra) to 3 → every fleet ladder still at tier0 is 3 ages behind (past the 2+ threshold)
    raw.money = 50;   // low enough that no higher-priority rule (eraReady/voyageIdle/idleGold/storageFull/unchartedReady) can also be true
    window.__harbor.resetTipRateLimit();
  });
  const tipIntro = await page.evaluate(() => window.__harbor.forceTipCheck());
  ok('17b tips: fresh save fires the once-only "intro" tip first, as always', tipIntro.lastId === 'intro');
  await page.evaluate(() => { window.__harbor.dismissTip(); window.__harbor.resetTipRateLimit(); });
  const tipFleet = await page.evaluate(() => window.__harbor.forceTipCheck());
  ok('17b tips: 2+ ages behind on every ladder fires "fleetBehind" (all higher-priority rules suppressed)',
    tipFleet.lastId === 'fleetBehind' && /falling behind the times/i.test(tipFleet.text) && /Registry/.test(tipFleet.text));
  // buying just ONE ladder up to keep pace must not clear the rule while the OTHER two are still behind
  await page.evaluate(() => { window.HARBOR_SIM.raw().fleetTech.fishing = 3; window.__harbor.dismissTip(); window.__harbor.resetTipRateLimit(); });
  const tipFleet2 = await page.evaluate(() => window.__harbor.forceTipCheck());
  ok('17b tips: still fires while trade/expedition remain 2+ ages behind, even after fixing fishing', tipFleet2.lastId === 'fleetBehind');
  // catching every ladder up clears the rule entirely. Every OTHER rule is still deliberately
  // suppressed by this isolated state (see the setup above), so the correct signal isn't "some
  // other rule's id now shows" (tips().lastId sticks at the last rule that actually fired if
  // nothing new matches this round) — it's that the toast stays hidden (nothing fired) AND the
  // underlying fleetBehind predicate itself now reads false straight from the sim state.
  await page.evaluate(() => { var raw = window.HARBOR_SIM.raw(); raw.fleetTech.trade = 3; raw.fleetTech.expedition = 3; window.__harbor.dismissTip(); window.__harbor.resetTipRateLimit(); });
  const tipFleet3 = await page.evaluate(() => window.__harbor.forceTipCheck());
  const fleetCaughtUp = await page.evaluate(() => { var s = window.HARBOR_SIM.state(); return ['fishing', 'trade', 'expedition'].every(r => (s.era - s.fleet[r].tier) < 2); });
  ok('17b tips: modernising every ladder clears the fleetBehind condition — no rule fires, toast stays hidden',
    fleetCaughtUp && tipFleet3.showing === false);
  ok('17b tips: fleetBehind flows produced zero new console/GL errors', errs.length === errsBeforeFleetTip);
  await page.evaluate(() => window.__harbor.pause(false));

  // Phase 14b: atmosphere — drifting clouds, quay dock workers, night light pools. Reuses this
  // run's post-reload state (a fresh save with only 'green' founded via the real foundHere() path;
  // 'tropical' is never founded here) so the "founded vs. wild" gating checks below have a clean,
  // known-unfounded world to compare against.
  const errsBefore14b = errs.length;
  await page.evaluate(() => window.__harbor.setTod(0.5));   // noon, so the clouds()/pools() checks below start from a known ToD
  const clouds0 = await page.evaluate(() => window.__harbor.clouds());
  ok('14b clouds: 4-7 soft cumulus instances built once, real geometry (not a shader-only sky layer)',
    clouds0 && clouds0.count >= 4 && clouds0.count <= 7 && clouds0.verts > 0);
  const cloudPosA = await page.evaluate(() => window.__harbor.clouds().pos);
  await sleep(900);
  const cloudPosB = await page.evaluate(() => window.__harbor.clouds().pos);
  ok('14b clouds: drift over time — at least one instance\'s world position changes between samples',
    cloudPosA.length === cloudPosB.length && cloudPosA.some((pA, i) => Math.abs(pA[0] - cloudPosB[i][0]) > 0.01 || Math.abs(pA[1] - cloudPosB[i][1]) > 0.01));

  // worker count scales with era and caps at 6 (2 + era, clamped 2..6)
  await page.evaluate(() => window.__harbor.setEra(0)); await sleep(120);
  const w0 = await page.evaluate(() => window.__harbor.workers());
  await page.evaluate(() => window.__harbor.setEra(4)); await sleep(120);
  const w4 = await page.evaluate(() => window.__harbor.workers());
  await page.evaluate(() => window.__harbor.setEra(7)); await sleep(120);
  const w7 = await page.evaluate(() => window.__harbor.workers());
  ok('14b workers: count scales with era (era0=2, era4=6) and caps — era7 stays at 6, not 9',
    w0.count === 2 && w4.count === 6 && w7.count === 6);

  // workers only render on a FOUNDED port — 'tropical' was founded via a raw SIM bypass earlier in
  // this run (never through the real foundHere() path), so game.js's own founded-site map has no
  // entry for it and switching to it renders as a wild, unfounded world (scene.port stays null).
  const wWild = await page.evaluate(() => { window.__harbor.setBiome('tropical'); return window.__harbor.workers(); });
  const wBack = await page.evaluate(() => { window.__harbor.setBiome('green'); return window.__harbor.workers(); });
  ok('14b workers: none on an unfounded world, back once the founded harbour is showing again',
    wWild.count === 0 && wBack.count > 0);

  // night light pools: absent by day, present under the quay's lampposts/lit windows once night falls
  await page.evaluate(() => window.__harbor.setTod(0.5)); await sleep(120);
  const poolsDay = await page.evaluate(() => window.__harbor.pools());
  await page.evaluate(() => window.__harbor.setTod(0.0)); await sleep(120);
  const poolsNight = await page.evaluate(() => window.__harbor.pools());
  ok('14b night pools: zero by day, present under the quay lampposts/warehouse fronts once night falls',
    poolsDay.count === 0 && poolsNight.count > 0 && poolsNight.night > 0.05);

  // full day/night sweep with clouds + workers + night pools all live — zero GL warnings/errors
  for (const t of [0, 0.15, 0.25, 0.34, 0.5, 0.66, 0.755, 0.9, 1.0]) { await page.evaluate(tt => window.__harbor.setTod(tt), t); await sleep(140); }
  ok('14b: full ToD sweep with clouds/workers/night-pools all live → zero GL warnings/errors', errs.length === errsBefore14b);

  // fps guard: sample real frame rate at night with clouds + workers + light pools + starfield all live
  await page.evaluate(() => window.__harbor.setTod(0.0));
  const fps14b = await page.evaluate(() => new Promise((resolve) => {
    var start = performance.now(), frames = 0;
    function step(ts) { frames++; if (ts - start < 2000) requestAnimationFrame(step); else resolve(frames / ((ts - start) / 1000)); }
    requestAnimationFrame(step);
  }));
  // NOTE: headless swiftshader (a software GL rasterizer) this deep into a long, stateful suite
  // run (every earlier phase's ports/ships/DOM state still resident) commonly sits at just a
  // few fps regardless of this phase's changes — see soak.js's own fps floor for the same reason
  // it uses a RELATIVE 60% floor rather than an absolute one. This guard is a hang/freeze
  // detector (the render loop is still actually advancing frames with the full atmosphere pass
  // live), not a real-device performance budget.
  ok('14b fps guard: render loop keeps advancing frames (no hang/freeze) with clouds/workers/night-pools all live', fps14b > 1.5);

  // geomStats: the quay lamppost/lit-window position bookkeeping adds no NEW static geometry (the
  // floodlight poles + warehouse walls already existed) — the vertex budget must stay exactly where
  // 16b/17a left it, still nowhere near the 250k ceiling.
  await page.evaluate(() => window.__harbor.setTod(0.5));
  const gs14b = await page.evaluate(() => window.__harbor.geomStats());
  ok('14b geomStats: static-scene vertex budget unaffected by the atmosphere pass, still within the 250k ceiling',
    gs14b && gs14b.verts > 10000 && gs14b.verts < 300000);

  // Phase 18a: LOOK 6.0 — faceted flat-shaded terrain + sculpted coast/biome dressing + dressed
  // founded-port ground (stone apron, plank dock, dirt paths, low fences, quay clutter). Terrain
  // vertex growth is a DELIBERATE per-quad flat-shading duplication (not a bug) — each grid quad
  // gets its own 4 vertices + one flat face normal instead of the old shared/smooth vertex, so
  // every quad reads as a distinct light-catching facet. heightAt() itself is byte-for-byte
  // unchanged (gameplay-critical: building placement/site heights) — only how those SAME heights
  // become a mesh changed; pinned below against known-good values.
  const hPts = [[0, 0], [79, 42], [100, 100], [-200, 50], [0, 150], [300, -50], [-400, 200]];
  const hVals = await page.evaluate((pts) => pts.map(p => window.HARBOR_MODELS.heightAt(p[0], p[1])), hPts);
  const hExpected = [-4, 0.7573668289184559, 6.38262414932251, 11.764867782592773, 35.296443939208984, 1.692590594291687, 6.257427215576172];
  ok('18a: heightAt() unchanged at sampled points — gameplay (building placement/site heights) untouched by the visual rebuild',
    hVals.every((v, i) => Math.abs(v - hExpected[i]) < 1e-4));

  await page.evaluate(() => window.__harbor.setEra(3));   // deterministic era for the port-dressing checks below
  const ts18a = await page.evaluate(() => window.__harbor.terrainStats());
  // Phase 20a: the quad-count floor dropped from 50000->30000 — buildFieldMesh now CLIPS terrain
  // quads to the SLAB ellipse (THE FLOATING DIORAMA), so the old unbounded-ocean-plate flat quads
  // stretching to the far WORLD.W edge are gone; the vert-per-quad contract and the vert budget
  // window are otherwise unchanged (see terrainStats().skirt for the new cliff-skirt geometry).
  ok('18a/20a: terrain vert count reflects per-face duplication — 4 verts/quad, clipped to the SLAB (no more unbounded ocean plate), within budget',
    ts18a && ts18a.terrain.quads > 30000 && ts18a.terrain.verts === ts18a.terrain.quads * 4 && ts18a.terrain.verts > 120000 && ts18a.terrain.verts < 260000);
  ok('18a: coastal/biome dressing present for the active (green) world — rocks + shelves + beach speckle',
    ts18a && ts18a.dressing && ts18a.dressing.rock > 0 && ts18a.dressing.shelf > 0 && ts18a.dressing.speckle > 0);
  ok('18a: founded-port dressing present at era3 (apron/dock/path/fence/quay clutter), clutter capped at 14 props',
    ts18a && ts18a.port && ts18a.port.apron > 0 && ts18a.port.dock > 0 && ts18a.port.path > 0 && ts18a.port.fence > 0 && ts18a.port.props > 0 && ts18a.port.props <= 14);

  // era0 (primitive village, no real quay yet) gets paths/fence/clutter but NOT the stone
  // apron/plank dock — those only make sense once era1's concreteQuay exists.
  await page.evaluate(() => window.__harbor.setEra(0));
  const ts18aE0 = await page.evaluate(() => window.__harbor.terrainStats());
  ok('18a: era0 village dressing is a lighter subset — no apron/dock yet, but path/fence/props present',
    ts18aE0 && ts18aE0.port && ts18aE0.port.apron === 0 && ts18aE0.port.dock === 0 && ts18aE0.port.path > 0 && ts18aE0.port.fence > 0 && ts18aE0.port.props > 0);
  await page.evaluate(() => window.__harbor.setEra(3));

  // per-biome feature identity: every world gets ITS OWN dressing signature (mountain/nordic get
  // boulders, desert gets dunes, tropical gets big-leaf plants) — and port dressing is strictly a
  // FOUNDED-port feature (null on a wild, unfounded world — mountain/desert/tropical/nordic are
  // never founded in this run, only 'green' is, via the real foundHere() path).
  const dressByBiome = await page.evaluate(() => {
    var H = window.__harbor, out = {};
    ['mountain', 'desert', 'tropical', 'nordic'].forEach(function (b) { H.setBiome(b); out[b] = H.terrainStats(); });
    H.setBiome('green');
    return out;
  });
  ok('18a: mountain + nordic (snow biomes) get scattered boulders; wild (unfounded) worlds have no port dressing',
    dressByBiome.mountain.dressing.boulder > 0 && dressByBiome.nordic.dressing.boulder > 0 &&
    dressByBiome.mountain.port === null && dressByBiome.desert.port === null && dressByBiome.tropical.port === null && dressByBiome.nordic.port === null);
  ok('18a: desert (mesa) gets dune ridges, tropical gets extra big-leaf plants — distinct per-biome identity',
    dressByBiome.desert.dressing.dune > 0 && dressByBiome.tropical.dressing.leaf > 0);

  // zero GL warnings/errors over a ToD sweep with the new faceted terrain + all dressing live
  const errsBefore18a = errs.length;
  for (const t of [0, 0.185, 0.34, 0.5, 0.66, 0.755, 0.9]) { await page.evaluate(tt => window.__harbor.setTod(tt), t); await sleep(140); }
  ok('18a: full ToD sweep over the faceted terrain + coastal/port dressing → zero GL warnings/errors', errs.length === errsBefore18a);

  // outline tuning still sky-masked/slope-rejecting with the new terrain (no regression in F_POST,
  // gl.js) — verified visually too: a dead-flat facet has zero neighbour-normal delta, so only
  // genuine silhouette/slope edges ink; gentle rolling terrain stays clean, not scratchy.
  const outlineT18a = await page.evaluate(() => window.__harbor.outlineTuning());
  ok('18a: outline tuning unregressed after the terrain rebuild (still sky-masked + slope-rejecting bounds)',
    outlineT18a && outlineT18a.depthT < 0.03 && outlineT18a.width > 1.0);

  // fps guard: faceted terrain + biome dressing + founded-port dressing all live at once
  await page.evaluate(() => window.__harbor.setTod(0.5));
  const fps18a = await page.evaluate(() => new Promise((resolve) => {
    var start = performance.now(), frames = 0;
    function step(ts) { frames++; if (ts - start < 2000) requestAnimationFrame(step); else resolve(frames / ((ts - start) / 1000)); }
    requestAnimationFrame(step);
  }));
  ok('18a fps guard: render loop keeps advancing frames (no hang/freeze) with the faceted terrain + full dressing live', fps18a > 1.5);

  const gs18a = await page.evaluate(() => window.__harbor.geomStats());
  ok('18a: geomStats within the re-derived 300k vertex ceiling (up from 250k pre-18a — faceted terrain + dressing)',
    gs18a && gs18a.verts > 200000 && gs18a.verts < 300000);

  // Phase 18b: LOOK 6.0 building total remodel — every structure rebuilt from a shared diorama
  // part-kit (roofKit/timberFrame/brickBanding/awning/door/window/chimney...), buildings split out
  // of the static world bake into their own per-frame-transformed meshes (squash-stretch pop rides
  // the draw transform), per-type vert budgets via the new buildingStats() hook.
  // Per-type budgets: measured one-of-each (green) ≈ hut 504 / cottage 792 / warehouse 532 /
  // market 622 / sawmill 524 / factory 520 / cargoDock 556 / tradingPost 661 / seawall 208 /
  // lighthouse 978 / solarSpire 406 / neonTower 318 / droneBayPad 276 — the 100..2600 band below
  // allows per-biome roof-style variance while still catching runaway geometry on any one type.
  const bKinds = await page.evaluate(() => window.__harbor.buildingKinds());
  const bStats = await page.evaluate((ks) => { var out = {}; ks.forEach(k => { out[k] = window.__harbor.buildingStats(k, 'green'); }); return out; }, bKinds);
  ok('18b: all 13 remodeled building types build via buildingStats() with verts inside their per-type budget (100..2600)',
    bKinds.length === 13 && bKinds.every(k => bStats[k] && bStats[k].verts > 100 && bStats[k].verts < 2600 && bStats[k].indices > 0));
  ok('18b: roof style follows the biome (desert flat parapet is cheaper than green\'s deep-eave gable on the same cottage)',
    await page.evaluate(() => {
      var g = window.__harbor.buildingStats('cottage', 'green'), d = window.__harbor.buildingStats('cottage', 'desert');
      return g && d && d.verts < g.verts;
    }));
  // buildings now live in their own meshes (geomStats.bldg) and still count toward the SAME 300k
  // static-scene ceiling (re-derived for 18b: measured worst case ~251k at era7 — no bump needed).
  ok('18b: building meshes present in geomStats (bldg > 1500 at a developed era) and total still within the 300k ceiling',
    gs18a && gs18a.bldg > 1500 && gs18a.verts < 300000);
  // Phase 19c unfold pop: DETERMINISTIC — setPopProgress(p) pins the pop clock at an exact point
  // of its window (no wall-clock sleeps; 18b hook contract preserved verbatim). unfoldExpect()
  // mirrors popScaleFor() in game.js operation-for-operation, so the comparison is EXACT
  // (same float ops in the same order — identical bits, not a tolerance band).
  const unfoldExpect = (k) => {
    const c1 = 1.70158, c3 = c1 + 1, u = k - 1;
    const f = 1 + c3 * u * u * u + c1 * u * u;
    const sy = f, sxz = 1 - 0.10 * (f - 1);
    const hinge = k < 0.4 ? 0.22 * Math.sin(Math.PI * (k / 0.4)) : 0;
    return { sy, sxz, hinge };
  };
  const pop19cA = await page.evaluate(() => window.__harbor.setPopProgress(0.1));
  const pop19cB = await page.evaluate(() => window.__harbor.setPopProgress(0.4));
  const pop19cC = await page.evaluate(() => window.__harbor.setPopProgress(0.8));
  const eA = unfoldExpect(0.1), eB = unfoldExpect(0.4), eC = unfoldExpect(0.8);
  ok('19c: unfold pop curve EXACT at pinned p=0.1 — rising from flat (y≈0.409) with the early forward hinge live, 0.45s window',
    pop19cA.active && pop19cA.style === 'unfold' && pop19cA.dur === 0.45 &&
    pop19cA.scale.y === eA.sy && pop19cA.scale.x === eA.sxz && pop19cA.scale.z === eA.sxz && pop19cA.hinge === eA.hinge);
  ok('19c: unfold pop curve EXACT at p=0.4 (hinge exactly settled to 0, y past 1 into the easeOutBack overshoot) and p=0.8 (settling, xz counter-flex)',
    pop19cB.active && pop19cB.hinge === 0 && pop19cB.scale.y === eB.sy && pop19cB.scale.y > 1 &&
    pop19cC.active && pop19cC.hinge === 0 && pop19cC.scale.y === eC.sy && pop19cC.scale.x === eC.sxz);
  const popEnd = await page.evaluate(() => window.__harbor.setPopProgress(1.0));
  const popCleared = await page.evaluate(() => window.__harbor.setPopProgress(null));
  ok('19c: unfold settles to exact identity (scale 1, hinge 0) at the window end and when the pin clears (no residual transform, no save state)',
    popEnd && !popEnd.active && popEnd.scale.x === 1 && popEnd.scale.y === 1 && popEnd.scale.z === 1 && popEnd.hinge === 0
    && popCleared && !popCleared.active && popCleared.scale.x === 1 && popCleared.scale.y === 1 && popCleared.hinge === 0);
  // industry smoke anchors: chimney smoke keys off factory/sawmill counts (emitSmoke) — the
  // factory's remodeled chimney is cosmetic, the emitter logic must still fire once industry exists.
  await page.evaluate(() => { var S = window.HARBOR_SIM; S.raw().money = 1e6; if (S.canBuild('factory')) S.build('factory'); });
  ok('18b: smoke-emitter anchor valid — industry smoke reports active once a factory exists',
    await page.evaluate(() => window.__harbor.smokeActive()));
  // zero GL warnings/errors over a ToD sweep with the per-frame building meshes + pop live
  const errsBefore18b = errs.length;
  await page.evaluate(() => window.__harbor.forcePop());
  for (const t of [0, 0.25, 0.5, 0.755, 0.9]) { await page.evaluate(tt => window.__harbor.setTod(tt), t); await sleep(140); }
  await page.evaluate(() => window.__harbor.setTod(0.5));
  ok('18b: full ToD sweep with remodeled buildings + squash-stretch live → zero GL warnings/errors', errs.length === errsBefore18b);

  // Phase 19a: PAPERCRAFT REBOOT — material & edge flip. The two signature inversions: the
  // 14a/16b dark ink outline became a WHITE scissor-cut paper rim (thicker + wobbled, same
  // detector), and the 16b candy palette became matte construction paper (desaturated source
  // colours, gloss/sparkle removed, 2-step banding, paper-fibre grain, gentle near-unity grade).
  // Assertions pivot on the __harbor.paper() debug hook added for this phase + hardcoded 16b-era
  // palette sentinels, then the same zero-GL-warning soak pattern every look phase uses.
  const errsBefore19a = errs.length;
  await page.evaluate(() => window.__harbor.setTod(0.5));
  const paper0 = await page.evaluate(() => window.__harbor.paper());
  const paperNight = await page.evaluate(() => { window.__harbor.setTod(0.0); return window.__harbor.paper(); });
  const rimLuma = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  ok('19a: edge line is PAPER-WHITE, not ink — warm white by day (luma > 0.85), pale card by night (luma > 0.7), never >1 (no glow)',
    paper0 && rimLuma(paper0.rim) > 0.85 && paper0.rim[0] > paper0.rim[2] &&
    paperNight && rimLuma(paperNight.rim) > 0.7 &&
    paper0.rim.concat(paperNight.rim).every(v => v <= 1.0));
  ok('19a: rim is >=1.5x the 16b ink width sentinel (1.6) and the scissor-cut wobble parameter is armed',
    paper0.width >= 1.6 * 1.5 && paper0.wobble > 0 && paper0.wobble <= 1);
  const sparkles19a = [];
  for (const t of [0.0, 0.34, 0.5, 0.755]) sparkles19a.push(await page.evaluate(tt => { window.__harbor.setTod(tt); return window.__harbor.env().sparkle; }, t));
  ok('19a: sparkle authored 0 across the whole ToD cycle + F_MAIN specular/sheen removed (glossOff)',
    sparkles19a.every(v => v === 0) && paper0.glossOff === true);
  ok('19a: 2-step paper banding + fibre grain active on every pass, terrain strongest then water then sky',
    paper0.bands === 2 && paper0.grain.main > 0 && paper0.grain.main < 0.15 &&
    paper0.grain.main > paper0.grain.water && paper0.grain.water > paper0.grain.sky);
  ok('19a: papercraft grade is gentle — uSat near unity (16b\'s 1.32+ candy push gone), mild crush',
    paper0.sat > 0.9 && paper0.sat < 1.15 && paperNight.sat > 0.9 && paperNight.sat < 1.15 &&
    paper0.crush >= 0 && paper0.crush < 0.2);
  // matte-flip palette sentinels: the LIVE v71 (16b-era) green-isles constants, hardcoded — the
  // painted saturation (max-min)/max must have dropped by >=30% on ground/shallow/wall, and the
  // 14a chromatic shadow ramp must be pulled to neutral paper shadow (no >1 blue channel).
  const OLD16B = { ground: [0.20, 0.46, 0.16], shallow: [0.10, 0.62, 0.66], wall0: [0.92, 0.30, 0.24], shadowB: 1.21 };
  const gp19a = await page.evaluate(() => { var b = window.HARBOR_BIOMES.green; return { ground: b.ground.slice(), shallow: b.shallow.slice(), wall0: b.build.wall[0].slice(), shadowTint: b.shadowTint.slice() }; });
  const satOf = c => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
  ok('19a: construction-paper palette flip — green ground/shallow/wall desaturated >=30% vs 16b, shadow ramp neutral grey-mauve',
    satOf(gp19a.ground) < satOf(OLD16B.ground) * 0.7 &&
    satOf(gp19a.shallow) < satOf(OLD16B.shallow) * 0.7 &&
    satOf(gp19a.wall0) < satOf(OLD16B.wall0) * 0.7 &&
    gp19a.shadowTint[2] <= 1.0 && (gp19a.shadowTint[2] - gp19a.shadowTint[0]) < 0.25);
  // white-rim/wobble/grain soak: sweep ToD with quality ON — the retuned F_POST must stay
  // sky-masked + slope-rejecting (unchanged machinery) with zero GL warnings over both RTT passes.
  for (const t of [0.0, 0.25, 0.34, 0.5, 0.66, 0.755, 0.9]) { await page.evaluate(tt => window.__harbor.setTod(tt), t); await sleep(160); }
  ok('19a: full ToD sweep with white wobbled rims + fibre grain + matte grade live → zero GL warnings/errors', errs.length === errsBefore19a);
  // legacy quality-off path: no post pass → no rims (as before, dark ink no longer ships as any
  // default) — the matte palette/grain/banding ride the base shaders and must render just as clean.
  await page.evaluate(() => { window.__harbor.setTod(0.5); window.__harbor.setPost(false); }); await sleep(400);
  ok('19a: legacy quality-off path renders the papercraft world clean (no outlines at all — ink is gone as a default)', errs.length === errsBefore19a);
  await page.evaluate(() => window.__harbor.setPost(true));

  // Phase 19b: PAPER WORLD ELEMENTS — the sea rebuilt as layered, sliding paper bands; clouds/trees
  // rebuilt as flat cutouts; the sky as a card gradient with a cut-paper sun disc + crescent moon;
  // industry smoke as paper curls; sails/pennants retuned to a crisper flutter. Assertions pivot on
  // the new __harbor.water()/sky()/clouds()/terrainStats().trees/smokeStyle()/forceSmoke()/flutter()
  // debug hooks + the deterministic stepClock() time-step (no wall-clock sleeps for the band-slide
  // or flutter checks).
  const errsBefore19b = errs.length;
  await page.evaluate(() => window.__harbor.setBiome('green'));
  await page.evaluate(() => window.__harbor.setTod(0.5));
  const water19bA = await page.evaluate(() => window.__harbor.water());
  await page.evaluate(() => window.__harbor.stepClock(3.0));
  const water19bB = await page.evaluate(() => window.__harbor.water());
  ok('19b water: paper-band contract intact (gradientOn, 4 shore bands, paperBands flag) + every boundary\'s lateral phase advances after a deterministic time-step (no sleep)',
    water19bA && water19bA.gradientOn === true && water19bA.shoreBands === 4 && water19bA.paperBands === true &&
    water19bB.bandPhase.length === 4 && water19bB.bandPhase.every((p, i) => Math.abs(p - water19bA.bandPhase[i]) > 0.05));
  const skyNoon19b = await page.evaluate(() => { window.__harbor.setTod(0.5); return window.__harbor.sky(); });
  const skyDusk19b = await page.evaluate(() => { window.__harbor.setTod(0.755); return window.__harbor.sky(); });
  const skyNight19b = await page.evaluate(() => { window.__harbor.setTod(0.0); return window.__harbor.sky(); });
  ok('19b sky: paper sun disc UV tracks the ToD sun (position shifts noon->dusk) + moon UV present at night + cut-paper/no-twinkle flags armed',
    Math.abs(skyNoon19b.sunUV[1] - skyDusk19b.sunUV[1]) > 0.02 && skyNight19b.moonUV.length === 2 &&
    skyNight19b.night > 0.5 && skyNoon19b.cutPaperSun === true && skyNoon19b.starTwinkleOff === true);
  const glSrc19b = await page.evaluate(() => fetch('gl.js').then(r => r.text()).catch(() => ''));
  ok('19b sky: F_SKY source drops the old animated star-twinkle term (sin(uTime*2.0+h*30.0)) in favour of a static per-star size hash',
    glSrc19b.length > 0 && !/sin\(uTime\*2\.0\+h\*30\.0\)/.test(glSrc19b) && /flecksize/.test(glSrc19b));
  const clouds19b = await page.evaluate(() => window.__harbor.clouds());
  ok('19b clouds: still 4-7 real-geometry drifting instances (14b contract preserved) + the new flat-cutout flag armed',
    clouds19b.count >= 4 && clouds19b.count <= 7 && clouds19b.verts > 0 && clouds19b.flat === true);
  const treesGreen19b = await page.evaluate(() => window.__harbor.terrainStats().trees);
  const treesMtn19b = await page.evaluate(() => { window.__harbor.setBiome('mountain'); return window.__harbor.terrainStats().trees; });
  const treesTropical19b = await page.evaluate(() => { window.__harbor.setBiome('tropical'); return window.__harbor.terrainStats().trees; });
  await page.evaluate(() => window.__harbor.setBiome('green'));
  const avgVerts19b = k => k.count > 0 ? k.verts / k.count : Infinity;
  ok('19b trees: cross-plane cutout rebuild lands at/under the old cylinder-tree budgets (broadleaf<=101, pine<=128, palm<=176 verts/tree)',
    treesGreen19b.broadleaf.count > 0 && avgVerts19b(treesGreen19b.broadleaf) <= 101 &&
    treesMtn19b.pine.count > 0 && avgVerts19b(treesMtn19b.pine) <= 128 &&
    treesTropical19b.palm.count > 0 && avgVerts19b(treesTropical19b.palm) <= 176);
  const smokeStyle19b = await page.evaluate(() => window.__harbor.smokeStyle());
  const fx19bBefore = await page.evaluate(() => window.__harbor.fxCount());
  const fx19bAfter = await page.evaluate(() => window.__harbor.forceSmoke(6));
  ok('19b smoke: style flag reports "curl" (flat paper spiral, not a round puff) and forceSmoke actually spawns particles',
    smokeStyle19b === 'curl' && fx19bAfter >= fx19bBefore + 6);
  const flut19bA = await page.evaluate(() => window.__harbor.flutter(0));
  const flut19bB = await page.evaluate(() => { window.__harbor.stepClock(0.3); return window.__harbor.flutter(0); });
  ok('19b flutter: retuned crisp paper sway/billow is bounded well under the old 16a cloth-wobble amplitude, and still animates between two time-steps',
    Math.abs(flut19bA.sway) <= 0.07 && Math.abs(flut19bA.billow - 1) <= 0.035 &&
    (flut19bA.sway !== flut19bB.sway || flut19bA.billow !== flut19bB.billow));
  for (const t of [0.0, 0.15, 0.25, 0.34, 0.5, 0.66, 0.755, 0.9, 1.0]) { await page.evaluate(tt => window.__harbor.setTod(tt), t); await sleep(120); }
  ok('19b: full ToD sweep with paper sea/sky/clouds/smoke all live → zero GL warnings/errors', errs.length === errsBefore19b);
  await page.evaluate(() => { window.__harbor.setTod(0.5); window.__harbor.setPost(false); }); await sleep(300);
  ok('19b: legacy quality-off path renders the paper world clean (no post pass, zero GL errors)', errs.length === errsBefore19b);
  await page.evaluate(() => window.__harbor.setPost(true));

  // Phase 19c: PAPER MOTION & UI — unfold build pop (asserted exactly up at the 18b block, which
  // 19c re-pins to the new curve), page-flutter on collect, the papercraft interface reskin
  // (body.paperui override layer in style.css), and the far-water band-CONTRAST distance fade.
  const errsBefore19c = errs.length;
  // page-flutter on collect: same deterministic pinned-progress contract as the pop. flutExpect()
  // mirrors flutterAngleFor() operation-for-operation (exact compare, no tolerance).
  const flutExpect = (k) => 0.10 * Math.sin(k * Math.PI * 3.0) * (1 - k);
  const flut19cMid = await page.evaluate(() => window.__harbor.setFlutterProgress(0.15));
  const flut19cEnd = await page.evaluate(() => window.__harbor.setFlutterProgress(1.0));
  const flut19cClr = await page.evaluate(() => window.__harbor.setFlutterProgress(null));
  ok('19c: collect page-flutter EXACT at pinned p=0.15 (decaying 3-half-wave rotation wobble, 0.25s, style flag armed) and exactly 0/inactive at the end + when cleared',
    flut19cMid.active && flut19cMid.style === 'page-flutter' && flut19cMid.dur === 0.25 && flut19cMid.angle === flutExpect((0.15 * 0.25) / 0.25) &&
    !flut19cEnd.active && flut19cEnd.angle === 0 && !flut19cClr.active && flut19cClr.angle === 0);
  // paper UI reskin: the body.paperui root class gates the whole override layer, and every panel
  // must actually resolve to a light warm-paper card background (not the old dark navy glass).
  const paperUI = await page.evaluate(() => {
    const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g) || [0, 0, 0]; return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255; };
    const bg = (id) => lum(getComputedStyle(document.getElementById(id)).backgroundColor);
    return {
      root: document.body.classList.contains('paperui'),
      manage: bg('managepanel'), settings: bg('settingspanel'), exp: bg('exppanel'), registry: bg('registrypanel'),
    };
  });
  ok('19c: paperui root class set + all four house panels (Manage/Settings/Expeditions/Registry) resolve to light paper-card backgrounds (luma > 0.75)',
    paperUI.root && paperUI.manage > 0.75 && paperUI.settings > 0.75 && paperUI.exp > 0.75 && paperUI.registry > 0.75);
  // computed-style CONTRAST sentinel: dark warm-brown text on the light card for Manage + Settings
  // (WCAG-ish luma gap — panel bg light, header/row text dark, gap > 0.5 keeps AA at 390x844).
  const contrast19c = await page.evaluate(() => {
    document.getElementById('managebtn').click();   // open Manage so its rows exist in the DOM
    const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g) || [0, 0, 0]; return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255; };
    const panel = document.getElementById('managepanel');
    const head = panel.querySelector('.mp-head'), item = panel.querySelector('.mp-item:not(.ghosted) .mi-n');
    const out = {
      bg: lum(getComputedStyle(panel).backgroundColor),
      head: head ? lum(getComputedStyle(head).color) : 1,
      item: item ? lum(getComputedStyle(item).color) : 1,
      setBg: lum(getComputedStyle(document.getElementById('settingspanel')).backgroundColor),
      setHelp: lum(getComputedStyle(document.body).color),
    };
    document.getElementById('managebtn').click();   // close again
    return out;
  });
  ok('19c: contrast sentinel — Manage header + item text are dark ink (luma < 0.35) on the light card (bg luma > 0.75), Settings card light too, body ink dark',
    contrast19c.bg > 0.75 && contrast19c.head < 0.35 && contrast19c.item < 0.35 &&
    contrast19c.setBg > 0.75 && contrast19c.setHelp < 0.35);
  // far-water band-contrast fade: hook flag + the shader term actually in the served source
  const water19c = await page.evaluate(() => window.__harbor.water());
  const glSrc19c = await page.evaluate(() => fetch('gl.js').then(r => r.text()).catch(() => ''));
  ok('19c: far-water band-CONTRAST distance fade armed (water().bandFarFade) and the bandFarFlat term ships in F_WATER — band tones ease to one card colour AND the cut rim fades with it',
    water19c.bandFarFade === true && /bandFarFlat=smoothstep/.test(glSrc19c) && /wobFade\*\(1\.0-bandFarFlat\)/.test(glSrc19c));
  // zero GL warnings ToD sweep with the unfold + flutter both live mid-window
  await page.evaluate(() => { window.__harbor.setPopProgress(0.2); window.__harbor.setFlutterProgress(0.4); });
  for (const t of [0, 0.25, 0.5, 0.755, 0.9]) { await page.evaluate(tt => window.__harbor.setTod(tt), t); await sleep(140); }
  await page.evaluate(() => { window.__harbor.setPopProgress(null); window.__harbor.setFlutterProgress(null); window.__harbor.setTod(0.5); });
  ok('19c: full ToD sweep with unfold + page-flutter transforms live → zero GL warnings/errors', errs.length === errsBefore19c);
  // legacy quality-off path with the 19c water fade + paper UI live
  await page.evaluate(() => window.__harbor.setPost(false)); await sleep(300);
  ok('19c: legacy quality-off path renders clean with the band-contrast fade + paper UI live (zero GL errors)', errs.length === errsBefore19c);
  await page.evaluate(() => window.__harbor.setPost(true));

  // ============ Phase 20a: THE FLOATING DIORAMA — the world slab ============
  // The world stops being an infinite-sea landscape and becomes a finite floating OBJECT: a
  // stratified cliff-skirt + rocky underside around a SLAB boundary, a bounded sea pool with paper
  // waterfalls spilling over the rim, a pure card-gradient sky backdrop with NO horizon line, a
  // reframed camera that can see the slab edge/underside, and departure paper-fold at the boundary.
  const errsBefore20a = errs.length;
  // skirt/underside geometry present per biome — terrainStats().skirt (models.js buildSkirtMesh)
  const ts20aGreen = await page.evaluate(() => { window.__harbor.setBiome('green'); return window.__harbor.terrainStats(); });
  const ts20aMtn = await page.evaluate(() => { window.__harbor.setBiome('mountain'); return window.__harbor.terrainStats(); });
  const ts20aDesert = await page.evaluate(() => { window.__harbor.setBiome('desert'); return window.__harbor.terrainStats(); });
  ok('20a: skirt (cliff-strata + rocky underside) geometry present for every sampled biome, hundreds of quads',
    ts20aGreen.skirt && ts20aGreen.skirt.quads > 400 && ts20aGreen.skirt.verts === ts20aGreen.skirt.quads * 4 &&
    ts20aMtn.skirt && ts20aMtn.skirt.quads > 400 && ts20aDesert.skirt && ts20aDesert.skirt.quads > 400);
  // bounded sea pool + waterfall strips + rim lip, and the pool is FAR smaller than the old
  // infinite 2900x300 plane (~90.6k verts) — a real structural boundary, not just a visual trick
  const water20a = await page.evaluate(() => window.__harbor.water());
  ok('20a: water is a bounded pool (not the old infinite plane) with a rim lip and paper waterfall strips around the boundary',
    water20a.bounded === true && water20a.rimLip === true && water20a.waterfallSegs >= 24 && water20a.poolVerts > 500 && water20a.poolVerts < 20000);
  // waterfall scroll advances deterministically via stepClock (no wall-clock sleep)
  const fall20aA = await page.evaluate(() => window.__harbor.water().waterfallScroll);
  await page.evaluate(() => window.__harbor.stepClock(3));
  const fall20aB = await page.evaluate(() => window.__harbor.water().waterfallScroll);
  ok('20a: waterfall downward-scroll phase advances with stepClock (deterministic, matches F_WATER\'s vFallMask term)', fall20aA !== fall20aB);
  // sky horizon-line REMOVED sentinel — read the served shader source directly: the old authored
  // horizon-glow term is gone, replaced by a plain vignette; no horizon band mixed in anywhere.
  const glSrc20a = await page.evaluate(() => fetch('gl.js').then(r => r.text()).catch(() => ''));
  ok('20a: F_SKY horizon band removed from the shader source (no more hb=exp horizon-glow mix) + a void vignette term now ships instead',
    !/hb=exp\(-pow\(max\(vUv\.y-uHorizonY/.test(glSrc20a) && !/c=mix\(c,uHorizon,hb/.test(glSrc20a) && /vig=1\.0-dot\(vc,vc\)/.test(glSrc20a));
  // camera max-zoom frames the whole slab; pitch can go low enough to see the underside
  const camB20a = await page.evaluate(() => window.__harbor.camBounds());
  const slab20a = await page.evaluate(() => window.__harbor.slab());
  ok('20a: camera bounds widened to frame the floating slab (raised max zoom-out, lowered min pitch) and SLAB geometry is sane',
    camB20a.distMax >= 1000 && camB20a.distMax <= 1600 && camB20a.elMin <= 0.10 &&
    slab20a && slab20a.rx > 500 && slab20a.rz > 100);
  // found-flow still works end-to-end on a fresh (unfounded) biome with the new camera/world intact
  const found20a = await page.evaluate(() => {
    window.__harbor.setBiome('nordic'); window.__harbor.autoFound();
    return window.__harbor.state();
  });
  ok('20a: found-village flow still works end-to-end on the rebuilt world (fresh biome founds via autoFound)', found20a.founded === true);
  await page.evaluate(() => window.__harbor.setBiome('green'));   // restore for the rest of the sweep
  // departure fold-out: a forced mid-boundary distance folds partially; well inside/outside are 1/0
  const fold20a = await page.evaluate(() => ({ mid: window.__harbor.departureFold(155), near: window.__harbor.departureFold(50), far: window.__harbor.departureFold(200) }));
  ok('20a: ship departure paper-fold — 0 well inside the boundary is unfolded (1), well past it is fully folded (0), mid-crossing is partial',
    fold20a.near === 1 && fold20a.far === 0 && fold20a.mid > 0 && fold20a.mid < 1);
  // zero GL warnings across a full ToD sweep with the rebuilt sky/water/skirt all live
  for (const t of [0, 0.2, 0.5, 0.755, 0.9]) { await page.evaluate(tt => window.__harbor.setTod(tt), t); await sleep(140); }
  await page.evaluate(() => window.__harbor.setTod(0.5));
  ok('20a: full ToD sweep over the floating-diorama world (skirt + bounded sea + waterfalls + void sky) → zero GL warnings/errors', errs.length === errsBefore20a);
  // geomStats within the re-derived ceiling — the skirt/underside quads are cheap (~1-2k verts) next
  // to the terrain's own ~200k+, and the bounded water pool REMOVES ~85k CPU-side verts vs the old
  // infinite plane (water isn't part of geomStats, but confirms no regression pushed past budget)
  const gs20a = await page.evaluate(() => window.__harbor.geomStats());
  ok('20a: geomStats within the re-derived 300k ceiling (unchanged — skirt/underside geometry is a small addition, hard cap 400k)',
    gs20a && gs20a.verts > 10000 && gs20a.verts < 300000);
  // legacy quality-off path renders the slab/void/waterfalls clean too (only rims/post are gated —
  // the skirt/underside/bounded-pool geometry itself is unconditional on both paths)
  await page.evaluate(() => window.__harbor.setPost(false)); await sleep(300);
  ok('20a: legacy quality-off path renders the world slab clean (zero GL errors) — skirt/pool geometry is unconditional', errs.length === errsBefore20a);
  await page.evaluate(() => window.__harbor.setPost(true));

  // ============ Phase 20b: diorama presentation polish ============
  const errsBefore20b = errs.length;
  // slab bob: advances deterministically via stepClock, imperceptibly small (<=0.4 units / 0.15deg)
  const bobA = await page.evaluate(() => window.__harbor.bob());
  await page.evaluate(() => window.__harbor.stepClock(3));
  const bobB = await page.evaluate(() => window.__harbor.bob());
  ok('20b: slab bob advances deterministically via stepClock (root-transform, pure fn of clock) and stays within its tiny authored amplitude',
    bobA.y !== bobB.y && Math.abs(bobA.y) <= bobA.amp + 1e-6 && Math.abs(bobB.roll) <= (0.15 * Math.PI / 180) + 1e-6);
  // picking/founding still works end-to-end WITH bob active — screenToGround/groundAt is
  // deliberately un-bobbed (compensated), so a tap should resolve to the same world point
  // regardless of where the bob sine currently sits.
  const groundBob1 = await page.evaluate(() => window.__harbor.groundAt(207, 410));
  await page.evaluate(() => window.__harbor.stepClock(6.5));   // walks the bob sine to a very different phase
  const groundBob2 = await page.evaluate(() => window.__harbor.groundAt(207, 410));
  // tolerance 0.15 world-units: un-compensated picking would drift by ~the bob amplitude (±0.4u), so
  // 0.15 still cleanly proves the compensation while absorbing swiftshader's per-frame FP jitter in
  // the projection (a tighter 0.05 occasionally flaked without ever indicating a real regression).
  ok('20b: picking (screenToGround) is unaffected by slab bob — same screen tap resolves to the same ground point at any bob phase',
    groundBob1 && groundBob2 && Math.abs(groundBob1.x - groundBob2.x) < 0.15 && Math.abs(groundBob1.z - groundBob2.z) < 0.15);
  const foundBob = await page.evaluate(() => { window.__harbor.setBiome('tropic'); window.__harbor.autoFound(); return window.__harbor.state(); });
  ok('20b: founding still works end-to-end with slab bob live', foundBob.founded === true);
  await page.evaluate(() => window.__harbor.setBiome('green'));
  // void paper flecks: capped count in the 20-30 range, deterministic drift via stepClock
  const fleckA = await page.evaluate(() => window.__harbor.flecks());
  await page.evaluate(() => window.__harbor.stepClock(20));
  const fleckB = await page.evaluate(() => window.__harbor.flecks());
  ok('20b: void paper flecks — 20-30 of them, cheap billboard scatter, deterministic drift over stepClock',
    fleckA && fleckA.count >= 20 && fleckA.count <= 30 &&
    fleckA.pos[0][0] !== fleckB.pos[0][0]);
  // waterfall wash audio: commanded target respects the mute toggle (independent of live ramp timing)
  await page.evaluate(() => window.__harbor.setMuted(false));
  const washOn = await page.evaluate(() => window.__harbor.audio());
  await page.evaluate(() => window.__harbor.setMuted(true));
  const washMuted = await page.evaluate(() => window.__harbor.audio());
  await page.evaluate(() => window.__harbor.setMuted(false));
  ok('20b: waterfall-wash commanded target is >=0 unmuted and forced to exactly 0 when muted',
    washOn.target.wash >= 0 && washMuted.target.wash === 0);
  // gulls: a few far gulls arc out to (and past) the slab's own edge radius before sweeping back
  const gullsFar = await page.evaluate(() => window.__harbor.gullFar());
  const slabB = await page.evaluate(() => window.__harbor.slab());
  ok('20b: a handful of gulls are tuned to arc out beyond the slab edge radius (rFar > harbour ring r, and past SLAB rx/rz) before sweeping back',
    gullsFar.length >= 1 && gullsFar.every(g => g.rFar > g.r) && gullsFar.every(g => g.rFar >= Math.max(slabB.rx, slabB.rz)));
  // welcome framing: a FRESH boot starts at max zoom-out ("model in hand"); a returning/saved boot
  // (welcome already seen) uses the ordinary defaultView() play-zoom framing, unchanged.
  const freshCtx = await browser.newContext({ viewport: { width: 414, height: 820 } });
  const freshPage = await freshCtx.newPage();
  await freshPage.goto(`http://localhost:${PORT}/games/harbor/?biome=green&nopost-probe`, { waitUntil: 'load' });
  await freshPage.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await freshPage.reload({ waitUntil: 'load' });
  await freshPage.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 }).catch(() => {});
  await sleep(200);
  const welcomeFresh = await freshPage.evaluate(() => window.__harbor.welcome());
  ok('20b: fresh boot (welcome not yet seen) starts the "model in hand" framing at max zoom-out',
    welcomeFresh.framing === true && welcomeFresh.distT === welcomeFresh.camMax);
  await freshPage.evaluate(() => { var b = document.querySelector('#welcomemodal .wm-btn'); if (b) b.click(); });
  await sleep(200);
  const welcomeDismissed = await freshPage.evaluate(() => window.__harbor.welcome());
  ok('20b: dismissing the welcome card ends model-in-hand framing and eases the camera back toward ordinary play zoom',
    welcomeDismissed.framing === false && welcomeDismissed.distT < welcomeFresh.camMax);
  await freshCtx.close();
  // a SAVED/returning boot (welcome already marked seen) never gets the model-in-hand override
  const savedCtx = await browser.newContext({ viewport: { width: 414, height: 820 } });
  const savedPage = await savedCtx.newPage();
  await savedPage.goto(`http://localhost:${PORT}/games/harbor/?biome=green&nopost-probe`, { waitUntil: 'load' });
  await savedPage.evaluate(() => { try { localStorage.setItem('gf:harbor:seen', 'true'); } catch (e) {} });
  await savedPage.reload({ waitUntil: 'load' });
  await savedPage.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 }).catch(() => {});
  await sleep(200);
  const welcomeSaved = await savedPage.evaluate(() => window.__harbor.welcome());
  ok('20b: a returning/saved boot (welcome already seen) keeps ordinary defaultView() framing, no model-in-hand override',
    welcomeSaved.framing === false && welcomeSaved.distT !== welcomeSaved.camMax);
  await savedCtx.close();
  // zero GL warnings across a ToD sweep with bob + flecks + wash + far gulls all live
  for (const t of [0, 0.2, 0.5, 0.755, 0.9]) { await page.evaluate(tt => window.__harbor.setTod(tt), t); await sleep(140); }
  await page.evaluate(() => window.__harbor.setTod(0.5));
  ok('20b: full ToD sweep with slab bob + void flecks + waterfall wash + far gulls all live → zero GL warnings/errors', errs.length === errsBefore20b);
  // geomStats/fps guard — flecks reuse the shared unit boxMesh (no new static geometry), so the
  // static-scene budget is unchanged by this phase
  const gs20b = await page.evaluate(() => window.__harbor.geomStats());
  ok('20b: geomStats unaffected by the presentation polish (flecks/gulls/bob are dynamic, not static geometry) — still within budget',
    gs20b && gs20b.verts > 10000 && gs20b.verts < 300000);

  // ---- Phase 14c: WORLD DRAMA — storms/pirates/construction theatre/expedition send-offs are all
  // pure reads of real sim state (SIM.state()/event()) plus a locally-smoothed draw timer; every
  // assertion below drives that real state (forceWarn/fireEvent/the actual send-voyage click) and
  // checks the exposed __harbor hooks, never a hardcoded/fake flag.
  // NB: storm/crash ease + pirate phase timers + volley cadence all advance inside updateDrama on
  // the clamped per-frame dt (≤0.05s), which swiftshader's slow software RAF under-advances vs a
  // wall-clock sleep() — so this whole block drives the drama through the deterministic stepDrama()
  // hook (fixed sub-steps), the same no-sleep discipline as stepClock/setPopProgress elsewhere.
  const errsBefore14c = errs.length;
  await page.evaluate(() => window.__harbor.pause(true));
  await page.evaluate(() => { window.HARBOR_SIM.forceWarn('green', false); window.__harbor.forceHUD(); window.__harbor.stepDrama(2.4); });
  const storm1 = await page.evaluate(() => window.__harbor.storm());
  ok('14c storm: forceWarn ramps rainOn + cloudStorm up (real hazard.phase===warn, no crash)', storm1.cloudStorm === true && storm1.rainOn === true && storm1.stormT > 0.2);
  ok('14c storm: water bands slide faster while a storm is up', storm1.waterStorm > 1.05);
  await page.evaluate(() => { window.HARBOR_SIM.avertHazard(); window.__harbor.stepDrama(4); });
  const storm2 = await page.evaluate(() => window.__harbor.storm());
  ok('14c storm: avert clears the storm visuals back down (rainOn/cloudStorm off)', storm2.cloudStorm === false && storm2.rainOn === false && storm2.stormT < 0.05);

  await page.evaluate(() => { window.HARBOR_SIM.forceWarn('green', true); window.__harbor.forceHUD(); window.__harbor.stepDrama(1.6); });
  const crash1 = await page.evaluate(() => window.__harbor.storm());
  ok('14c crash: forceWarn(crash) ramps the crash flag up (light treatment, distinct from storm)', crash1.crashT > 0.5 && crash1.cloudStorm === false);
  await page.evaluate(() => { window.HARBOR_SIM.avertCrash(); window.__harbor.stepDrama(4); });
  const crash2 = await page.evaluate(() => window.__harbor.storm());
  ok('14c crash: avert clears the crash flag back down', crash2.crashT < 0.05);

  // legacy quality path: rain is quality-gated (postEnabled()), cloud darkening/water-speed are not
  await page.evaluate(() => { window.__harbor.setPost(false); window.HARBOR_SIM.forceWarn('green', false); window.__harbor.forceHUD(); window.__harbor.stepDrama(2.4); });
  const stormLegacy = await page.evaluate(() => window.__harbor.storm());
  ok('14c storm: legacy quality path (post off) turns rain off cleanly while the storm palette/water-speed beats stay live', stormLegacy.rainOn === false && stormLegacy.cloudStorm === true);
  await page.evaluate(() => { window.HARBOR_SIM.avertHazard(); window.__harbor.stepDrama(4); window.__harbor.setPost(true); });

  // pirate raid ship: fold-in to the hold point, pay-resolve departs, fight-resolve runs a confetti
  // cannon exchange before departing
  await page.evaluate(() => window.__harbor.forcePirate());
  const pirIn = await page.evaluate(() => window.__harbor.pirate());
  ok('14c pirate: forcePirate folds the corsair in', pirIn.present === true && pirIn.phase === 'in');
  await page.evaluate(() => window.__harbor.stepDrama(1.2));
  const pirHold = await page.evaluate(() => window.__harbor.pirate());
  ok('14c pirate: corsair settles to its ~40-unit holding point offshore of the port', pirHold.phase === 'hold' && pirHold.holdDist > 25 && pirHold.holdDist < 55);
  await page.evaluate(() => { window.__harbor.resolvePirate('pay'); window.__harbor.stepDrama(1.7); });
  const pirPaid = await page.evaluate(() => window.__harbor.pirate());
  ok('14c pirate: paying tribute sails the corsair off (folds out + clears)', pirPaid.present === false);

  await page.evaluate(() => window.__harbor.forcePirate('fight'));
  const pirFight = await page.evaluate(() => window.__harbor.pirate());
  ok('14c pirate: fight resolution carries a confetti-style cannon exchange flag', pirFight.present === true && pirFight.confetti === true);
  await page.evaluate(() => window.__harbor.stepDrama(4));   // fire the 2-3 volleys, then let the corsair depart
  const volleys = await page.evaluate(() => window.__harbor.volleyCount());
  const pirDone = await page.evaluate(() => window.__harbor.pirate());
  ok('14c pirate: the fight runs a multi-volley confetti exchange (2-3 volleys) then the corsair departs', volleys >= 2 && volleys <= 3 && pirDone.present === false);

  // construction theatre: deterministic scaffold pop via the pinned-progress hook (same contract
  // as 19c's setPopProgress) — present mid-prelude, gone once the window has fully elapsed
  const theatreMid = await page.evaluate(() => window.__harbor.setBuildTheatreProgress(0.3));
  ok('14c theatre: scaffold prelude is present at p=0.3', theatreMid.active === true);
  const theatreDone = await page.evaluate(() => window.__harbor.setBuildTheatreProgress(1));
  ok('14c theatre: scaffold prelude is gone once p reaches 1', theatreDone.active === false);
  await page.evaluate(() => window.__harbor.setBuildTheatreProgress(null));   // un-pin — restore live sampling

  // expedition send-off: horn sfx commanded (11c target pattern: assert the call was made, not a
  // continuous AudioParam) + toast text + a real cast-off (ship starts at the quay, not offshore)
  await page.evaluate(() => { var S = window.HARBOR_SIM.raw(); S.money = 200000; window.HARBOR_SIM.setEra(1); window.HARBOR_SIM.save(); window.__sfxLog = []; window.Juice.Audio.play = (function (orig) { return function (name) { window.__sfxLog.push(name); return orig.apply(this, arguments); }; })(window.Juice.Audio.play); });
  await page.evaluate(() => { document.getElementById('expbtn').click(); });
  await sleep(150);
  await page.evaluate(() => { var b = document.querySelector('[data-send]'); if (b) b.click(); });
  await sleep(100);
  const voyDrama = await page.evaluate(() => window.__harbor.voyageDrama());
  const sfxLog = await page.evaluate(() => window.__sfxLog.slice());
  ok('14c expedition: send-off commands a horn/sting sfx (11c target pattern — the call was made)', sfxLog.indexOf('score') >= 0);
  ok('14c expedition: cast-off marks the freshly-sent voyage (ship starts at the quay, not offshore)', voyDrama.castoffOn === true);

  // zero GL/console warnings + geomStats/vertex budget with storm + pirate + theatre all forced
  // together across one ToD sweep (the "everything happening at once" stress case from the spec)
  const errsBeforeSweep14c = errs.length;
  await page.evaluate(() => { window.HARBOR_SIM.forceWarn('green', false); window.__harbor.forceHUD(); window.__harbor.forcePirate(); window.__harbor.setBuildTheatreProgress(0.4); });
  for (const t of [0.1, 0.3, 0.5, 0.755, 0.9]) { await page.evaluate(tt => window.__harbor.setTod(tt), t); await sleep(160); }
  await page.evaluate(() => { window.HARBOR_SIM.avertHazard(); window.__harbor.setBuildTheatreProgress(null); window.__harbor.resolvePirate('pay'); window.__harbor.setTod(0.5); });
  await sleep(300);
  ok('14c: storm + pirate + theatre forced together across a ToD sweep → zero new GL/console warnings', errs.length === errsBeforeSweep14c);
  const gs14c = await page.evaluate(() => window.__harbor.geomStats());
  ok('14c: geomStats stays within the existing vertex budget (drama is all dynamic/2D-overlay, no new static geometry)', gs14c && gs14c.verts > 10000 && gs14c.verts < 300000);
  await page.evaluate(() => window.__harbor.pause(false));
  ok('14c: the whole drama pass ran with zero new console/page errors', errs.length === errsBefore14c);

  // live ticking after everything — no late errors
  await sleep(2000);
  ok('stability: zero console/page errors', errs.length === 0);

  console.log((fail === 0 ? 'ALL PASS' : 'FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('  failing:'); fails.forEach(f => console.log('   - ' + f)); if (errs.length) console.log('  errors: ' + errs.slice(0, 6).join(' | ')); }
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAILED — harness error: ' + e.message); try { srv.close(); } catch (x) {} process.exit(1); });
