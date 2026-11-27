// Assembles the demo as a static site in site/: the page at the root, its
// script, stylesheet and the library (without the encoder) under app-<hash>/,
// and the film(s) under film/ (kept if already there, else copied from
// demo/film). Deploy site/ to any static host.
//
// The scripts are ES modules with fixed names, and some hosts tell browsers to
// keep such files for hours: a visitor would go on running the old library
// after a release. Naming their folder by a hash of their content gives every
// change new addresses, so they can be cached for long and still never be
// stale: only the page itself must be revalidated.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const site = `${root}site/`;
const keep = (p) => !p.includes('/encoder');

const files = (dir) => readdirSync(dir, { recursive: true }).map((f) => `${dir}/${f}`)
  .filter((p) => keep(p) && /\.(js|css)$/.test(p)).sort();
const hash = createHash('sha256');
for (const p of [`${root}demo/demo.js`, `${root}demo/demo.css`, ...files(`${root}src`)]) {
  hash.update(p.slice(root.length)).update(readFileSync(p));
}
const app = `app-${hash.digest('hex').slice(0, 10)}`;

mkdirSync(site, { recursive: true });
for (const f of readdirSync(site)) {
  if (f.startsWith('app-') || ['src', 'demo.js', 'demo.css'].includes(f)) rmSync(`${site}${f}`, { recursive: true, force: true });
}
mkdirSync(`${site}${app}`);
cpSync(`${root}src`, `${site}${app}/src`, { recursive: true, filter: keep });
cpSync(`${root}demo/demo.css`, `${site}${app}/demo.css`);
const script = readFileSync(`${root}demo/demo.js`, 'utf8');
if (!script.includes("from '../src/index.js'")) throw new Error('demo.js no longer imports ../src/index.js');
writeFileSync(`${site}${app}/demo.js`, script.replace("from '../src/index.js'", "from './src/index.js'"));
let page = readFileSync(`${root}demo/index.html`, 'utf8');
for (const [a, b] of [['href="demo.css"', `href="${app}/demo.css"`], ['src="demo.js"', `src="${app}/demo.js"`]]) {
  if (!page.includes(a)) throw new Error(`index.html no longer has ${a}`);
  page = page.replace(a, b);
}
writeFileSync(`${site}index.html`, page);

if (!existsSync(`${site}film`)) {
  if (!existsSync(`${root}demo/film`)) throw new Error('no film: run npm run demo:film, or put one in site/film');
  cpSync(`${root}demo/film`, `${site}film`, { recursive: true });
}
// Parts are named by the encoder's version and the app folder by its content,
// so both can be cached for long; the page and the manifests are revalidated.
writeFileSync(`${site}_headers`, `/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/app-*
  Cache-Control: public, max-age=31536000, immutable
/film/*
  Cache-Control: public, max-age=2592000
/film/*/manifest.json
  Cache-Control: no-cache
/film/manifest.json
  Cache-Control: no-cache
`);
console.log(`site/ ready (${app})`);
