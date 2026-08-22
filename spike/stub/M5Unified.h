// Spike stub: minimal M5Unified replacement. M5.Display IS the framebuffer —
// the avatar's real strip-DMA drawing path runs unchanged and lands here.
#pragma once
#include "M5GFX.h"

struct M5_t {
  M5Canvas Display;
  M5Canvas &Lcd = Display;
  M5_t() {
    Display.createSprite(320, 240);
    Display.setColorDepth(16);
  }
};

inline M5_t M5;
