// For browsers without WebCodecs' VideoDecoder (Firefox for Android): the
// same film through Media Source Extensions and a hidden <video>. The frames
// already downloaded are wrapped in MP4 fragments, one group of pictures (a
// keyframe and the frames up to the next) at a time, and the video is seeked
// to each frame the film wants. Only a few groups stay in the video's buffer.
import { TICKS, TIMESCALE, fragment, initSegment } from './mp4.js';

const typeOf = (video) => `video/mp4; codecs="${video.codec}"`;

export const seekerSupported = (video) => typeof MediaSource !== 'undefined'
  && typeof document !== 'undefined' && MediaSource.isTypeSupported(typeOf(video));

export function openSeeker(source, { onFrame, onError, groups = 8, patience = 2000 }) {
  const { video: v, keyList: keys, n } = source;
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.setAttribute('aria-hidden', 'true');
  el.style.display = 'none'; // until the film puts it in place
  document.body.append(el);
  const ms = new MediaSource();
  el.src = URL.createObjectURL(ms);

  const group = (i) => { // the index in keys of the keyframe at or before i
    let lo = 0, hi = keys.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (keys[mid] <= i) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const span = (g) => [keys[g], (keys[g + 1] ?? n) - 1];
  const appended = new Map(); // group -> last used
  const ops = [];
  let sb = null, seq = 1, closed = false, seeking = -1, seekTimer = 0, clock = 0;

  const frameAt = (t) => Math.min(n - 1, Math.max(0, Math.floor(t * TIMESCALE / TICKS + 1e-3)));
  // Queues group g into the video's buffer unless it is there already.
  function ensure(g) {
    if (g < 0 || g >= keys.length) return;
    appended.set(g, ++clock);
    if (buffered(g) || ops.some((op) => op.group === g)) return;
    const [a, b] = span(g);
    if (!source.ready(a) || !source.ready(b)) return;
    evict(g);
    const op = () => {
      const samples = [];
      for (let f = a; f <= b; f++) samples.push({ size: v.sizes[f], key: source.keys.has(f) });
      const data = new Uint8Array(samples.reduce((t, x) => t + x.size, 0));
      for (let f = a, at = 0; f <= b; f++) { data.set(source.chunk(f), at); at += v.sizes[f]; }
      sb.appendBuffer(fragment(seq++, a, samples, data));
    };
    op.group = g;
    ops.push(op);
  }

  const seeker = {
    get busy() { return !sb || sb.updating || ops.length > 0 || seeking >= 0; },
    get playing() { return !el.paused; },
    // The frame the video is at. Firefox for Android stops calling
    // requestVideoFrameCallback now and then, so the clock is read instead.
    get frame() { return frameAt(el.currentTime); },
    // Plays forward at rate (1 is 30 frames a second): a playing video
    // decodes frame after frame, far faster than it seeks. The groups ahead
    // are queued into the buffer as it goes; read frame to see where it is.
    run(rate) {
      if (closed || !sb || seeking >= 0) return;
      const g = group(frameAt(el.currentTime));
      for (let k = 0; k <= 3; k++) ensure(g + k);
      next();
      rate = Math.min(4, Math.max(0.25, rate));
      if (Math.abs(el.playbackRate - rate) > rate * 0.15) el.playbackRate = rate;
      if (el.paused) el.play().catch(() => {});
    },
    stop() { if (!el.paused) el.pause(); },
    // Whether frame i can be asked for: its whole group downloaded.
    ready(i) {
      const [a, b] = span(group(i));
      return source.ready(a) && source.ready(b);
    },
    // Seeks to frame i; onFrame(i, video) runs once it shows.
    want(i) {
      if (seeker.busy || closed || i < 0 || i >= n || !seeker.ready(i)) return false;
      seeker.stop();
      ensure(group(i));
      seeking = i;
      next();
      return true;
    },
    close() {
      closed = true;
      clearTimeout(seekTimer);
      el.removeAttribute('src');
      el.load();
      el.remove();
    },
    el,
  };

  // Whether group g's frames are all in the video's buffer.
  function buffered(g) {
    if (!appended.has(g) || !sb) return false;
    const [a, b] = span(g);
    const t0 = a * TICKS / TIMESCALE, t1 = (b + 1) * TICKS / TIMESCALE;
    for (let r = 0; r < sb.buffered.length; r++) {
      if (sb.buffered.start(r) <= t0 + 1e-3 && sb.buffered.end(r) >= t1 - 1e-3) return true;
    }
    return false;
  }

  // Keeps the buffer to a few groups: the ones used longest ago go.
  function evict(keep) {
    while (appended.size > groups) {
      let old = -1, at = Infinity;
      for (const [g, t] of appended) if (g !== keep && t < at) { old = g; at = t; }
      if (old < 0) return;
      appended.delete(old);
      const [a, b] = span(old);
      ops.push(() => sb.remove(a * TICKS / TIMESCALE, (b + 1) * TICKS / TIMESCALE));
    }
  }

  function next() {
    if (closed || !sb || sb.updating) return;
    const op = ops.shift();
    if (op) {
      try { op(); } catch (e) { fail(e); }
      return;
    }
    if (seeking < 0) return;
    // The middle of the frame's interval, clear of rounding at its edges.
    const t = (seeking + 0.5) * TICKS / TIMESCALE;
    clearTimeout(seekTimer);
    seekTimer = setTimeout(() => { seeking = -1; next(); }, patience);
    if (Math.abs(el.currentTime - t) < 1e-4 && el.readyState >= 2) shown();
    else el.currentTime = t;
  }

  function shown() {
    clearTimeout(seekTimer);
    const i = seeking;
    seeking = -1;
    if (i >= 0 && !closed) onFrame(i, el);
    next();
  }

  function fail(e) {
    if (closed) return;
    onError?.(e);
  }

  el.addEventListener('seeked', shown);
  el.addEventListener('error', () => fail(el.error));
  ms.addEventListener('sourceopen', () => {
    URL.revokeObjectURL(el.src);
    try {
      ms.duration = n * TICKS / TIMESCALE;
      sb = ms.addSourceBuffer(typeOf(v));
      sb.mode = 'segments';
      sb.addEventListener('updateend', next);
      sb.addEventListener('error', () => fail(new Error('scrollfilm: the video rejected a fragment')));
      const avcC = Uint8Array.from(atob(v.description), (c) => c.charCodeAt(0));
      sb.appendBuffer(initSegment({ width: v.width, height: v.height, avcC }));
    } catch (e) { fail(e); }
  }, { once: true });

  return seeker;
}
