/* Port Boss — v85 regression: found an unlocked-but-unfounded world INLINE from the Trade Network
 * map, then link a route — the "I have 3 harbours but can't build a trade network" playtest trap
 * (3 UNLOCKED worlds, only 1 FOUNDED). Real taps + real button clicks, zero console errors.
 * Run: node games/harbor/tests/trade-found.test.js   ·   exit 0 = pass
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const PORT = 8236;
// trade-map node positions (fractions of the canvas) — mirrors NODES in game.js. Used to synthesize
// REAL pointerdown taps at each harbour's on-screen pixel, exercising the actual canvas listener +
// hit-test (not the __harbor.tradeTapNode shortcut) — the path a finger takes on a real device.
const NODES = { green: [0.24, 0.66], tropical: [0.40, 0.40], mountain: [0.58, 0.23], nordic: [0.70, 0.70], desert: [0.84, 0.46] };
function findChromium() { var base = '/opt/pw-browsers'; try { var d = fs.readdirSync(base).filter(n => /^chromium-/.test(n)).sort(); if (d.length) { var p = path.join(base, d[d.length - 1], 'chrome-linux', 'chrome'); if (fs.existsSync(p)) return p; } } catch (e) {} return undefined; }
let chromium; try { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; } catch (e) { try { chromium = require('playwright').chromium; } catch (e2) { console.log('SKIP — playwright not available'); process.exit(0); } }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; let fp = path.join(ROOT, p); fs.readFile(fp, (e, b) => { if (e) { s.writeHead(404); s.end('nf'); } else { s.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); s.end(b); } }); }).listen(PORT);
const sleep = ms => new Promise(z => setTimeout(z, ms));
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };

// dispatch the REAL pointerdown the canvas binds, at a node's on-screen pixel; return the element
// actually under that pixel (proves the guide card doesn't swallow the tap) — a mismatch here is the
// exact class of bug (overlay eating taps / stale canvas backing) that made the map feel dead.
async function tapNode(page, id) {
  return await page.evaluate(({ frac }) => {
    var cv = document.getElementById('tradecanvas'); var r = cv.getBoundingClientRect();
    var x = r.left + frac[0] * r.width, y = r.top + frac[1] * r.height;
    var under = document.elementFromPoint(x, y); var uid = under ? (under.id || under.className || under.tagName) : 'none';
    cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true }));
    return uid;
  }, { frac: NODES[id] });
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  // real mobile-style context (touch, 2x DPR) — the CrazyGames mobile target
  const page = await (await browser.newContext({ viewport: { width: 414, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
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

  // REAL pointerdown on the dim Mountain node — the pixel must reach the CANVAS (not the guide card),
  // and the tap must open the inline Found panel.
  const underM = await tapNode(page, 'mountain');
  ok('dim-node pixel reaches the canvas, not the guide-card overlay', underM === 'tradecanvas');
  await sleep(120);
  const tap = await page.evaluate(() => window.__harbor.tradeState());
  ok('real tap on an unlocked-unfounded node opens the inline Found panel', tap.found === 'mountain' && /Found/i.test(tap.msg) && /£/.test(tap.msg));

  const before = await page.evaluate(() => window.HARBOR_SIM.raw().money);
  await page.evaluate(() => { var b = document.querySelector('#trademap [data-found]'); if (b) b.click(); });
  await sleep(200);
  const af = await page.evaluate(() => ({ founded: !!window.HARBOR_SIM.port('mountain'), sel: window.__harbor.tradeState().sel, money: window.HARBOR_SIM.raw().money, count: window.__harbor.tradeState().founded }));
  ok('clicking "Found colony" founds the world from the map (2 founded now)', af.founded && af.count === 2);
  ok('the fresh node is auto-selected for the next tap', af.sel === 'mountain');
  ok('founding charged the colony fee', (before - af.money) >= 100 && (before - af.money) < 1e5);

  // REAL tap on the other founded harbour — after founding rebuilt the world, the canvas backing must
  // stay matched to its box so this tap lands on Green (regression: it used to hit the wrong node).
  await tapNode(page, 'green');
  await sleep(120);
  const builder = await page.evaluate(() => window.__harbor.tradeState().msg);
  ok('real tap on the other founded harbour opens the route builder', /Ship from/i.test(builder));
  await page.evaluate(() => { var b = document.querySelector('#trademap [data-res="fish"]'); if (b) b.click(); });
  await sleep(120);
  ok('a route is created entirely from the map by real taps', await page.evaluate(() => window.HARBOR_SIM.network().routes.length === 1));

  // the built route actually ships cargo along its true source→dest direction
  const shipped = await page.evaluate(() => { var S = window.HARBOR_SIM, r = S.network().routes[0]; if (!r) return -1; var pa = S.port(r.a), pb = S.port(r.b); if (!pa || !pb) return -1; pa.res[r.res] = 500; pb.res[r.res] = 0; S.raw().stats.shipped = 0; for (var i = 0; i < 40; i++) S.tick(1); return Math.round(S.raw().stats.shipped); });
  ok('the route ships cargo after being built by touch', shipped > 0);

  await page.evaluate(() => { window.__harbor.closeTrade(); window.__harbor.openTrade(); });
  await sleep(80);
  const underN = await tapNode(page, 'nordic');
  await sleep(80);
  const locked = await page.evaluate(() => window.__harbor.tradeState());
  ok('a still-LOCKED coast does not offer founding', underN === 'tradecanvas' && locked.found === null && !/Found nordic/i.test(locked.msg));

  ok('zero console/page errors', errs.length === 0);

  await browser.close(); srv.close();
  if (fail) { console.log('FAIL — ' + fail + ' failed: ' + fails.join('; ')); process.exit(1); }
  console.log('ALL PASS — ' + pass + ' assertions (found-from-trade-map + guidance)');
  process.exit(0);
})().catch(e => { console.error('ERROR', e); process.exit(2); });
