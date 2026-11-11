import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFeed } from './decodeFeed.js';

function varint(n) {
  const out = [];
  let x = n;
  while (x > 127) {
    out.push((x % 128) | 0x80);
    x = Math.floor(x / 128);
  }
  out.push(x);
  return Buffer.from(out);
}

function tag(field, wire) {
  return varint((field << 3) | wire);
}

function dbl(n) {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(n);
  return b;
}

function str(s) {
  const raw = Buffer.from(s);
  return Buffer.concat([varint(raw.length), raw]);
}

function msg(parts) {
  const raw = Buffer.concat(parts);
  return Buffer.concat([varint(raw.length), raw]);
}

test('decodes last price and previous close from an ltpc frame', () => {
  const ltpc = msg([tag(1, 1), dbl(110.5), tag(4, 1), dbl(100)]);
  const feed = msg([tag(1, 2), ltpc]);
  const entry = msg([tag(1, 2), str('NSE_EQ|INE002A01018'), tag(2, 2), feed]);
  const frame = Buffer.concat([tag(2, 2), entry, tag(3, 0), varint(1731240000000)]);
  const decoded = decodeFeed(frame);
  assert.equal(decoded.currentTs, 1731240000000);
  assert.equal(decoded.feeds['NSE_EQ|INE002A01018'].ltpc.ltp, 110.5);
  assert.equal(decoded.feeds['NSE_EQ|INE002A01018'].ltpc.cp, 100);
});

test('decodes a frame with several instruments', () => {
  const entry = (k, last, close) =>
    Buffer.concat([tag(2, 2), msg([tag(1, 2), str(k), tag(2, 2), msg([tag(1, 2), msg([tag(1, 1), dbl(last), tag(4, 1), dbl(close)])])])]);
  const frame = Buffer.concat([entry('NSE_EQ|A', 110.5, 100), entry('NSE_EQ|B', 2500.25, 2400), entry('NSE_EQ|C', 77.7, 70), tag(3, 0), varint(1731240000000)]);
  const decoded = decodeFeed(frame);
  assert.equal(decoded.currentTs, 1731240000000);
  assert.deepEqual(Object.keys(decoded.feeds), ['NSE_EQ|A', 'NSE_EQ|B', 'NSE_EQ|C']);
  assert.equal(decoded.feeds['NSE_EQ|B'].ltpc.ltp, 2500.25);
  assert.equal(decoded.feeds['NSE_EQ|C'].ltpc.cp, 70);
});
