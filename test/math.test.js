import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bracket, decodedAhead, evenTimes, firstKey, fitRect, framePos, keyBefore, spring, timeAt,
} from '../src/math.js';

test('framePos and timeAt invert each other on uneven times', () => {
  const times = [0, 0.1, 0.15, 0.5, 0.9, 1];
  for (const x of [0, 0.5, 1, 2.25, 3.7, 5]) assert.ok(Math.abs(framePos(times, timeAt(times, x)) - x) < 1e-9);
  assert.equal(framePos(times, -1), 0);
  assert.equal(framePos(times, 2), 5);
  assert.equal(framePos(times, 0.125), 1.5);
});

test('evenTimes spans 0 to 1', () => {
  assert.deepEqual(evenTimes(5), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(evenTimes(1), [0]);
});

test('bracket finds the decoded frames either side', () => {
  const has = (i) => [3, 4, 9].includes(i);
  assert.deepEqual(bracket(has, 5.5, 10), [4, 9]);
  assert.deepEqual(bracket(has, 4, 10), [4, 4]);
  assert.deepEqual(bracket(has, 10, 10), [9, -1]);
  assert.deepEqual(bracket(has, 5.5, 2), [4, -1]);
});

test('decodedAhead stops at a gap wider than hold', () => {
  const set = new Set([10, 11, 12, 14, 15, 20]);
  const has = (i) => set.has(i);
  assert.equal(decodedAhead(has, 10.5, 1, 3, 100), 4.5); // 14, 15 then a gap of 4
  assert.equal(decodedAhead(has, 12, -1, 3, 100), 2);
  assert.equal(decodedAhead(has, 50, 1, 3, 100), Infinity); // nothing near: no limit
  assert.equal(decodedAhead(has, 10, 0, 3, 100), 0);
});

test('keyframes around a frame', () => {
  const keys = [0, 16, 32, 48];
  assert.equal(keys[firstKey(keys, 20, 1)], 32);
  assert.equal(keys[firstKey(keys, 20, -1)], 16);
  assert.equal(keys[firstKey(keys, 32, -1)], 32);
  assert.equal(firstKey(keys, 60, 1), 4);
  assert.equal(keyBefore(keys, 31), 16);
  assert.equal(keyBefore(keys, 0), 0);
});

test('spring eases to the target without passing the speed cap', () => {
  let view = 0, speed = 0, top = 0;
  for (let k = 0; k < 600; k++) {
    [view, speed] = spring(view, speed, 100, 1 / 60, 7, 132);
    top = Math.max(top, Math.abs(speed));
  }
  assert.equal(view, 100);
  assert.ok(top <= 132);
});

test('a missed refresh moves the film no more than a 20 Hz one', () => {
  const [a] = spring(0, 132, 1000, 0.5, 7, 132);
  assert.ok(a <= 132 / 20 + 1e-9);
});

test('fitRect covers and contains', () => {
  assert.deepEqual(fitRect(100, 100, 200, 100), { x: -50, y: 0, w: 200, h: 100 });
  assert.deepEqual(fitRect(100, 100, 200, 100, 'contain'), { x: 0, y: 25, w: 100, h: 50 });
});
