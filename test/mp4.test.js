import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TICKS, fragment, initSegment } from '../src/mp4.js';

// Reads a list of boxes: [{ type, start, size, body }].
function boxes(buf, from = 0, to = buf.length) {
  const out = [];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let at = from; at < to;) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(...buf.subarray(at + 4, at + 8));
    assert.ok(size >= 8 && at + size <= to, `${type} fits its parent`);
    out.push({ type, start: at, size, body: [at + 8, at + size] });
    at += size;
  }
  return out;
}
const child = (buf, box, type, skip = 0) => boxes(buf, box.body[0] + skip, box.body[1]).find((b) => b.type === type);

test('the init segment nests the boxes a video track needs', () => {
  const avcC = Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe0, 0]);
  const init = initSegment({ width: 864, height: 1536, avcC });
  assert.deepEqual(boxes(init).map((b) => b.type), ['ftyp', 'moov']);
  const moov = boxes(init)[1];
  assert.deepEqual(boxes(init, ...moov.body).map((b) => b.type), ['mvhd', 'trak', 'mvex']);
  const trak = child(init, moov, 'trak');
  const stbl = child(init, child(init, child(init, trak, 'mdia'), 'minf'), 'stbl');
  const stsd = child(init, stbl, 'stsd');
  const avc1 = child(init, stsd, 'avc1', 8); // after version, flags and the entry count
  const view = new DataView(init.buffer);
  assert.equal(view.getUint16(avc1.body[0] + 24), 864);
  assert.equal(view.getUint16(avc1.body[0] + 26), 1536);
  const avcCBox = child(init, avc1, 'avcC', 78); // after the visual sample entry fields
  assert.deepEqual([...init.subarray(...avcCBox.body)], [...avcC]);
});

test('a fragment points its samples at the bytes in mdat', () => {
  const data = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const frag = fragment(7, 32, [{ size: 5, key: true }, { size: 4, key: false }], data);
  const [moof, mdat] = boxes(frag);
  assert.equal(moof.type, 'moof');
  assert.equal(mdat.type, 'mdat');
  assert.deepEqual([...frag.subarray(...mdat.body)], [...data]);
  const view = new DataView(frag.buffer);
  assert.equal(view.getUint32(child(frag, moof, 'mfhd').body[0] + 4), 7);
  const traf = child(frag, moof, 'traf');
  const tfdt = child(frag, traf, 'tfdt');
  assert.equal(view.getUint32(tfdt.body[0] + 8), 32 * TICKS); // low word of the 64-bit time
  const trun = child(frag, traf, 'trun');
  const t = trun.body[0];
  assert.equal(view.getUint32(t + 4), 2); // samples
  assert.equal(moof.start + view.getUint32(t + 8), mdat.body[0]); // data offset, from moof
  assert.deepEqual([view.getUint32(t + 12), view.getUint32(t + 16), view.getUint32(t + 20)], [TICKS, 5, 0x02000000]);
  assert.deepEqual([view.getUint32(t + 24), view.getUint32(t + 28), view.getUint32(t + 32)], [TICKS, 4, 0x01010000]);
});
