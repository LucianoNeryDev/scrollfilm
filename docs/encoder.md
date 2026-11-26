# Encoder

```sh
npx scrollfilm encode INPUT OUT_DIR [options]
```

`INPUT` is a video file, or an image sequence pattern such as
`renders/%04d.png`. `OUT_DIR` receives `manifest.json` and the film in parts
(`00.bin`, `01.bin`, …). Running it again replaces both.

The encoder needs `ffmpeg` built with libx264 (most builds are), and
`ffprobe`. From Node:

```js
import { encode } from 'scrollfilm/encoder';
const manifest = await encode('flythrough.mp4', 'public/film', { width: 1280, crf: 22 });
```

## Options

| Option | Default | Meaning |
|---|---|---|
| `--width`, `--height` | the input's | The output size. Given only one, the other keeps the aspect. |
| `--crf` | `20` | The x264 quality setting. Lower is sharper and larger: each step of 6 roughly doubles or halves the size. |
| `--gop` | `16` | Frames between keyframes. See below. |
| `--preset` | `slower` | The x264 preset. Slower presets give smaller files at the same quality; `veryfast` is fine for trials. |
| `--level` | `4.0` | The H.264 level. Older phones' hardware decoders stop at 4.0, which allows up to 1920×1080 or 1080×1920. |
| `--part-mb` | `16` | The largest part, in MiB. Cloudflare Pages takes files up to 25 MiB; other hosts and CDNs have their own limits. |
| `--fps` | `30` | The frame rate of an image sequence. It changes nothing in playback: the scroll is the clock. |
| `--start`, `--duration`, `--frames` | | Use part of the input. |
| `--times FILE` | even | A JSON array giving each frame's place in the scroll, from 0 to 1, rising. |

## Choosing the settings

**Size.** The canvas never draws more pixels than the film has, and a phone
canvas rarely needs more than two pixels per CSS pixel. A portrait phone is
about 430 CSS pixels wide, so 864×1536 is enough. Each step down in
resolution saves bandwidth and decode time: on a Galaxy A14, 720×1280
decoded 15–25% faster than 864×1536 and was 28% smaller. If the page looks
very different in portrait and landscape, encode one film for each and load
the one that fits.

**Keyframe interval.** Scrolling back, or jumping, the decoder restarts at the
keyframe before the frame it needs and decodes forward. A `--gop` of 16 means
at most 15 extra frames. During a fast flick the player decodes only the
keyframes, so the gap between them is the step the picture moves by when it
travels. Smaller intervals make both cheaper and the file larger. 16 was a
good balance for a 2,400-frame fly-through.

**Frame count and length.** The scroll sets the pace, not the clock, so what
matters is how much the picture changes between frames. A fly-through played
over 12 screens of scrolling looked smooth with about 200 frames per screen.
If the camera moves unevenly, either render more frames where it moves fast
or pass `--times`, so a stretch where little changes takes up less of the
scroll.

## What it does

ffmpeg scales the input and converts it to BT.709 limited-range 4:2:0. x264
then encodes it with:

- no B-frames, so frames decode in the order they show;
- a fixed keyframe interval, with no scene-cut keyframes;
- an access unit delimiter before every frame.

The encoder splits the stream at those delimiters into one access unit per
frame. It rewrites each access unit from start codes to 4-byte lengths, the
AVCC form WebCodecs expects. It builds the `avcC` decoder configuration from
the stream's SPS and PPS. Then it cuts the frames into parts, at frame
boundaries, and writes the [manifest](format.md).
