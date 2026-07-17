/* Port Boss — v85 regression: found an unlocked-but-unfounded world INLINE from the Trade Network
 * map, then link a route — the "I have 3 harbours but can't build a trade network" playtest trap
 * (3 UNLOCKED worlds, only 1 FOUNDED). Real taps + real button clicks, zero console errors.
 * Run: node games/harbor/tests/trade-found.test.js   ·   exit 0 = pass
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const PORT = 8236;
function findChromium() { var base = '/opt/pw-browsers'; try { var d = fs.readdirSync(base).filter(n => /^chromium-/.test(n)).sort(); if (d.length) { var p = path.join(base, d[d.length - 1], 'chrome-linux', 'chrome'); if (fs.existsSync(p)) return p; } } catch (e) {} return undefined; }
let chromium; try { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; } catch (e) { try { chromium = require('playwright').chromium; } catch (e2) { console.log('SKIP — playwright not available'); process.exit(0); } }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; let fp = path.join(ROOT, p); fs.readFile(fp, (e, b) => { if (e) { s.writeHead(404); s.end('nf'); } else { s.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); s.end(b); } }); }).listen(PORT);
const sleep = ms => new Promise(z => setTimeout(z, ms));
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };

(async () => {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 900, height: 640 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|favicon/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  await page.goto(`http://localhost:${PORT}/games/harbor/?biome=green&nopost-probe`, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 });
  await sleep(400);
  await page.evaluate(() => { var b = document.querySelector('#welcomemodal .wm-btn'); if (b) b.click(); window.__harbor.autoFound(); });

  // the trap: two worlds UNLOCKED, none of them FOUNDED, cash on hand
  await page.evaluate(() => { window.HARBOR_SIM.raw().money = 1e6; window.__harbor.unlockWorld('mountain'); window.__harbor.unlockWorld('desert'); });
  await page.evaluate(() => window.__harbor.openTrade());
  await sleep(150);

  const guide = await page.evaluate(() => ({ t: (document.querySelector('#tm-guide .tmg-title') || {}).textContent || '', b: (document.querySelector('#tm-guide .tmg-body') || {}).textContent || '', shown: window.__harbor.tradeState().guide }));
  ok('guide card retitled to "Found your next harbour"', guide.shown && /Found your next harbour/.test(guide.t));
  ok('guide names the unlocked world + price, not "Uncharted Waters"', /Mountain Fjord/.test(guide.b) && /£/.test(guide.b) && !/Uncharted/.test(guide.b));

  const tap = await page.evaluate(() => { window.__harbor.tradeTapNode('mountain'); return window.__harbor.tradeState(); });
  ok('tapping an unlocked-unfounded node opens the inline Found panel', tap.found === 'mountain' && /Found/i.test(tap.msg) && /£/.test(tap.msg));

  const before = await page.evaluate(() => window.HARBOR_SIM.raw().money);
  await page.evaluate(() => { var b = document.querySelector('#trademap [data-found]'); if (b) b.click(); });
  await sleep(200);
  const af = await page.evaluate(() => ({ founded: !!window.HARBOR_SIM.port('mountain'), sel: window.__harbor.tradeState().sel, spent: undefined, money: window.HARBOR_SIM.raw().money, count: window.__harbor.tradeState().founded }));
  ok('clicking "Found colony" founds the world from the map (2 founded now)', af.founded && af.count === 2);
  ok('the fresh node is auto-selected for the next tap', af.sel === 'mountain');
  ok('founding charged the colony fee', (before - af.money) >= 100 && (before - af.money) < 1e5);

  await page.evaluate(() => window.__harbor.tradeTapNode('green'));
  const builder = await page.evaluate(() => window.__harbor.tradeState().msg);
  ok('tapping the other founded harbour opens the route builder', /Ship from/i.test(builder));
  await page.evaluate(() => { var b = document.querySelector('#trademap [data-res="fish"]'); if (b) b.click(); });
  await sleep(120);
  ok('a route is created entirely from the map', await page.evaluate(() => window.HARBOR_SIM.network().routes.length === 1));

  await page.evaluate(() => { window.__harbor.closeTrade(); window.__harbor.openTrade(); });
  await sleep(80);
  const locked = await page.evaluate(() => { window.__harbor.tradeTapNode('nordic'); return window.__harbor.tradeState(); });
  ok('a still-LOCKED coast does not offer founding', locked.found === null && !/Found nordic/i.test(locked.msg));

  ok('zero console/page errors', errs.length === 0);

  await browser.close(); srv.close();
  if (fail) { console.log('FAIL — ' + fail + ' failed: ' + fails.join('; ')); process.exit(1); }
  console.log('ALL PASS — ' + pass + ' assertions (found-from-trade-map + guidance)');
  process.exit(0);
})().catch(e => { console.error('ERROR', e); process.exit(2); });
