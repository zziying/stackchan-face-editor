// Generates faces/pixel-demo.json — the pixel-skin demo/test face (schema
// v2). Run from web/:  npx esbuild scripts/gen-pixel-demo.ts --bundle
// --format=esm --platform=node | node --input-type=module
// The C++ PPM test loads the output, so the file is a cross-codec fixture:
// TS encoder → firmware decoder.
import { writeFileSync } from 'node:fs';
import { encodeFrame, OVERLAY_H, OVERLAY_W } from '../src/face/sprite';

function grid(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h);
}
function set(px: Uint8Array, w: number, x: number, y: number, idx: number) {
  if (x >= 0 && y >= 0 && x < w && px[y * w + x] !== undefined) px[y * w + x] = idx;
}
function disc(px: Uint8Array, w: number, cx: number, cy: number, r: number, idx: number) {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.6) set(px, w, x, y, idx);
}

// eye open 16x16: white disc, dark pupil, sky shine
const eyePal = ['#FFFFFF', '#222233', '#AEE7FF'];
const eyeOpen = grid(16, 16);
disc(eyeOpen, 16, 8, 8, 7, 1);
disc(eyeOpen, 16, 8, 9, 3, 2);
set(eyeOpen, 16, 5, 5, 3);
set(eyeOpen, 16, 6, 5, 3);
set(eyeOpen, 16, 5, 6, 3);

// eye closed 16x16: a "︶" crescent — the shape squashing can't give (P1)
const eyeClosed = grid(16, 16);
for (let x = 2; x <= 13; x++) {
  const t = (x - 2) / 11;
  const y = 8 + Math.round(2.4 * Math.sin(Math.PI * t));
  set(eyeClosed, 16, x, y, 1);
  set(eyeClosed, 16, x, y + 1, 1);
}

// mouth closed 20x10: upturned smile line
const mouthPal = ['#FFFFFF', '#7A2E3F', '#E06377'];
const mouthClosed = grid(20, 10);
for (let x = 2; x <= 17; x++) {
  const t = (x - 2) / 15;
  const y = 3 + Math.round(3.2 * Math.sin(Math.PI * t));
  set(mouthClosed, 20, x, y, 1);
  set(mouthClosed, 20, x, y + 1, 1);
}

// mouth open 20x14: dark mouth with tongue
const mouthOpen = grid(20, 14);
for (let y = 0; y < 14; y++)
  for (let x = 0; x < 20; x++) {
    const dx = (x - 9.5) / 8.5, dy = (y - 6.5) / 6.5;
    if (dx * dx + dy * dy <= 1) set(mouthOpen, 20, x, y, 2);
  }
for (let y = 9; y < 13; y++)
  for (let x = 6; x < 14; x++) {
    const dx = (x - 9.5) / 4.5, dy = (y - 12) / 4;
    if (dx * dx + dy * dy <= 1) set(mouthOpen, 20, x, y, 3);
  }

// overlay: fixed 80x60 grid mapped 1:1 onto the 320x240 face (P6v2), blush
// patches on both cheeks; smooth exercises the load-time Scale2x expansion
const overlay = grid(OVERLAY_W, OVERLAY_H);
for (const cx of [14, 65])
  for (let y = 32; y <= 35; y++)
    for (let x = cx - 3; x <= cx + 3; x++) {
      const dx = (x - cx) / 3.5, dy = (y - 33.5) / 2.5;
      if (dx * dx + dy * dy <= 1) set(overlay, OVERLAY_W, x, y, 1);
    }

// v2.1 per-expression overlay: angry swaps the blush for a red anger vein
// (own frame), sleepy hides the overlay entirely
const vein = grid(OVERLAY_W, OVERLAY_H);
for (const [ox, oy] of [[0, 0], [4, 0], [0, 4], [4, 4]] as const)
  for (let i = 0; i < 3; i++) {
    set(vein, OVERLAY_W, 60 + ox + i, 8 + oy + 1, 1);
    set(vein, OVERLAY_W, 60 + ox + 1, 8 + oy + i, 1);
  }

// v3 per-expression part frames: happy swaps both eyes for golden "^" arcs.
// Own open frame only — the closed slot stays empty so the C++ test also
// covers the pickFrame fallback (a blink on happy keeps showing the arc).
const happyEye = grid(16, 16);
for (let x = 2; x <= 13; x++) {
  const t = (x - 2) / 11;
  const y = 10 - Math.round(4 * Math.sin(Math.PI * t));
  for (let d = 0; d < 3; d++) set(happyEye, 16, x, y + d, 1);
}
const happyEyeFrame = () =>
  encodeFrame({ w: 16, h: 16, palette: ['#FFD700'], pixels: happyEye });

const doc = {
  version: 1,
  meta: { name: 'Pixel Demo', author: 'stackchan-face-editor' },
  canvas: { width: 320, height: 240 },
  palette: { primary: '#FFFFFF', secondary: '#FF99CC', background: '#000000' },
  parts: {
    eyeL: {
      pos: { x: 230, y: 96 }, shape: 'pixel', scale: 3,
      frames: {
        open: encodeFrame({ w: 16, h: 16, palette: eyePal, pixels: eyeOpen }),
        closed: encodeFrame({ w: 16, h: 16, palette: eyePal, pixels: eyeClosed }),
      },
      upperLid: { angle: 0, cover: 0 }, lowerLid: { angle: 0, cover: 0 },
    },
    eyeR: {
      pos: { x: 90, y: 96 }, shape: 'pixel', scale: 3,
      frames: {
        open: encodeFrame({ w: 16, h: 16, palette: eyePal, pixels: eyeOpen }),
        closed: encodeFrame({ w: 16, h: 16, palette: eyePal, pixels: eyeClosed }),
      },
      upperLid: { angle: 0, cover: 0 }, lowerLid: { angle: 0, cover: 0 },
    },
    mouth: {
      pos: { x: 163, y: 148 }, shape: 'pixel', scale: 3,
      frames: {
        open: encodeFrame({ w: 20, h: 14, palette: mouthPal, pixels: mouthOpen }),
        closed: encodeFrame({ w: 20, h: 10, palette: mouthPal, pixels: mouthClosed }),
      },
    },
  },
  overlay: {
    smooth: true,
    frames: {
      open: encodeFrame(
        { w: OVERLAY_W, h: OVERLAY_H, palette: ['#FF9EC4'], pixels: overlay },
        OVERLAY_W, OVERLAY_H,
      ),
    },
    expr: {
      angry: {
        frames: {
          open: encodeFrame(
            { w: OVERLAY_W, h: OVERLAY_H, palette: ['#E03A3A'], pixels: vein },
            OVERLAY_W, OVERLAY_H,
          ),
        },
      },
      sleepy: { hidden: true },
    },
  },
  animation: {
    blink: { interval: 4, duration: 150 },
    saccade: { interval: 3, amplitude: 0.4 },
    breath: { period: 3.5, depth: 0.6 },
  },
  expressions: {
    happy: {
      // own part frames instead of a lid squint: the mouth carries no entry,
      // so it inherits the base pair — partial ownership is the common case
      parts: {
        eyeL: { frames: { open: happyEyeFrame() } },
        eyeR: { frames: { open: happyEyeFrame() } },
      },
    },
    angry: {
      parts: {
        eyeL: { upperLid: { angle: -22, cover: 0.4 } },
        eyeR: { upperLid: { angle: 22, cover: 0.4 } },
      },
    },
    sad: {
      parts: {
        eyeL: { upperLid: { angle: 18, cover: 0.35 } },
        eyeR: { upperLid: { angle: -18, cover: 0.35 } },
      },
    },
    doubt: {
      parts: {
        eyeL: { upperLid: { cover: 0.45 } },
        eyeR: { upperLid: { cover: 0.1 } },
      },
    },
    sleepy: {
      parts: {
        eyeL: { upperLid: { cover: 0.6 } },
        eyeR: { upperLid: { cover: 0.6 } },
      },
      animation: { blink: { interval: 3, duration: 250 }, breath: { depth: 0.4 } },
    },
  },
};

writeFileSync('../faces/pixel-demo.json', JSON.stringify(doc, null, 2) + '\n');
console.log('wrote faces/pixel-demo.json,', JSON.stringify(doc).length, 'bytes');
