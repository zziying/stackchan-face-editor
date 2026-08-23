// face.json parsing + expression delta merge + animation state machines.
// Merge semantics (DESIGN.md S5): numbers add (clamped at parse), everything
// else replaces. Merging happens in JSON DOM space so the rule is uniform,
// then each merged DOM is parsed into a plain FaceParams struct — all six
// expressions are precomputed at load(), so setExpression() is free.
#include "ParamFace.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "ArduinoJson.h"

namespace paramface {

const char* expressionKey(Expression e) {
  switch (e) {
    case Expression::Happy: return "happy";
    case Expression::Angry: return "angry";
    case Expression::Sad: return "sad";
    case Expression::Doubt: return "doubt";
    case Expression::Sleepy: return "sleepy";
    default: return nullptr;
  }
}

// ---------- parse helpers ----------

static float clampf(float v, float lo, float hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

static float numOr(JsonVariantConst v, float dflt) {
  return v.is<float>() ? v.as<float>() : dflt;
}

// "#RRGGBB" -> RGB888 int, or `dflt` when absent/malformed.
static int32_t colorOr(JsonVariantConst v, int32_t dflt) {
  const char* s = v.as<const char*>();
  if (!s || s[0] != '#' || strlen(s) != 7) return dflt;
  char* end = nullptr;
  long val = strtol(s + 1, &end, 16);
  if (!end || *end != '\0') return dflt;
  return static_cast<int32_t>(val);
}

// ---------- pixel-skin sprites (P1-P3) ----------

// Standard base64 -> bytes. Returns decoded length, or -1 on bad input.
static int base64Decode(const char* s, uint8_t* out, int outCap) {
  static const char* kAlpha =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  int n = 0, bits = 0;
  uint32_t acc = 0;
  for (; *s && *s != '='; s++) {
    const char* p = strchr(kAlpha, *s);
    if (!p) return -1;
    acc = (acc << 6) | static_cast<uint32_t>(p - kAlpha);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (n >= outCap) return -1;
      out[n++] = static_cast<uint8_t>(acc >> bits);
    }
  }
  return n;
}

static void freeFrame(SpriteFrame* f) {
  free(f->pixels);
  *f = SpriteFrame();
}

static void freeSpriteSet(SpriteSet* s) {
  PartFrames* tables[] = {s->eyeL, s->eyeR, s->mouth, s->browL, s->browR};
  for (PartFrames* t : tables) {
    for (int i = 0; i < kExpressionCount; i++) {
      freeFrame(&t[i].f[0]);
      freeFrame(&t[i].f[1]);
    }
  }
  freeFrame(&s->overlay);
  for (int i = 0; i < kExpressionCount; i++) {
    freeFrame(&s->overlayExpr[i]);
    s->overlayMode[i] = OverlayMode::Inherit;
  }
}

// nullptr = ok (including "no frame here"), else a static reason string.
// Strict where the vector parser is lenient: a malformed sprite is garbage
// on screen, so reject the whole load like the TS codec does.
static const char* parseSpriteFrame(JsonObjectConst o, SpriteFrame* out,
                                    int maxW = 48, int maxH = 48) {
  if (o.isNull()) return nullptr;
  int w = o["w"] | 0, h = o["h"] | 0;
  if (w < 1 || w > maxW || h < 1 || h > maxH) return "bad dims";
  JsonArrayConst pal = o["palette"];
  if (pal.isNull() || pal.size() > 15) return "bad palette";
  uint16_t palette565[15];
  int colors = 0;
  for (JsonVariantConst v : pal) {
    int32_t rgb = colorOr(v, -1);
    if (rgb < 0) return "bad palette color";
    palette565[colors++] = static_cast<uint16_t>(
        ((rgb >> 8) & 0xF800) | ((rgb >> 5) & 0x07E0) | ((rgb >> 3) & 0x001F));
  }
  const char* data = o["data"].as<const char*>();
  if (!data) return "missing data";
  int cap = static_cast<int>(strlen(data));  // RLE never exceeds base64 length
  uint8_t* rle = static_cast<uint8_t*>(malloc(cap ? cap : 1));
  if (!rle) return "oom";
  int nRle = base64Decode(data, rle, cap);
  if (nRle < 0) { free(rle); return "bad base64"; }
  uint8_t* pixels = static_cast<uint8_t*>(malloc(w * h));
  if (!pixels) { free(rle); return "oom"; }
  int n = 0;
  for (int i = 0; i < nRle; i++) {
    int run = (rle[i] >> 4) + 1, idx = rle[i] & 0x0F;
    if (idx > colors || n + run > w * h) { free(rle); free(pixels); return "bad rle"; }
    memset(pixels + n, idx, run);
    n += run;
  }
  free(rle);
  if (n != w * h) { free(pixels); return "bad rle"; }
  out->w = static_cast<uint16_t>(w);
  out->h = static_cast<uint16_t>(h);
  out->colors = static_cast<uint8_t>(colors);
  memcpy(out->palette565, palette565, sizeof(palette565));
  out->pixels = pixels;
  return nullptr;
}

// Sprite pixels never ride the delta merge (P5). Base frames come from
// parts.<key>.frames; per-expression own pairs come straight from
// expressions.<name>.parts.<key>.frames (the same node that carries the
// vector delta — the merge also copies frames around, but nothing reads
// them from the merged DOM). Writes the failing slot name + reason on error.
static bool parseSprites(JsonObjectConst root, SpriteSet* s, char* err, int errCap) {
  struct Slot { const char* part; const char* frame; int fi; PartFrames* table; };
  const Slot slots[] = {
      {"eyeL", "open", 0, s->eyeL},  {"eyeL", "closed", 1, s->eyeL},
      {"eyeR", "open", 0, s->eyeR},  {"eyeR", "closed", 1, s->eyeR},
      {"mouth", "open", 0, s->mouth}, {"mouth", "closed", 1, s->mouth},
      {"browL", "open", 0, s->browL}, {"browR", "open", 0, s->browR},
  };
  JsonObjectConst exprs = root["expressions"];
  for (int ei = 0; ei < kExpressionCount; ei++) {
    JsonObjectConst parts =
        ei == 0 ? root["parts"].as<JsonObjectConst>()
                : exprs[expressionKey(static_cast<Expression>(ei))]["parts"]
                      .as<JsonObjectConst>();
    if (parts.isNull()) continue;
    for (const Slot& sl : slots) {
      const char* reason =
          parseSpriteFrame(parts[sl.part]["frames"][sl.frame], &sl.table[ei].f[sl.fi]);
      if (reason) {
        snprintf(err, errCap, "sprite %s%s%s/%s: %s",
                 ei ? expressionKey(static_cast<Expression>(ei)) : "", ei ? "/" : "",
                 sl.part, sl.frame, reason);
        return false;
      }
    }
  }
  // P6v2: overlay grid (up to 80x60) maps 1:1 onto the design canvas.
  // Smoothing is pre-expanded at load: the set is immutable and deltas never
  // touch it (P5), so the render loop never pays for Scale2x on the overlay.
  float cw = clampf(numOr(root["canvas"]["width"], 320), 16, 4096);
  float ch = clampf(numOr(root["canvas"]["height"], 240), 16, 4096);
  auto expandSmooth = [cw, ch](SpriteFrame& f) {
    float psx = cw / f.w, psy = ch / f.h;
    float ps = psx < psy ? psx : psy;
    int passes = ps >= 4 ? 2 : (ps >= 2 ? 1 : 0);
    for (int i = 0; i < passes; i++) {
      uint8_t* big = static_cast<uint8_t*>(malloc(f.w * 2 * f.h * 2));
      if (!big) break;  // out of memory: keep the coarser grid, still correct
      scale2xPass(f.pixels, f.w, f.h, big);
      free(f.pixels);
      f.pixels = big;
      f.w = static_cast<uint16_t>(f.w * 2);
      f.h = static_cast<uint16_t>(f.h * 2);
    }
  };
  JsonObjectConst overlay = root["overlay"];
  bool smooth = overlay["smooth"].as<bool>();
  const char* reason =
      parseSpriteFrame(overlay["frames"]["open"], &s->overlay, 80, 60);
  if (reason) {
    snprintf(err, errCap, "sprite overlay: %s", reason);
    return false;
  }
  if (s->overlay.present() && smooth) expandSmooth(s->overlay);
  // v2.1: overlay.expr.<name> — hidden:true suppresses the overlay on that
  // expression, an own frame replaces it wholesale; an entry without a frame
  // inherits the base one (the editor seeds own frames from a base copy).
  JsonObjectConst exprTable = overlay["expr"];
  for (int i = 1; i < kExpressionCount; i++) {
    JsonObjectConst e = exprTable[expressionKey(static_cast<Expression>(i))];
    if (e.isNull()) continue;
    if (e["hidden"].as<bool>()) {
      s->overlayMode[i] = OverlayMode::Hidden;
      continue;
    }
    reason = parseSpriteFrame(e["frames"]["open"], &s->overlayExpr[i], 80, 60);
    if (reason) {
      snprintf(err, errCap, "sprite overlay/%s: %s",
               expressionKey(static_cast<Expression>(i)), reason);
      return false;
    }
    if (s->overlayExpr[i].present()) {
      s->overlayMode[i] = OverlayMode::Own;
      if (smooth) expandSmooth(s->overlayExpr[i]);
    }
  }
  return true;
}

static void parseLid(JsonObjectConst o, Lid* lid) {
  lid->angle = clampf(numOr(o["angle"], lid->angle), -90, 90);
  lid->cover = clampf(numOr(o["cover"], lid->cover), 0, 1);
}

static void parseEye(JsonObjectConst o, EyeParams* p) {
  if (o.isNull()) { p->present = false; return; }
  p->present = true;
  p->x = numOr(o["pos"]["x"], p->x);
  p->y = numOr(o["pos"]["y"], p->y);
  const char* shape = o["shape"].as<const char*>();
  if (shape) {
    if (!strcmp(shape, "roundRect")) p->shape = EyeShape::RoundRect;
    else if (!strcmp(shape, "arc")) p->shape = EyeShape::Arc;
    else if (!strcmp(shape, "pixel")) p->shape = EyeShape::Pixel;
    else p->shape = EyeShape::Ellipse;  // unknown shape -> fallback (S2)
  }
  p->spriteScale = clampf(numOr(o["scale"], p->spriteScale), 1, 8);
  if (o["smooth"].is<bool>()) p->smooth = o["smooth"].as<bool>();
  p->width = clampf(numOr(o["width"], p->width), 1, 640);
  p->height = clampf(numOr(o["height"], p->height), 1, 480);
  p->cornerRadius = clampf(numOr(o["cornerRadius"], p->cornerRadius), 0, 240);
  p->curve = clampf(numOr(o["curve"], p->curve), -1, 1);
  p->thickness = clampf(numOr(o["thickness"], p->thickness), 1, 32);
  parseLid(o["upperLid"], &p->upperLid);
  parseLid(o["lowerLid"], &p->lowerLid);
  if (o["highlight"].is<bool>()) p->highlight = o["highlight"].as<bool>();
  p->color = colorOr(o["color"], p->color);
}

static void parseBrow(JsonObjectConst o, BrowParams* p) {
  if (o.isNull()) { p->present = false; return; }
  p->present = true;
  p->x = numOr(o["pos"]["x"], p->x);
  p->y = numOr(o["pos"]["y"], p->y);
  const char* shape = o["shape"].as<const char*>();
  if (shape) {
    if (!strcmp(shape, "arc")) p->shape = BrowShape::Arc;
    else if (!strcmp(shape, "pixel")) p->shape = BrowShape::Pixel;
    else p->shape = BrowShape::Rect;
  }
  p->spriteScale = clampf(numOr(o["scale"], p->spriteScale), 1, 8);
  if (o["smooth"].is<bool>()) p->smooth = o["smooth"].as<bool>();
  p->width = clampf(numOr(o["width"], p->width), 0, 640);
  p->thickness = clampf(numOr(o["thickness"], p->thickness), 1, 60);
  p->angle = clampf(numOr(o["angle"], p->angle), -90, 90);
  p->curve = clampf(numOr(o["curve"], p->curve), -1, 1);
  p->color = colorOr(o["color"], p->color);
}

static void parseMouth(JsonObjectConst o, MouthParams* p) {
  if (o.isNull()) { p->present = false; return; }
  p->present = true;
  p->x = numOr(o["pos"]["x"], p->x);
  p->y = numOr(o["pos"]["y"], p->y);
  const char* shape = o["shape"].as<const char*>();
  if (shape) {
    if (!strcmp(shape, "arc")) p->shape = MouthShape::Arc;
    else if (!strcmp(shape, "omega")) p->shape = MouthShape::Omega;
    else if (!strcmp(shape, "pixel")) p->shape = MouthShape::Pixel;
    else p->shape = MouthShape::Rect;
  }
  p->spriteScale = clampf(numOr(o["scale"], p->spriteScale), 1, 8);
  if (o["smooth"].is<bool>()) p->smooth = o["smooth"].as<bool>();
  p->minWidth = clampf(numOr(o["minWidth"], p->minWidth), 0, 640);
  p->maxWidth = clampf(numOr(o["maxWidth"], p->maxWidth), 0, 640);
  p->minHeight = clampf(numOr(o["minHeight"], p->minHeight), 0, 480);
  p->maxHeight = clampf(numOr(o["maxHeight"], p->maxHeight), 0, 480);
  p->curve = clampf(numOr(o["curve"], p->curve), -1, 1);
  p->color = colorOr(o["color"], p->color);
}

static void parseFace(JsonObjectConst root, FaceParams* f) {
  f->canvasW = clampf(numOr(root["canvas"]["width"], 320), 16, 4096);
  f->canvasH = clampf(numOr(root["canvas"]["height"], 240), 16, 4096);
  JsonObjectConst pal = root["palette"];
  f->palette.primary = colorOr(pal["primary"], f->palette.primary);
  f->palette.secondary = colorOr(pal["secondary"], f->palette.secondary);
  f->palette.background = colorOr(pal["background"], f->palette.background);
  JsonObjectConst parts = root["parts"];
  parseEye(parts["eyeL"], &f->eyeL);
  parseEye(parts["eyeR"], &f->eyeR);
  parseBrow(parts["browL"], &f->browL);
  parseBrow(parts["browR"], &f->browR);
  parseMouth(parts["mouth"], &f->mouth);
  JsonObjectConst anim = root["animation"];
  f->anim.blinkInterval = clampf(numOr(anim["blink"]["interval"], f->anim.blinkInterval), 0.3f, 60);
  f->anim.blinkDuration = clampf(numOr(anim["blink"]["duration"], f->anim.blinkDuration), 30, 2000);
  f->anim.saccadeInterval = clampf(numOr(anim["saccade"]["interval"], f->anim.saccadeInterval), 0.3f, 60);
  f->anim.saccadeAmplitude = clampf(numOr(anim["saccade"]["amplitude"], f->anim.saccadeAmplitude), 0, 1);
  f->anim.breathPeriod = clampf(numOr(anim["breath"]["period"], f->anim.breathPeriod), 0.5f, 60);
  f->anim.breathDepth = clampf(numOr(anim["breath"]["depth"], f->anim.breathDepth), 0, 1);
}

// Recursive delta application onto a mutable copy of the base DOM:
// object -> recurse, number-on-number -> add, anything else -> replace.
static void mergeDelta(JsonObject dst, JsonObjectConst delta) {
  for (JsonPairConst kv : delta) {
    const char* key = kv.key().c_str();
    JsonVariantConst v = kv.value();
    if (v.is<JsonObjectConst>()) {
      JsonObject child = dst[key].is<JsonObject>()
                             ? dst[key].as<JsonObject>()
                             : dst[key].to<JsonObject>();
      mergeDelta(child, v.as<JsonObjectConst>());
    } else if (v.is<float>() && !v.is<bool>() && dst[key].is<float>() &&
               !dst[key].is<bool>()) {
      dst[key] = dst[key].as<float>() + v.as<float>();
    } else {
      dst[key] = v;
    }
  }
}

bool ParamFace::load(const char* json) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, json);
  if (err) {
    snprintf(error_, sizeof(error_), "json: %s", err.c_str());
    return false;
  }
  JsonObjectConst root = doc.as<JsonObjectConst>();
  if (root.isNull()) {
    snprintf(error_, sizeof(error_), "json: root is not an object");
    return false;
  }

  // heap, not stack: the per-expression tables put SpriteSet near 3KB,
  // too fat for the device task stack
  SpriteSet* stagedSprites = new SpriteSet();
  if (!parseSprites(root, stagedSprites, error_, sizeof(error_))) {
    freeSpriteSet(stagedSprites);
    delete stagedSprites;
    return false;
  }

  FaceParams staged[kExpressionCount];
  parseFace(root, &staged[0]);  // Neutral = base (S5)

  JsonObjectConst exprs = root["expressions"];
  for (int i = 1; i < kExpressionCount; i++) {
    const char* key = expressionKey(static_cast<Expression>(i));
    JsonObjectConst delta = exprs[key];
    if (delta.isNull()) {
      staged[i] = staged[0];
      continue;
    }
    JsonDocument merged;
    merged.set(root);
    mergeDelta(merged.as<JsonObject>(), delta);
    // parse from base defaults so absent-in-merged fields inherit correctly
    staged[i] = FaceParams();
    parseFace(merged.as<JsonObjectConst>(), &staged[i]);
  }

  for (int i = 0; i < kExpressionCount; i++) faces_[i] = staged[i];
  freeSpriteSet(&sprites_);
  sprites_ = *stagedSprites;  // shallow copy hands over pixel ownership
  delete stagedSprites;       // frames are PODs, so this frees only the shell
  if (!loaded_) animator_.reset();
  loaded_ = true;
  error_[0] = '\0';
  return true;
}

ParamFace::~ParamFace() { freeSpriteSet(&sprites_); }

void ParamFace::tick(float dtMs) {
  if (!loaded_) return;
  animator_.tick(dtMs, effective().anim, &driven_);
  if (mouthOverride_) driven_.mouthOpen = clampf(mouthOverrideV_, 0, 1);
  if (gazeOverride_) {
    driven_.gazeH = clampf(gazeOverrideH_, -1, 1);
    driven_.gazeV = clampf(gazeOverrideV_, -1, 1);
  }
}

// ---------- Animator ----------

void Animator::reset(uint32_t seed) {
  rng_ = seed ? seed : 1;
  tMs_ = 0;
  nextBlinkMs_ = 800;
  blinkPhaseMs_ = -1;
  nextSaccadeMs_ = 400;
  gazeTargetH_ = gazeTargetV_ = gazeH_ = gazeV_ = 0;
}

float Animator::rand01() {
  rng_ = rng_ * 1664525u + 1013904223u;  // LCG: same sequence on WASM & device
  return (rng_ >> 8) * (1.0f / 16777216.0f);
}

void Animator::tick(float dtMs, const AnimParams& p, DrivenState* out) {
  if (dtMs < 0) dtMs = 0;
  if (dtMs > 200) dtMs = 200;  // tab-switch / task stall: don't fast-forward
  tMs_ += dtMs;

  // blink: triangular close-open profile over blinkDuration
  float open = 1;
  if (blinkPhaseMs_ >= 0) {
    blinkPhaseMs_ += dtMs;
    float half = p.blinkDuration * 0.5f;
    if (blinkPhaseMs_ >= p.blinkDuration) {
      blinkPhaseMs_ = -1;
    } else if (blinkPhaseMs_ < half) {
      open = 1 - blinkPhaseMs_ / half;
    } else {
      open = (blinkPhaseMs_ - half) / half;
    }
  } else if (tMs_ >= nextBlinkMs_) {
    blinkPhaseMs_ = 0;
    open = 1;
    nextBlinkMs_ = tMs_ + p.blinkInterval * 1000.0f * (0.6f + 0.8f * rand01());
  }
  out->eyeOpenL = out->eyeOpenR = open;

  // saccade: jump to a random target, ease toward it
  if (tMs_ >= nextSaccadeMs_) {
    if (rand01() < 0.35f) {
      gazeTargetH_ = gazeTargetV_ = 0;  // bias back to center
    } else {
      gazeTargetH_ = (rand01() * 2 - 1) * p.saccadeAmplitude;
      gazeTargetV_ = (rand01() * 2 - 1) * p.saccadeAmplitude * 0.6f;
    }
    nextSaccadeMs_ = tMs_ + p.saccadeInterval * 1000.0f * (0.5f + rand01());
  }
  float k = 1 - expf(-dtMs / 60.0f);  // ~60ms time constant
  gazeH_ += (gazeTargetH_ - gazeH_) * k;
  gazeV_ += (gazeTargetV_ - gazeV_) * k;
  out->gazeH = gazeH_;
  out->gazeV = gazeV_;

  out->breath =
      (0.5f + 0.5f * sinf(tMs_ * 2.0f * static_cast<float>(M_PI) /
                          (p.breathPeriod * 1000.0f))) * p.breathDepth;
  out->mouthOpen = 0;  // idle; lipsync overrides via ParamFace
}

}  // namespace paramface
