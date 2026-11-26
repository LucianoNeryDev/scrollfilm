# Contributing

Issues and pull requests are welcome. The project is maintained for our own
needs, so there is no support commitment, but bug reports with a device and a
browser version are read.

## Working on it

```sh
npm install                # only the dev dependency (Playwright)
npm test                   # unit tests and an ffmpeg encode
npm run demo:film          # a test film for the demo
npm run demo               # http://localhost:5173/demo/
npx playwright install chromium firefox webkit
npm run test:browser       # the demo in three engines, headless
```

## Rules

- The library stays dependency-free plain ES modules, with no build step.
- Keep the pure logic (positions, windows, the spring) in `src/math.js` with
  unit tests. Browser-only code goes in `src/film.js`, `src/renderer.js` and
  `src/source.js`.
- Any change to playback is measured, ideally on a low-end phone with real
  swipes. Put the numbers in the pull request, and in `docs/how-it-works.md`
  when they change a decision.
- Comments explain why, in plain sentences; the code says what.
- Update `CHANGELOG.md` under `[Unreleased]` for anything a user would notice.
