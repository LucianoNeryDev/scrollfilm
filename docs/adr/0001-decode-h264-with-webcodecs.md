# 1. Decode an H.264 stream with WebCodecs, not a <video> or an image sequence

Status: accepted, 2026-11-26

## Context

A film scrubbed by the scroll needs any frame, in either direction, within a
screen refresh, on low-end phones. The two usual ways to get it are:

- seeking a `<video>` element, which stutters on every scroll because
  browsers don't promise when a seek's frame will show, and throttle it on
  phones;
- an image sequence, which on the Residenza Vela tour meant 1,200 AVIF
  downloads, 107 s to load on home Wi-Fi and about 12 new images a second on
  a Galaxy A14.

## Decision

Encode the film as one H.264 stream (no B-frames, a keyframe every 16 frames,
level 4.0), cut into parts at frame boundaries. Decode it in the page with
WebCodecs' `VideoDecoder`, keeping only a window of frames around the
playhead, and upload each frame to a WebGL texture as soon as it is out.

## Consequences

- The browser needs WebCodecs: Chrome and Edge 94, Safari 16.4, Firefox 130
  or later. Older browsers get nothing, so pages should check `supported()`
  and show a fallback.
- H.264 is the codec with hardware decoding nearly everywhere. AV1 or HEVC
  would be smaller, but many phones would decode them in software.
- The whole film downloads before it plays smoothly everywhere. A long film
  means a long wait, which a site has to cover, for example with an opening
  sequence.
- The player owns decoding, so it has to handle decoders that hold frames,
  stall or die. It flushes, restarts, and reports an error after five
  failures.
