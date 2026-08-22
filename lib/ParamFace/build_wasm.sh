#!/bin/bash
# Build ParamFace to WASM for the web editor.
# Output: web/src/wasm/paramface.js (ES module glue) + web/public/paramface.wasm
set -euo pipefail
cd "$(dirname "$0")"

OUT_JS_DIR=../../web/src/wasm
OUT_WASM_DIR=../../web/public
mkdir -p "$OUT_JS_DIR" "$OUT_WASM_DIR"

em++ -O2 -std=c++17 -Ihost -Ivendor -Isrc \
  src/ParamFace.cpp src/Renderer.cpp wasm/pf_wasm.cpp \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createParamFace \
  -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,HEAPU16 \
  -o "$OUT_JS_DIR/paramface.js"

mv "$OUT_JS_DIR/paramface.wasm" "$OUT_WASM_DIR/paramface.wasm"
echo "built: $OUT_JS_DIR/paramface.js + $OUT_WASM_DIR/paramface.wasm"
