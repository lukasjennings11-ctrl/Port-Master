#!/usr/bin/env node
/* factory/verify-portal-build.js — headless boot check for a built portal package under dist/.
 * Serves the SELF-CONTAINED build directly (no reach-outside-itself paths) and proves the package a
 * portal will actually receive boots on its own — both as a top-level page AND embedded in an
 * <iframe> (how a portal really hosts it: the classic "broken in their iframe" rejection cause).
 *
 * Asserts:
 *   - window.__PORTAL_BUILD__ === true + __harbor.portalMode() === true (build force-patch took effect)
 *   - the dead non-portal Settings rows (privacy link / "Add to home screen") never render
 *   - the founded-flow works (autoFound) and WebGL boots — top-level AND inside an iframe
 *   - zero console/page errors, zero 404s, zero failed requests (EXCEPT the portal SDK CDN, which is
 *     expected to fail offline in this sandbox; on the real portal it loads and window.ADS routes to it)
 *   - poki target: window.__POKI_BUILD__ === true AND HARBOR_SIM.eventExcluded('gamble') === true
 *
 * Env: VERIFY_OUT (dist subdir, default 'portboss-portal'), VERIFY_TARGET ('crazygames'|'poki'|'bare').
 * Run: node factory/verify-portal-build.js   (wired as the last step of build-portal.sh per target)
 * Exit 0 = pass, non-zero = fail.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', process.env.VERIFY_OUT || 'portboss-portal');
const TARGET = process.env.VERIFY_TARGET || '';
const PORT = Number(process.env.VERIFY_PORT) || 8299;

// The portal SDKs load from the portal's own CDN — the ONE allowed external reference. Offline (here)
// they fail; shared/portal.js then no-ops and the game boots identically. Never count that as an error.
const SDK_HOST = /sdk\.crazygames\.com|game-cdn\.poki\.com|poki-sdk|poki\.com/;

if (!fs.existsSync(path.join(OUT, 'index.html'))) {
  console.log('FAILED — ' + path.join(OUT, 'index.html') + ' not found; run build-portal.sh first');
  process.exit(1);
}

function findChromium() {
  var base = '/opt/pw-browsers';
  try {
    var d = fs.readdirSync(base).filter(function (n) { return /^chromium-/.test(n); }).sort();
    if (d.length) { var p = path.join(base, d[d.length - 1], 'chrome-linux', 'chrome'); if (fs.existsSync(p)) return p; }
  } catch (e) {}
  return undefined;
}
let chromium;
try { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
catch (e) { try { chromium = require('playwright').chromium; } catch (e2) { console.log('SKIP — playwright not available'); process.exit(0); } }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => {
  // synthetic parent page that embeds the build in an <iframe>, mimicking a portal's embed
  if (q.url.split('?')[0] === '/__parent__') {
    s.writeHead(200, { 'Content-Type': 'text/html' });
    s.end('<!doctype html><meta charset="utf8"><title>embed</title><body style="margin:0">' +
          '<iframe id="g" src="/index.html?nopost-probe" style="width:414px;height:820px;border:0"></iframe>');
    return;
  }
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
  const reqFailed = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  // Chromium logs resource-load failures ("Failed to load resource…", net::ERR…) as console errors
  // WITHOUT the URL in the message text, so they can't be allowlisted by host here — they're tracked
  // (with real URLs) by the response(404) + requestfailed handlers below instead, where the portal
  // SDK CDN + favicon are allowlisted. So drop that resource noise from the console-error gate and
  // keep only genuine JS errors. (Same discipline as browser.test.js's IGNORE_CONSOLE_ERR.)
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|net::ERR/.test(m.text()) && !SDK_HOST.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('console', m => { if (m.type() === 'warning' && /GL_INVALID|INVALID_OPERATION|INVALID_ENUM|INVALID_VALUE|[Ff]eedback loop/.test(m.text())) errs.push('GLWARN ' + m.text()); });
  page.on('response', r => { if (r.status() === 404 && !/favicon/.test(r.url())) notFound.push(r.url()); });
  page.on('requestfailed', r => { if (!SDK_HOST.test(r.url()) && !/favicon/.test(r.url())) reqFailed.push(r.url()); });

  // ---------- top-level page ----------
  await page.goto(`http://localhost:${PORT}/index.html?nopost-probe`, { waitUntil: 'load' });
  const booted = await page.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 }).then(() => true).catch(() => false);
  ok('boot: WebGL alive', booted);
  ok('boot: zero 404s while loading', notFound.length === 0);
  ok('boot: zero failed requests (portal SDK CDN allowlisted)', reqFailed.length === 0);

  ok('build marker: window.__PORTAL_BUILD__ === true', await page.evaluate(() => window.__PORTAL_BUILD__ === true).catch(() => false));
  ok('portal mode: __harbor.portalMode() === true (build force-patch took effect)', await page.evaluate(() => !!(window.__harbor && window.__harbor.portalMode())).catch(() => false) === true);

  await page.evaluate(() => { var b = document.querySelector('#welcomemodal .wm-btn'); if (b) b.click(); window.__harbor.autoFound(); });
  await sleep(300);
  ok('founded-flow: autoFound() founds the port', await page.evaluate(() => !!(window.HARBOR_SIM && window.HARBOR_SIM.raw().founded)).catch(() => false));

  const settings = await page.evaluate(() => {
    var btn = document.getElementById('setbtn'); if (btn) btn.click();
    return { privacyLink: !!document.querySelector('a[href*="privacy.html"]'), installRow: !!document.querySelector('[data-set="install"]') };
  }).catch(() => ({ privacyLink: true, installRow: true }));
  ok('settings: no privacy link rendered in portal build', settings.privacyLink === false);
  ok('settings: no "Add to home screen" row rendered in portal build', settings.installRow === false);

  // target-specific: SDK <script> present + (poki) gamble event dropped
  if (TARGET === 'crazygames' || TARGET === 'poki') {
    const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
    ok('sdk: portal SDK <script> injected into the built index.html', /crazygames-sdk|poki-sdk/.test(html));
  }
  if (TARGET === 'poki') {
    ok('poki: window.__POKI_BUILD__ === true', await page.evaluate(() => window.__POKI_BUILD__ === true).catch(() => false));
    ok('poki: the gambling event is excluded (HARBOR_SIM.eventExcluded("gamble"))',
      await page.evaluate(() => !!(window.HARBOR_SIM && window.HARBOR_SIM.eventExcluded && window.HARBOR_SIM.eventExcluded('gamble'))).catch(() => false));
  }

  // ---------- embedded in an <iframe> (how a portal really hosts it) ----------
  await page.goto(`http://localhost:${PORT}/__parent__`, { waitUntil: 'load' });
  await sleep(400);
  const frame = page.frames().find(f => /\/index\.html/.test(f.url()));
  ok('iframe: the embedded game frame is present', !!frame);
  let iframeBooted = false, iframeFounded = false;
  if (frame) {
    iframeBooted = await frame.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 }).then(() => true).catch(() => false);
    await frame.evaluate(() => { var b = document.querySelector('#welcomemodal .wm-btn'); if (b) b.click(); window.__harbor.autoFound(); }).catch(() => {});
    await sleep(300);
    iframeFounded = await frame.evaluate(() => !!(window.HARBOR_SIM && window.HARBOR_SIM.raw().founded)).catch(() => false);
  }
  ok('iframe: WebGL boots inside the portal-style embed', iframeBooted);
  ok('iframe: founded-flow works inside the embed', iframeFounded);

  await sleep(500);
  ok('stability: zero console/page errors (top-level + iframe)', errs.length === 0);

  console.log((fail === 0 ? 'ALL PASS' : 'FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed  [' + (TARGET || 'portal') + ']');
  if (fail) {
    console.log('  failing:'); fails.forEach(f => console.log('   - ' + f));
    if (errs.length) console.log('  errors: ' + errs.slice(0, 6).join(' | '));
    if (notFound.length) console.log('  404s: ' + notFound.slice(0, 6).join(' | '));
    if (reqFailed.length) console.log('  failed-requests: ' + reqFailed.slice(0, 6).join(' | '));
  }
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAILED — harness error: ' + e.message); try { srv.close(); } catch (x) {} process.exit(1); });
