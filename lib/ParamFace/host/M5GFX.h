// Spike stub: software-rendered replacement for M5GFX/LovyanGFX.
// Implements only the surface m5stack-avatar actually calls, backed by a
// plain RGB565 framebuffer so the untouched library code runs on host/WASM.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>

#define MC_DATUM 4

#define TFT_WHITE 0xFFFF
#define TFT_BLACK 0x0000
#define M5_LOGI(...)

namespace lgfx {
struct IFont {};
inline void delay(unsigned long) {}
}  // namespace lgfx

class M5Canvas {
 public:
  uint16_t *buf = nullptr;
  int32_t w = 0, h = 0;
  int depth = 16;
  uint16_t baseColor = 0;

  M5Canvas() {}
  explicit M5Canvas(void *) {}
  ~M5Canvas() { deleteSprite(); }

  void *createSprite(int32_t width, int32_t height) {
    deleteSprite();
    w = width;
    h = height;
    buf = static_cast<uint16_t *>(calloc(static_cast<size_t>(w) * h, 2));
    return buf;
  }
  void deleteSprite() {
    free(buf);
    buf = nullptr;
    w = h = 0;
  }
  void setColorDepth(int d) { depth = d; }
  int getColorDepth() const { return depth; }
  void *getBuffer() const { return buf; }
  void setBaseColor(uint16_t c) { baseColor = c; }
  void setBitmapColor(uint16_t, uint16_t) {}
  void fillSprite(uint16_t c) {
    for (int64_t i = 0; i < static_cast<int64_t>(w) * h; i++) buf[i] = c;
  }
  void clear() { fillSprite(baseColor); }
  int32_t width() const { return w; }
  int32_t height() const { return h; }
  void startWrite() {}
  void endWrite() {}
  static uint16_t color24to16(uint32_t c) {
    return static_cast<uint16_t>(((c >> 8) & 0xF800) | ((c >> 5) & 0x07E0) |
                                 ((c >> 3) & 0x001F));
  }

  inline void pset(int32_t x, int32_t y, uint16_t c) {
    if (x >= 0 && y >= 0 && x < w && y < h) buf[y * w + x] = c;
  }
  void hline(int32_t x0, int32_t x1, int32_t y, uint16_t c) {
    if (y < 0 || y >= h) return;
    x0 = std::max<int32_t>(x0, 0);
    x1 = std::min<int32_t>(x1, w - 1);
    for (int32_t x = x0; x <= x1; x++) buf[y * w + x] = c;
  }

  void fillRect(int32_t x, int32_t y, int32_t ww, int32_t hh, uint16_t c) {
    for (int32_t j = y; j < y + hh; j++) hline(x, x + ww - 1, j, c);
  }
  void drawRect(int32_t x, int32_t y, int32_t ww, int32_t hh, uint16_t c) {
    hline(x, x + ww - 1, y, c);
    hline(x, x + ww - 1, y + hh - 1, c);
    for (int32_t j = y; j < y + hh; j++) {
      pset(x, j, c);
      pset(x + ww - 1, j, c);
    }
  }
  void drawLine(int32_t x0, int32_t y0, int32_t x1, int32_t y1, uint16_t c) {
    int32_t dx = std::abs(x1 - x0), dy = -std::abs(y1 - y0);
    int32_t sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (;;) {
      pset(x0, y0, c);
      if (x0 == x1 && y0 == y1) break;
      int32_t e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  void fillEllipse(int32_t x, int32_t y, int32_t rx, int32_t ry, uint16_t c) {
    if (rx < 1 || ry < 1) return;
    for (int32_t dy = -ry; dy <= ry; dy++) {
      double t = 1.0 - static_cast<double>(dy) * dy / (static_cast<double>(ry) * ry);
      if (t < 0) continue;
      int32_t dx = static_cast<int32_t>(rx * std::sqrt(t));
      hline(x - dx, x + dx, y + dy, c);
    }
  }
  void fillCircle(int32_t x, int32_t y, int32_t r, uint16_t c) {
    fillEllipse(x, y, r, r, c);
  }
  void drawCircle(int32_t x, int32_t y, int32_t r, uint16_t c) {
    // brute-force ring, fine for a spike
    for (int32_t dy = -r; dy <= r; dy++)
      for (int32_t dx = -r; dx <= r; dx++) {
        int32_t d2 = dx * dx + dy * dy;
        if (d2 >= (r - 1) * (r - 1) && d2 <= r * r) pset(x + dx, y + dy, c);
      }
  }
  void fillTriangle(int32_t x0, int32_t y0, int32_t x1, int32_t y1, int32_t x2,
                    int32_t y2, uint16_t c) {
    int32_t minx = std::min({x0, x1, x2}), maxx = std::max({x0, x1, x2});
    int32_t miny = std::min({y0, y1, y2}), maxy = std::max({y0, y1, y2});
    auto edge = [](int32_t ax, int32_t ay, int32_t bx, int32_t by, int32_t px,
                   int32_t py) -> int64_t {
      return static_cast<int64_t>(bx - ax) * (py - ay) -
             static_cast<int64_t>(by - ay) * (px - ax);
    };
    for (int32_t py = miny; py <= maxy; py++)
      for (int32_t px = minx; px <= maxx; px++) {
        int64_t e0 = edge(x0, y0, x1, y1, px, py);
        int64_t e1 = edge(x1, y1, x2, y2, px, py);
        int64_t e2 = edge(x2, y2, x0, y0, px, py);
        if ((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0))
          pset(px, py, c);
      }
  }
  // LovyanGFX semantics: angle in degrees, 0 = +x axis, increasing clockwise
  // on screen (y-down). r0..r1 is the radial band.
  void fillArc(int32_t x, int32_t y, int32_t r0, int32_t r1, float a0, float a1,
               uint16_t c) {
    if (r0 > r1) std::swap(r0, r1);
    auto norm = [](float a) {
      while (a < 0) a += 360.0f;
      while (a >= 360.0f) a -= 360.0f;
      return a;
    };
    a0 = norm(a0);
    a1 = norm(a1);
    for (int32_t dy = -r1; dy <= r1; dy++)
      for (int32_t dx = -r1; dx <= r1; dx++) {
        double d = std::sqrt(static_cast<double>(dx) * dx +
                             static_cast<double>(dy) * dy);
        if (d < r0 || d > r1) continue;
        float ang = norm(std::atan2(static_cast<double>(dy), dx) * 180.0 / M_PI);
        bool in = (a0 <= a1) ? (ang >= a0 && ang <= a1) : (ang >= a0 || ang <= a1);
        if (in) pset(x + dx, y + dy, c);
      }
  }

  // text API — dumb stubs; the spike renders no speech balloon
  void setTextSize(float) {}
  void setTextColor(uint16_t, uint16_t) {}
  void setTextDatum(int) {}
  void setFont(const lgfx::IFont *) {}
  int textWidth(const char *) { return 0; }
  void drawString(const char *, int32_t, int32_t,
                  const lgfx::IFont * = nullptr) {}

  void pushSprite(M5Canvas *dst, int32_t x, int32_t y) {
    for (int32_t j = 0; j < h; j++)
      for (int32_t i = 0; i < w; i++) dst->pset(x + i, y + j, buf[j * w + i]);
  }
  // Paste this sprite onto dst with its center at (cx, cy), rotated by
  // `angle` degrees and scaled. Inverse-mapped per destination pixel.
  void pushRotateZoom(M5Canvas *dst, float cx, float cy, float angle, float zx,
                      float zy) {
    if (zx == 0 || zy == 0) return;
    double rad = -angle * M_PI / 180.0;
    double cs = std::cos(rad), sn = std::sin(rad);
    double srcCx = w / 2.0, srcCy = h / 2.0;
    // conservative destination bounds: whole dst canvas (spike simplicity)
    for (int32_t py = 0; py < dst->h; py++)
      for (int32_t px = 0; px < dst->w; px++) {
        double dx = px - cx, dy = py - cy;
        double sxf = (dx * cs - dy * sn) / zx + srcCx;
        double syf = (dx * sn + dy * cs) / zy + srcCy;
        int32_t sx = static_cast<int32_t>(std::lround(sxf));
        int32_t sy = static_cast<int32_t>(std::lround(syf));
        if (sx >= 0 && sy >= 0 && sx < w && sy < h)
          dst->pset(px, py, buf[sy * w + sx]);
      }
  }
};

using M5GFX = M5Canvas;
