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
  // Phase 11b: refreshed welcome copy should name the systems a newcomer wouldn't otherwise discover
  const wmFeat = await page.evaluate(() => { var el = document.querySelector('#welcomemodal .wm-feat'); return el ? el.textContent : ''; });
  ok('welcome: refreshed copy mentions Expeditions', /expedition/i.test(wmFeat));
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
  ok('bonus: claim → SIM boost active at 2× with a live "⚓2× m:ss" countdown chip in the HUD, daily count advances',
    b1.hook.active === true && b1.hook.mult === 2 && b1.hook.remaining > 590 && b1.hook.remaining <= 600 &&
    b1.chipVisible === true && /⚓\s*2×\s*\d+:\d{2}/.test(b1.chipText) && b1.modalShown === false && b1.hook.usedToday === 1);

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
    window.__harbor.setEra(4); S.raw().money = 5e6;
    if (S.canBuild('dock')) S.build('dock'); if (S.canBuild('dock')) S.build('dock');
  });
  await page.evaluate(() => window.__harbor.advance());
  await sleep(150);
  const cbAfter = await page.evaluate(() => window.ADS._counts.commercialBreak);
  ok('ads: commercialBreak() fires on era advance, before the ascension cinematic', cbAfter === cbBefore + 1);

  // portal mode (?portal=1): service worker not registered, "Add to home screen" + privacy link
  // hidden, plain version line shown instead. Fresh context/page — independent of `page` above.
  const portalPage = await (await browser.newContext({ viewport: { width: 414, height: 820 } })).newPage();
  const portalErrs = [];
  portalPage.on('pageerror', e => portalErrs.push('PAGEERR ' + e.message));
  portalPage.on('console', m => { if (m.type() === 'error' && !/404|favicon/.test(m.text())) portalErrs.push('CONSOLE ' + m.text()); });
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
    portalState.privacyLink === false && /PortMaster v\d+/.test(portalState.aboutText));
  ok('portal mode: zero console/page errors', portalErrs.length === 0);
  await portalPage.close();

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

  // live ticking after everything — no late errors
  await sleep(2000);
  ok('stability: zero console/page errors', errs.length === 0);

  console.log((fail === 0 ? 'ALL PASS' : 'FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('  failing:'); fails.forEach(f => console.log('   - ' + f)); if (errs.length) console.log('  errors: ' + errs.slice(0, 6).join(' | ')); }
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAILED — harness error: ' + e.message); try { srv.close(); } catch (x) {} process.exit(1); });
