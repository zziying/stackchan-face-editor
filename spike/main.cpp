// Spike: render the untouched m5stack-avatar default face on host.
// Drives Face::draw directly (skipping Avatar's FreeRTOS task layer) and
// dumps M5.Display's framebuffer as PPM frames.
#include <cstdio>
#include <string>

#include <M5Unified.h>
#include "ColorPalette.h"
#include "DrawContext.h"
#include "Face.h"

using namespace m5avatar;

static void dumpPPM(const std::string &path) {
  FILE *f = fopen(path.c_str(), "wb");
  fprintf(f, "P6\n%d %d\n255\n", M5.Display.w, M5.Display.h);
  for (int64_t i = 0; i < static_cast<int64_t>(M5.Display.w) * M5.Display.h; i++) {
    uint16_t c = M5.Display.buf[i];
    unsigned char rgb[3] = {
        static_cast<unsigned char>(((c >> 11) & 0x1F) << 3),
        static_cast<unsigned char>(((c >> 5) & 0x3F) << 2),
        static_cast<unsigned char>((c & 0x1F) << 3)};
    fwrite(rgb, 1, 3, f);
  }
  fclose(f);
}

static void frame(Face *face, ColorPalette *palette, Expression exp,
                  float breath, float eyeOpen, float mouthOpen,
                  const std::string &path) {
  DrawContext ctx(exp, breath, palette, Gaze(0, 0), eyeOpen, Gaze(0, 0),
                  eyeOpen, mouthOpen, "", 0.0f, 1.0f, 16,
                  BatteryIconStatus::invisible, 0, nullptr);
  face->draw(&ctx);
  dumpPPM(path);
}

int main() {
  Face *face = new Face();  // library default face, untouched
  ColorPalette palette;

  frame(face, &palette, Expression::Neutral, 0.0f, 1.0f, 0.0f, "f1_neutral.ppm");
  frame(face, &palette, Expression::Neutral, 0.5f, 0.4f, 0.0f, "f2_halfblink.ppm");
  frame(face, &palette, Expression::Neutral, 1.0f, 0.0f, 0.0f, "f3_closed.ppm");
  frame(face, &palette, Expression::Happy, 0.0f, 1.0f, 0.0f, "f4_happy.ppm");
  frame(face, &palette, Expression::Angry, 0.0f, 1.0f, 0.0f, "f5_angry.ppm");
  frame(face, &palette, Expression::Neutral, 0.0f, 1.0f, 0.8f, "f6_mouthopen.ppm");

  printf("6 frames rendered\n");
  delete face;
  return 0;
}
