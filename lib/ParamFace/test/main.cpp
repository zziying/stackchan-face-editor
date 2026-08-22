// Host harness: load a face.json, dump PPM frames for every expression plus
// blink/talk states. Eyeball the output before trusting the WASM build.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <M5GFX.h>

#include "ParamFace.h"

using paramface::Expression;
using paramface::ParamFace;

static void arcTests(ParamFace& arcFace, M5Canvas& canvas);

static void dumpPPM(M5Canvas& c, const char* path) {
  FILE* f = fopen(path, "wb");
  if (!f) { perror(path); exit(1); }
  fprintf(f, "P6\n%d %d\n255\n", c.w, c.h);
  for (int i = 0; i < c.w * c.h; i++) {
    uint16_t p = c.buf[i];
    unsigned char rgb[3] = {
        static_cast<unsigned char>(((p >> 11) & 0x1F) << 3),
        static_cast<unsigned char>(((p >> 5) & 0x3F) << 2),
        static_cast<unsigned char>((p & 0x1F) << 3)};
    fwrite(rgb, 1, 3, f);
  }
  fclose(f);
  printf("wrote %s\n", path);
}

int main(int argc, char** argv) {
  const char* jsonPath = argc > 1 ? argv[1] : "../../faces/default.json";
  FILE* f = fopen(jsonPath, "rb");
  if (!f) { perror(jsonPath); return 1; }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  char* json = static_cast<char*>(malloc(n + 1));
  fread(json, 1, n, f);
  json[n] = '\0';
  fclose(f);

  ParamFace face;
  if (!face.load(json)) {
    fprintf(stderr, "load failed: %s\n", face.lastError());
    return 1;
  }
  free(json);

  M5Canvas canvas;
  canvas.createSprite(320, 240);

  const char* names[] = {"neutral", "happy", "angry", "sad", "doubt", "sleepy"};
  char path[128];
  for (int i = 0; i < paramface::kExpressionCount; i++) {
    face.setExpression(static_cast<Expression>(i));
    face.tick(16);
    face.render(&canvas);
    snprintf(path, sizeof(path), "out_%d_%s.ppm", i, names[i]);
    dumpPPM(canvas, path);
  }

  // talk frame: mouth wide open, neutral
  face.setExpression(Expression::Neutral);
  face.setMouthOpenOverride(true, 1.0f);
  face.tick(16);
  face.render(&canvas);
  dumpPPM(canvas, "out_talk.ppm");
  face.setMouthOpenOverride(false);

  // ride the animator until a blink closes the eyes, dump the closed frame
  for (int i = 0; i < 4000; i++) {
    face.tick(16);
    if (face.driven().eyeOpenL < 0.2f) break;
  }
  face.render(&canvas);
  dumpPPM(canvas, "out_blink.ppm");
  printf("eyeOpen at blink frame: %.2f\n", face.driven().eyeOpenL);

  // arc-eye face (^_^ + smile mouth): verify the arc sweep stays a small
  // segment through open/half/closed blink phases (regression: swapped
  // angles painted the complement ring once R exploded on flat curves)
  static const char* kArcFace = R"({
    "version": 1,
    "canvas": {"width": 320, "height": 240},
    "palette": {"primary": "#FFFFFF", "secondary": "#FF99CC", "background": "#000000"},
    "parts": {
      "eyeL": {"pos": {"x": 230, "y": 96}, "shape": "arc", "width": 44, "height": 28, "curve": 0.8, "thickness": 5},
      "eyeR": {"pos": {"x": 90, "y": 96}, "shape": "arc", "width": 44, "height": 28, "curve": 0.8, "thickness": 5},
      "mouth": {"pos": {"x": 160, "y": 150}, "shape": "arc", "curve": 0.7,
                "minWidth": 60, "maxWidth": 80, "minHeight": 5, "maxHeight": 50}
    }
  })";
  ParamFace arcFace;
  if (!arcFace.load(kArcFace)) {
    fprintf(stderr, "arc face load failed: %s\n", arcFace.lastError());
    return 1;
  }
  arcTests(arcFace, canvas);

  // pixel-skin face (schema v2): TS-encoded fixture through the C++ decoder.
  // Frames: open/closed keyframe switch on blink + talk, lid deltas over
  // sprites, blush overlay on top.
  const char* pixPath = argc > 2 ? argv[2] : "../../faces/pixel-demo.json";
  FILE* pf = fopen(pixPath, "rb");
  if (!pf) { perror(pixPath); return 1; }
  fseek(pf, 0, SEEK_END);
  long pn = ftell(pf);
  fseek(pf, 0, SEEK_SET);
  char* pjson = static_cast<char*>(malloc(pn + 1));
  fread(pjson, 1, pn, pf);
  pjson[pn] = '\0';
  fclose(pf);
  ParamFace pix;
  if (!pix.load(pjson)) {
    fprintf(stderr, "pixel face load failed: %s\n", pix.lastError());
    return 1;
  }
  free(pjson);
  pix.tick(16);
  pix.render(&canvas);
  dumpPPM(canvas, "out_pixel_open.ppm");
  pix.setMouthOpenOverride(true, 1.0f);
  pix.tick(16);
  pix.render(&canvas);
  dumpPPM(canvas, "out_pixel_talk.ppm");
  pix.setMouthOpenOverride(false);
  for (int i = 0; i < 8000; i++) {
    pix.tick(16);
    if (pix.driven().eyeOpenL < 0.4f) break;
  }
  pix.render(&canvas);
  dumpPPM(canvas, "out_pixel_closed.ppm");
  printf("pixel eyeOpen at blink frame: %.2f\n", pix.driven().eyeOpenL);
  pix.setExpression(Expression::Happy);
  // let the blink finish so happy is captured on the open keyframe
  for (int i = 0; i < 200 && pix.driven().eyeOpenL < 0.9f; i++) pix.tick(16);
  pix.tick(16);
  pix.render(&canvas);
  dumpPPM(canvas, "out_pixel_happy.ppm");

  // v2.1 per-expression overlay: the fixture keeps the blush on neutral/happy,
  // swaps in a red vein (own frame) on angry, hides the overlay on sleepy
  auto count565 = [&canvas](uint16_t c) {
    int n = 0;
    for (int i = 0; i < 320 * 240; i++) n += canvas.buf[i] == c;
    return n;
  };
  const uint16_t kBlush = ((0xFF9EC4 >> 8) & 0xF800) | ((0xFF9EC4 >> 5) & 0x07E0) | ((0xFF9EC4 >> 3) & 0x001F);
  const uint16_t kVein = ((0xE03A3A >> 8) & 0xF800) | ((0xE03A3A >> 5) & 0x07E0) | ((0xE03A3A >> 3) & 0x001F);
  struct OvCase { Expression e; const char* name; bool blush, vein; };
  const OvCase ovCases[] = {
      {Expression::Neutral, "neutral", true, false},
      {Expression::Happy, "happy", true, false},
      {Expression::Angry, "angry", false, true},
      {Expression::Sleepy, "sleepy", false, false},
  };
  for (const OvCase& oc : ovCases) {
    pix.setExpression(oc.e);
    pix.render(&canvas);
    int blush = count565(kBlush), vein = count565(kVein);
    if ((blush > 0) != oc.blush || (vein > 0) != oc.vein) {
      fprintf(stderr, "FAIL: overlay on %s: blush=%d vein=%d (want blush%s, vein%s)\n",
              oc.name, blush, vein, oc.blush ? ">0" : "=0", oc.vein ? ">0" : "=0");
      return 1;
    }
  }
  pix.setExpression(Expression::Angry);
  pix.render(&canvas);
  dumpPPM(canvas, "out_pixel_angry.ppm");
  pix.setExpression(Expression::Neutral);
  printf("per-expression overlay: neutral/happy blush, angry vein, sleepy hidden — ok\n");

  // smooth (P8): 8x8 two-px diagonal at scale 8 — Scale2x must change the
  // staircase, and at scale 1 (no pass) smooth must be a no-op
  static const char* kSmoothFace = R"({
    "version": 1, "canvas": {"width": 320, "height": 240},
    "palette": {"primary": "#FFFFFF", "secondary": "#FF99CC", "background": "#000000"},
    "parts": {"eyeL": {"pos": {"x": 160, "y": 120}, "shape": "pixel",
      "scale": %d, "smooth": %s,
      "frames": {"open": {"w": 8, "h": 8, "palette": ["#FFFFFF"], "data": "AWARYBFgEWARYBFgEWAR"}}}}
  })";
  auto renderSmooth = [&canvas](int scale, const char* smooth, uint16_t* out) {
    char buf[640];
    snprintf(buf, sizeof(buf), kSmoothFace, scale, smooth);
    ParamFace pf2;
    if (!pf2.load(buf)) {
      fprintf(stderr, "smooth face load failed: %s\n", pf2.lastError());
      exit(1);
    }
    pf2.render(&canvas);
    memcpy(out, canvas.buf, 320 * 240 * sizeof(uint16_t));
  };
  static uint16_t bufOff[320 * 240], bufOn[320 * 240];
  renderSmooth(8, "false", bufOff);
  dumpPPM(canvas, "out_smooth_off.ppm");
  renderSmooth(8, "true", bufOn);
  dumpPPM(canvas, "out_smooth_on.ppm");
  if (!memcmp(bufOff, bufOn, sizeof(bufOff))) {
    fprintf(stderr, "FAIL: smooth at scale 8 changed nothing\n");
    return 1;
  }
  renderSmooth(1, "false", bufOff);
  renderSmooth(1, "true", bufOn);
  if (memcmp(bufOff, bufOn, sizeof(bufOff))) {
    fprintf(stderr, "FAIL: smooth at scale 1 should be a no-op\n");
    return 1;
  }
  printf("smooth: scale8 differs, scale1 no-op — ok\n");

  // malformed sprite data must reject the whole load and keep the old face
  ParamFace bad;
  const char* kBadPixel = R"({
    "version": 1, "canvas": {"width": 320, "height": 240},
    "parts": {"eyeL": {"pos": {"x": 100, "y": 100}, "shape": "pixel",
      "frames": {"open": {"w": 4, "h": 4, "palette": ["#FFFFFF"], "data": "////"}}}}
  })";
  if (bad.load(kBadPixel)) {
    fprintf(stderr, "FAIL: malformed sprite accepted\n");
    return 1;
  }
  printf("malformed sprite rejected: %s\n", bad.lastError());
  return 0;
}

static void arcTests(ParamFace& arcFace, M5Canvas& canvas) {
  arcFace.tick(16);
  arcFace.render(&canvas);
  dumpPPM(canvas, "out_arc_open.ppm");
  bool gotMid = false;
  for (int i = 0; i < 8000; i++) {
    arcFace.tick(16);
    float open = arcFace.driven().eyeOpenL;
    if (!gotMid && open > 0.3f && open < 0.7f) {
      arcFace.render(&canvas);
      dumpPPM(canvas, "out_arc_mid.ppm");
      gotMid = true;
    } else if (gotMid && open < 0.2f) {
      arcFace.render(&canvas);
      dumpPPM(canvas, "out_arc_closed.ppm");
      break;
    }
  }
}
