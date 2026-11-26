// Makes the demo's film: node scripts/demo-film.js [INPUT] [--width N] ...
// With no input it generates a test clip with ffmpeg (a counter and colour
// bars, so every frame is easy to tell apart). Options go to the encoder.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
let input = args[0] && !args[0].startsWith('--') ? args.shift() : null;
let tmp = null;
if (!input) {
  tmp = mkdtempSync(join(tmpdir(), 'scrollfilm-demo-'));
  input = join(tmp, 'clip.mp4');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=20',
    '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', input], { stdio: 'inherit' });
  if (r.status) process.exit(r.status);
}
const out = new URL('../demo/film', import.meta.url).pathname;
const r = spawnSync(process.execPath, [new URL('../bin/scrollfilm.js', import.meta.url).pathname, 'encode', input, out, ...args], { stdio: 'inherit' });
if (tmp) rmSync(tmp, { recursive: true, force: true });
process.exit(r.status ?? 1);
