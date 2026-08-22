// Pixel-skin sprite codec (schema v2, DESIGN.md P1-P3).
// Wire format per frame: {w, h, palette, data}. `palette` holds up to 15
// "#RRGGBB" strings; pixel index 0 is transparent, index k maps to
// palette[k-1]. `data` is base64 of an RLE byte stream: each byte encodes
// one run — high nibble = run length - 1 (1..16), low nibble = palette
// index — row-major, runs may cross row boundaries, and the run total must
// equal exactly w*h. The C++ parser implements the same format; keep in sync.
export interface SpriteFrameDoc {
  w: number;
  h: number;
  palette: string[];
  data: string;
}

// Decoded form: one palette index per pixel, row-major.
export interface SpriteFrame {
  w: number;
  h: number;
  palette: string[];
  pixels: Uint8Array;
}

export const SPRITE_MIN_DIM = 1;
export const SPRITE_MAX_DIM = 48;
export const SPRITE_MAX_COLORS = 15;
export const SPRITE_DEFAULT_DIM = 24;
export const SPRITE_DEFAULT_SCALE = 4;
export const SPRITE_MAX_SCALE = 8;
// P6v2: the overlay is a fixed grid mapped 1:1 onto the design canvas
export const OVERLAY_W = 80;
export const OVERLAY_H = 60;

function isHexColor(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

function validDims(w: number, h: number, maxW: number, maxH: number): boolean {
  return (
    Number.isInteger(w) && Number.isInteger(h) &&
    w >= SPRITE_MIN_DIM && w <= maxW &&
    h >= SPRITE_MIN_DIM && h <= maxH
  );
}

export function encodeFrame(
  frame: SpriteFrame, maxW = SPRITE_MAX_DIM, maxH = SPRITE_MAX_DIM,
): SpriteFrameDoc {
  const { w, h, palette, pixels } = frame;
  if (!validDims(w, h, maxW, maxH)) throw new Error(`sprite dims out of range: ${w}x${h}`);
  if (palette.length > SPRITE_MAX_COLORS) throw new Error('palette too large');
  if (pixels.length !== w * h) throw new Error('pixel count mismatch');
  const bytes: number[] = [];
  for (let i = 0; i < pixels.length; ) {
    const idx = pixels[i];
    if (idx > palette.length) throw new Error(`pixel index ${idx} out of palette`);
    let run = 1;
    while (run < 16 && i + run < pixels.length && pixels[i + run] === idx) run++;
    bytes.push(((run - 1) << 4) | idx);
    i += run;
  }
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return { w, h, palette: [...palette], data: btoa(bin) };
}

// Returns null on any malformed input (bad dims, palette, base64, index out
// of range, or run total ≠ w*h) — mirrors the firmware's reject-then-keep-
// previous-face behavior instead of half-drawing garbage.
export function decodeFrame(
  doc: unknown, maxW = SPRITE_MAX_DIM, maxH = SPRITE_MAX_DIM,
): SpriteFrame | null {
  if (typeof doc !== 'object' || doc === null) return null;
  const { w, h, palette, data } = doc as Record<string, unknown>;
  if (typeof w !== 'number' || typeof h !== 'number' || !validDims(w, h, maxW, maxH)) return null;
  if (!Array.isArray(palette) || palette.length > SPRITE_MAX_COLORS) return null;
  if (!palette.every(isHexColor)) return null;
  if (typeof data !== 'string') return null;
  let bin: string;
  try {
    bin = atob(data);
  } catch {
    return null;
  }
  const pixels = new Uint8Array(w * h);
  let n = 0;
  for (let i = 0; i < bin.length; i++) {
    const b = bin.charCodeAt(i);
    const run = (b >> 4) + 1;
    const idx = b & 0x0f;
    if (idx > palette.length || n + run > pixels.length) return null;
    pixels.fill(idx, n, n + run);
    n += run;
  }
  if (n !== pixels.length) return null;
  return { w, h, palette: palette as string[], pixels };
}
