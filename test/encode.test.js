// Encodes a generated clip with the real ffmpeg; skipped where there is none.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encode } from '../src/encoder/encode.js';

const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('encodes a clip into parts with a keyframe every gop frames', { skip: !ffmpeg && 'no ffmpeg' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scrollfilm-'));
  try {
    const clip = join(dir, 'clip.mp4');
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=3', clip]);
    assert.equal(r.status, 0, String(r.stderr));
    const out = join(dir, 'film');
    const film = await encode(clip, out, { width: 160, gop: 8, partBytes: 20000, preset: 'veryfast' });
    assert.equal(film.sizes.length, 90);
    assert.deepEqual(film.keys, Array.from({ length: 12 }, (_, i) => i * 8).filter((k) => k < 90));
    assert.equal(film.width, 160);
    assert.equal(film.height, 120);
    assert.match(film.codec, /^avc1\.[0-9a-f]{6}$/);
    const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest, film);
    const bins = (await readdir(out)).filter((f) => f.endsWith('.bin')).sort();
    assert.equal(bins.length, film.parts.length);
    let total = 0;
    for (const [p, name] of bins.entries()) {
      const size = (await stat(join(out, name))).size;
      const end = film.parts[p + 1] ?? film.sizes.length;
      assert.equal(size, film.sizes.slice(film.parts[p], end).reduce((a, b) => a + b, 0));
      total += size;
    }
    assert.equal(total, film.sizes.reduce((a, b) => a + b, 0));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
