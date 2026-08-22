// Resolves the library's internal #include "ArduinoJson.h" to the vendored
// single-header copy without requiring the ArduinoJson library to be
// installed. Quoted includes search this directory first, so this shim wins
// in both the Arduino build (which only exposes src/) and the WASM build.
#pragma once
#include "../vendor/ArduinoJson.h"
