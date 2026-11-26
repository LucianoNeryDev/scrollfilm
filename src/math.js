// Pure helpers: positions in the film, the decoded window, the motion. No DOM,
// so they run (and are tested) anywhere.

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Evenly spaced frame times, from 0 to 1.
export function evenTimes(n) {
  return Array.from({ length: n }, (_, i) => (n > 1 ? i / (n - 1) : 0));
}

// Where t (0 to 1) falls in the film, in frames: 12.25 is a quarter of the way
// from frame 12 to frame 13. times[i] is frame i's place, rising.
export function framePos(times, t) {
  let lo = 0, hi = times.length - 1;
  if (t <= times[lo]) return lo;
  if (t >= times[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid;
  }
  return lo + (t - times[lo]) / (times[hi] - times[lo]);
}

// The time at a frame position: framePos turned around.
export function timeAt(times, x) {
  const i = clamp(Math.floor(x), 0, times.length - 1);
  const j = Math.min(i + 1, times.length - 1);
  return times[i] + (times[j] - times[i]) * (x - i);
}

// The decoded frames either side of x, nearest first: [a, b] with
// a <= x <= b, -1 where there is none within reach.
export function bracket(has, x, reach) {
  let a = -1, b = -1;
  const lo = Math.floor(x), hi = Math.ceil(x);
  for (let d = 0; d <= reach && (a < 0 || b < 0); d++) {
    if (a < 0 && has(lo - d)) a = lo - d;
    if (b < 0 && has(hi + d)) b = hi + d;
  }
  return [a, b];
}

// How far the film can go from x towards dir over decoded frames, none
// further than hold from the next. Nothing decoded near x: no limit (the film
// has jumped and shows the nearest frame it has).
export function decodedAhead(has, x, dir, hold, n) {
  if (!dir) return 0;
  let at = dir > 0 ? Math.floor(x) : Math.ceil(x);
  let gap = 0;
  while (gap <= hold && !has(at)) { at -= dir; gap++; }
  if (gap > hold) return Infinity;
  let end = at;
  for (let i = at + dir, miss = 0; miss <= hold && i >= 0 && i < n; i += dir) {
    if (has(i)) { end = i; miss = 0; } else miss++;
  }
  return (end - x) * dir;
}

// The index in keys (keyframes, rising) of the first keyframe at or past
// center going dir; may be -1 or keys.length when there is none.
export function firstKey(keys, center, dir) {
  let lo = 0, hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < center) lo = mid + 1; else hi = mid;
  }
  return dir > 0 ? lo : (keys[lo] === center ? lo : lo - 1);
}

// The keyframe at or before frame i.
export function keyBefore(keys, i) {
  const k = firstKey(keys, i, -1);
  return k >= 0 ? keys[k] : 0;
}

// One step of the film's motion: a critically damped spring pulling view
// towards target, its speed (frames a second) capped at most. dt is capped
// too (at 50 ms), so a missed refresh doesn't make the film jump to catch up.
export function spring(view, speed, target, dt, stiffness, most) {
  for (let left = Math.min(dt, 1 / 20); left > 0; left -= 1 / 240) {
    const h = Math.min(left, 1 / 240);
    speed = clamp(speed + (stiffness * stiffness * (target - view) - 2 * stiffness * speed) * h, -most, most);
    view += speed * h;
  }
  if (Math.abs(target - view) < 0.01 && Math.abs(speed) < 0.5) return [target, 0];
  return [view, speed];
}

// Where an iw x ih image goes in a cw x ch box: cover fills the box and crops,
// contain shows all of it.
export function fitRect(cw, ch, iw, ih, fit = 'cover') {
  const s = fit === 'contain' ? Math.min(cw / iw, ch / ih) : Math.max(cw / iw, ch / ih);
  return { x: (cw - iw * s) / 2, y: (ch - ih * s) / 2, w: iw * s, h: ih * s };
}
