#!/usr/bin/env node
// Packages each game into a submission-ready zip for portal distribution.
// Output: dist/zips/prismplay-<slug>.zip
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = resolve(ROOT, 'dist', 'zips');
mkdirSync(OUT, { recursive: true });

const slugs = ['fuse','stack','orbit','match3','bubble','idle','io','runner','equate','td'];

for (const slug of slugs) {
  const metaPath = resolve(ROOT, 'games', slug, 'meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const outFile = resolve(OUT, `prismplay-${slug}.zip`);

  // Files to include — paths relative to ROOT so zip retains clean structure
  const files = [
    `games/${slug}/index.html`,
    `games/${slug}/game.js`,
    `games/${slug}/style.css`,
    `games/${slug}/meta.json`,
    `shared/juice.js`,
    `shared/retention.js`,
  ];

  // Remove old zip if it exists
  try { execSync(`rm -f "${outFile}"`); } catch {}

  execSync(`zip -j "${outFile}" ${files.map(f => `"${resolve(ROOT, f)}"`).join(' ')}`, {
    cwd: ROOT,
    stdio: 'pipe',
  });

  const stat = execSync(`du -sh "${outFile}"`).toString().split('\t')[0];
  console.log(`✓  prismplay-${slug}.zip  (${stat})  — ${meta.title}`);
}

console.log(`\nAll zips written to dist/zips/`);
