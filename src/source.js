// A film's files: its manifest and the parts it is cut into. All of it
// downloads, a few parts at a time, starting at the part the film is at;
// playback then never waits for the network, only for decoding.
import { evenTimes } from './math.js';

const pad = (p) => String(p).padStart(2, '0');

// A manifest's URL, or { base, video, times, version } for a manifest of your
// own (see docs/format.md).
export async function resolveSource(src, fetchOptions) {
  if (typeof src !== 'string') return src;
  const url = new URL(src, location.href);
  const r = await fetch(url, fetchOptions);
  if (!r.ok) throw new Error(`scrollfilm: ${url} answered ${r.status}`);
  const m = await r.json();
  return { base: new URL('.', url).href, video: m, times: m.times, version: m.v };
}

export function openSource(src, { loads = 3, tries = 5, onChange = () => {} } = {}) {
  const { video } = src;
  const n = video.sizes.length;
  const partOf = new Uint16Array(n);
  const offset = new Uint32Array(n);
  const parts = video.parts.map((first, p) => {
    const end = video.parts[p + 1] ?? n;
    let size = 0;
    for (let i = first; i < end; i++) { partOf[i] = p; offset[i] = size; size += video.sizes[i]; }
    return { p, size, buf: null, got: 0, state: 'none', tries: 0 };
  });
  const query = src.version ? `?v=${encodeURIComponent(src.version)}` : '';
  const source = {
    base: src.base,
    video,
    n,
    times: src.times && src.times.length === n ? src.times : evenTimes(n),
    keys: new Set(video.keys),
    keyList: video.keys,
    parts,
    partOf,
    offset,
    got: 0,
    total: parts.reduce((a, p) => a + p.size, 0),
    loading: 0,
    order: null,
    closed: false,
    ready: (i) => parts[partOf[i]].state === 'ready',
    settled: () => parts.every((p) => p.state === 'ready' || p.state === 'failed'),
    // The bytes of frame i (its part must be ready).
    chunk(i) {
      const at = offset[i];
      return parts[partOf[i]].buf.subarray(at, at + video.sizes[i]);
    },
    // Starts the download, from the part holding frame `from` to the end,
    // then back to the start.
    start(from = 0) {
      if (source.order) return source.done;
      const at = partOf[Math.min(Math.max(0, from), n - 1)];
      source.order = [...parts.slice(at), ...parts.slice(0, at).reverse()];
      pump();
      return source.done;
    },
  };
  let finish;
  source.done = new Promise((r) => { finish = r; });

  // A part streams in, counted as it comes, so progress moves with every byte.
  async function load(part) {
    const r = await fetch(`${src.base}${pad(part.p)}.bin${query}`);
    if (!r.ok || !r.body) throw new Error(r.status);
    const buf = new Uint8Array(part.size);
    const reader = r.body.getReader();
    let at = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.length > buf.length) throw new Error('longer than the manifest says');
      buf.set(value, at);
      at += value.length;
      source.got += value.length;
      part.got += value.length;
      onChange(source);
    }
    if (at !== buf.length) throw new Error('cut short');
    return buf;
  }

  function pump() {
    while (!source.closed && source.loading < loads) {
      const part = source.order.find((p) => p.state === 'none');
      if (!part) break;
      part.state = 'loading';
      source.loading++;
      load(part)
        .then((buf) => { part.buf = buf; part.state = 'ready'; })
        .catch(() => {
          source.got -= part.got;
          part.got = 0;
          part.tries++;
          // Back off and try again: 0.5, 1, 2, 4 s. After the last try the
          // film plays without these frames, showing their neighbours.
          part.state = part.tries >= tries ? 'failed' : 'waiting';
          if (part.state === 'waiting') setTimeout(() => { part.state = 'none'; pump(); }, 250 * 2 ** part.tries);
        })
        .finally(() => {
          source.loading--;
          onChange(source);
          pump();
        });
    }
    if (source.settled()) finish(source);
  }

  return source;
}
