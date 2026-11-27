# scrollfilm

A film you scrub with the scroll, smooth on a cheap phone.

scrollfilm plays a video frame by frame as the page scrolls, forwards and
back, at any speed. You can see it running on the
[Residenza Vela](https://residenza-vela.lucianonery.dev) site, a 2,399-frame
architectural fly-through. The demo is at
<https://scrollfilm.lucianonery.dev>.

The usual ways to do this both break down on phones. Seeking a `<video>`
element stutters, because browsers aren't built to seek on every scroll
event. A sequence of images, the approach Apple's product pages made famous,
means hundreds of separate downloads.

scrollfilm keeps the film as H.264 and decodes it itself with
[WebCodecs](https://developer.mozilla.org/docs/Web/API/WebCodecs_API):

- **Small window:** only the frames around the playhead are decoded, by the
  device's hardware decoder.
- **Straight to the GPU:** each frame goes from the decoder into a WebGL
  texture.
- **Sticky motion:** the film follows the scroll on a spring that never runs
  past what is decoded, so it glides instead of skipping.
- **Fast flicks and long jumps:** the player decodes only keyframes, which
  stand alone, so this works in both directions.

## Measured on a Galaxy A14

These numbers come from real finger swipes (`adb shell input swipe`) on a
low-end Android phone (Helio G80, 60 Hz), with the Residenza Vela film at
864×1536.

"Before" is the same H.264 film when the player decoded every frame the scroll
asked for, drawing through a 2D canvas.

| Swipe | Refreshes with a new image, before | Jump between images (p90), before | scrollfilm: biggest jump | scrollfilm: refreshes stuck while behind |
|---|---|---|---|---|
| slow drag | 73% | 4 frames | 4 frames | 0 |
| medium flick | 16% | 111 frames | 4 frames | 0 |
| flick back | 12% | 176 frames | 4 frames | 0 |

The cost is lag. After a fast scroll the film trails it by up to a second
going forward, and one to two seconds going back, because the phone decodes
about 120 frames a second.

The [how it works](https://git.lucianonery.dev/LucianoNeryDev/scrollfilm/src/branch/master/docs/how-it-works.md) page explains what each change fixed
and how it was measured.

## Quick start

You need ffmpeg (with libx264) to encode, and a browser with WebCodecs to
play: Chrome or Edge 94, Safari 16.4, Firefox 130, or later.

```sh
npm install scrollfilm
npx scrollfilm encode flythrough.mp4 public/film --width 1280
```

This writes `public/film/manifest.json` and the film in parts of at most
16 MiB (`00.bin`, `01.bin`, …).

```html
<section class="track" style="height: 800vh">
  <canvas style="position: sticky; top: 0; width: 100%; height: 100vh"></canvas>
</section>

<script type="module">
  import { Film, supported } from 'scrollfilm';

  const film = new Film(document.querySelector('canvas'));
  if (await supported('/film/manifest.json')) {
    film.load('/film/manifest.json');
    film.follow(document.querySelector('.track'));
  }
</script>
```

`follow()` maps the section's scroll to the film: the first frame shows when
the section's top reaches the top of the screen, and the last frame when its
bottom reaches the bottom. To drive the film yourself, call `film.seek(p)`
with a value from 0 to 1 and then `film.update()` on every animation frame.

## Documentation

- [API](https://git.lucianonery.dev/LucianoNeryDev/scrollfilm/src/branch/master/docs/api.md): the `Film` class, its options and its hooks (overlays,
  progress, a source per orientation).
- [Encoder](https://git.lucianonery.dev/LucianoNeryDev/scrollfilm/src/branch/master/docs/encoder.md): the `scrollfilm encode` options and how to
  choose a size, quality and keyframe interval.
- [How it works](https://git.lucianonery.dev/LucianoNeryDev/scrollfilm/src/branch/master/docs/how-it-works.md): decoding around the playhead,
  keyframe travel, the sticky spring, and the measurements behind each choice.
- [Film format](https://git.lucianonery.dev/LucianoNeryDev/scrollfilm/src/branch/master/docs/format.md): the manifest and the parts, for writing your
  own encoder.

## Demo

```sh
npm run demo:film     # a generated test clip; or: npm run demo:film -- your.mp4 --width 1280
npm run demo          # http://localhost:5173/demo/
```

Add `?debug` to the demo's address to expose the player as `window.film`.
`npm run build:site` puts the demo in `site/` as a static site; a film in
`site/film/portrait/` and `site/film/landscape/` gets one per orientation.

## Tests

```sh
npm test              # unit tests and an ffmpeg encode
npm run test:browser  # the demo in Chromium (WebGL and 2D), Firefox and WebKit, headless
```

## Status

The player has been used in production on one site, and has been measured on
a low-end Android phone and in desktop Chromium, Firefox and WebKit. It hasn't
yet been tried on a real iPhone. It is maintained for our own needs; issues
and pull requests are welcome, with no support commitment.

## License and credit

MIT, © Luciano Nery. If you use it, keep the copyright notice; a credit or a
link to [lucianonery.dev](https://lucianonery.dev) is appreciated.
