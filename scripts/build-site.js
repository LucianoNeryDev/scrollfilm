// Assembles the demo as a static site in site/: the demo page at the root,
// the library under src/, and the film(s) under film/ (kept if already there,
// else copied from demo/film). Deploy site/ to any static host.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const site = `${root}site/`;
mkdirSync(site, { recursive: true });
for (const f of ['index.html', 'demo.css', 'demo.js']) cpSync(`${root}demo/${f}`, `${site}${f}`);
rmSync(`${site}src`, { recursive: true, force: true });
cpSync(`${root}src`, `${site}src`, { recursive: true, filter: (p) => !p.includes('/encoder') });
if (!existsSync(`${site}film`)) {
  if (!existsSync(`${root}demo/film`)) throw new Error('no film: run npm run demo:film, or put one in site/film');
  cpSync(`${root}demo/film`, `${site}film`, { recursive: true });
}
// Parts are named by the encoder's version, so they can be cached for long.
writeFileSync(`${site}_headers`, `/film/*
  Cache-Control: public, max-age=2592000
/film/*/manifest.json
  Cache-Control: no-cache
/film/manifest.json
  Cache-Control: no-cache
`);
console.log(`site/ ready`);
