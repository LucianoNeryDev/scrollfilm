// H.264 as x264 writes it (Annex B: NAL units after start codes) into what
// WebCodecs wants: one access unit per frame in AVCC form (each NAL unit
// after its 4-byte length) and an avcC record for the decoder's description.

// The NAL units of an Annex B stream, without their start codes.
export function* nalUnits(stream) {
  const starts = [];
  for (let i = 0; ; ) {
    i = stream.indexOf(1, i);
    if (i < 0) break;
    if (i >= 2 && stream[i - 1] === 0 && stream[i - 2] === 0) starts.push(i + 1);
    i++;
  }
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k];
    let end = k + 1 < starts.length ? starts[k + 1] - 3 : stream.length;
    // A four-byte start code leaves a zero at the end of the unit before it.
    while (k + 1 < starts.length && end > s && stream[end - 1] === 0) end--;
    yield stream.subarray(s, end);
  }
}

const TYPE = { slice: 1, idr: 5, sps: 7, pps: 8, aud: 9 };

// Frames from a stream with an access unit delimiter before each frame
// (x264's aud=1): [{ data, key }], plus the first SPS and PPS.
export function accessUnits(stream) {
  const frames = [];
  let sps = null, pps = null, au = null;
  for (const nal of nalUnits(stream)) {
    const type = nal[0] & 0x1f;
    if (type === TYPE.aud) {
      au = { parts: [], key: false };
      frames.push(au);
      continue;
    }
    if (type === TYPE.sps && !sps) sps = nal;
    if (type === TYPE.pps && !pps) pps = nal;
    if (!au) throw new Error('stream has no access unit delimiters (encode with x264 aud=1)');
    if (type === TYPE.idr) au.key = true;
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, nal.length);
    au.parts.push(len, nal);
  }
  if (!sps || !pps) throw new Error('stream has no SPS or PPS');
  return {
    frames: frames.map((f) => ({ data: concat(f.parts), key: f.key })),
    sps,
    pps,
  };
}

// The avcC record (ISO/IEC 14496-15) for one SPS and one PPS, 4-byte lengths.
export function avcC(sps, pps) {
  return concat([
    Uint8Array.of(1, sps[1], sps[2], sps[3], 0xff, 0xe1),
    u16(sps.length), sps,
    Uint8Array.of(1),
    u16(pps.length), pps,
  ]);
}

// The codec string WebCodecs and MSE use: avc1.PPCCLL from the SPS.
export function codecString(sps) {
  return `avc1.${[sps[1], sps[2], sps[3]].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// Frames into parts of at most `max` bytes (a frame larger than that gets a
// part of its own): the index of each part's first frame.
export function cutParts(sizes, max) {
  const first = [0];
  let size = 0;
  sizes.forEach((s, i) => {
    if (size + s > max && size > 0) { first.push(i); size = 0; }
    size += s;
  });
  return first;
}

function u16(n) {
  return Uint8Array.of(n >> 8, n & 0xff);
}

export function concat(arrays) {
  const out = new Uint8Array(arrays.reduce((a, b) => a + b.length, 0));
  let at = 0;
  for (const a of arrays) { out.set(a, at); at += a.length; }
  return out;
}
