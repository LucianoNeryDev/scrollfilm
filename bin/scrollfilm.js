#!/usr/bin/env node
// scrollfilm encode INPUT OUT_DIR [options]: a video or an image sequence into
// a film the player can scrub. Needs ffmpeg (with libx264) and ffprobe.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { encode, ENCODE_DEFAULTS } from '../src/encoder/encode.js';

const HELP = `Usage: scrollfilm encode INPUT OUT_DIR [options]

INPUT is a video file or an image sequence pattern such as frames/%04d.png.
OUT_DIR gets manifest.json and the film in parts (00.bin, 01.bin, ...).

Options:
  --width N        output width (keeps the aspect if --height is not given)
  --height N       output height
  --crf N          x264 quality, lower is better and larger (default ${ENCODE_DEFAULTS.crf})
  --gop N          frames between keyframes (default ${ENCODE_DEFAULTS.gop})
  --preset NAME    x264 preset (default ${ENCODE_DEFAULTS.preset})
  --level L        H.264 level (default ${ENCODE_DEFAULTS.level})
  --part-mb N      largest part in MiB (default ${ENCODE_DEFAULTS.partBytes >> 20})
  --fps N          frame rate of an image sequence (default ${ENCODE_DEFAULTS.fps})
  --start S        seconds into the input to start at
  --duration S     seconds of the input to use
  --frames N       frames at most
  --times FILE     JSON array: each frame's place in the scroll, 0 to 1, rising
  -h, --help       this help
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    width: { type: 'string' }, height: { type: 'string' }, crf: { type: 'string' }, gop: { type: 'string' },
    preset: { type: 'string' }, level: { type: 'string' }, 'part-mb': { type: 'string' }, fps: { type: 'string' },
    start: { type: 'string' }, duration: { type: 'string' }, frames: { type: 'string' }, times: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, input, out] = positionals;
if (values.help || command !== 'encode' || !input || !out) {
  process.stdout.write(HELP);
  process.exit(values.help ? 0 : 1);
}

const num = (k) => (values[k] === undefined ? undefined : Number(values[k]));
const options = Object.fromEntries(Object.entries({
  width: num('width'), height: num('height'), crf: num('crf'), gop: num('gop'), preset: values.preset,
  level: values.level, fps: num('fps'), start: num('start'), duration: num('duration'), frames: num('frames'),
  partBytes: values['part-mb'] ? Math.round(Number(values['part-mb']) * (1 << 20)) : undefined,
}).filter(([, v]) => v !== undefined));
if (values.times) options.times = JSON.parse(await readFile(values.times, 'utf8'));

try {
  const t0 = Date.now();
  const m = await encode(input, out, options);
  const bytes = m.sizes.reduce((a, b) => a + b, 0);
  console.log(`${out}: ${m.sizes.length} frames at ${m.width}x${m.height}, ${m.keys.length} keyframes, `
    + `${m.parts.length} parts, ${(bytes / 1e6).toFixed(1)} MB (${m.codec}) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
} catch (e) {
  console.error(`scrollfilm: ${e.message}`);
  process.exit(1);
}
