// A film tied to the scroll: H.264 decoded with WebCodecs around the
// playhead, drawn with WebGL, moving after the scroll on a spring that never
// runs past what is decoded. docs/how-it-works.md explains the choices and
// the measurements behind them.
import { createRenderer } from './renderer.js';
import { openSeeker, seekerSupported } from './seeker.js';
import { openSource, resolveSource } from './source.js';
import {
  bracket, clamp, decodedAhead, firstKey, framePos, keyBefore, spring, timeAt,
} from './math.js';

const small = typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 700;

export const DEFAULTS = Object.freeze({
  fit: 'cover', // or 'contain'
  maxPixelRatio: 2, // the canvas never has more pixels than the film either
  stiffness: 7, // the spring pulling the film after the scroll: lower is stickier
  cruise: small ? 2.2 : 4, // frames a refresh (at 60 Hz) at most; a Galaxy A14 decodes about two
  travel: 18, // the same when the scroll is far ahead
  far: 240, // frames behind the scroll from which the film travels through keyframes
  hold: 3, // frames: the film doesn't blend across a wider gap, it waits
  ahead: small ? 14 : 22, // frames kept decoded ahead of the playhead (times the stride)
  behind: small ? 4 : 6, // and behind it
  queue: 6, // frames in the decoder and not out yet
  keyQueue: 3, // the same, travelling
  jump: 24, // further ahead than this, the decoder skips to the keyframe before
  held: 150, // ms frames may sit in the decoder with nothing out before it is flushed
  fast: [2, 4], // frames a refresh: from the second only keyframes are decoded, below the first frame by frame
  blend: 16, // frames apart, at most, for two frames to be blended
  settle: 120, // ms the scroll stands still before the film comes to rest on a whole frame
  loads: 3, // parts downloading at once
  tries: 5, // downloads of a part before the film plays without it
  reducedMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  groups: 8, // without WebCodecs: groups of pictures kept in the video's buffer
  forceCanvas2d: false,
  forceVideo: false, // play through a <video> even where WebCodecs is there (for testing)
  debug: false,
});

// How this browser decodes a film: 'webcodecs', 'video' (Media Source
// Extensions and a <video>, where VideoDecoder is missing, as in Firefox for
// Android), or null when it can't.
export async function playback(src) {
  try {
    const { video } = await resolveSource(src);
    if (await webcodecs(video)) return 'webcodecs';
    return seekerSupported(video) ? 'video' : null;
  } catch {
    return null;
  }
}

// Whether this browser can play the film, one way or the other.
export async function supported(src) {
  return (await playback(src)) !== null;
}

async function webcodecs(video) {
  if (typeof VideoDecoder === 'undefined') return false;
  try {
    const r = await VideoDecoder.isConfigSupported({ codec: video.codec, codedWidth: video.width, codedHeight: video.height });
    return r.supported;
  } catch {
    return false;
  }
}

export class Film {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.o = { ...DEFAULTS, ...options };
    this.goal = 0; // where the scroll is, 0 to 1
    this.view = -1; // the film's position on screen, in frames
    this.speed = 0; // frames a second
    this.target = 0; // where the film is heading, in frames: a whole frame once the scroll stands still
    this.aim = -1; // where the scroll is, in frames
    this.stillSince = 0;
    this.travelling = false;
    this.heading = 1;
    this.stride = 1; // frames the film crosses a refresh
    this.hopping = false;
    this.frame = -1; // the frame on screen, the nearer of two blended
    this.time = 0; // the film's position on screen, 0 to 1
    this.active = true; // false: update() moves nothing (the film is off screen)
    this.overlay = null; // (drawImage, info) => {}: more images over the frame
    this.onDraw = null; // (info) => {}: after each draw
    this.onProgress = null; // (got, total) => {}: bytes downloaded
    this.onError = null;
    this.stats = this.o.debug ? { refreshes: 0, slow: 0, drawn: 0, decoded: 0, log: null } : null;
    this.sources = new Map(); // base -> opened source, kept for switching back
    this.source = null;
    this.decoded = new Map(); // frame -> texture
    this.pending = new Set(); // frames given to the decoder and not out yet
    this.decoder = null;
    this.seeker = null; // without WebCodecs
    this.backend = null; // 'webcodecs' or 'video'
    this.decoderSource = null;
    this.fed = -1;
    this.flushing = false;
    this.needKey = true;
    this.fedAt = 0;
    this.outAt = 0;
    this.lo = 0;
    this.hi = -1;
    this.failures = 0;
    this.dirty = true;
    this.shown = -1;
    this.last = 0;
    this.has = (i) => this.decoded.has(i);
    this.renderer = null; // made by load(), once it is known how the film plays
    this.videoFrame = -1; // without WebCodecs: the frame the video shows
    if (typeof ResizeObserver !== 'undefined') {
      this.resizer = new ResizeObserver(() => this.resize());
      this.resizer.observe(canvas);
    }
  }

  // Plays a film: a manifest's URL, or { base, video, times, version }.
  // Resolves once every part has downloaded (or failed for good); frames
  // show as soon as their part is in.
  async load(src) {
    const resolved = await resolveSource(src, { cache: 'no-cache' });
    this.backend ??= !this.o.forceVideo && await webcodecs(resolved.video) ? 'webcodecs' : 'video';
    // Played by a <video>, the film shows through a transparent canvas that
    // only draws the overlays.
    this.renderer ??= createRenderer(this.canvas, {
      forceCanvas2d: this.o.forceCanvas2d,
      transparent: this.backend === 'video',
      onLost: () => { this.decoded.clear(); },
      onRestored: () => { this.dirty = true; },
    });
    let source = this.sources.get(resolved.base);
    if (!source) {
      source = openSource(resolved, {
        loads: this.o.loads,
        tries: this.o.tries,
        onChange: (s) => {
          if (s === this.source) this.dirty = true;
          this.onProgress?.(s.got, s.total);
        },
      });
      this.sources.set(resolved.base, source);
    }
    if (source !== this.source) {
      this.forget();
      this.source = source;
      this.frame = -1;
      this.resize();
      this.startDecoder(source);
    }
    return source.start(Math.round(framePos(source.times, this.goal)));
  }

  // Where the scroll is, 0 to 1.
  seek(p) {
    this.goal = clamp(Number(p) || 0, 0, 1);
  }

  // Draw again at the next update (an overlay changed).
  invalidate() {
    this.dirty = true;
  }

  get progress() {
    return this.source ? { got: this.source.got, total: this.source.total, done: this.source.settled() } : { got: 0, total: 0, done: false };
  }

  // Drives the film from the scroll position of `el` (by default the
  // document): 0 when its top reaches the top of the viewport, 1 when its
  // bottom reaches the bottom. Calls update() every frame; returns a stop function.
  follow(el = document.documentElement) {
    let raf = 0;
    const tick = (now) => {
      const r = el.getBoundingClientRect();
      const len = r.height - innerHeight;
      this.seek(len > 0 ? -r.top / len : 0);
      // Within a screen of the viewport: the first frame is ready before it shows.
      this.active = r.bottom > -innerHeight && r.top < 2 * innerHeight;
      this.update(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }

  // Sizes the canvas to its box: no more pixels than the screen has, nor
  // than the film has. Only a new size clears it (phones fire resize as the
  // address bar comes and goes).
  resize() {
    const c = this.canvas;
    const w = c.clientWidth || c.width, h = c.clientHeight || c.height;
    if (!w || !h) return;
    const v = this.source?.video;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, this.o.maxPixelRatio,
      v ? Math.sqrt((v.width * v.height) / (w * h)) : Infinity);
    const pw = Math.max(1, Math.round(w * ratio)), ph = Math.max(1, Math.round(h * ratio));
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    this.dirty = true;
  }

  // One screen refresh: moves the film, keeps the decoder going and draws.
  update(now = performance.now()) {
    const s = this.source;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (this.stats) { this.stats.refreshes++; if (dt > 0.034) this.stats.slow++; }
    if (!s) return false;
    const o = this.o;
    const before = this.view;
    // While the scroll moves, the film follows it between frames, blending
    // the two either side. Once the scroll stands still it comes to rest on
    // the nearest whole frame, which is always decoded: a film at rest shows
    // one sharp frame, never two blended.
    const aim = framePos(s.times, this.goal);
    if (aim !== this.aim) { this.aim = aim; this.stillSince = now; }
    this.target = now - this.stillSince >= o.settle ? Math.round(aim) : aim;
    if (this.view < 0 || o.reducedMotion) {
      this.view = this.target;
      this.speed = 0;
    } else {
      const gap = Math.abs(this.target - this.view);
      this.travelling = gap > o.far || (this.travelling && gap > o.far / 4);
      // Cruising, the film slows as it nears the last frame decoded ahead,
      // so it eases into a wait instead of stopping dead.
      const dir = Math.sign(this.target - this.view);
      // Played by a video, the film keeps within `ahead` frames of the picture going forward.
      const room = this.travelling ? Infinity
        : this.seeker ? (dir > 0 && this.videoFrame >= 0 ? this.videoFrame + o.ahead - this.view : Infinity)
          : decodedAhead(this.has, this.view, dir, o.hold, s.n);
      const most = this.travelling ? o.travel * 60 : Math.min(o.cruise * 60, Math.max(0, room) * 10);
      [this.view, this.speed] = spring(this.view, this.speed, this.target, dt, o.stiffness, most);
    }
    this.view = clamp(this.view, 0, s.n - 1);
    const step = before < 0 ? 0 : this.view - before;
    if (step) this.heading = Math.sign(step);
    this.stride = clamp(Math.round(Math.abs(step)), 1, 16);
    // A video shows the frame it last seeked to: captions follow that.
    this.time = timeAt(s.times, this.seeker && this.videoFrame >= 0 ? this.videoFrame : this.view);
    if (!this.active) return false;
    if (this.seeker) this.placeSurface();

    // The decoder is kept going at every refresh: the film may be waiting
    // for it, with nothing else changing.
    this.keepDecoded(Math.round(this.view), Math.sign(this.target - this.view) || this.heading);
    if (!this.dirty && this.time === this.shown) return false;
    this.shown = this.time;
    this.dirty = false;
    return this.draw(now);
  }

  draw(now) {
    const s = this.source, o = this.o, x = this.view;
    if (this.seeker) return this.drawOver(now);
    // The two decoded frames either side, blended by where the film is
    // between them. Too far apart they read as a double image: the nearer alone.
    let [a, b] = bracket(this.has, x, o.ahead * this.stride + o.behind);
    if (a >= 0 && b >= 0 && b - a > o.blend) { if (x - a <= b - x) b = -1; else a = -1; }
    if (a < 0) a = b;
    if (b < 0) b = a;
    if (a < 0) return false;
    const mix = b > a ? (x - a) / (b - a) : 0;
    const r = this.renderer;
    const { width, height } = s.video;
    r.begin(o.fit);
    r.draw(this.decoded.get(a), width, height, 1, o.fit);
    if (b !== a && mix > 0.002) r.draw(this.decoded.get(b), width, height, mix, o.fit);
    const showing = mix < 0.5 ? a : b;
    const info = { frame: showing, position: x, time: this.time, target: this.target };
    this.overlay?.((img, alpha = 1, fit = o.fit) => r.image(img, alpha, fit), info);
    if (this.stats) {
      if (showing !== this.frame || mix !== this.stats.mix) this.stats.drawn++;
      this.stats.mix = mix;
      this.stats.log?.push([Math.round(now), +x.toFixed(2), a, b, +mix.toFixed(3), this.heading, this.pending.size, this.hopping ? 1 : 0, +this.target.toFixed(2)]);
    }
    this.frame = showing;
    this.onDraw?.(info);
    return true;
  }

  // A video shows the film: only the overlays are drawn, on a clear canvas.
  drawOver(now) {
    const showing = this.videoFrame;
    if (showing < 0) return false;
    const r = this.renderer, o = this.o;
    r.begin(o.fit);
    const info = { frame: showing, position: this.view, time: this.time, target: this.target };
    this.overlay?.((img, alpha = 1, fit = o.fit) => r.image(img, alpha, fit), info);
    if (this.stats) {
      if (showing !== this.frame) this.stats.drawn++;
      this.stats.mix = 0;
      this.stats.log?.push([Math.round(now), +this.view.toFixed(2), showing, showing, 0, this.heading, this.seeker.busy ? 1 : 0, this.hopping ? 1 : 0, +this.target.toFixed(2)]);
    }
    this.frame = showing;
    this.onDraw?.(info);
    return true;
  }

  // The video goes right under the canvas, the same size and in the same
  // place, so the page's layout and stacking hold it as they hold the canvas.
  placeSurface() {
    const v = this.seeker.el, c = this.canvas, st = v.style;
    if (v.nextElementSibling !== c) {
      c.before(v);
      st.cssText = 'display:block;pointer-events:none;object-position:50% 50%;background:#000;margin:0';
      c.style.background = 'transparent';
    }
    const cs = getComputedStyle(c);
    if (cs.position === 'static') c.style.position = 'relative';
    const set = (k, val) => { if (st[k] !== val) st[k] = val; };
    const pos = getComputedStyle(c).position;
    set('objectFit', this.o.fit);
    set('width', `${c.offsetWidth}px`);
    set('height', `${c.offsetHeight}px`);
    if (pos === 'relative') {
      set('position', 'absolute');
      set('left', `${c.offsetLeft}px`);
      set('top', `${c.offsetTop}px`);
    } else {
      // sticky, fixed or absolute: the same rules; in the flow (sticky), it
      // takes no room.
      set('position', pos);
      for (const k of ['top', 'right', 'bottom', 'left']) set(k, cs[k]);
      set('marginBottom', pos === 'sticky' ? `${-c.offsetHeight}px` : '0px');
    }
    set('transform', cs.transform === 'none' ? '' : cs.transform);
    set('transformOrigin', cs.transformOrigin);
    set('opacity', cs.opacity);
    set('visibility', cs.visibility);
  }

  // ---------- decoding ----------
  // One VideoDecoder (hardware where there is one) runs ahead of the film:
  // forward it is fed frame after frame; going back or jumping, it goes on
  // from the keyframe before the frame wanted. Each frame out is uploaded at
  // once and handed back: hardware decoders stall when their frames are kept.

  forget() {
    for (const tex of this.decoded.values()) this.renderer?.release(tex);
    this.decoded.clear();
  }

  startDecoder(source) {
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.seeker?.close();
    this.decoderSource = source;
    if (this.backend === 'video') {
      // Hardware-decoded video can't be read back on every browser (Firefox
      // for Android draws it black into a canvas or a texture), so the video
      // itself is on screen, under the canvas.
      this.videoFrame = -1;
      this.seeker = openSeeker(source, {
        groups: this.o.groups,
        onFrame: (i) => {
          if (this.stats) this.stats.decoded++;
          if (source === this.decoderSource) this.videoFrame = i;
          this.dirty = true;
        },
        onError: (e) => {
          if (this.stats) this.stats.error = String(e);
          this.onError?.(e);
        },
      });
      return;
    }
    this.fed = -1;
    this.pending.clear();
    this.flushing = false;
    this.needKey = true;
    this.decoder = new VideoDecoder({
      output: (vf) => {
        const i = vf.timestamp;
        this.pending.delete(i);
        this.outAt = performance.now();
        if (this.stats) this.stats.decoded++;
        // Every frame is decoded, the codec needs them all, but going faster
        // than a frame a refresh only the ones the screen can show are kept.
        const shows = this.hopping || Math.abs(i - this.view) <= 1.5 || (i - Math.round(this.view)) % this.stride === 0;
        if (source === this.decoderSource && i >= this.lo && i <= this.hi && shows && !this.decoded.has(i)) {
          const tex = this.renderer.upload(vf);
          if (tex) this.decoded.set(i, tex);
        }
        vf.close();
        this.dirty = true;
      },
      error: (e) => {
        if (this.stats) this.stats.error = String(e);
        if (source !== this.decoderSource) return;
        // A decoder can die (a GPU reset, a bad frame): start a new one, but
        // not forever.
        if (++this.failures <= 5) { this.startDecoder(source); return; }
        this.onError?.(e);
      },
    });
    const v = source.video;
    this.decoder.configure({
      codec: v.codec,
      description: Uint8Array.from(atob(v.description), (c) => c.charCodeAt(0)),
      codedWidth: v.width,
      codedHeight: v.height,
      optimizeForLatency: true,
    });
  }

  feed(i) {
    const s = this.decoderSource;
    this.decoder.decode(new EncodedVideoChunk({ type: s.keys.has(i) ? 'key' : 'delta', timestamp: i, data: s.chunk(i) }));
    this.fed = i;
    this.pending.add(i);
    this.needKey = false;
    this.fedAt = performance.now();
  }

  // A decoded frame each side of i, near enough to blend.
  covered(i) {
    let lo = false, hi = false;
    for (let d = 0; d <= 2 * this.stride && !(lo && hi); d++) {
      lo ||= this.decoded.has(i - d);
      hi ||= this.decoded.has(i + d);
    }
    return lo && hi;
  }

  keepDecoded(center, dir) {
    const o = this.o, s = this.decoderSource, stride = this.stride;
    this.lo = center - (dir < 0 ? o.ahead * stride : o.behind);
    this.hi = center + (dir < 0 ? o.behind : o.ahead * stride);
    for (const [i, tex] of this.decoded) {
      if (i >= this.lo && i <= this.hi) continue;
      this.renderer.release(tex);
      this.decoded.delete(i);
    }
    if (stride >= o.fast[1]) this.hopping = true;
    else if (stride <= o.fast[0]) this.hopping = false;
    if (this.seeker) { this.seekNext(center, dir); return; }
    const d = this.decoder;
    if (!d || d.state !== 'configured' || this.flushing) return;
    // Some decoders hold their last frames until more come or they are
    // flushed; a flush leaves them wanting a keyframe next.
    if (this.pending.size && performance.now() - Math.max(this.fedAt, this.outAt) > o.held) {
      this.flushing = true;
      d.flush().catch(() => {}).finally(() => {
        this.flushing = false;
        this.pending.clear();
        this.needKey = true;
        this.dirty = true;
      });
      return;
    }
    if (this.hopping) { this.hopKeys(center, dir); return; }
    // The frame wanted first: the one the film comes to rest on, then the
    // nearest the playhead, ahead before behind. Frames the decoder went past
    // without keeping are not worth starting over for while the screen can
    // blend across them, except the one at rest.
    const rest = this.restFrame();
    const wanted = (i) => i >= 0 && i < s.n && !this.decoded.has(i) && !this.pending.has(i) && s.ready(i)
      && !(i !== rest && i <= this.fed && !this.needKey && this.covered(i));
    let target = wanted(rest) ? rest : -1;
    for (let k = 0; k <= o.ahead && target < 0; k++) {
      for (const i of k <= o.behind && k > 0 ? [center + k * stride * dir, center - k * dir] : [center + k * stride * dir]) {
        if (wanted(i)) { target = i; break; }
      }
    }
    if (target < 0) return;
    if (this.needKey || target <= this.fed || target > this.fed + o.jump) {
      // Behind what the decoder has done, far ahead, or after a flush: go on
      // from the keyframe before it. What is still in the decoder comes out
      // first and is dropped if no longer wanted; a new decoder would cost
      // far more (a phone's hardware decoder takes a few hundred ms to start).
      this.fed = keyBefore(s.keyList, target) - 1;
      this.needKey = true;
    }
    const end = Math.min(s.n - 1, Math.max(target, dir > 0 ? this.hi : target));
    while (this.pending.size < o.queue && this.fed < end && s.ready(this.fed + 1)) this.feed(this.fed + 1);
  }

  // The frame the film is coming to rest on, or -1 while it moves.
  restFrame() {
    return Number.isInteger(this.target) && Math.abs(this.target - this.view) < 2 ? this.target : -1;
  }

  // Without WebCodecs. Going forward the video plays, its rate following
  // the film (a playing video decodes far faster than it seeks: on a
  // Galaxy A14, Firefox managed about 8 seeks a second). Going back,
  // travelling, or close to where the film is heading, it pauses and seeks:
  // to the frame the film comes to rest on, to the frame it is on, or when
  // travelling to the next keyframe, which decodes on its own.
  seekNext(center, dir) {
    const k = this.seeker, keys = this.decoderSource.keyList;
    if (k.playing && k.frame !== this.videoFrame) { this.videoFrame = k.frame; this.dirty = true; }
    const shown = this.videoFrame;
    const rest = this.restFrame();
    const goal = rest >= 0 ? rest : this.target;
    if (shown >= 0 && !this.travelling && !this.hopping && goal - shown > 3) {
      // Frames a second: the film's own speed, plus catching up with it.
      const lead = this.view - shown;
      k.run((Math.max(0, this.speed) + 4 * Math.max(0, lead)) / 30);
      return;
    }
    k.stop();
    if (k.busy) return;
    let i = rest >= 0 ? rest : center;
    if (rest < 0 && this.hopping) i = keys[clamp(firstKey(keys, center, dir), 0, keys.length - 1)];
    if (i !== shown) k.want(i);
  }

  // Travelling: only the keyframes ahead, nearest first. Each stands alone,
  // so this works in both directions.
  hopKeys(center, dir) {
    const s = this.decoderSource, keys = s.keyList;
    let k = firstKey(keys, center, dir);
    for (let n = 0; n < 8 && this.pending.size < this.o.keyQueue; n++, k += dir) {
      const i = keys[k];
      if (i === undefined || i < this.lo || i > this.hi) break;
      if (!this.decoded.has(i) && !this.pending.has(i) && s.ready(i)) this.feed(i);
    }
  }

  // A snapshot for debugging and tests.
  state() {
    const s = this.source;
    return {
      renderer: this.renderer?.kind, backend: this.backend, frame: this.frame, position: this.view, target: this.target, time: this.time,
      travelling: this.travelling, hopping: this.hopping, stride: this.stride, pending: this.pending.size, fed: this.fed,
      decoder: this.decoder?.state, decoded: [...this.decoded.keys()].sort((p, q) => p - q),
      got: s?.got ?? 0, total: s?.total ?? 0, parts: s ? s.parts.map((p) => p.state) : [],
    };
  }

  destroy() {
    this.active = false;
    this.resizer?.disconnect();
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.seeker?.close();
    this.forget();
    for (const s of this.sources.values()) s.closed = true;
    this.renderer?.destroy();
  }
}
