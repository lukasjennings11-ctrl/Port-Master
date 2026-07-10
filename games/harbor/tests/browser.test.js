/* PortMaster — headless browser integration regression (swiftshader Playwright).
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

(async () => {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 414, height: 820 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|favicon/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
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
  await page.evaluate(() => { var b = document.querySelector('#welcomemodal .wm-btn'); if (b) b.click(); var H = window.__harbor, S = window.HARBOR_SIM; H.autoFound(); S.setEra(4); S.raw().money = 5e6; S.raw().lifetimeMoney = 5e6; var p = S.port('green'); ['fishing_hut', 'fishing_hut', 'cottage', 'jetty', 'warehouse', 'market'].forEach(t => { if (S.canBuild(t)) S.build(t); }); p.res.fish = 999; p.res.timber = 999; p.res.goods = 999; });
  ok('found: port founded', await page.evaluate(() => !!window.HARBOR_SIM.raw().founded));

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
  ok('9c doctrine: gated <3 charters, capstone gated on pick, pick costs 25✦ → +35% sales +10% routes',
    d9.gatedPick === false && d9.capGate === false && d9.pickOk === true && d9.bal1 === 275 &&
    Math.abs(d9.sell1 - d9.sell0 - 0.35) < 1e-6 && d9.route1 >= 1.10 - 1e-6);
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
  await page.evaluate(() => { window.HARBOR_SIM.raw().voyages[0].endsAt = Date.now() - 1; var v = window.__harbor.voyages().active[0]; window.__harbor.collectVoyage(v.seq); });
  ok('fleet: expedition ship gone after collect', await page.evaluate(() => window.__harbor.fleet().expedition === 0));
  // living fleet: a route touching the active port spawns a shuttling cargo ship
  await page.evaluate(() => { var S = window.HARBOR_SIM; S.foundPort('tropical'); S.setActive('green'); S.raw().money = 1e6; S.addRoute('green', 'tropical', 'fish'); });
  ok('fleet: cargo ship shuttles the active-port route', await page.evaluate(() => window.__harbor.fleet().route === 1));

  // rival race → win
  await page.evaluate(() => window.__harbor.triggerRival()); await sleep(120);
  await page.evaluate(() => { var bs = document.querySelectorAll('#rivalmodal .ev-btn'); if (bs.length) bs[bs.length - 1].click(); }); await sleep(120);
  ok('fleet: rival ship patrols during the race', await page.evaluate(() => window.__harbor.fleet().rival === 1));
  await page.evaluate(() => { var r = window.__harbor.rival().race; if (r) window.HARBOR_SIM.raw().lifetimeMoney += r.target + 10; window.__harbor.forceHUD(); }); await sleep(150);
  await page.evaluate(() => { var b = document.querySelector('#rivalmodal.show .ev-btn'); if (b) b.click(); });
  ok('rival: race won recorded', await page.evaluate(() => window.__harbor.rival().wins >= 1));
  ok('fleet: rival ship gone after the race resolves', await page.evaluate(() => window.__harbor.fleet().rival === 0));

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
  const gs = await page.evaluate(() => window.__harbor.geomStats());
  ok('geom: static-scene stats exposed and within vertex budget', gs && gs.verts > 10000 && gs.verts < 250000 && gs.indices > 0);
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
  ok('env: water sparkle scales with ToD (dusk strong, night faint)',
    envDusk2.sparkle > 0.5 && envNight2.sparkle > 0 && envNight2.sparkle < 0.3);
  await page.evaluate(() => window.__harbor.setTod(0.5)); await sleep(150);
  ok('10b: sky/water/sparkle uniforms render with zero new errors', errs.length === errsBeforeSweep);

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

  // live ticking after everything — no late errors
  await sleep(2000);
  ok('stability: zero console/page errors', errs.length === 0);

  console.log((fail === 0 ? 'ALL PASS' : 'FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('  failing:'); fails.forEach(f => console.log('   - ' + f)); if (errs.length) console.log('  errors: ' + errs.slice(0, 6).join(' | ')); }
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAILED — harness error: ' + e.message); try { srv.close(); } catch (x) {} process.exit(1); });
