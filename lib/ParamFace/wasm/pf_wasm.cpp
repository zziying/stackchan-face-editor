// WASM entry: thin C ABI over ParamFace for the browser editor.
#include <emscripten.h>

#include <M5GFX.h>

#include "ParamFace.h"

using paramface::Expression;
using paramface::ParamFace;

static ParamFace g_face;
static M5Canvas g_canvas;

extern "C" {

EMSCRIPTEN_KEEPALIVE int pf_init(int w, int h) {
  g_canvas.createSprite(w, h);
  return g_canvas.buf != nullptr;
}

EMSCRIPTEN_KEEPALIVE int pf_load(const char* json) { return g_face.load(json); }
EMSCRIPTEN_KEEPALIVE const char* pf_error() { return g_face.lastError(); }

EMSCRIPTEN_KEEPALIVE void pf_set_expression(int e) {
  if (e >= 0 && e < paramface::kExpressionCount)
    g_face.setExpression(static_cast<Expression>(e));
}

EMSCRIPTEN_KEEPALIVE void pf_tick(float dtMs) {
  g_face.tick(dtMs);
  g_face.render(&g_canvas);
}

EMSCRIPTEN_KEEPALIVE uint16_t* pf_fb() { return g_canvas.buf; }
EMSCRIPTEN_KEEPALIVE int pf_fb_w() { return g_canvas.w; }
EMSCRIPTEN_KEEPALIVE int pf_fb_h() { return g_canvas.h; }

EMSCRIPTEN_KEEPALIVE void pf_set_mouth_open(int on, float v) {
  g_face.setMouthOpenOverride(on != 0, v);
}
EMSCRIPTEN_KEEPALIVE void pf_set_gaze(int on, float h, float v) {
  g_face.setGazeOverride(on != 0, h, v);
}
}
