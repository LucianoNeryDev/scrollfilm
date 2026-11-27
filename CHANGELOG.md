# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The demo site could go on running the previous release's scripts for hours,
  where the host told browsers to keep `.js` files (Firefox for Android kept
  showing the old "needs WebCodecs" error after 0.3.0). `npm run build:site`
  now puts the scripts and the library in a folder named by a hash of their
  content, so each change has new addresses.

## [0.3.0] - 2026-11-27

### Added

- Playback without WebCodecs, for Firefox for Android: the film's parts go
  through Media Source Extensions to a `<video>` placed under the canvas,
  which plays forward and seeks back. `playback(source)` says which way a
  browser plays a film; `forceVideo` and `groups` options;
  `film.state().backend`.

### Changed

- `supported()` is also `true` where only the `<video>` path works.

### Fixed

- The docs named the test phone's chip as a Helio G85; it is a Helio G80.

## [0.2.0] - 2026-11-27

### Added

- `settle` option: how long the scroll must stand still before the film comes
  to rest on a whole frame (120 ms).
- `npm run build:site` assembles the demo as a static site in `site/`, with
  long-lived caching for the film's parts.

### Changed

- Published to npm: `npm install scrollfilm`.

### Fixed

- A film at rest showed two frames blended when the scroll stopped between
  them, which looked blurred. It now comes to rest on the nearest whole frame,
  decoded and drawn alone.
- CI runs on pushes to `master`, the default branch.

## [0.1.0] - 2026-11-26

### Added

- `Film`: plays an H.264 film scrubbed by the scroll. It decodes a window of
  frames around the playhead with WebCodecs, uploads them to WebGL2 textures
  (with a 2D canvas fallback), and moves the film after the scroll on a spring
  limited by what is decoded. Fast scrolls and long jumps travel through
  keyframes.
- `follow()` to drive a film from an element's scroll, `seek()` and
  `update()` to drive it yourself, overlay, progress and draw hooks, and
  switching between films (one per orientation).
- `scrollfilm encode`: a video or an image sequence into a film, through
  ffmpeg and x264, with parts sized for static hosts.
- A demo page, unit tests, an ffmpeg encode test and a headless browser test
  in Chromium, Firefox and WebKit.
