# API

```js
import { Film, supported, DEFAULTS, fitRect, framePos, timeAt, evenTimes } from 'scrollfilm';
```

The package is plain ES modules with no dependencies and no build step. It
runs in browsers with WebCodecs. The encoder (`scrollfilm/encoder`) runs in
Node 20 or later.

## `supported(source)`

```js
if (!(await supported('/film/manifest.json'))) showFallback();
```

This resolves to `true` when the browser has WebCodecs and can decode the
film's codec at its size. Check it before creating a `Film`, and show a still
or a plain `<video>` where it is `false`. `source` takes the same forms as in
`load()`.

## `new Film(canvas, options)`

`canvas` is the `<canvas>` the film draws on. Size it with CSS. The film sets
the canvas's pixel size from its CSS size and the screen's pixel ratio, never
above the film's own resolution, and keeps it in step with a
`ResizeObserver`.

Options (all optional, defaults in `DEFAULTS`):

| Option | Default | Meaning |
|---|---|---|
| `fit` | `'cover'` | `'cover'` fills the canvas and crops; `'contain'` shows the whole frame on black. |
| `maxPixelRatio` | `2` | The most canvas pixels per CSS pixel. |
| `stiffness` | `7` | The spring pulling the film after the scroll. Lower is stickier. |
| `cruise` | `2.2` on phones, `4` otherwise | The film's top speed, in frames per refresh at 60 Hz, when the scroll is near. Keep it near what the slowest device you care about decodes per refresh. |
| `travel` | `18` | The top speed when the scroll is far ahead. |
| `far` | `240` | How many frames behind the scroll the film must be before it travels through keyframes. |
| `hold` | `3` | The widest gap, in frames, the film blends across. At a wider gap it waits for the decoder instead. |
| `ahead`, `behind` | `14`, `4` on phones; `22`, `6` otherwise | Frames kept decoded ahead of and behind the playhead. `ahead` is multiplied by the current stride. |
| `blend` | `16` | The furthest apart two frames may be and still be blended. |
| `queue`, `keyQueue` | `6`, `3` | Frames given to the decoder and not yet out, cruising and travelling. |
| `jump` | `24` | Further ahead than this, the decoder skips to the keyframe before the frame wanted. |
| `held` | `150` | Milliseconds frames may wait in the decoder, with nothing coming out, before it is flushed. |
| `fast` | `[2, 4]` | Frames per refresh: from the second number up only keyframes are decoded; below the first, every frame is. |
| `loads`, `tries` | `3`, `5` | Parts downloading at once, and attempts per part before the film plays without it. |
| `reducedMotion` | from `prefers-reduced-motion` | `true` makes the film jump straight to the scroll position, with no spring. |
| `forceCanvas2d` | `false` | Draws with a 2D canvas even where WebGL2 works, for testing the fallback. |
| `debug` | `false` | Counts refreshes and draws in `film.stats`. Set `film.stats.log = []` to record every draw. |

## Methods

### `film.load(source)`

Starts playing a film. `source` is either the URL of a `manifest.json` (the
parts are fetched from the same folder) or an object
`{ base, video, times, version }`:

- `base` is the folder URL of the parts, ending in `/`.
- `video` holds the manifest's fields (see [format](format.md)).
- `times` (optional) gives each frame's place in the scroll.
- `version` (optional) is added to the part URLs as `?v=`.

The download starts at the part holding the current scroll position. The
returned promise resolves once every part has downloaded, or failed for good.
Frames show as soon as their own part is in.

Loading a second source switches to it. The first stays in memory, so
switching back is instant. Use this for a portrait and a landscape film:

```js
const pick = () => (innerWidth < innerHeight ? '/film/portrait/manifest.json' : '/film/landscape/manifest.json');
film.load(pick());
addEventListener('resize', () => film.load(pick()));
```

### `film.follow(element = document.documentElement)`

Drives the film from the scroll position of `element`. The position is 0 when
the element's top reaches the top of the viewport, and 1 when its bottom
reaches the bottom of the viewport. `follow()` calls `update()` on every
animation frame. The film decodes only while the element is within a screen's
height of the viewport. It returns a function that stops the loop.

### `film.seek(p)` and `film.update(now)`

These drive the film yourself instead of with `follow()`. `seek(p)` sets where
the scroll is, from 0 to 1. `update(now)` runs one refresh: it moves the film,
keeps the decoder fed and draws. Call it on every animation frame. It returns
`true` when it drew. Setting `film.active = false` pauses decoding and
drawing, for example while the film is off screen.

### `film.invalidate()`

Draws again at the next update even if the film hasn't moved, for example
when an overlay has changed.

### `film.state()`

A snapshot for debugging: the renderer, the frame on screen, the film's
position and the scroll's target in frames, travelling or not, the decoded
frames, and the bytes and parts downloaded.

### `film.destroy()`

Stops decoding, frees the textures and closes the decoder.

## Properties

| Property | Meaning |
|---|---|
| `film.frame` | The frame on screen (the nearer one when two are blended), or −1 before the first draw. |
| `film.time` | The film's position on screen, 0 to 1. It lags the scroll while the film glides, so tie captions to it to keep them in step with the picture. |
| `film.goal` | The scroll position last given to `seek()`. |
| `film.progress` | `{ got, total, done }`: bytes downloaded, bytes in the film, and whether every part has settled. |
| `film.source` | The current film: `n` frames, its `times`, its `video` fields. |

## Hooks

```js
film.onProgress = (got, total) => {};      // as the film downloads
film.onDraw = ({ frame, position, time, target }) => {};  // after each draw
film.onError = (error) => {};              // the decoder failed five times
film.overlay = (draw, info) => {           // more images over the frame
  draw(eveningStill, 0.6);                 // an <img>, ImageBitmap or canvas, at an opacity
};
```

`overlay` runs on every draw, after the frame. `draw(image, alpha, fit)`
covers the canvas with the image. It is uploaded to the GPU once per image
object, so reuse the same objects. Call `film.invalidate()` when the overlay
changes while the film stands still.

`onDraw` runs in the same task as the draw. Copying the canvas there (for
example with `drawImage(film.canvas, …)` into a blurred backdrop) copies the
frame just drawn.

## Helpers

- `fitRect(boxW, boxH, imageW, imageH, fit)`: where an image lands in a box,
  as `{ x, y, w, h }`. Use it to place HTML over a point of the frame.
- `framePos(times, t)` and `timeAt(times, x)`: convert between scroll
  position and frame position.
- `evenTimes(n)`: evenly spaced times, the default.
