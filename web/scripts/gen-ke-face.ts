// Generates faces/ke.json — the "Ke" face, a faithful port of the hand-coded
// m5avatar face from keke_firmware v4 (rect eyes 28x10, long thin mouth, no
// brows at rest; brows + comic marks appear per expression). The comic marks
// (anger 💢 / Zzz / ?) that used to be firmware-drawn decorations live in the
// v2.1 per-expression pixel overlay instead.
//
// Run from web/:
//   npx esbuild scripts/gen-ke-face.ts --bundle --format=esm --platform=node \
//     | node --input-type=module -- [header-out-path]
// With a header path argument it also emits a C header embedding the compact
// json (the firmware's built-in default face) — regenerate instead of editing
// the header by hand.
import { writeFileSync } from 'node:fs';
import { encodeFrame, OVERLAY_H, OVERLAY_W } from '../src/face/sprite';

// String-art painter: '#' = palette index 1, '.' = transparent. Placed onto
// the 80x60 overlay grid (1 cell = 4 design px on the 320x240 canvas).
function paint(px: Uint8Array, ox: number, oy: number, rows: string[]) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#') px[(oy + y) * OVERLAY_W + (ox + x)] = 1;
    }
  });
}
function overlayFrame(rows: string[], ox: number, oy: number) {
  const px = new Uint8Array(OVERLAY_W * OVERLAY_H);
  paint(px, ox, oy, rows);
  return {
    frames: {
      open: encodeFrame(
        { w: OVERLAY_W, h: OVERLAY_H, palette: ['#FFFFFF'], pixels: px },
        OVERLAY_W, OVERLAY_H,
      ),
    },
  };
}

// 💢 four corner brackets pointing outward (was drawAngerMark at 272,52)
const anger = overlayFrame([
  '##....##',
  '#......#',
  '........',
  '........',
  '........',
  '........',
  '#......#',
  '##....##',
], 64, 9);

// Zzz descending to the lower-left (was three drawString "Z" at ~256,32)
const zzz = overlayFrame([
  '.....#####',
  '........#.',
  '.......#..',
  '......#...',
  '.....#####',
  '..........',
  '..####....',
  '....#.....',
  '...#......',
  '..####....',
  '..........',
  '###.......',
  '.#........',
  '###.......',
], 60, 6);

// ? (was drawString "?" size 3 at 262,36)
const question = overlayFrame([
  '.###.',
  '#...#',
  '....#',
  '...#.',
  '..#..',
  '..#..',
  '.....',
  '..#..',
], 65, 8);

// Geometry lifted from keke_firmware v4 (m5avatar BoundingRects + KeEye /
// KeMouth / KeBrow draw code). ParamFace naming: eyeL = character's left =
// screen right.
const doc = {
  version: 1,
  meta: { name: 'Ke', author: 'keke_firmware' },
  canvas: { width: 320, height: 240 },
  palette: { primary: '#FFFFFF', secondary: '#FF99CC', background: '#000000' },
  parts: {
    eyeL: {
      pos: { x: 230, y: 93 }, shape: 'roundRect', width: 28, height: 10,
      cornerRadius: 0,
      upperLid: { angle: 0, cover: 0 }, lowerLid: { angle: 0, cover: 0 },
    },
    eyeR: {
      pos: { x: 103, y: 96 }, shape: 'roundRect', width: 28, height: 10,
      cornerRadius: 0,
      upperLid: { angle: 0, cover: 0 }, lowerLid: { angle: 0, cover: 0 },
    },
    // brows exist but are invisible at rest (width 0); expression deltas
    // grow them (delta numbers add onto the base)
    browL: { pos: { x: 230, y: 67 }, shape: 'rect', width: 0, thickness: 2, angle: 0 },
    browR: { pos: { x: 103, y: 70 }, shape: 'rect', width: 0, thickness: 2, angle: 0 },
    // rest: 42x2 line; talking: narrows to 24 wide, opens to 10 tall
    mouth: {
      pos: { x: 163, y: 148 }, shape: 'rect',
      minWidth: 24, maxWidth: 42, minHeight: 2, maxHeight: 10,
    },
  },
  overlay: {
    smooth: false,
    expr: { angry: anger, sleepy: zzz, doubt: question },
  },
  animation: {
    blink: { interval: 4, duration: 150 },
    saccade: { interval: 3, amplitude: 0.4 },
    breath: { period: 3.5, depth: 0.6 },
  },
  expressions: {
    // ^ ^ chevron eyes (arc peak-up) + smile arc mouth
    happy: {
      parts: {
        eyeL: { shape: 'arc', curve: 0.9, thickness: 3, width: -4, height: 12 },
        eyeR: { shape: 'arc', curve: 0.9, thickness: 3, width: -4, height: 12 },
        mouth: { shape: 'arc', curve: 0.7 },
      },
    },
    // narrowed eyes + sharp down-pressed brows + 💢
    angry: {
      parts: {
        eyeL: { height: -3 },
        eyeR: { height: -3 },
        browL: { width: 36, angle: -29, pos: { y: 4 } },
        browR: { width: 36, angle: 29, pos: { y: 4 } },
      },
    },
    // inner-high brows + down-curved mouth
    sad: {
      parts: {
        browL: { width: 36, angle: 24 },
        browR: { width: 36, angle: -24 },
        mouth: { shape: 'arc', curve: -0.7 },
      },
    },
    // offset eyes, one raised brow, small mouth, ?
    doubt: {
      parts: {
        eyeL: { pos: { y: 2 } },
        eyeR: { pos: { y: -3 } },
        browL: { width: 36, pos: { y: 3 } },
        browR: { width: 36, angle: -18, pos: { y: -5 } },
        mouth: { minWidth: -8, maxWidth: -26 },
      },
    },
    // heavy lids, small mouth, slower blink, Zzz
    sleepy: {
      parts: {
        eyeL: { upperLid: { cover: 0.7 } },
        eyeR: { upperLid: { cover: 0.7 } },
        mouth: { maxWidth: -26 },
      },
      animation: { blink: { interval: -1, duration: 100 }, breath: { depth: -0.2 } },
    },
  },
};

writeFileSync('../faces/ke.json', JSON.stringify(doc, null, 2) + '\n');
console.log('wrote faces/ke.json,', JSON.stringify(doc).length, 'bytes');

const headerPath = process.argv[2];
if (headerPath) {
  const header =
    '// generated by web/scripts/gen-ke-face.ts (stackchan-face-editor) —\n' +
    '// do not hand-edit; regenerate and re-flash to change the built-in face.\n' +
    '#pragma once\n' +
    'static const char KE_FACE_DEFAULT[] = R"PF(' +
    JSON.stringify(doc) +
    ')PF";\n';
  writeFileSync(headerPath, header);
  console.log('wrote', headerPath);
}
