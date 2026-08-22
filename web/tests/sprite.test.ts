import assert from 'node:assert';
import { encodeFrame, decodeFrame } from '../src/face/sprite';
import type { SpriteFrame } from '../src/face/sprite';

const pal = ['#FFFFFF', '#FF99CC'];

function roundtrip(f: SpriteFrame) {
  const doc = encodeFrame(f);
  const back = decodeFrame(doc);
  assert.ok(back, 'decodes');
  assert.equal(back!.w, f.w);
  assert.equal(back!.h, f.h);
  assert.deepEqual(back!.palette, f.palette);
  assert.deepEqual([...back!.pixels], [...f.pixels]);
  return doc;
}

// all-transparent 24x24: long runs, tiny payload
const blank = { w: 24, h: 24, palette: pal, pixels: new Uint8Array(24 * 24) };
const blankDoc = roundtrip(blank);
assert.equal(atob(blankDoc.data).length, 36, 'blank 24x24 = 576/16 RLE bytes');

// worst case: alternating indices, no runs
const noise = new Uint8Array(24 * 24).map((_, i) => (i % 2) + 1);
roundtrip({ w: 24, h: 24, palette: pal, pixels: noise });

// runs crossing row boundaries + run exactly 16 + run of 17 (16+1 split)
const px = new Uint8Array(8 * 4).fill(1, 0, 17).fill(2, 17, 32);
roundtrip({ w: 8, h: 4, palette: pal, pixels: px });

// typical sprite stays under the design budget
const eye = new Uint8Array(24 * 24);
for (let y = 6; y < 18; y++) for (let x = 4; x < 20; x++) eye[y * 24 + x] = 1;
const eyeDoc = roundtrip({ w: 24, h: 24, palette: pal, pixels: eye });
assert.ok(JSON.stringify(eyeDoc).length < 400, 'typical frame under 400B');

// 1x1 min and 48x48 max dims
roundtrip({ w: 1, h: 1, palette: pal, pixels: new Uint8Array([1]) });
roundtrip({ w: 48, h: 48, palette: pal, pixels: new Uint8Array(48 * 48).fill(2) });

// overlay dims (P6v2): 80x60 valid with the wider limits, rejected without
const ovFrame = { w: 80, h: 60, palette: pal, pixels: new Uint8Array(80 * 60).fill(1) };
const ovDoc = encodeFrame(ovFrame, 80, 60);
assert.deepEqual(decodeFrame(ovDoc, 80, 60)?.pixels, ovFrame.pixels);
assert.throws(() => encodeFrame(ovFrame));
assert.equal(decodeFrame(ovDoc), null, 'part-sized limits reject overlay dims');

// encode rejects bad input
assert.throws(() => encodeFrame({ w: 49, h: 1, palette: pal, pixels: new Uint8Array(49) }));
assert.throws(() => encodeFrame({ w: 2, h: 2, palette: pal, pixels: new Uint8Array([0, 3, 0, 0]) }));
assert.throws(() => encodeFrame({ w: 2, h: 2, palette: pal, pixels: new Uint8Array(3) }));

// decode rejects malformed docs
const good = encodeFrame(blank);
assert.equal(decodeFrame(null), null);
assert.equal(decodeFrame({ ...good, w: 0 }), null);
assert.equal(decodeFrame({ ...good, palette: ['nope'] }), null);
assert.equal(decodeFrame({ ...good, data: '!!!' }), null);
assert.equal(decodeFrame({ ...good, data: good.data + good.data }), null, 'run total > w*h');
assert.equal(decodeFrame({ ...good, data: good.data.slice(0, 4) }), null, 'run total < w*h');
assert.equal(decodeFrame({ ...good, data: btoa('\x1f'.repeat(18)) }), null, 'index out of palette');

console.log('sprite codec ok');
