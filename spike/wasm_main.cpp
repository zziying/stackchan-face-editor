// Spike WASM entry: expose the untouched avatar renderer to JS.
#include <emscripten.h>

#include <M5Unified.h>
#include "ColorPalette.h"
#include "DrawContext.h"
#include "Face.h"

using namespace m5avatar;

static Face *face = nullptr;
static ColorPalette palette;

extern "C" {

EMSCRIPTEN_KEEPALIVE uint16_t *fb() { return M5.Display.buf; }
EMSCRIPTEN_KEEPALIVE int fb_w() { return M5.Display.w; }
EMSCRIPTEN_KEEPALIVE int fb_h() { return M5.Display.h; }

EMSCRIPTEN_KEEPALIVE void render(int exp, float breath, float eyeOpen,
                                 float mouthOpen, float gazeH, float gazeV) {
  if (!face) face = new Face();
  DrawContext ctx(static_cast<Expression>(exp), breath, &palette,
                  Gaze(gazeV, gazeH), eyeOpen, Gaze(gazeV, gazeH), eyeOpen,
                  mouthOpen, "", 0.0f, 1.0f, 16, BatteryIconStatus::invisible,
                  0, nullptr);
  face->draw(&ctx);
}
}
