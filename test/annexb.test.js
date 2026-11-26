import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessUnits, avcC, codecString, concat, cutParts, nalUnits } from '../src/encoder/annexb.js';

const SC3 = [0, 0, 1], SC4 = [0, 0, 0, 1];
const SPS = Uint8Array.of(0x67, 0x64, 0x00, 0x28, 0xac);
const PPS = Uint8Array.of(0x68, 0xee, 0x3c);
const AUD = Uint8Array.of(0x09, 0xf0);
const IDR = Uint8Array.of(0x65, 0x88, 0x84);
const P1 = Uint8Array.of(0x41, 0x9a, 0x00, 0x02);
const stream = concat([
  Uint8Array.from(SC4), AUD, Uint8Array.from(SC4), SPS, Uint8Array.from(SC4), PPS, Uint8Array.from(SC3), IDR,
  Uint8Array.from(SC4), AUD, Uint8Array.from(SC3), P1,
]);

test('nalUnits splits on 3- and 4-byte start codes', () => {
  const units = [...nalUnits(stream)].map((u) => [...u]);
  assert.deepEqual(units, [[...AUD], [...SPS], [...PPS], [...IDR], [...AUD], [...P1]]);
});

test('accessUnits gives one AVCC frame per delimiter', () => {
  const { frames, sps, pps } = accessUnits(stream);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].key, true);
  assert.equal(frames[1].key, false);
  // The first frame carries SPS, PPS and the IDR slice, each after its length.
  assert.deepEqual([...frames[0].data.subarray(0, 9)], [0, 0, 0, 5, ...SPS]);
  assert.equal(frames[0].data.length, 3 * 4 + SPS.length + PPS.length + IDR.length);
  assert.deepEqual([...frames[1].data], [0, 0, 0, 4, ...P1]);
  assert.deepEqual([...sps], [...SPS]);
  assert.deepEqual([...pps], [...PPS]);
});

test('avcC and the codec string come from the SPS', () => {
  const rec = avcC(SPS, PPS);
  assert.deepEqual([...rec.subarray(0, 8)], [1, 0x64, 0x00, 0x28, 0xff, 0xe1, 0, 5]);
  assert.equal(rec.length, 6 + 2 + SPS.length + 1 + 2 + PPS.length);
  assert.equal(codecString(SPS), 'avc1.640028');
});

test('a stream without delimiters is refused', () => {
  assert.throws(() => accessUnits(concat([Uint8Array.from(SC4), SPS, Uint8Array.from(SC4), PPS, Uint8Array.from(SC4), IDR])), /delimiters/);
});

test('cutParts keeps parts under the limit', () => {
  assert.deepEqual(cutParts([4, 4, 4, 4, 4], 10), [0, 2, 4]);
  assert.deepEqual(cutParts([12, 1, 1], 10), [0, 1]); // an oversized frame alone
});
