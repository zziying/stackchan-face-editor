// Parametric drawing (DESIGN.md S2): eye shapes + independent eyelid layer,
// mouth min/max open interpolation, rotatable brows. Uses only primitives
// that exist on both real M5GFX and the host stub: fillRect, fillTriangle,
// fillEllipse, fillCircle, fillArc, fillSprite.
#include <math.h>

#include <M5GFX.h>

#include "ParamFace.h"

namespace paramface {

namespace {

constexpr float kDeg2Rad = 3.14159265f / 180.0f;

inline uint16_t rgb565(int32_t rgb888) {
  return static_cast<uint16_t>(((rgb888 >> 8) & 0xF800) |
                               ((rgb888 >> 5) & 0x07E0) |
                               ((rgb888 >> 3) & 0x001F));
}

// Uniform design-canvas -> destination transform.
struct Xf {
  float scale, offX, offY;
  int32_t x(float v) const { return static_cast<int32_t>(lroundf(v * scale + offX)); }
  int32_t y(float v) const { return static_cast<int32_t>(lroundf(v * scale + offY)); }
  int32_t s(float v) const {
    int32_t r = static_cast<int32_t>(lroundf(v * scale));
    return r < 1 && v > 0 ? 1 : r;
  }
};

// Filled quad from 4 corners (two triangles).
void fillQuad(M5Canvas* g, const float px[4], const float py[4], uint16_t c) {
  g->fillTriangle(lroundf(px[0]), lroundf(py[0]), lroundf(px[1]), lroundf(py[1]),
                  lroundf(px[2]), lroundf(py[2]), c);
  g->fillTriangle(lroundf(px[0]), lroundf(py[0]), lroundf(px[2]), lroundf(py[2]),
                  lroundf(px[3]), lroundf(py[3]), c);
}

// Rect of size (w,h), local origin at its center, rotated by angleDeg around
// (pivotX, pivotY) after being placed with its center at (cx, cy).
void fillRotatedRect(M5Canvas* g, float cx, float cy, float w, float h,
                     float angleDeg, float pivotX, float pivotY, uint16_t c) {
  float rad = angleDeg * kDeg2Rad;
  float cs = cosf(rad), sn = sinf(rad);
  float lx[4] = {-w / 2, w / 2, w / 2, -w / 2};
  float ly[4] = {-h / 2, -h / 2, h / 2, h / 2};
  float px[4], py[4];
  for (int i = 0; i < 4; i++) {
    float ax = cx + lx[i] - pivotX, ay = cy + ly[i] - pivotY;
    px[i] = pivotX + ax * cs - ay * sn;
    py[i] = pivotY + ax * sn + ay * cs;
  }
  fillQuad(g, px, py, c);
}

void fillRoundRect(M5Canvas* g, float cx, float cy, float w, float h, float r,
                   uint16_t c) {
  float maxR = (w < h ? w : h) / 2;
  if (r > maxR) r = maxR;
  if (r < 1) {
    g->fillRect(lroundf(cx - w / 2), lroundf(cy - h / 2), lroundf(w), lroundf(h), c);
    return;
  }
  int32_t left = lroundf(cx - w / 2), top = lroundf(cy - h / 2);
  int32_t ww = lroundf(w), hh = lroundf(h), rr = lroundf(r);
  g->fillRect(left + rr, top, ww - 2 * rr, hh, c);
  g->fillRect(left, top + rr, rr, hh - 2 * rr, c);
  g->fillRect(left + ww - rr, top + rr, rr, hh - 2 * rr, c);
  g->fillCircle(left + rr, top + rr, rr, c);
  g->fillCircle(left + ww - rr - 1, top + rr, rr, c);
  g->fillCircle(left + rr, top + hh - rr - 1, rr, c);
  g->fillCircle(left + ww - rr - 1, top + hh - rr - 1, rr, c);
}

// Circular-arc stroke through chord endpoints (cx±w/2, cy) with peak
// deviation `sagitta` (positive = peak up on screen).
void fillArcStroke(M5Canvas* g, float cx, float cy, float w, float sagitta,
                   float thickness, uint16_t c) {
  float s = fabsf(sagitta);
  float half = w / 2;
  if (s < 1.0f) {  // flat: plain line
    g->fillRect(lroundf(cx - half), lroundf(cy - thickness / 2), lroundf(w),
                lroundf(thickness < 1 ? 1 : thickness), c);
    return;
  }
  float R = (half * half + s * s) / (2 * s);
  bool up = sagitta > 0;
  // center sits opposite the peak
  float ccy = up ? cy - s + R : cy + s - R;
  float aL = atan2f(cy - ccy, -half) / kDeg2Rad;  // left endpoint angle
  float aR = atan2f(cy - ccy, half) / kDeg2Rad;   // right endpoint angle
  // LovyanGFX fillArc: degrees clockwise (y-down), band r0..r1. Sweep must
  // pass through the peak (270° for up, 90° for down): left→right when the
  // peak is up, right→left when down. Swapping these paints the complement —
  // a near-full ring once R blows up on flat curves.
  float lo = up ? aL : aR, hi = up ? aR : aL;
  g->fillArc(lroundf(cx), lroundf(ccy), lroundf(R - thickness / 2),
             lroundf(R + thickness / 2), lo, hi, c);
}

}  // namespace

// Index-domain only, so no new colors appear and index 0 (transparent)
// participates like any other value. Edges clamp to self.
void scale2xPass(const uint8_t* src, int w, int h, uint8_t* dst) {
  for (int y = 0; y < h; y++) {
    const uint8_t* row = src + y * w;
    const uint8_t* up = y > 0 ? row - w : row;
    const uint8_t* dn = y < h - 1 ? row + w : row;
    uint8_t* out0 = dst + (2 * y) * (2 * w);
    uint8_t* out1 = out0 + 2 * w;
    for (int x = 0; x < w; x++) {
      uint8_t e = row[x];
      uint8_t b = up[x], hh = dn[x];
      uint8_t d = x > 0 ? row[x - 1] : e;
      uint8_t fr = x < w - 1 ? row[x + 1] : e;
      uint8_t e0 = e, e1 = e, e2 = e, e3 = e;
      if (b != hh && d != fr) {
        if (d == b) e0 = d;
        if (b == fr) e1 = fr;
        if (d == hh) e2 = d;
        if (hh == fr) e3 = fr;
      }
      out0[2 * x] = e0; out0[2 * x + 1] = e1;
      out1[2 * x] = e2; out1[2 * x + 1] = e3;
    }
  }
}

namespace {

// Blit one pixel-skin frame centered at design-space (cx, cy), `pxScale`
// design px per sprite pixel (P2). Block edges come from the continuous
// design coords, so adjacent blocks share boundaries exactly — no rounding
// gaps. Horizontal same-index runs collapse into one fillRect; index 0 skips.
// `smooth` (P8): scale>=2 runs Scale2x once, >=4 twice, before blitting —
// the grid doubles/quadruples, pxScale shrinks to match, and the leftover
// factor stays nearest-neighbor through the unchanged blit below.
void drawSpriteFrame(M5Canvas* g, const SpriteFrame& f, float cx, float cy,
                     float pxScale, bool smooth, const Xf& xf) {
  const uint8_t* pixels = f.pixels;
  int w = f.w, h = f.h;
  if (smooth) {
    // lazy scratch, worst case 48x48 doubled twice; kept for the process
    // lifetime so render ticks never touch the allocator
    static uint8_t* scratch1 = nullptr;  // 96*96
    static uint8_t* scratch2 = nullptr;  // 192*192
    int passes = pxScale >= 4 ? 2 : (pxScale >= 2 ? 1 : 0);
    if (passes >= 1) {
      if (!scratch1) scratch1 = static_cast<uint8_t*>(malloc(96 * 96));
      if (scratch1) {
        scale2xPass(pixels, w, h, scratch1);
        pixels = scratch1; w *= 2; h *= 2; pxScale /= 2;
      }
    }
    if (passes == 2 && pixels == scratch1) {
      if (!scratch2) scratch2 = static_cast<uint8_t*>(malloc(192 * 192));
      if (scratch2) {
        scale2xPass(pixels, w, h, scratch2);
        pixels = scratch2; w *= 2; h *= 2; pxScale /= 2;
      }
    }
  }
  float left = cx - w * pxScale / 2, top = cy - h * pxScale / 2;
  for (int row = 0; row < h; row++) {
    int32_t y0 = xf.y(top + row * pxScale), y1 = xf.y(top + (row + 1) * pxScale);
    if (y1 <= y0) y1 = y0 + 1;
    const uint8_t* px = pixels + row * w;
    for (int col = 0; col < w;) {
      uint8_t idx = px[col];
      int run = 1;
      while (col + run < w && px[col + run] == idx) run++;
      if (idx) {
        int32_t x0 = xf.x(left + col * pxScale);
        int32_t x1 = xf.x(left + (col + run) * pxScale);
        if (x1 <= x0) x1 = x0 + 1;
        g->fillRect(x0, y0, x1 - x0, y1 - y0, f.palette565[idx - 1]);
      }
      col += run;
    }
  }
}

// Keyframe selection (P1/P4): want open or closed, fall back to whichever
// frame exists; null when the part has no sprite at all (then the caller
// falls back to its vector shape, S2 spirit).
const SpriteFrame* pickFrame(const SpriteFrame frames[2], bool open) {
  const SpriteFrame& want = frames[open ? 0 : 1];
  if (want.present()) return &want;
  const SpriteFrame& other = frames[open ? 1 : 0];
  return other.present() ? &other : nullptr;
}

void drawEye(M5Canvas* g, const EyeParams& e, const PaletteParams& pal,
             const SpriteFrame frames[2], float openRatio, float gazeH,
             float gazeV, const Xf& xf) {
  if (!e.present) return;
  uint16_t color = rgb565(e.color >= 0 ? e.color : pal.primary);
  uint16_t bg = rgb565(pal.background);
  float gx = gazeH * 3, gy = gazeV * 3;
  float cx = xf.x(e.x + gx), cy = xf.y(e.y + gy);
  float w = e.width * xf.scale, h = e.height * xf.scale;

  if (e.shape == EyeShape::Pixel) {
    const SpriteFrame* fr = pickFrame(frames, openRatio >= 0.5f);
    if (fr) {
      drawSpriteFrame(g, *fr, e.x + gx, e.y + gy, e.spriteScale, e.smooth, xf);
      // lids (bg quads below) still apply — expression deltas keep working
      // on pixel eyes; blink itself is the frame switch, not a squash
      w = fr->w * e.spriteScale * xf.scale;
      h = fr->h * e.spriteScale * xf.scale;
      float quadW = w * 3, quadH = h * 3;
      if (e.upperLid.cover > 0.01f) {
        float lidY = cy - h / 2 + e.upperLid.cover * h;
        fillRotatedRect(g, cx, lidY - quadH / 2, quadW, quadH, e.upperLid.angle,
                        cx, lidY, bg);
      }
      if (e.lowerLid.cover > 0.01f) {
        float lidY = cy + h / 2 - e.lowerLid.cover * h;
        fillRotatedRect(g, cx, lidY + quadH / 2, quadW, quadH, e.lowerLid.angle,
                        cx, lidY, bg);
      }
      return;
    }
    // pixel declared but no frames decoded: vector fallback
  }

  if (e.shape == EyeShape::Arc) {
    // arc eyes blink by flattening: ^ eases into a straight line
    float sag = e.curve * (e.height / 2) * openRatio * xf.scale;
    fillArcStroke(g, cx, cy, w, sag, e.thickness * xf.scale, color);
    return;
  }

  if (openRatio < 0.15f) {  // closed: the classic line
    float lh = 4 * xf.scale;
    g->fillRect(lroundf(cx - w / 2), lroundf(cy - lh / 2), lroundf(w),
                lroundf(lh < 1 ? 1 : lh), color);
    return;
  }

  float hEff = h * openRatio;
  if (e.shape == EyeShape::RoundRect) {
    fillRoundRect(g, cx, cy, w, hEff, e.cornerRadius * xf.scale, color);
  } else {
    g->fillEllipse(lroundf(cx), lroundf(cy), lroundf(w / 2), lroundf(hEff / 2), color);
  }

  if (e.highlight) {
    g->fillCircle(lroundf(cx - w * 0.18f), lroundf(cy - hEff * 0.18f),
                  lroundf((w < hEff ? w : hEff) * 0.16f), bg);
  }

  // eyelids: background-colored quads pivoting on the lid line (S2).
  // Draw order in render() puts brows after eyes so an angled lid can't
  // erase them.
  float quadW = w * 3, quadH = h * 3;
  if (e.upperLid.cover > 0.01f) {
    float lidY = cy - h / 2 + e.upperLid.cover * h;
    fillRotatedRect(g, cx, lidY - quadH / 2, quadW, quadH, e.upperLid.angle,
                    cx, lidY, bg);
  }
  if (e.lowerLid.cover > 0.01f) {
    float lidY = cy + h / 2 - e.lowerLid.cover * h;
    fillRotatedRect(g, cx, lidY + quadH / 2, quadW, quadH, e.lowerLid.angle,
                    cx, lidY, bg);
  }
}

void drawBrow(M5Canvas* g, const BrowParams& b, const PaletteParams& pal,
              const SpriteFrame& frame, const Xf& xf) {
  if (!b.present) return;
  if (b.shape == BrowShape::Pixel && frame.present()) {
    // single keyframe (P1); angle doesn't apply — rotation would shred the
    // pixels, pos deltas still move it
    drawSpriteFrame(g, frame, b.x, b.y, b.spriteScale, b.smooth, xf);
    return;
  }
  if (b.width < 1) return;
  uint16_t color = rgb565(b.color >= 0 ? b.color : pal.primary);
  float cx = xf.x(b.x), cy = xf.y(b.y);
  if (b.shape == BrowShape::Arc) {
    // rotation via sagitta keeps it primitive-only; good enough for brows
    fillArcStroke(g, cx, cy, b.width * xf.scale,
                  b.curve * (b.width / 4) * xf.scale, b.thickness * xf.scale,
                  color);
  } else {
    fillRotatedRect(g, cx, cy, b.width * xf.scale, b.thickness * xf.scale,
                    b.angle, cx, cy, color);
  }
}

void drawMouth(M5Canvas* g, const MouthParams& m, const PaletteParams& pal,
               const SpriteFrame frames[2], float openRatio, float breath,
               const Xf& xf) {
  if (!m.present) return;
  if (m.shape == MouthShape::Pixel) {
    const SpriteFrame* fr = pickFrame(frames, openRatio >= 0.5f);
    if (fr) {
      // talk = open/closed frame alternation off the mouthOpen waveform (P4);
      // breath bob in design space, same as the vector path
      drawSpriteFrame(g, *fr, m.x, m.y + breath * 2, m.spriteScale, m.smooth, xf);
      return;
    }
  }
  uint16_t color = rgb565(m.color >= 0 ? m.color : pal.primary);
  float cy = xf.y(m.y) + breath * 2 * xf.scale;  // breath bob, from the lib
  float cx = xf.x(m.x);
  float w = (m.minWidth + (m.maxWidth - m.minWidth) * (1 - openRatio)) * xf.scale;
  float h = (m.minHeight + (m.maxHeight - m.minHeight) * openRatio) * xf.scale;

  switch (m.shape) {
    case MouthShape::Pixel:  // declared pixel but no frames decoded
    case MouthShape::Rect:
      g->fillRect(lroundf(cx - w / 2), lroundf(cy - h / 2), lroundf(w),
                  lroundf(h < 1 ? 1 : h), color);
      break;
    case MouthShape::Arc:
      if (openRatio < 0.1f) {
        // closed: curved stroke; positive curve = smile (peak down = "U")
        fillArcStroke(g, cx, cy, w, -m.curve * (m.maxWidth / 4) * xf.scale,
                      (m.minHeight < 3 ? 3 : m.minHeight) * xf.scale, color);
      } else {
        g->fillEllipse(lroundf(cx), lroundf(cy), lroundf(w / 2), lroundf(h / 2), color);
      }
      break;
    case MouthShape::Omega:
      if (openRatio < 0.1f) {
        float r = m.maxWidth * xf.scale / 4;
        float t = (m.minHeight < 3 ? 3 : m.minHeight) * xf.scale;
        // two lower-half rings side by side (0..180 = below the +x axis in
        // LovyanGFX's y-down clockwise convention): the ω
        g->fillArc(lroundf(cx - r), lroundf(cy), lroundf(r - t / 2),
                   lroundf(r + t / 2), 0, 180, color);
        g->fillArc(lroundf(cx + r), lroundf(cy), lroundf(r - t / 2),
                   lroundf(r + t / 2), 0, 180, color);
      } else {
        g->fillEllipse(lroundf(cx), lroundf(cy), lroundf(w / 2), lroundf(h / 2), color);
      }
      break;
  }
}

}  // namespace

void ParamFace::render(M5Canvas* dst) {
  if (!loaded_ || !dst) return;
  const FaceParams& f = effective();
  float sx = dst->width() / f.canvasW, sy = dst->height() / f.canvasH;
  Xf xf;
  xf.scale = sx < sy ? sx : sy;
  xf.offX = (dst->width() - f.canvasW * xf.scale) / 2;
  xf.offY = (dst->height() - f.canvasH * xf.scale) / 2;

  dst->fillSprite(rgb565(f.palette.background));
  drawEye(dst, f.eyeL, f.palette, sprites_.eyeL, driven_.eyeOpenL, driven_.gazeH, driven_.gazeV, xf);
  drawEye(dst, f.eyeR, f.palette, sprites_.eyeR, driven_.eyeOpenR, driven_.gazeH, driven_.gazeV, xf);
  drawBrow(dst, f.browL, f.palette, sprites_.browL, xf);
  drawBrow(dst, f.browR, f.palette, sprites_.browR, xf);
  drawMouth(dst, f.mouth, f.palette, sprites_.mouth, driven_.mouthOpen, driven_.breath, xf);
  // P6v2: the overlay grid maps 1:1 onto the design canvas (uniform fit,
  // centered); smoothing was pre-expanded at load, so smooth=false here.
  // v2.1: the current expression may hide the overlay or swap in its own frame.
  const int ei = static_cast<int>(expr_);
  const SpriteFrame* ov = &sprites_.overlay;
  if (sprites_.overlayMode[ei] == OverlayMode::Hidden) ov = nullptr;
  else if (sprites_.overlayMode[ei] == OverlayMode::Own) ov = &sprites_.overlayExpr[ei];
  if (ov && ov->present()) {
    float psx = f.canvasW / ov->w, psy = f.canvasH / ov->h;
    drawSpriteFrame(dst, *ov, f.canvasW / 2, f.canvasH / 2,
                    psx < psy ? psx : psy, false, xf);
  }
}

}  // namespace paramface
