/* Port Boss — branded CrazyGames covers at the exact required dimensions.
 * Poses a built-out port, captures a clean gameplay hero at each aspect ratio, then composites the
 * "PORT BOSS / IDLE PORT TYCOON" wordmark (LilitaOne, yellow gradient + navy stroke, teal pill) to
 * match the existing square thumbnail. Outputs to submit/crazygames/cover-*.png.
 * Run: node scripts/gen-portboss-covers.js
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = '/home/user/prism-play';
const OUT = path.join(ROOT, 'submit/crazygames');
const PORT = 8251;
function findChromium() { var base = '/opt/pw-browsers'; try { var d = fs.readdirSync(base).filter(n => /^chromium-/.test(n)).sort(); if (d.length) { var p = path.join(base, d[d.length - 1], 'chrome-linux', 'chrome'); if (fs.existsSync(p)) return p; } } catch (e) {} return undefined; }
let chromium; try { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; } catch (e) { try { chromium = require('playwright').chromium; } catch (e2) { console.log('SKIP — no playwright'); process.exit(0); } }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; let fp = path.join(ROOT, p); fs.readFile(fp, (e, b) => { if (e) { s.writeHead(404); s.end('nf'); } else { s.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); s.end(b); } }); }).listen(PORT);
const sleep = ms => new Promise(z => setTimeout(z, ms));

// three CrazyGames cover slots — [w, h, wordmark-scale, bottom-inset%]
const COVERS = [
  { name: 'cover-landscape-1920x1080.png', w: 1920, h: 1080, scale: 1.0, pose: { el: 0.34, dist: 150, tod: 0.46 } },
  { name: 'cover-portrait-800x1200.png', w: 800, h: 1200, scale: 0.62, pose: { el: 0.42, dist: 120, tod: 0.46 } }
  // square uses the exact existing branded reference (thumbnail-square-800.png) — copied below
];

// build a busy container-port scene (crane + stacked containers, like the reference thumbnail)
async function poseScene(page) {
  await page.evaluate(() => {
    var b = document.querySelector('#welcomemodal .wm-btn'); if (b) b.click();
    if (window.__harbor) window.__harbor.autoFound();
    var S = window.HARBOR_SIM; if (!S) return;
    S.raw().money = 5e6; S.raw().lifetimeMoney = 5e6;
    if (S.setEra) S.setEra(6);
    var want = ['fishing_hut', 'fishing_hut', 'cottage', 'cottage', 'jetty', 'warehouse', 'market',
      'sawmill', 'factory', 'dock', 'dock', 'container_terminal', 'container_terminal', 'drone_bay', 'logistics_hub'];
    want.forEach(function (t) { for (var i = 0; i < 3; i++) { S.raw().money = 5e6; if (S.canBuild && S.canBuild(t)) S.build(t); } });
    if (window.__harbor && window.__harbor.setEra) window.__harbor.setEra(6);
  });
  await sleep(300);
}

// clean hero screenshot of just the WebGL canvas at the current viewport (no UI chrome)
async function hero(page, pose) {
  await page.evaluate((p) => {
    if (!window.__harbor) return;
    window.__harbor.setTod(p.tod);
    // hide ALL DOM chrome (HUD chips, era bar, objective, buttons, hint) — keep only the WebGL canvas
    // and its ancestors visible, so an element screenshot of the canvas region is pure gameplay.
    var cv = document.getElementById('game');
    document.querySelectorAll('body *').forEach(function (el) {
      if (el === cv || el.contains(cv)) return;
      try { el.style.setProperty('display', 'none', 'important'); } catch (e) {}
    });
  }, pose);
  await sleep(500);
  const cv = await page.$('canvas');
  return await cv.screenshot();   // PNG buffer of the canvas only
}

function coverHTML(heroDataUri, w, h, scale) {
  // wordmark sizing keyed off the smaller dimension so it reads on any aspect
  const base = Math.min(w, h);
  const fs1 = Math.round(base * 0.285 * scale);      // PORT/BOSS line size
  const pill = Math.round(base * 0.05 * scale);
  const edge = Math.max(2, Math.round(fs1 * 0.022)); // thin dark-amber letter edge
  const drop = Math.max(2, Math.round(fs1 * 0.05));  // navy 3D drop under letters
  const padX = Math.round(fs1 * 0.34), padY = Math.round(fs1 * 0.26);
  const ring = Math.max(3, Math.round(fs1 * 0.028));
  const rad = Math.round(fs1 * 0.26);
  const bottom = Math.round(h * (h > w ? 0.055 : 0.05));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:'Lilita';src:url('http://localhost:${PORT}/games/harbor/fonts/LilitaOne-400.woff2') format('woff2');}
    @font-face{font-family:'Fredoka';src:url('http://localhost:${PORT}/games/harbor/fonts/Fredoka-700.woff2') format('woff2');font-weight:700;}
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${w}px;height:${h}px;overflow:hidden}
    .stage{position:relative;width:${w}px;height:${h}px;background:#0a2230}
    .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    .vig{position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 30%, rgba(0,0,0,0) 55%, rgba(4,16,24,.32) 100%);}
    .grad{position:absolute;left:0;right:0;bottom:0;height:${Math.round(h*0.42)}px;background:linear-gradient(180deg, rgba(6,21,31,0) 0%, rgba(6,21,31,.18) 60%, rgba(6,21,31,.5) 100%);}
    .mark{position:absolute;left:0;right:0;bottom:${bottom}px;text-align:center;}
    /* dark navy plaque behind the wordmark (reference look) */
    .plaque{display:inline-block;position:relative;padding:${padY}px ${padX}px ${Math.round(padY*1.15)}px;
        background:linear-gradient(180deg,#14324c 0%,#0d2740 100%);
        border-radius:${rad}px;box-shadow:inset 0 0 0 ${ring}px #24567a, 0 ${Math.round(fs1*0.09)}px ${Math.round(fs1*0.11)}px rgba(0,0,0,.5);}
    .wm{font-family:'Lilita',sans-serif;font-size:${fs1}px;line-height:.9;letter-spacing:${Math.round(fs1*0.015)}px;
        -webkit-text-stroke:${edge}px #7a4a12;paint-order:stroke fill;
        background:linear-gradient(180deg,#fff2c8 0%,#ffd257 46%,#f0a636 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
        filter:drop-shadow(0 ${drop}px 0 #0c2740) drop-shadow(0 ${Math.round(drop*1.6)}px ${Math.round(drop*0.8)}px rgba(0,0,0,.4));}
    .tag{display:inline-block;position:relative;margin-top:-${Math.round(pill*0.9)}px;padding:${Math.round(pill*0.44)}px ${Math.round(pill*1.25)}px;
        background:#37d6c0;color:#0a3b34;border-radius:999px;font-family:'Fredoka',sans-serif;font-weight:700;
        font-size:${pill}px;letter-spacing:${Math.round(pill*0.16)}px;box-shadow:inset 0 0 0 ${Math.max(2,Math.round(pill*0.06))}px #7ff0e0, 0 ${Math.round(pill*0.16)}px ${Math.round(pill*0.2)}px rgba(0,0,0,.35);}
  </style></head><body><div class="stage">
    <img class="bg" src="${heroDataUri}"/>
    <div class="vig"></div><div class="grad"></div>
    <div class="mark"><div class="plaque"><div class="wm">PORT<br>BOSS</div></div><br>
      <div class="tag">IDLE&nbsp;&nbsp;PORT&nbsp;&nbsp;TYCOON</div></div>
  </div></body></html>`;
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const game = await ctx.newPage();
  await game.goto(`http://localhost:${PORT}/games/harbor/?biome=green&found&era=6&nopost-probe`, { waitUntil: 'load' });
  await game.waitForFunction(() => window.__harbor && window.__harbor.state().webgl, null, { timeout: 8000 });
  await sleep(500);
  await poseScene(game);

  const cover = await ctx.newPage();
  for (const c of COVERS) {
    await game.setViewportSize({ width: c.w, height: c.h });
    await sleep(250);
    await game.evaluate((p) => { if (window.__harbor) { window.__harbor.setTod(p.tod); } }, c.pose);
    // nudge camera: elevation/distance via query is baked at boot; re-pose through __harbor if available
    await game.evaluate((p) => { try { if (window.__harbor && window.__harbor.pose) window.__harbor.pose(p); } catch (e) {} }, c.pose);
    await sleep(300);
    const heroBuf = await hero(game, c.pose);
    const heroUri = 'data:image/png;base64,' + heroBuf.toString('base64');
    await cover.setViewportSize({ width: c.w, height: c.h });
    await cover.setContent(coverHTML(heroUri, c.w, c.h, c.scale), { waitUntil: 'load' });
    await sleep(400);   // let fonts + gradient clip settle
    await cover.screenshot({ path: path.join(OUT, c.name) });
    console.log('wrote ' + c.name + '  (' + c.w + 'x' + c.h + ')');
  }
  await browser.close(); srv.close();
  // square cover = the exact existing branded reference (already 800x800, matches the user's image)
  fs.copyFileSync(path.join(OUT, 'thumbnail-square-800.png'), path.join(OUT, 'cover-square-800x800.png'));
  console.log('wrote cover-square-800x800.png  (copied from thumbnail-square-800.png, exact reference)');
  console.log('DONE — 3 branded covers in submit/crazygames/');
  process.exit(0);
})().catch(e => { console.error('COVER ERROR', e); process.exit(2); });
