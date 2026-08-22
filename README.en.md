# stackchan-face-editor

[中文](README.md) | **English**

Browser-based parametric face editor for [StackChan](https://github.com/meganetaaan/stack-chan) /
[m5stack-avatar](https://github.com/meganetaaan/m5stack-avatar) — sculpt a living face
(blinks, breathes, lipsyncs), share it as a URL, run it on the device with zero compiling.

**Fidelity by construction**: the editor preview and the device run the *same C++ renderer*
(`lib/ParamFace`), compiled to WASM for the browser and as an Arduino library for the ESP32.
No codegen, no reimplementation drift.

## Layout

```
web/       Vite + React editor (WASM preview, param panels, expression tabs, URL share)
lib/       ParamFace — parametric renderer + animator (C++, WASM & Arduino targets)
firmware/  reference firmware (serial protocol / SD card / flash face.json loading)
faces/     official preset faces (face.json)
spike/     feasibility spike (m5stack-avatar compiled to WASM untouched)
DESIGN.md  full decision log: architecture, schema S1-S8
```

## Run it on your StackChan

Two paths, depending on who you are.

### Path A — flash the reference firmware (no dev environment beyond Arduino)

`firmware/ParamFaceReference/` is a minimal firmware whose only job is to be a
face: it renders ParamFace at ~30 fps and speaks the editor's serial protocol.
Flash it once, then swap faces forever without recompiling — from the editor
("Push to device" over Web Serial), from a script over the serial monitor, or
by dropping a `face.json` onto the SD card.

```bash
arduino-cli compile --fqbn m5stack:esp32:m5stack_cores3 \
  --library $PWD/lib/ParamFace firmware/ParamFaceReference/
arduino-cli upload  --fqbn m5stack:esp32:m5stack_cores3 \
  --port /dev/cu.usbmodemXXX firmware/ParamFaceReference/
```

Boot loads `SD:/face.json` → flash `/face.json` → built-in default.
Serial protocol (newline-delimited, also usable by hand from a monitor):

| Command | Effect |
| --- | --- |
| `PING` | replies `OK PF 1` |
| `FACE <json>` | apply a face.json live (RAM only; single line) |
| `EXPR <0-5\|name>` | switch expression (`neutral happy angry sad doubt sleepy`) |
| `TALK <0..1\|off>` | drive mouth-open externally (lipsync); `off` returns it to the animator |
| `SAVE` | persist the last applied json to flash (survives reboot) |
| `STAT` / `REBOOT` | status / restart |

Prefer no cable at all? The firmware has a compile-time WiFi option
(`PF_ENABLE_WIFI 1` + your credentials at the top of the sketch): it then
serves the same HTTP face API the editor's **WiFi** button speaks, so edits
live-push over the network instead of USB. Works when the editor itself is
served over plain HTTP (localhost or your own dev server) — an HTTPS-hosted
editor can't call an HTTP device (browser mixed-content rule); there the
serial channel or curl still works.

**Trade-off**: the reference firmware *replaces* whatever your StackChan was
running — servo choreography, voice features, whatever your original firmware
did is gone. It's a demo and an integration reference. If your robot already
has a firmware you like, take Path B.

### Path B — integrate ParamFace into your own firmware (the main course)

Most StackChan owners run a firmware of their own. The point of ParamFace is
that your face stops being C++ you recompile and becomes data you swap: keep
your servos, your voice pipeline, your HTTP API — replace only the
m5stack-avatar rendering layer.

1. **Add the library**: point your build at `lib/ParamFace`
   (`arduino-cli compile --library path/to/lib/ParamFace ...`, or copy it into
   your Arduino libraries folder). No dependencies beyond M5GFX; ArduinoJson is
   vendored inside.

2. **Own the frame loop.** ParamFace has no background task — you pump it:

   ```cpp
   #include <ParamFace.h>
   paramface::ParamFace face;
   M5Canvas canvas(&M5.Display);

   // setup(): canvas.setColorDepth(16); canvas.createSprite(320, 240);
   //          face.load(jsonString);
   // every ~33 ms:
   face.tick(dtMs);          // blink / saccade / breath state machines
   face.render(&canvas);     // whole-frame redraw, scaled to the canvas
   canvas.pushSprite(0, 0);
   ```

   If your firmware has long-blocking handlers (audio streaming, recording),
   run the pump in its own FreeRTOS task so the face keeps animating — and take
   a mutex around `face.load()` vs the tick/render pair, since `load()` rebuilds
   the whole face while `render()` reads it.

3. **Load faces as data.** Boot from SD/flash with an embedded default as
   fallback; accept new json at runtime over whatever channel your firmware
   already has (HTTP POST, MQTT, serial — `face.load()` doesn't care). A face
   that fails to parse keeps the previous face loaded and reports
   `face.lastError()`.

4. **Map your expressions.** The six ParamFace expressions
   (`Neutral Happy Angry Sad Doubt Sleepy`) correspond one-to-one to
   m5stack-avatar's standard set, so existing expression logic ports by
   renaming the enum. Extra house expressions that don't fit the schema can be
   drawn on the canvas *after* `face.render()` — the frame is yours.

5. **Wire the mouth (lipsync).** Where you used
   `avatar.setMouthOpenRatio(r)`, call `face.setMouthOpenOverride(true, r)`
   while audio plays and `face.setMouthOpenOverride(false)` when it ends.
   `setGazeOverride(...)` exists for face-tracking, same pattern. Blink and
   gaze idle motion need no code at all — the animator owns them, with its
   personality (intervals, amplitudes) coming from the face.json.

6. **(Optional) Let the editor live-push over WiFi.** If your firmware exposes
   the keke-style HTTP endpoints — `POST /face` (body = face.json, `?save=1`
   persists), `GET /face?expr=<name>&hold=1` — and answers with
   `Access-Control-Allow-Origin: *`, the editor's **WiFi** button connects
   straight to the device: every edit live-pushes over the network, same feel
   as the serial channel but with no USB cable and from any browser.

A complete worked example of this migration (m5avatar out, ParamFace in, HTTP
face push with CORS, lipsync, subtitle overlay drawn on top) lives in
[keke_firmware](https://github.com/zziying/stackchan-openapi).

## FAQ

**Which browsers can push to the device?** Web Serial is a Chromium API, not a
Chrome exclusive: Chrome, Edge, Arc, Brave, Opera and most Chromium-based
browsers work (Chinese shells like 360/QQ browser usually work in their
"极速/blink" mode). If the connect button lights up, you're fine. Firefox,
Safari and mobile browsers can't connect — the editor itself still runs there,
including URL sharing.

**Do I need the device at all?** No — the editor previews with the same C++
renderer compiled to WASM, and faces share as URLs.

**Why does my face look identical on device and in the browser?** That's the
point. Same renderer, same animator, same json.

## Develop

```bash
# editor
cd web && npm install && npm run dev

# rebuild WASM after touching lib/ (needs emscripten)
./lib/ParamFace/build_wasm.sh

# native render harness (dumps PPM frames per expression)
cd lib/ParamFace/test
c++ -O2 -std=c++17 -I../host -I../vendor -I../src ../src/*.cpp main.cpp -o pf_test && ./pf_test

# logic tests
cd web && npx esbuild tests/editDoc.test.ts --bundle --format=esm --platform=node | node --input-type=module
```

## face.json

Schema v1 — see DESIGN.md for the full spec. Core ideas: explicit L/R parts,
eyelids as a layer over any eye shape, expressions stored as *relative deltas*
(numbers add, enums replace) so a face keeps all six expressions working when
you reshape the base, and animation personality (blink/saccade/breath) lives in
the schema too.

MIT
