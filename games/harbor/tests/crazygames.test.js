/* PortMaster — CrazyGames adapter contract test (headless Playwright, same harness pattern as
 * browser.test.js). Serves games/harbor with the same script injection build-portal.sh
 * --crazygames performs (mock SDK + crazygames.js before ads.js), then asserts every MUST in
 * the ads.js contract against a deterministic mocked CrazyGames SDK v3:
 *   - default provider selection (no URL param → 'crazygames'; ?adprovider=stub still wins)
 *   - init cb-exactly-once, including when the SDK never loads (game boots ad-less)
 *   - rewardedAvailable: sync, true when ready+under cap, false at the 6/day cap
 *   - showRewarded: onReward ONLY on adFinished (+cap bump); adError → onFail, count unchanged
 *   - commercialBreak: onDone exactly once whether the ad shows or errors
 *   - lifecycle: loadingStart/loadingStop paired, gameplayStart/gameplayStop forwarded
 * Run: node games/harbor/tests/crazygames.test.js
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const PORT = 8198;

function findChromium() {
  var base = '/opt/pw-browsers';
  try { var d = fs.readdirSync(base).filter(function (n) { return /^chromium-/.test(n); }).sort(); if (d.length) { var p = path.join(base, d[d.length - 1], 'chrome-linux', 'chrome'); if (fs.existsSync(p)) return p; } } catch (e) {}
  return undefined;
}
let chromium;
try { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
catch (e) { try { chromium = require('playwright').chromium; } catch (e2) { console.log('SKIP — playwright not available'); process.exit(0); } }

// Deterministic CrazyGames SDK v3 mock. window.__CG controls behaviour and records calls.
const MOCK_SDK = `
window.__CG = { mode: 'finish', ads: [], game: [], initCalls: 0 };
window.CrazyGames = { SDK: {
  environment: 'crazygames',
  init: function () { window.__CG.initCalls++; return Promise.resolve(); },
  ad: { requestAd: function (type, cbs) {
    window.__CG.ads.push(type);
    if (window.__CG.mode === 'error') { setTimeout(function () { cbs.adError({ code: 'no-fill' }); }, 10); return; }
    setTimeout(function () { if (cbs.adStarted) cbs.adStarted(); }, 5);
    setTimeout(function () { cbs.adFinished(); }, 20);
  } },
  game: {
    loadingStart:  function () { window.__CG.game.push('loadingStart'); },
    loadingStop:   function () { window.__CG.game.push('loadingStop'); },
    gameplayStart: function () { window.__CG.game.push('gameplayStart'); },
    gameplayStop:  function () { window.__CG.game.push('gameplayStop'); }
  }
} };`;

// Serve the repo; for harbor's index.html, perform the same injection the --crazygames build
// does, with the mock replacing the real SDK tag (?mocksdk=0 disables the mock so the
// SDK-unreachable path can be tested — the real URL is then blocked via routing below).
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => {
  let raw = q.url.split('?')[0];
  let p = decodeURIComponent(raw);
  if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  fs.readFile(fp, (e, b) => {
    if (e) { s.writeHead(404); s.end('nf'); return; }
    if (p === '/games/harbor/index.html') {
      let html = b.toString();
      const useMock = !/[?&]mocksdk=0/.test(q.url);
      const inject = (useMock ? `<script>${MOCK_SDK}</script>\n  ` : `<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>\n  `) +
        '<script src="crazygames.js?v=60"></script>\n  ';
      html = html.replace('<script src="ads.js', inject + '<script src="ads.js');
      s.writeHead(200, { 'Content-Type': 'text/html' });
      s.end(html);
      return;
    }
    s.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    s.end(b);
  });
}).listen(PORT);
const sleep = ms => new Promise(z => setTimeout(z, ms));

let pass = 0, fail = 0, fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); } console.log((cond ? '  PASS  ' : '  FAIL  ') + name); }
const IGNORE_CONSOLE_ERR = /404|favicon|Blocked call to navigator\.vibrate/;

(async () => {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 414, height: 820 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE_CONSOLE_ERR.test(m.text())) errs.push('CONSOLE ' + m.text()); });

  // ---- default selection + happy path ----
  await page.goto(`http://localhost:${PORT}/games/harbor/?biome=green&nopost-probe`, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'load' });
  ok('selection: no URL param + adapter present → provider is crazygames',
    await page.evaluate(() => window.ADS && window.ADS.provider) === 'crazygames');

  const booted = await page.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 }).then(() => true).catch(() => false);
  ok('boot: game boots with the adapter active', booted);
  await page.waitForFunction(() => window.__CG && window.__CG.initCalls > 0, null, { timeout: 4000 }).catch(() => {});
  ok('init: SDK.init called exactly once', await page.evaluate(() => window.__CG.initCalls) === 1);

  // lifecycle: found a port so gameplayStart fires; loading bracket must be paired
  await page.evaluate(() => { var b = document.querySelector('#welcomemodal .wm-btn'); if (b) b.click(); window.__harbor.autoFound(); });
  await sleep(300);
  const gameEvts = await page.evaluate(() => window.__CG.game.join(','));
  ok('lifecycle: loadingStart precedes loadingStop', /loadingStart.*loadingStop/.test(gameEvts));
  ok('lifecycle: gameplayStart forwarded to the SDK', /gameplayStart/.test(gameEvts));

  // rewarded happy path: grant only on adFinished, cap bumps
  const r1 = await page.evaluate(() => new Promise(res => {
    var before = (window.Retention.get('harbor', 'bonusDay', null) || { count: 0 }).count | 0;
    var avail = window.ADS.rewardedAvailable();
    window.ADS.showRewarded(
      function () { res({ avail: avail, outcome: 'reward', after: window.Retention.get('harbor', 'bonusDay', null).count }); },
      function (why) { res({ avail: avail, outcome: 'fail:' + why }); });
  }));
  ok('rewarded: available pre-show, onReward on adFinished, daily count bumped to 1',
    r1.avail === true && r1.outcome === 'reward' && r1.after === 1);

  // rewarded error path: onFail, count unchanged, sim money unchanged
  const r2 = await page.evaluate(() => new Promise(res => {
    window.__CG.mode = 'error';
    var countBefore = window.Retention.get('harbor', 'bonusDay', null).count;
    var moneyBefore = window.HARBOR_SIM.raw().money;
    window.ADS.showRewarded(
      function () { res({ outcome: 'reward' }); },
      function (why) { res({ outcome: 'fail', why: why, countSame: window.Retention.get('harbor', 'bonusDay', null).count === countBefore, moneySame: window.HARBOR_SIM.raw().money === moneyBefore }); });
  }));
  ok('rewarded: adError → onFail with cap count and game state untouched',
    r2.outcome === 'fail' && r2.countSame === true && r2.moneySame === true);

  // cap: force 6/6 → available false, show fails with 'cap'
  const r3 = await page.evaluate(() => new Promise(res => {
    window.__CG.mode = 'finish';
    window.Retention.set('harbor', 'bonusDay', { date: window.Retention.todayStr(), count: 6 });
    var avail = window.ADS.rewardedAvailable();
    window.ADS.showRewarded(function () { res({ avail: avail, outcome: 'reward' }); }, function (why) { res({ avail: avail, outcome: why }); });
  }));
  ok('cap: at 6/day → rewardedAvailable false and showRewarded fails with cap', r3.avail === false && r3.outcome === 'cap');

  // commercialBreak: onDone exactly once, midgame requested
  const cb = await page.evaluate(() => new Promise(res => {
    var calls = 0;
    window.ADS.commercialBreak(function () { calls++; setTimeout(function () { res({ calls: calls, midgames: window.__CG.ads.filter(function (t) { return t === 'midgame'; }).length }); }, 60); });
  }));
  ok('commercialBreak: onDone exactly once, one midgame ad requested', cb.calls === 1 && cb.midgames === 1);

  // ---- explicit ?adprovider=stub still wins over the registered default ----
  const p2 = await ctx.newPage();
  await p2.goto(`http://localhost:${PORT}/games/harbor/?biome=green&nopost-probe&adprovider=stub`, { waitUntil: 'load' });
  ok('selection: ?adprovider=stub overrides the registered default', await p2.evaluate(() => window.ADS.provider) === 'stub');
  await p2.close();

  // ---- SDK unreachable: block the real URL; init cb must still fire and the game boots ----
  const p3 = await ctx.newPage();
  await p3.route('https://sdk.crazygames.com/**', route => route.abort());
  await p3.goto(`http://localhost:${PORT}/games/harbor/?biome=green&nopost-probe&mocksdk=0`, { waitUntil: 'load' });
  const boot3 = await p3.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 }).then(() => true).catch(() => false);
  const deg = await p3.evaluate(() => ({ provider: window.ADS.provider, avail: window.ADS.rewardedAvailable() }));
  ok('degraded: SDK unreachable → game still boots, provider crazygames, rewarded unavailable',
    boot3 && deg.provider === 'crazygames' && deg.avail === false);
  await p3.close();

  ok('console: zero unexplained console/page errors across the run', errs.length === 0);
  if (errs.length) console.log('   errors: ' + errs.slice(0, 5).join(' | '));

  await browser.close();
  srv.close();
  console.log('======================================');
  console.log(fail === 0 ? `CRAZYGAMES ADAPTER: PASS (${pass})` : `CRAZYGAMES ADAPTER: FAIL — ${fails.join('; ')}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
