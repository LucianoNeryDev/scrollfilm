// Encodes a video or an image sequence into a film: ffmpeg and x264 make the
// H.264, this cuts it into frames and parts and writes the manifest.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { accessUnits, avcC, codecString, concat, cutParts } from './annexb.js';

export const ENCODE_DEFAULTS = Object.freeze({
  crf: 20, // x264 quality: lower is better and larger
  gop: 16, // frames between keyframes: going back decodes at most this many
  preset: 'slower',
  level: '4.0', // hardware decoders on older phones stop at 4.0
  partBytes: 16 << 20, // Cloudflare Pages takes files up to 25 MiB
  fps: 30, // only matters for image sequences; the film has no time of its own
  width: 0, // 0: the input's size; one of them 0 keeps the aspect
  height: 0,
  start: 0, // seconds into the input
  duration: 0, // seconds of it, 0 for all
  frames: 0, // frames at most, 0 for all
});

// The ffmpeg arguments for an input: an image pattern (frames/%04d.png) is
// read as a sequence.
export function ffmpegArgs(input, o) {
  const args = ['-v', 'error', '-nostdin', '-y'];
  if (/%\d*d/.test(input)) args.push('-framerate', String(o.fps));
  if (o.start) args.push('-ss', String(o.start));
  if (o.duration) args.push('-t', String(o.duration));
  args.push('-i', input);
  if (o.frames) args.push('-frames:v', String(o.frames));
  const w = o.width || (o.height ? -2 : 0), h = o.height || (o.width ? -2 : 0);
  const scale = w || h ? `scale=${w}:${h}:flags=lanczos:` : 'scale=';
  args.push(
    '-an', '-vf', `${scale}out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    '-c:v', 'libx264', '-preset', o.preset, '-level:v', o.level, '-crf', String(o.crf),
    // No B-frames: frames decode in the order they show. A keyframe every
    // gop frames, never more, never fewer.
    '-g', String(o.gop), '-keyint_min', String(o.gop), '-sc_threshold', '0', '-bf', '0',
    '-x264-params', 'aud=1',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-f', 'h264', '-',
  );
  return args;
}

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    if (input) { p.stdin.on('error', () => {}); p.stdin.end(input); }
    const out = [], err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', (e) => reject(e.code === 'ENOENT' ? new Error(`${cmd} not found: install ffmpeg (with libx264)`) : e));
    p.on('close', (code) => (code ? reject(new Error(`${cmd} failed: ${Buffer.concat(err).toString().trim()}`)) : resolve(Buffer.concat(out))));
  });
}

// An Annex B stream into the film's files under dir. Returns the manifest.
export async function writeFilm(stream, dir, { partBytes = ENCODE_DEFAULTS.partBytes, times } = {}) {
  const { frames, sps, pps } = accessUnits(new Uint8Array(stream.buffer, stream.byteOffset, stream.length));
  if (!frames.length) throw new Error('no frames in the stream');
  if (!frames[0].key) throw new Error('the first frame is not a keyframe');
  const sizes = frames.map((f) => f.data.length);
  const parts = cutParts(sizes, partBytes);
  await mkdir(dir, { recursive: true });
  for (const old of await readdir(dir)) if (/^\d+\.bin$/.test(old)) await rm(join(dir, old));
  const hash = createHash('sha1');
  for (let p = 0; p < parts.length; p++) {
    const data = concat(frames.slice(parts[p], parts[p + 1] ?? frames.length).map((f) => f.data));
    hash.update(data);
    await writeFile(join(dir, `${String(p).padStart(2, '0')}.bin`), data);
  }
  // The frame size is filled in by encode(), from the stream.
  const manifest = {
    format: 'scrollfilm',
    version: 1,
    codec: codecString(sps),
    description: Buffer.from(avcC(sps, pps)).toString('base64'),
    width: 0,
    height: 0,
    parts,
    sizes,
    keys: frames.flatMap((f, i) => (f.key ? [i] : [])),
    v: hash.digest('hex').slice(0, 10),
  };
  if (times) {
    if (times.length !== frames.length) throw new Error(`${times.length} times for ${frames.length} frames`);
    manifest.times = times;
  }
  return manifest;
}

// The frame size of an H.264 stream, as ffprobe reads it from the SPS.
async function streamSize(stream) {
  const out = await run('ffprobe', ['-v', 'error', '-f', 'h264', '-i', 'pipe:0',
    '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0'], stream);
  return out.toString().trim().split('\n')[0].split(',').map(Number);
}

export async function encode(input, dir, options = {}) {
  const o = { ...ENCODE_DEFAULTS, ...options };
  const stream = await run('ffmpeg', ffmpegArgs(input, o));
  const [width, height] = await streamSize(stream);
  const manifest = await writeFilm(stream, dir, { partBytes: o.partBytes, times: o.times });
  manifest.width = width;
  manifest.height = height;
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}
