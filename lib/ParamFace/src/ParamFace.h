// ParamFace — parametric face renderer for StackChan.
// One C++ codebase renders both on-device (M5GFX) and in-browser (WASM +
// canvas-backed M5GFX stub), so the editor preview is the device, not a copy.
//
// Schema decisions (DESIGN.md S1-S8): parts are explicit L/R, expression
// deltas are additive for numbers / replace for enums+strings, neutral is the
// base itself, animation personality lives in the schema and deltas can bend
// it per expression.
#pragma once
#include <stdint.h>

// Real M5GFX on device, canvas stub on host/WASM. Must be a real include:
// the device header defines M5Canvas as a using-alias, so a forward
// `class M5Canvas;` declaration conflicts with it.
#include <M5GFX.h>

namespace paramface {

// Index order is the wire format for setExpression(); keep stable.
enum class Expression : uint8_t { Neutral = 0, Happy, Angry, Sad, Doubt, Sleepy };
constexpr int kExpressionCount = 6;
const char* expressionKey(Expression e);  // "happy", ... (nullptr for Neutral)

enum class EyeShape : uint8_t { Ellipse, RoundRect, Arc, Pixel };
enum class MouthShape : uint8_t { Rect, Arc, Omega, Pixel };
enum class BrowShape : uint8_t { Rect, Arc, Pixel };

// One decoded pixel-skin keyframe (P1-P3). Wire format: palette of up to 15
// "#RRGGBB" colors (pixel index 0 = transparent, k = palette[k-1]) + base64
// RLE bytes, high nibble = run length - 1, low nibble = index, row-major,
// runs may cross rows, run total must equal w*h. Same codec as web/src/face/
// sprite.ts; keep in sync.
struct SpriteFrame {
  uint16_t w = 0, h = 0;  // u16: a smoothed overlay grid can reach 320x240
  uint8_t colors = 0;
  uint16_t palette565[15] = {0};
  uint8_t* pixels = nullptr;  // heap, w*h palette indices; null = absent
  bool present() const { return pixels != nullptr; }
};

// Per-expression overlay resolution (v2.1): absent entry inherits the base
// frame, `hidden:true` suppresses it, an own frame replaces it wholesale.
enum class OverlayMode : uint8_t { Inherit, Hidden, Own };

// One part's keyframe pair. [0]=open, [1]=closed (brows only use [0]).
struct PartFrames {
  SpriteFrame f[2];
  bool present() const { return f[0].present() || f[1].present(); }
};

// Sprites live outside FaceParams: expression deltas never move pixels via
// the merge (P5). Each part carries a per-expression table instead: slot [0]
// (Neutral) is the base pair, slots 1..5 hold own pairs parsed from
// expressions.<name>.parts.<key>.frames — a slot with any present frame
// replaces the whole pair, an empty slot inherits the base one.
struct SpriteSet {
  PartFrames eyeL[kExpressionCount], eyeR[kExpressionCount];
  PartFrames mouth[kExpressionCount];
  PartFrames browL[kExpressionCount], browR[kExpressionCount];
  // Top-level static layer (P6v2): its grid (up to 80x60) maps 1:1 onto the
  // whole design canvas (uniform fit, centered) — no pos, no scale. Smoothing
  // is applied at load time (the set is immutable), so render pays nothing.
  SpriteFrame overlay;
  // v2.1: overlay.expr.<name> table, indexed by Expression. [0] (Neutral)
  // always stays Inherit — neutral IS the base overlay.
  OverlayMode overlayMode[kExpressionCount] = {};
  SpriteFrame overlayExpr[kExpressionCount];
};

// One Scale2x (AdvMAME2x) pass on a palette-index grid: src (w,h) ->
// dst (2w,2h). Defined in Renderer.cpp, shared with the load-time overlay
// expansion in ParamFace.cpp.
void scale2xPass(const uint8_t* src, int w, int h, uint8_t* dst);

struct Lid {
  float angle = 0;  // degrees, positive = clockwise on screen
  float cover = 0;  // 0..1 fraction of eye height covered
};

struct EyeParams {
  bool present = false;
  float x = 0, y = 0;  // center, design-canvas pixels
  EyeShape shape = EyeShape::Ellipse;
  float width = 32, height = 32;
  float cornerRadius = 0;  // roundRect only, px
  float curve = 0;         // arc only, -1..1 (positive = peak up "^")
  float thickness = 4;     // arc stroke, px
  Lid upperLid, lowerLid;
  bool highlight = false;
  int32_t color = -1;  // RGB888, -1 = palette.primary
  float spriteScale = 4;  // pixel shape only: design px per sprite pixel (P2)
  bool smooth = false;    // pixel shape only: Scale2x on the index grid (P8)
};

struct BrowParams {
  bool present = false;
  float x = 0, y = 0;
  BrowShape shape = BrowShape::Rect;
  float width = 40, thickness = 6;
  float angle = 0;  // degrees, positive = clockwise on screen
  float curve = 0.5f;  // arc only
  int32_t color = -1;
  float spriteScale = 4;
  bool smooth = false;
};

struct MouthParams {
  bool present = false;
  float x = 0, y = 0;
  MouthShape shape = MouthShape::Rect;
  // open/close interpolation, the lipsync foundation (kept from m5stack-avatar)
  float minWidth = 50, maxWidth = 90, minHeight = 4, maxHeight = 60;
  float curve = 0;  // arc only, positive = smile "U"
  int32_t color = -1;
  float spriteScale = 4;
  bool smooth = false;
};

struct AnimParams {
  float blinkInterval = 4;     // s, mean gap between blinks
  float blinkDuration = 150;   // ms, full close-open cycle
  float saccadeInterval = 3;   // s, mean gap between gaze jumps
  float saccadeAmplitude = 0.4f;  // 0..1
  float breathPeriod = 3.5f;   // s
  float breathDepth = 0.6f;    // 0..1
};

struct PaletteParams {
  int32_t primary = 0xFFFFFF;
  int32_t secondary = 0xFF99CC;
  int32_t background = 0x000000;
};

struct FaceParams {
  float canvasW = 320, canvasH = 240;
  PaletteParams palette;
  EyeParams eyeL, eyeR;
  BrowParams browL, browR;
  MouthParams mouth;
  AnimParams anim;
};

// Values the animator (or an external driver, e.g. lipsync) feeds per frame.
struct DrivenState {
  float eyeOpenL = 1, eyeOpenR = 1;  // 0..1
  float gazeH = 0, gazeV = 0;        // -1..1
  float breath = 0;                  // 0..1, depth already applied
  float mouthOpen = 0;               // 0..1
};

// Blink / saccade / breath state machines. Shares the schema's personality
// params so preview and device don't just look alike — they behave alike.
class Animator {
 public:
  void reset(uint32_t seed = 0x5EED);
  void tick(float dtMs, const AnimParams& p, DrivenState* out);

 private:
  float rand01();
  uint32_t rng_ = 0x5EED;
  float tMs_ = 0;
  float nextBlinkMs_ = 1000;
  float blinkPhaseMs_ = -1;  // <0 idle, else elapsed in current blink
  float nextSaccadeMs_ = 500;
  float gazeTargetH_ = 0, gazeTargetV_ = 0;
  float gazeH_ = 0, gazeV_ = 0;
};

class ParamFace {
 public:
  ParamFace() = default;
  ~ParamFace();
  ParamFace(const ParamFace&) = delete;
  ParamFace& operator=(const ParamFace&) = delete;

  // Parses face.json; precomputes effective params for all six expressions
  // (base deep-merged with each delta). Returns false + lastError() on bad
  // input; keeps the previous face loaded in that case.
  bool load(const char* json);
  const char* lastError() const { return error_; }

  void setExpression(Expression e) { expr_ = e; }
  Expression expression() const { return expr_; }
  const FaceParams& effective() const { return faces_[static_cast<int>(expr_)]; }

  // Advance animation and draw one frame onto dst (whole-canvas redraw).
  // Scales design canvas to dst size (uniform fit, centered).
  void tick(float dtMs);
  void render(M5Canvas* dst);

  // External drivers win over the animator while enabled.
  void setMouthOpenOverride(bool on, float v = 0) { mouthOverride_ = on; mouthOverrideV_ = v; }
  void setGazeOverride(bool on, float h = 0, float v = 0) { gazeOverride_ = on; gazeOverrideH_ = h; gazeOverrideV_ = v; }

  const DrivenState& driven() const { return driven_; }

 private:
  FaceParams faces_[kExpressionCount];
  SpriteSet sprites_;
  bool loaded_ = false;
  Expression expr_ = Expression::Neutral;
  Animator animator_;
  DrivenState driven_;
  bool mouthOverride_ = false;
  float mouthOverrideV_ = 0;
  bool gazeOverride_ = false;
  float gazeOverrideH_ = 0, gazeOverrideV_ = 0;
  char error_[96] = "";
};

}  // namespace paramface
