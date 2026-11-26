# How it works

scrollfilm was built for the
[Residenza Vela](https://residenza-vela.lucianonery.dev) tour, a 2,399-frame
fly-through rendered in Blender and played over twelve screens of scrolling.
The target device was a Galaxy A14: a low-end Android phone (MediaTek Helio
G85, 60 Hz screen) that many people actually own. Every choice below was
measured on it.

The measurements used real finger swipes (`adb shell input swipe`), not
`scrollBy()` from a script. Scripted scrolling is steady and never hides the
address bar, so it missed the two worst problems.

## The film is a video, decoded by the page

The first version shipped 1,200 separate AVIF images. Even slow scrolling
showed about 12 new images a second, and the download took 107 seconds over
home Wi-Fi.

Seeking a `<video>` element doesn't work well either. A seek decodes from the
nearest keyframe, browsers don't promise when the frame will show, and on
mobile they throttle it.

scrollfilm keeps the film as one H.264 stream and decodes it itself with
WebCodecs' `VideoDecoder`, in hardware where the device has a decoder. The
stream:

- has no B-frames, so frames come out in the order they go in;
- has a keyframe every 16 frames;
- is cut into parts of at most 16 MiB, at frame boundaries.

The whole film downloads up front, starting at the part the scroll is at, so
playback never waits for the network. The Residenza Vela phone film is
109 MB for 2,399 frames at 864×1536. The A14's decoder produces about 120 of
those frames a second.

## Only a window is decoded

Decoding the whole film into memory would take gigabytes. scrollfilm keeps
only a window of frames around the playhead, 14 ahead and 4 behind on a phone,
with the ahead side multiplied by the stride when the scroll is fast.

- **Forward:** the decoder is fed frame after frame.
- **Backward or jumping:** it goes on from the keyframe before the frame
  wanted.

On a jump the player feeds that keyframe to the same decoder instead of
creating a new one. A new hardware decoder took a few hundred milliseconds to
start on the A14, and the picture froze while it did.

Hardware decoders hand out a small pool of output buffers. Keeping even four
frames out of the decoder halved its frame rate on the A14. So every frame is
copied to a texture as soon as it comes out, and handed straight back.

Some decoders hold their last frame until more input arrives. If frames have
been waiting for more than 150 ms with nothing coming out, the player flushes
the decoder.

## Straight to a texture

Copying a `VideoFrame` through a 2D canvas (`drawImage` onto an
`OffscreenCanvas`, then `transferToImageBitmap`) took about 3 ms on the A14.
That capped the film at 35–41 new frames a second. Uploading it with
`texImage2D` into a WebGL2 texture takes about 1.6 ms, which allowed 71–76 a
second.

WebGL also makes blending two frames free: one quad, then another at an
opacity. Where WebGL2 is missing (a blocked GPU), a 2D canvas does the same
job, more slowly.

## Fast flicks decode only keyframes

A flick can cross 30 frames in one refresh. The first version chased the
playhead frame by frame. Every refresh, the target was past what the decoder
could reach, so it restarted at a keyframe and never caught up. The picture
froze for the whole flick, then jumped 100 or more frames when the scroll
settled. On real swipes, 2–16% of refreshes showed a new image during a
flick.

Above 4 frames a refresh, scrollfilm switches to decoding only the keyframes
ahead of the playhead, at most three in the decoder at once. Each keyframe
stands alone, so this works backwards as well. It switches back below
2 frames a refresh. The gap between the two numbers stops it flipping
between the two modes.

## The film is sticky

Even a slow drag on a phone asks for 3–4 frames a refresh, and the A14
decodes 2. Following the scroll exactly meant the picture sometimes stood
still, then caught up 25–60 frames in a single refresh. That reads as a
glitch.

So the film has its own position, measured in frames, which follows the
scroll on a critically damped spring (stiffness 7). Three limits apply:

- **Top speed:** while the scroll is near, the film moves at most 2.2 frames
  a refresh on phones and 4 on larger screens.
- **Decoded frames ahead:** it slows down as it nears the last frame decoded
  ahead of it, easing into a wait rather than stopping dead. A gap of more
  than 3 frames counts as the end of the decoded run.
- **Missed refreshes:** time steps are capped at 50 ms, so a missed refresh
  doesn't make the film jump to catch up.

When the scroll is more than 240 frames ahead (a long flick, a link to a
chapter), the film travels faster, through keyframes. It blends frames up to
16 apart.

The position is counted in frames, not in scroll distance. A timeline can
give a slow stretch of the film more scroll (see `times` in the
[format](format.md)), so equal distances in frames are equal amounts of change
on screen. That keeps the film's speed steady in what you see.

The result on the A14, over three swipes of each kind:

| Swipe | Biggest jump in one refresh, before → after | Refreshes stuck while behind | Backward steps |
|---|---|---|---|
| slow drag | 25 → 4 frames | 0 | 0 |
| medium flick | 60 → 4 frames | 0 | 0 |
| flick back | 45 → 4 frames | 0 | 0 |
| drag back | 33 → 4 frames | 0 | 0 |

The cost is lag. After a fast scroll the film trails the scroll by about
75 frames going forward and up to about 150 going back, which is one to two
seconds. Lower `cruise` or `stiffness` for a stickier film; raise them on
devices that decode faster.

## Small things that mattered

- **Address-bar resizes.** Android Chrome fires `resize` as the address bar
  slides in and out, at the very moment a swipe starts. Resetting the canvas
  then cleared the picture and threw away every decoded frame. The canvas is
  now resized only when its pixel size actually changes. Decoded frames are
  textures at the film's own size, so a resize never discards them.
- **Canvas size.** The canvas never has more pixels than the film. Extra
  pixels cost fill rate on every refresh and add nothing.
- **Level 4.0.** x264 picked level 5.0 for a 1080×1920 film. Hardware
  decoders on older phones stop at 4.0, so the encoder sets it.
- **Parts.** Cloudflare Pages takes files up to 25 MiB, so the film is cut
  into parts of at most 16 MiB. Each part's frames are counted as they
  stream in, so a loading screen can follow the download byte by byte.
