import assert from 'node:assert';
import { emptyFrame, flipH, squashV, resizeFrame, floodFill, lineCells } from '../src/face/spriteOps';

const pal = ['#FFFFFF', '#FF99CC'];

// flipH mirrors and is its own inverse
const f = emptyFrame(4, 2, pal);
f.pixels.set([1, 0, 0, 2, 0, 1, 2, 0]);
assert.deepEqual([...flipH(f).pixels], [2, 0, 0, 1, 0, 2, 1, 0]);
assert.deepEqual([...flipH(flipH(f)).pixels], [...f.pixels]);

// squashV: full-height column becomes a ~30% band centered on the canvas
const tall = emptyFrame(2, 10, pal);
for (let y = 0; y < 10; y++) tall.pixels[y * 2] = 1;
const sq = squashV(tall);
const rows = [];
for (let y = 0; y < 10; y++) if (sq.pixels[y * 2]) rows.push(y);
assert.deepEqual(rows, [3, 4, 5], 'three centered rows');
assert.equal(sq.pixels[3 * 2 + 1], 0, 'right column stays empty');

// resizeFrame pads centered, then crops back to the original content
const small = emptyFrame(2, 2, pal);
small.pixels.set([1, 2, 2, 1]);
const grown = resizeFrame(small, 4, 4);
assert.equal(grown.pixels[1 * 4 + 1], 1);
assert.equal(grown.pixels[2 * 4 + 2], 1);
const back = resizeFrame(grown, 2, 2);
assert.deepEqual([...back.pixels], [...small.pixels]);
assert.equal(resizeFrame(small, 99, 0).w, 48, 'clamped to sprite dims');

// floodFill: bounded region only; no-op when target == fill index
const ff = emptyFrame(3, 3, pal);
ff.pixels.set([1, 1, 1, 1, 0, 1, 1, 1, 1]);
const filled = floodFill(ff, 1, 1, 2);
assert.deepEqual([...filled.pixels], [1, 1, 1, 1, 2, 1, 1, 1, 1]);
assert.equal(floodFill(ff, 0, 0, 1), ff, 'same-index fill returns frame as-is');
const all = floodFill(ff, 0, 0, 2);
assert.deepEqual([...all.pixels], [2, 2, 2, 2, 0, 2, 2, 2, 2], 'ring filled, hole untouched');

// lineCells: contiguous, endpoints included
const cells = lineCells(0, 0, 3, 2);
assert.deepEqual(cells[0], [0, 0]);
assert.deepEqual(cells[cells.length - 1], [3, 2]);
for (let i = 1; i < cells.length; i++) {
  const [ax, ay] = cells[i - 1], [bx, by] = cells[i];
  assert.ok(Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1, 'no gaps');
}

console.log('spriteOps ok');
