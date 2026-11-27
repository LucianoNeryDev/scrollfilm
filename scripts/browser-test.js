// Plays the demo in headless browsers and checks the film decodes and follows
// the scroll: npm run demo:film, then npm run test:browser. Needs the
// playwright package (a dev dependency) and its browsers (npx playwright install).
import { spawn } from 'node:child_process';
import { chromium, firefox, webkit } from 'playwright';

const PORT = 5199;
const server = spawn(process.execPath, [new URL('./serve.js', import.meta.url).pathname, 'demo', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const base = `http://localhost:${PORT}/demo/?debug`;
let failed = false;

async function check(name, type, launch = {}, query = '') {
  const url = base + query;
  let browser;
  try {
    browser = await type.launch(launch);
  } catch (e) {
    console.log(`${name}: skipped (${e.message.split('\n')[0]})`);
    return;
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(url);
    const ok = await page.evaluate(async () => {
      const { supported } = await import('/src/index.js');
      return supported('film/manifest.json');
    });
    if (!ok) { console.log(`${name}: no WebCodecs H.264 here, the page says so`); return; }
    await page.waitForFunction(() => window.film?.frame >= 0, null, { timeout: 30000 });
    const seen = new Set();
    const height = await page.evaluate(() => document.querySelector('.track').offsetHeight - innerHeight);
    const top = await page.evaluate(() => document.querySelector('.track').offsetTop);
    for (const p of [0.1, 0.35, 0.6, 0.9, 0.5, 0.2]) {
      await page.evaluate((y) => scrollTo(0, y), top + height * p);
      // At rest: on the whole frame nearest the scroll, drawn alone.
      await page.waitForFunction((goal) => {
        const f = window.film, s = f.state(), n = f.source.n;
        return Math.abs(f.time - goal) <= 0.5 / (n - 1) + 1e-9 && s.position === s.target && Number.isInteger(s.position)
          && s.frame === s.position && f.stats.mix === 0;
      }, p, { timeout: 40000 });
      const s = await page.evaluate(() => window.film.state());
      seen.add(s.frame);
    }
    const renderer = await page.evaluate(() => window.film.state().renderer);
    if (errors.length) throw new Error(errors.join('; '));
    if (seen.size < 6) throw new Error(`settled on ${seen.size} distinct frames, expected 6`);
    console.log(`${name}: ok (${renderer}, frames ${[...seen].join(', ')})`);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
  } catch (e) {
    failed = true;
    const s = await page.evaluate(async () => { const f = window.film; const a = { r: f.stats.refreshes, last: f.last, now: performance.now() }; await new Promise((r) => setTimeout(r, 500)); return { a, b: { r: f.stats.refreshes, last: f.last }, speed: f.speed, view: f.view, target: f.target, active: f.active, goal: f.goal, vis: document.visibilityState }; }).catch((e) => String(e));
    console.log(`${name}: FAILED ${e.message}`, JSON.stringify(s), errors.slice(0, 3));
  } finally {
    await browser.close();
  }
}

const only = process.env.ONLY;
const run = (n, ...a) => (!only || only === n ? check(n, ...a) : null);
await run('chromium', chromium, { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
await run('chromium-2d', chromium, {}, '&canvas2d');
await run('firefox', firefox);
await run('webkit', webkit);
server.kill();
process.exit(failed ? 1 : 0);
