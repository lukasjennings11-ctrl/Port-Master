#!/usr/bin/env node
/* factory/verify-portal-build.js — headless boot check for the built portal package
 * (dist/portmaster-portal/), adapted from the chromium boilerplate in
 * games/harbor/tests/browser.test.js. Where that suite drives the live repo copy of
 * the game (../../shared/* etc, served from the repo root), this one serves the
 * SELF-CONTAINED dist build directly — proving the package a portal will actually
 * receive boots on its own, with no reach-outside-itself paths.
 *
 * Specifically asserts build-portal.sh's PORTAL_MODE force-patch (see that script's
 * header comment) took effect at runtime, not just that the sed found its target line:
 *   - window.__PORTAL_BUILD__ === true (the injected build marker)
 *   - __harbor.portalMode() === true (game.js's own forced flag)
 *   - the dead non-portal Settings rows (privacy link, "Add to home screen") never
 *     render — confirming the leftover "../../privacy.html" string still in game.js's
 *     non-portal branch is genuinely unreachable, not a real broken link
 *   - the founded-flow works (autoFound) and WebGL boots
 *   - zero console/page errors, zero 404s while loading
 *
 * Run: node factory/verify-portal-build.js   (wired as the last step of build-portal.sh)
 * Exit 0 = pass, non-zero = fail.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'portmaster-portal');
const PORT = Number(process.env.VERIFY_PORT) || 8299;

if (!fs.existsSync(path.join(OUT, 'index.html'))) {
  console.log('FAILED — ' + path.join(OUT, 'index.html') + ' not found; run build-portal.sh\'s copy/rewrite steps first');
  process.exit(1);
}

// locate playwright + a chromium build without hardcoding the version (same approach as
// games/harbor/tests/browser.test.js)
function findChromium() {
  var base = '/opt/pw-browsers';
  try {
    var d = fs.readdirSync(base).filter(function (n) { return /^chromium-/.test(n); }).sort();
    if (d.length) { var p = path.join(base, d[d.length - 1], 'chrome-linux', 'chrome'); if (fs.existsSync(p)) return p; }
  } catch (e) {}
  return undefined;   // let Playwright resolve from its own cache
}
let chromium;
try { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
catch (e) { try { chromium = require('playwright').chromium; } catch (e2) { console.log('SKIP — playwright not available'); process.exit(0); } }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  let fp = path.join(OUT, p);
  fs.readFile(fp, (e, b) => {
    if (e) { s.writeHead(404); s.end('nf'); }
    else { s.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); s.end(b); }
  });
}).listen(PORT);
const sleep = ms => new Promise(z => setTimeout(z, ms));

let pass = 0, fail = 0, fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

(async () => {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 414, height: 820 } })).newPage();
  const errs = [];
  const notFound = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('console', m => { if (m.type() === 'warning' && /GL_INVALID|INVALID_OPERATION|INVALID_ENUM|INVALID_VALUE|[Ff]eedback loop/.test(m.text())) errs.push('GLWARN ' + m.text()); });
  page.on('response', r => { if (r.status() === 404 && !/favicon/.test(r.url())) notFound.push(r.url()); });

  // nopost-probe: swiftshader is slow — the 10c frame-time probe would trip and auto-disable
  // the post pass mid-run, same reason games/harbor/tests/browser.test.js sets it.
  await page.goto(`http://localhost:${PORT}/index.html?nopost-probe`, { waitUntil: 'load' });
  const booted = await page.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 }).then(() => true).catch(() => false);
  ok('boot: WebGL alive', booted);
  ok('boot: zero 404s while loading', notFound.length === 0);

  const marker = await page.evaluate(() => window.__PORTAL_BUILD__ === true).catch(() => false);
  ok('build marker: window.__PORTAL_BUILD__ === true', marker);

  const portalMode = await page.evaluate(() => !!(window.__harbor && window.__harbor.portalMode())).catch(() => false);
  ok('portal mode: __harbor.portalMode() === true (build force-patch took effect)', portalMode === true);

  // dismiss the first-run welcome card, then drive the founded-flow test hook exactly as
  // games/harbor/tests/browser.test.js does against the live repo copy.
  await page.evaluate(() => { var b = document.querySelector('#welcomemodal .wm-btn'); if (b) b.click(); window.__harbor.autoFound(); });
  await sleep(300);
  const founded = await page.evaluate(() => !!(window.HARBOR_SIM && window.HARBOR_SIM.raw().founded)).catch(() => false);
  ok('founded-flow: autoFound() founds the port', founded);

  // confirm the non-portal Settings rows (privacy link / "Add to home screen") never
  // render — proves the "../../privacy.html" string still sitting in game.js's dead
  // non-portal branch (see build-portal.sh's grep-scoping note) is truly unreachable.
  const settings = await page.evaluate(() => {
    var btn = document.getElementById('setbtn'); if (btn) btn.click();
    return {
      privacyLink: !!document.querySelector('a[href*="privacy.html"]'),
      installRow: !!document.querySelector('[data-set="install"]')
    };
  }).catch(() => ({ privacyLink: true, installRow: true }));
  ok('settings: no privacy link rendered in portal build', settings.privacyLink === false);
  ok('settings: no "Add to home screen" row rendered in portal build', settings.installRow === false);

  await sleep(500);
  ok('stability: zero console/page errors', errs.length === 0);

  console.log((fail === 0 ? 'ALL PASS' : 'FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  if (fail) {
    console.log('  failing:'); fails.forEach(f => console.log('   - ' + f));
    if (errs.length) console.log('  errors: ' + errs.slice(0, 6).join(' | '));
    if (notFound.length) console.log('  404s: ' + notFound.slice(0, 6).join(' | '));
  }
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAILED — harness error: ' + e.message); try { srv.close(); } catch (x) {} process.exit(1); });
