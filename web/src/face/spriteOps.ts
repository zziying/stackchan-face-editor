// Pure pixel-grid operations for the sprite board. All return new frames.
import type { SpriteFrame } from './sprite';
import { SPRITE_MAX_DIM, SPRITE_MIN_DIM } from './sprite';

export function emptyFrame(w: number, h: number, palette: string[]): SpriteFrame {
  return { w, h, palette: [...palette], pixels: new Uint8Array(w * h) };
}

// Symmetry lock across L/R parts (P7): plain horizontal flip.
export function flipH(f: SpriteFrame): SpriteFrame {
  const pixels = new Uint8Array(f.w * f.h);
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++)
      pixels[y * f.w + x] = f.pixels[y * f.w + (f.w - 1 - x)];
  return { ...f, palette: [...f.palette], pixels };
}

// Closed-frame draft (wizard pipeline): squash vertically to ~30% by
// nearest-neighbor, centered on the same canvas — the user edits this
// instead of facing a blank grid.
export function squashV(f: SpriteFrame, factor = 0.3): SpriteFrame {
  const h2 = Math.max(1, Math.round(f.h * factor));
  const top = Math.floor((f.h - h2) / 2);
  const pixels = new Uint8Array(f.w * f.h);
  for (let y = 0; y < h2; y++) {
    const srcY = Math.min(f.h - 1, Math.floor(((y + 0.5) / h2) * f.h));
    pixels.set(f.pixels.subarray(srcY * f.w, srcY * f.w + f.w), (top + y) * f.w);
  }
  return { ...f, palette: [...f.palette], pixels };
}

// Center-anchored crop/pad to a new grid size.
export function resizeFrame(
  f: SpriteFrame, w2: number, h2: number,
  maxW = SPRITE_MAX_DIM, maxH = SPRITE_MAX_DIM,
): SpriteFrame {
  w2 = Math.max(SPRITE_MIN_DIM, Math.min(maxW, Math.round(w2)));
  h2 = Math.max(SPRITE_MIN_DIM, Math.min(maxH, Math.round(h2)));
  const pixels = new Uint8Array(w2 * h2);
  const dx = Math.floor((w2 - f.w) / 2), dy = Math.floor((h2 - f.h) / 2);
  for (let y = 0; y < f.h; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= h2) continue;
    for (let x = 0; x < f.w; x++) {
      const tx = x + dx;
      if (tx >= 0 && tx < w2) pixels[ty * w2 + tx] = f.pixels[y * f.w + x];
    }
  }
  return { w: w2, h: h2, palette: [...f.palette], pixels };
}

// Flood fill the same-index region at (x, y) with `idx`.
export function floodFill(f: SpriteFrame, x: number, y: number, idx: number): SpriteFrame {
  const from = f.pixels[y * f.w + x];
  if (from === idx) return f;
  const pixels = f.pixels.slice();
  const stack = [y * f.w + x];
  while (stack.length) {
    const p = stack.pop()!;
    if (pixels[p] !== from) continue;
    pixels[p] = idx;
    const px = p % f.w;
    if (px > 0) stack.push(p - 1);
    if (px < f.w - 1) stack.push(p + 1);
    if (p >= f.w) stack.push(p - f.w);
    if (p < f.w * (f.h - 1)) stack.push(p + f.w);
  }
  return { ...f, palette: [...f.palette], pixels };
}

// Cells on the segment (x0,y0)→(x1,y1), for gap-free drag painting.
export function lineCells(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cells.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return cells;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
