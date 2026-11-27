// Fragmented MP4 for Media Source Extensions: an init segment from the
// film's avcC, and one fragment per run of frames. Only what a single H.264
// track with no B-frames needs (ISO/IEC 14496-12 and 14496-15).

export const TIMESCALE = 30000;
export const TICKS = 1000; // a frame lasts 1/30 s; the scroll is the clock

const u8 = (...a) => Uint8Array.from(a);
function u16(v) { return u8(v >> 8 & 255, v & 255); }
function u32(v) { return u8(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255); }
function u64(v) { return [u32(Math.floor(v / 2 ** 32)), u32(v >>> 0)]; }
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const zeros = (n) => new Uint8Array(n);

function concat(parts) {
  const flat = parts.flat(Infinity);
  const out = new Uint8Array(flat.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of flat) { out.set(p, at); at += p.length; }
  return out;
}

function box(type, ...body) {
  const content = concat(body);
  return concat([u32(content.length + 8), ascii(type), content]);
}
const full = (type, version, flags, ...body) => box(type, u8(version, flags >> 16 & 255, flags >> 8 & 255, flags & 255), ...body);
const MATRIX = [u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)];

// The init segment: ftyp and a moov with one video track and no samples.
export function initSegment({ width, height, avcC }) {
  const avc1 = box('avc1',
    zeros(6), u16(1), // reserved, data reference index
    zeros(16), u16(width), u16(height),
    u32(0x480000), u32(0x480000), zeros(4), u16(1), // 72 dpi, one frame per sample
    zeros(32), u16(0x18), u16(0xffff),
    box('avcC', avcC));
  const stbl = box('stbl',
    full('stsd', 0, 0, u32(1), avc1),
    full('stts', 0, 0, u32(0)),
    full('stsc', 0, 0, u32(0)),
    full('stsz', 0, 0, u32(0), u32(0)),
    full('stco', 0, 0, u32(0)));
  const minf = box('minf',
    full('vmhd', 0, 1, zeros(8)),
    box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
    stbl);
  const mdia = box('mdia',
    full('mdhd', 0, 0, zeros(8), u32(TIMESCALE), u32(0), u16(0x55c4), u16(0)), // language: und
    full('hdlr', 0, 0, u32(0), ascii('vide'), zeros(12), ascii('video\0')),
    minf);
  const trak = box('trak',
    full('tkhd', 0, 3, zeros(8), u32(1), zeros(4), u32(0), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX,
      u32(width * 65536), u32(height * 65536)),
    mdia);
  const moov = box('moov',
    full('mvhd', 0, 0, zeros(8), u32(TIMESCALE), u32(0), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)),
    trak,
    box('mvex', full('trex', 0, 0, u32(1), u32(1), u32(0), u32(0), u32(0))));
  return concat([box('ftyp', ascii('isom'), u32(0x200), ascii('isomiso6avc1mp41')), moov]);
}

// A fragment of frames first..first + samples.length - 1, back to back in
// data. samples: [{ size, key }]. Frame i plays from i * TICKS.
export function fragment(seq, first, samples, data) {
  const trun = (offset) => full('trun', 0, 0x000701, u32(samples.length), u32(offset),
    samples.map((s) => [u32(TICKS), u32(s.size), u32(s.key ? 0x02000000 : 0x01010000)]));
  const traf = (offset) => box('traf',
    full('tfhd', 0, 0x020000, u32(1)), // default-base-is-moof
    full('tfdt', 1, 0, u64(first * TICKS)),
    trun(offset));
  const moofOf = (offset) => box('moof', full('mfhd', 0, 0, u32(seq)), traf(offset));
  const size = moofOf(0).length;
  return concat([moofOf(size + 8), u32(data.length + 8), ascii('mdat'), data]);
}
