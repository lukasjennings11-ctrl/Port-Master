/* PortMaster — long-session soak test (Playwright monkey run).
 * Proves an evening session survives: drives the real UI (Manage/Expeditions/Legacy panels,
 * crate/bonus buttons, event/rival modals, fever, ToD/biome/viewport churn, prestige) via a
 * weighted-random "monkey" for ~22 minutes of real wall time, sampling heap/fps/DOM-node-count
 * every 30s, then asserts: zero page/console errors, a heap plateau (not an unbounded climb) over
 * the second half of the run, an fps floor relative to early steady-state, no unbounded DOM growth,
 * and that the save survives a reload with money intact. Exit 0 = pass.
 *
 * Run: node games/harbor/tests/soak.js --mins 22   (or: bash games/harbor/tests/run-soak.sh 22)
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../..');        // repo root (…/games/harbor/tests → repo)
const PORT = 8299;                                        // distinct from the fast suite's 8199 — safe to run alongside it

// ---------------------------------------------------------------- CLI args
function argMins() {
  var a = process.argv, i = a.indexOf('--mins');
  if (i >= 0 && a[i + 1]) { var v = parseFloat(a[i + 1]); if (!isNaN(v) && v > 0) return v; }
  return 22;
}
const MINS = argMins();
const DURATION_MS = Math.round(MINS * 60 * 1000);
const SAMPLE_EVERY_MS = 30000;

// ---------------------------------------------------------------- Playwright + static server (copied boilerplate from browser.test.js)
function findChromium() {
  var base = '/opt/pw-browsers';
  try { var d = fs.readdirSync(base).filter(function (n) { return /^chromium-/.test(n); }).sort(); if (d.length) { var p = path.join(base, d[d.length - 1], 'chrome-linux', 'chrome'); if (fs.existsSync(p)) return p; } } catch (e) {}
  return undefined;
}
let chromium;
try { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
catch (e) { try { chromium = require('playwright').chromium; } catch (e2) { console.log('SKIP — playwright not available'); process.exit(0); } }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; let fp = path.join(ROOT, p); fs.readFile(fp, (e, b) => { if (e) { s.writeHead(404); s.end('nf'); } else { s.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); s.end(b); } }); }).listen(PORT);
const sleep = ms => new Promise(z => setTimeout(z, ms));

// ---------------------------------------------------------------- monkey action library
function pickWeighted(list) {
  var total = list.reduce((s, a) => s + a.weight, 0), r = Math.random() * total;
  for (var i = 0; i < list.length; i++) { r -= list[i].weight; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}

async function answerModals(page) {
  await page.evaluate(() => {
    var em = document.querySelector('#eventmodal.show .ev-btns');
    if (em) { var bs = em.querySelectorAll('.ev-btn'); if (bs.length) bs[Math.floor(Math.random() * bs.length)].click(); }
    var rm = document.querySelector('#rivalmodal.show .ev-btns');
    if (rm) { var bs2 = rm.querySelectorAll('.ev-btn'); if (bs2.length) bs2[Math.floor(Math.random() * bs2.length)].click(); }
  });
}

async function manageAction(page) {
  await page.evaluate(() => { var b = document.getElementById('managebtn'); if (b) b.click(); });
  await sleep(150);
  await page.evaluate(() => {
    var sels = ['[data-build]:not([disabled])', '[data-up]:not([disabled])', '[data-mgr]:not([disabled])', '[data-order]:not([disabled])'];
    var all = [];
    sels.forEach(s => document.querySelectorAll('#managepanel ' + s).forEach(el => all.push(el)));
    if (all.length) all[Math.floor(Math.random() * all.length)].click();
  });
  await sleep(150);
  await page.evaluate(() => { var b = document.getElementById('managebtn'); if (b) b.click(); });
}

async function expAction(page) {
  await page.evaluate(() => { var b = document.getElementById('expbtn'); if (b) b.click(); });
  await sleep(150);
  await page.evaluate(() => {
    var collects = Array.from(document.querySelectorAll('#exppanel [data-collect]'));
    var sends = Array.from(document.querySelectorAll('#exppanel [data-send]:not([disabled])'));
    var pool = collects.concat(sends);
    if (pool.length) pool[Math.floor(Math.random() * pool.length)].click();
  });
  await sleep(150);
  await page.evaluate(() => { var b = document.getElementById('expbtn'); if (b) b.click(); });
}

async function legacyAction(page, prestigeState) {
  const shown = await page.evaluate(() => { var b = document.getElementById('legacybtn'); return !!(b && b.style.display !== 'none'); });
  if (!shown) return;
  await page.evaluate(() => { var b = document.getElementById('legacybtn'); if (b) b.click(); });
  await sleep(150);
  const canPrestige = await page.evaluate(() => { var b = document.getElementById('lg-pbtn'); return !!(b && !b.disabled); });
  if (canPrestige && prestigeState.count < 2) {
    await page.evaluate(() => { var b = document.getElementById('lg-pbtn'); if (b) b.click(); });
    prestigeState.count++;
    prestigeState.log.push('prestiged at action #' + prestigeState.actionIdx);
    await sleep(400);
  } else {
    await page.evaluate(() => {
      var legs = Array.from(document.querySelectorAll('#legacypanel [data-leg]:not([disabled])'));
      var pass = Array.from(document.querySelectorAll('#legacypanel [data-pass]'));
      var pool = legs.concat(pass);
      if (pool.length) pool[Math.floor(Math.random() * pool.length)].click();
    });
  }
  await sleep(150);
  await page.evaluate(() => { var el = document.getElementById('lg-close'); if (el) el.click(); });
}

async function crateAction(page) {
  const shown = await page.evaluate(() => { var b = document.getElementById('cratebtn'); return !!(b && b.style.display !== 'none'); });
  if (!shown) return;
  await page.evaluate(() => document.getElementById('cratebtn').click());
  await sleep(150);
  await page.evaluate(() => { var b = document.querySelector('#cratemodal #cm-btn'); if (b && !b.disabled) b.click(); });
  await sleep(650);
  await page.evaluate(() => { var b = document.querySelector('#cratemodal #cm-btn'); if (b) b.click(); });   // closes the card
}

async function bonusAction(page) {
  const shown = await page.evaluate(() => { var b = document.getElementById('bonusbtn'); return !!(b && b.style.display !== 'none'); });
  if (!shown) return;
  await page.evaluate(() => document.getElementById('bonusbtn').click());
  await sleep(150);
  await page.evaluate((claim) => {
    var sel = claim ? '[data-bonus="claim"]' : '[data-bonus="decline"]';
    var b = document.querySelector('#bonusmodal ' + sel);
    if (b) b.click();
  }, Math.random() < 0.7);
  await sleep(150);
}

async function feverAction(page) {
  const active = await page.evaluate(() => { try { return window.__harbor.fever().active; } catch (e) { return false; } });
  if (active) await page.evaluate(() => window.__harbor.collectCoins());
}

async function todAction(page) {
  await page.evaluate(() => window.__harbor.setTod(Math.random()));
}

async function biomeAction(page) {
  await page.evaluate(() => {
    window.__harbor.unlockAll();
    var worlds = window.__harbor.state().worlds;
    var id = worlds[Math.floor(Math.random() * worlds.length)];
    window.__harbor.setBiome(id);
  });
  await sleep(400);
  await page.evaluate(() => window.__harbor.setBiome('green'));   // always return home — the founded port + running economy live here
}

async function zoomAction(page) {
  const vp = page.viewportSize() || { width: 414, height: 820 };
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.mouse.wheel(0, (Math.random() < 0.5 ? -1 : 1) * (100 + Math.random() * 200));
}

async function resizeAction(page) {
  const cur = page.viewportSize() || { width: 414, height: 820 };
  const toBig = cur.width < 700;
  await page.setViewportSize(toBig ? { width: 800, height: 600 } : { width: 414, height: 820 });
  await sleep(300);
}

const ACTIONS = [
  { name: 'manage', weight: 30, fn: manageAction },
  { name: 'expedition', weight: 18, fn: expAction },
  { name: 'legacy', weight: 10, fn: legacyAction },
  { name: 'crate', weight: 8, fn: crateAction },
  { name: 'bonus', weight: 6, fn: bonusAction },
  { name: 'fever', weight: 8, fn: feverAction },
  { name: 'tod', weight: 8, fn: todAction },
  { name: 'biome', weight: 4, fn: biomeAction },
  { name: 'zoom', weight: 5, fn: zoomAction },
  { name: 'resize', weight: 3, fn: resizeAction },
];

// ---------------------------------------------------------------- sampling
async function takeSample(page, t) {
  const heapMB = await page.evaluate(() => { try { return performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(2) : null; } catch (e) { return null; } });
  const fps = await page.evaluate(() => new Promise((resolve) => {
    try {
      var start = performance.now(), frames = 0;
      function step(ts) { frames++; if (ts - start < 3000) requestAnimationFrame(step); else resolve(+(frames / ((ts - start) / 1000)).toFixed(1)); }
      requestAnimationFrame(step);
    } catch (e) { resolve(null); }
  }));
  const domNodes = await page.evaluate(() => document.querySelectorAll('*').length);
  const econ = await page.evaluate(() => { try { var r = window.HARBOR_SIM.raw(); return { era: r.era, money: Math.round(r.money) }; } catch (e) { return { era: null, money: null }; } });
  return { t, heapMB, fps, domNodes, era: econ.era, money: econ.money };
}

function closestSample(samples, targetT) {
  var best = null;
  samples.forEach(s => { if (best === null || Math.abs(s.t - targetT) < Math.abs(best.t - targetT)) best = s; });
  return best;
}

function fmtRow(s) {
  return [String(s.t).padStart(5), (s.heapMB == null ? 'n/a' : s.heapMB.toFixed(1)).padStart(8),
    (s.fps == null ? 'n/a' : s.fps.toFixed(1)).padStart(6), String(s.domNodes).padStart(9),
    String(s.era).padStart(4), String(s.money).padStart(10)].join('  ');
}

// ---------------------------------------------------------------- main
(async () => {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 414, height: 820 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|favicon/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('console', m => { if (m.type() === 'warning' && /GL_INVALID|INVALID_OPERATION|INVALID_ENUM|INVALID_VALUE|[Ff]eedback loop/.test(m.text())) errs.push('GLWARN ' + m.text()); });

  console.log('PortMaster soak — target ' + MINS + ' min, sampling every 30s. Port ' + PORT + '.');

  // ---- 1. setup: fresh state, found the port, seed a modest bankroll once ----
  await page.goto(`http://localhost:${PORT}/games/harbor/?biome=green&nopost-probe`, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'load' });
  const booted = await page.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 }).then(() => true).catch(() => false);
  if (!booted) { console.log('FAILED — WebGL never came up'); await browser.close(); srv.close(); process.exit(1); return; }
  await sleep(400);
  await page.evaluate(() => { var b = document.querySelector('#welcomemodal .wm-btn'); if (b) b.click(); });
  await sleep(350);
  await page.evaluate(() => { window.__harbor.autoFound(); });
  await sleep(200);
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 5000; });
  const founded0 = await page.evaluate(() => !!window.HARBOR_SIM.raw().founded);
  console.log('setup complete — port founded: ' + founded0 + ', money seeded to 5000');

  // ---- 2 & 3. monkey loop + periodic sampling ----
  const samples = [];
  const actionCounts = {};
  const actionThrows = [];
  const prestigeState = { count: 0, log: [], actionIdx: 0 };
  const startTime = Date.now();
  let lastSampleTime = -Infinity;

  samples.push(await takeSample(page, 0));   // baseline
  lastSampleTime = Date.now();

  while (Date.now() - startTime < DURATION_MS) {
    prestigeState.actionIdx++;
    try { await answerModals(page); } catch (e) { /* modal churn racing a re-render — ignore */ }

    const action = pickWeighted(ACTIONS);
    try {
      if (action.name === 'legacy') await action.fn(page, prestigeState);
      else await action.fn(page);
      actionCounts[action.name] = (actionCounts[action.name] || 0) + 1;
    } catch (e) {
      actionThrows.push('[' + Math.round((Date.now() - startTime) / 1000) + 's] ' + action.name + ': ' + e.message);
    }

    await sleep(1500 + Math.random() * 1500);

    if (Date.now() - lastSampleTime >= SAMPLE_EVERY_MS) {
      const t = Math.round((Date.now() - startTime) / 1000);
      try { samples.push(await takeSample(page, t)); } catch (e) { samples.push({ t, heapMB: null, fps: null, domNodes: null, era: null, money: null }); }
      lastSampleTime = Date.now();
      console.log('  [' + t + 's / ' + Math.round(DURATION_MS / 1000) + 's] sample #' + samples.length + ' taken, ' + errs.length + ' errors so far');
    }
  }
  // final sample, always, regardless of the 30s cadence
  const finalT = Math.round((Date.now() - startTime) / 1000);
  samples.push(await takeSample(page, finalT));

  // ---- 4. assertions ----
  const results = [];   // { name, pass, detail }

  // (a) zero errors
  results.push({ name: 'zero page/console errors', pass: errs.length === 0, detail: errs.length + ' error(s)' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : '') });

  // (b) heap plateau over the second half of samples
  const heapSamples = samples.filter(s => s.heapMB != null);
  let heapDetail = 'insufficient heap samples — skipped', heapPass = true;
  if (heapSamples.length >= 4) {
    const half = heapSamples.slice(Math.floor(heapSamples.length / 2));
    const a = half[0].heapMB, b = half[half.length - 1].heapMB;
    const growth = a > 0 ? (b - a) / a : 0;
    heapPass = growth < 0.15;
    heapDetail = (growth * 100).toFixed(1) + '% growth over 2nd half (' + a.toFixed(1) + 'MB → ' + b.toFixed(1) + 'MB), threshold <15%';
  }
  results.push({ name: 'heap plateau (2nd-half growth <15%)', pass: heapPass, detail: heapDetail });

  // (c) fps relative floor: final sample >= 60% of the 3rd sample
  const fpsSamples = samples.filter(s => s.fps != null);
  let fpsPass = true, fpsDetail = 'insufficient fps samples — skipped';
  if (fpsSamples.length >= 3) {
    const third = fpsSamples[2], final = fpsSamples[fpsSamples.length - 1];
    const floor = third.fps * 0.6;
    fpsPass = final.fps >= floor;
    fpsDetail = 'final ' + final.fps.toFixed(1) + ' fps vs 3rd-sample ' + third.fps.toFixed(1) + ' fps (floor ' + floor.toFixed(1) + ' fps, 60%)';
  }
  results.push({ name: 'fps relative floor (final ≥60% of 3rd sample)', pass: fpsPass, detail: fpsDetail });

  // (d) DOM node count: final < 2x the 5-minute mark
  const domSamples = samples.filter(s => s.domNodes != null);
  let domPass = true, domDetail = 'insufficient dom samples — skipped';
  if (domSamples.length >= 2) {
    const mark5 = closestSample(domSamples, 300);
    const final = domSamples[domSamples.length - 1];
    const cap = mark5.domNodes * 2;
    domPass = final.domNodes < cap;
    domDetail = 'final ' + final.domNodes + ' nodes vs 5-min-mark(t=' + mark5.t + 's) ' + mark5.domNodes + ' nodes (cap ' + cap + ', <2×)';
  }
  results.push({ name: 'no unbounded DOM growth (final <2× the 5-min mark)', pass: domPass, detail: domDetail });

  // (e) save survives reload
  const preReload = await page.evaluate(() => ({ founded: window.__harbor.state().founded, money: window.HARBOR_SIM.raw().money }));
  await page.reload({ waitUntil: 'load' });
  const bootedAgain = await page.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 }).then(() => true).catch(() => false);
  await sleep(400);
  const postReload = bootedAgain ? await page.evaluate(() => ({ founded: window.__harbor.state().founded, money: window.HARBOR_SIM.raw().money })) : { founded: false, money: -1 };
  const moneyDrift = preReload.money > 0 ? Math.abs(postReload.money - preReload.money) / preReload.money : (postReload.money === preReload.money ? 0 : 1);
  const reloadPass = bootedAgain && postReload.founded === true && preReload.founded === true && moneyDrift <= 0.01;
  results.push({
    name: 'save survives reload (founded + money within 1%)', pass: reloadPass,
    detail: 'pre £' + preReload.money + ' founded=' + preReload.founded + ' → post £' + postReload.money + ' founded=' + postReload.founded + ' (drift ' + (moneyDrift * 100).toFixed(2) + '%)'
  });

  // ---- 5. output ----
  const header = ['t(s)', 'heapMB', 'fps', 'domNodes', 'era', 'money'];
  const tableLines = [header.map((h, i) => h.padStart([5, 8, 6, 9, 4, 10][i])).join('  '), ...samples.map(fmtRow)];

  console.log('');
  console.log('=== sample table ===');
  tableLines.forEach(l => console.log(l));

  console.log('');
  console.log('=== action mix ===');
  Object.keys(actionCounts).sort().forEach(k => console.log('  ' + k + ': ' + actionCounts[k]));
  if (prestigeState.log.length) console.log('  prestige events: ' + prestigeState.log.join('; '));
  if (actionThrows.length) {
    console.log('');
    console.log('=== action exceptions (non-fatal, logged per spec) ===');
    actionThrows.slice(0, 20).forEach(t => console.log('  ' + t));
    if (actionThrows.length > 20) console.log('  … and ' + (actionThrows.length - 20) + ' more');
  }

  console.log('');
  console.log('=== assertions ===');
  let allPass = true;
  results.forEach(r => { console.log((r.pass ? 'PASS' : 'FAIL') + ' — ' + r.name + ' :: ' + r.detail); if (!r.pass) allPass = false; });
  console.log('');
  console.log((allPass ? 'ALL PASS' : 'FAILED') + ' — soak ran ' + finalT + 's (' + (finalT / 60).toFixed(1) + ' min), ' + samples.length + ' samples, ' + errs.length + ' errors, ' + actionThrows.length + ' action exceptions');

  // write the run record
  const outLines = [];
  outLines.push('PortMaster soak run — ' + new Date().toISOString());
  outLines.push('target: ' + MINS + ' min, actual: ' + finalT + 's (' + (finalT / 60).toFixed(1) + ' min), samples: ' + samples.length);
  outLines.push('');
  outLines.push('=== sample table ===');
  outLines.push(...tableLines);
  outLines.push('');
  outLines.push('=== action mix ===');
  Object.keys(actionCounts).sort().forEach(k => outLines.push('  ' + k + ': ' + actionCounts[k]));
  if (prestigeState.log.length) outLines.push('  prestige events: ' + prestigeState.log.join('; '));
  if (actionThrows.length) {
    outLines.push('');
    outLines.push('=== action exceptions (non-fatal) ===');
    actionThrows.forEach(t => outLines.push('  ' + t));
  }
  outLines.push('');
  outLines.push('=== assertions ===');
  results.forEach(r => outLines.push((r.pass ? 'PASS' : 'FAIL') + ' — ' + r.name + ' :: ' + r.detail));
  outLines.push('');
  outLines.push((allPass ? 'ALL PASS' : 'FAILED') + ' — soak ran ' + finalT + 's (' + (finalT / 60).toFixed(1) + ' min), ' + samples.length + ' samples, ' + errs.length + ' errors, ' + actionThrows.length + ' action exceptions');
  try { fs.writeFileSync(path.join(__dirname, 'last-soak.txt'), outLines.join('\n') + '\n'); } catch (e) { console.log('(could not write last-soak.txt: ' + e.message + ')'); }

  await browser.close(); srv.close();
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.log('FAILED — harness error: ' + e.message + '\n' + (e.stack || '')); try { srv.close(); } catch (x) {} process.exit(1); });
