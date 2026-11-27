// The demo: one film, or one per orientation (film/portrait and
// film/landscape) when both are there, switched as the screen turns.
import { Film, supported } from '../src/index.js';

const params = new URLSearchParams(location.search);
const canvas = document.querySelector('.film');
const track = document.querySelector('.track');
const loading = document.querySelector('.loading');
const pct = loading.querySelector('.pct');
const bar = document.querySelector('.bar span');
const notes = [...document.querySelectorAll('.notes p')].map((el) => ({ el, at: el.dataset.at.split(' ').map(Number) }));
const hud = Object.fromEntries(['frame', 'decoded', 'mode', 'renderer'].map((k) => [k, document.querySelector(`.h-${k}`)]));

const film = new Film(canvas, { debug: params.has('debug'), forceCanvas2d: params.has('canvas2d'), forceVideo: params.has('video') });
if (params.has('debug')) window.film = film;

const orientation = () => (innerWidth < innerHeight ? 'portrait' : 'landscape');
const exists = (url) => fetch(url, { method: 'HEAD' }).then((r) => r.ok, () => false);
async function sourceFor(o) {
  const own = `film/${o}/manifest.json`;
  return (await exists(own)) ? own : 'film/manifest.json';
}

function fail(text) {
  loading.textContent = text;
  loading.classList.add('is-error');
}

let current = null;
async function play() {
  const src = await sourceFor(orientation());
  if (src === current) return;
  current = src;
  loading.classList.remove('is-done');
  await film.load(src);
}

film.onProgress = (got, total) => {
  pct.textContent = `${Math.floor((100 * got) / total)}%`;
};
film.onError = () => fail('This device could not decode the film.');

film.onDraw = ({ frame, time }) => {
  loading.classList.add('is-done');
  const s = film.state();
  hud.frame.textContent = `${frame + 1} / ${film.source.n}`;
  hud.decoded.textContent = s.decoded.length;
  hud.mode.textContent = s.travelling ? 'travel' : s.target === s.position ? 'still' : 'glide';
  hud.renderer.textContent = `${s.renderer}, ${s.backend}`;
  for (const n of notes) n.el.classList.toggle('is-on', time >= n.at[0] && time <= n.at[1]);
};

(async () => {
  const src = await sourceFor(orientation());
  if (!(await supported(src))) {
    fail('This browser can’t play the film: it needs WebCodecs or Media Source Extensions with H.264.');
    return;
  }
  fetch('film/credits.txt').then((r) => (r.ok ? r.text() : '')).then((t) => {
    const el = document.querySelector('.credits');
    if (t.trim()) { el.textContent = t.trim(); el.hidden = false; }
  });
  await play().catch(() => fail('The film did not load. Reload the page to try again.'));
  const stop = film.follow(track);
  addEventListener('resize', () => { play(); });
  // The progress bar follows the scroll, the film follows the bar.
  const tick = () => {
    bar.style.transform = `scaleX(${film.goal})`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  addEventListener('pagehide', stop);
})();
