// ParamFace reference firmware — the device half of the face editor.
//
// Boot: loads face.json from SD:/face.json, then SPIFFS:/face.json, then the
// embedded default (DESIGN.md v1 item 7 — SD wins so no-cable users can swap
// faces by copying a file onto the card).
//
// Serial protocol (USB CDC, newline-delimited; the editor's Web Serial side
// speaks the same lines, so you can also drive it by hand from a monitor):
//   PING            -> OK PF 1
//   FACE <json>     -> apply face.json live (RAM only; json must be one line)
//   EXPR <0-5|name> -> switch expression (neutral happy angry sad doubt sleepy)
//   TALK <0..1|off> -> drive mouth open externally (lipsync); off = animator
//   SAVE            -> persist the last applied json to SPIFFS:/face.json
// Replies: "OK ..." / "ERR <reason>". Lines starting with "# " are logs.
//
// WiFi is the protocol's second channel (DESIGN.md Q5): compile-time opt-in
// below, off by default. With it on, the endpoint set matches the editor's
// WiFi-push contract — GET /status (connect probe), GET /face?expr=<name>
// (&hold=1 accepted; this firmware never auto-reverts anyway), GET /face
// (read back current json), POST /face (?save=1 persists), permissive CORS —
// so the editor's "WiFi" button can live-push here over the network.
// Caveat: browsers block HTTP device calls from an HTTPS-served editor page
// (mixed content); use a localhost / plain-HTTP editor origin, or curl.

#include <FFat.h>
#include <M5Unified.h>
#include <ParamFace.h>
#include <SD.h>
#include <SPIFFS.h>

#include <string>

// ---- board config -----------------------------------------------------------
// SD pins (default: M5Stack CoreS3). Other boards: Core2/Basic/Fire use
// SCK 18, MISO 38 (Core2) or 19 (Basic/Fire), MOSI 23, CS 4.
// Set PF_SD_CS to -1 to skip SD entirely.
#define PF_SD_SCK 36
#define PF_SD_MISO 35
#define PF_SD_MOSI 37
#define PF_SD_CS 4

#define PF_ENABLE_WIFI 0
#if PF_ENABLE_WIFI
#include <WebServer.h>
#include <WiFi.h>
#define PF_WIFI_SSID "your-ssid"
#define PF_WIFI_PASS "your-password"
WebServer server(80);
#endif

// ---- state ------------------------------------------------------------------
static paramface::ParamFace face;
static M5Canvas canvas(&M5.Display);
static std::string rxLine;   // serial line being accumulated
static std::string lastJson; // last successfully applied json (SAVE writes this)
static uint32_t lastFrameMs = 0;

static constexpr size_t kMaxLine = 32 * 1024;
static constexpr uint32_t kFrameMs = 33; // ~30 fps

// Mirrors faces/default.json ("Classic").
static const char kDefaultFace[] = R"PF({
  "version": 1,
  "meta": { "name": "Classic", "author": "stackchan-face-editor" },
  "canvas": { "width": 320, "height": 240 },
  "palette": { "primary": "#FFFFFF", "secondary": "#FF99CC", "background": "#000000" },
  "parts": {
    "eyeL": { "pos": { "x": 230, "y": 96 }, "shape": "ellipse", "width": 32, "height": 32,
              "upperLid": { "angle": 0, "cover": 0 }, "lowerLid": { "angle": 0, "cover": 0 } },
    "eyeR": { "pos": { "x": 90, "y": 93 }, "shape": "ellipse", "width": 32, "height": 32,
              "upperLid": { "angle": 0, "cover": 0 }, "lowerLid": { "angle": 0, "cover": 0 } },
    "mouth": { "pos": { "x": 163, "y": 148 }, "shape": "rect",
               "minWidth": 50, "maxWidth": 90, "minHeight": 4, "maxHeight": 60 }
  },
  "animation": { "blink": { "interval": 4, "duration": 150 },
                 "saccade": { "interval": 3, "amplitude": 0.4 },
                 "breath": { "period": 3.5, "depth": 0.6 } },
  "expressions": {
    "happy": { "parts": { "eyeL": { "lowerLid": { "cover": 0.6 } },
                          "eyeR": { "lowerLid": { "cover": 0.6 } } } },
    "angry": { "parts": { "eyeL": { "upperLid": { "angle": -22, "cover": 0.4 } },
                          "eyeR": { "upperLid": { "angle": 22, "cover": 0.4 } } } },
    "sad": { "parts": { "eyeL": { "upperLid": { "angle": 18, "cover": 0.35 } },
                        "eyeR": { "upperLid": { "angle": -18, "cover": 0.35 } } } },
    "doubt": { "parts": { "eyeL": { "upperLid": { "cover": 0.45 } },
                          "eyeR": { "upperLid": { "cover": 0.1 } },
                          "mouth": { "minWidth": -14, "maxWidth": -30 } } },
    "sleepy": { "parts": { "eyeL": { "upperLid": { "cover": 0.6 } },
                           "eyeR": { "upperLid": { "cover": 0.6 } } },
                "animation": { "blink": { "interval": 3, "duration": 250 },
                               "breath": { "depth": 0.4 } } }
  }
})PF";

// ---- face loading -----------------------------------------------------------
static bool applyJson(const char* json, const char* source) {
  if (!face.load(json)) {
    Serial.printf("# load from %s failed: %s\r\n", source, face.lastError());
    return false;
  }
  lastJson = json;
  Serial.printf("# face loaded from %s\r\n", source);
  return true;
}

static bool loadFromFile(fs::FS& fs, const char* label) {
  File f = fs.open("/face.json", FILE_READ);
  if (!f) return false;
  String content = f.readString();
  f.close();
  if (content.isEmpty()) return false;
  return applyJson(content.c_str(), label);
}

static bool sdOk = false;
// Internal flash filesystem for SAVE. Which one exists depends on the board's
// partition scheme (CoreS3 default is FATFS, classic Cores ship SPIFFS), so
// mount whichever is there.
static fs::FS* flashFs = nullptr;
static const char* flashFsName = "none";

static void mountFlashFs() {
  if (FFat.begin(true)) {
    flashFs = &FFat;
    flashFsName = "FFat";
  } else if (SPIFFS.begin(true)) {
    flashFs = &SPIFFS;
    flashFsName = "SPIFFS";
  }
}

static void loadBootFace() {
#if PF_SD_CS >= 0
  SPI.begin(PF_SD_SCK, PF_SD_MISO, PF_SD_MOSI, PF_SD_CS);
  sdOk = SD.begin(PF_SD_CS, SPI, 25000000);
  if (sdOk && loadFromFile(SD, "SD")) return;
#endif
  mountFlashFs();
  if (flashFs && loadFromFile(*flashFs, flashFsName)) return;
  applyJson(kDefaultFace, "embedded default");
}

// ---- serial protocol --------------------------------------------------------
static bool setExpressionByArg(const std::string& arg) {
  static const char* names[] = {"neutral", "happy", "angry", "sad", "doubt", "sleepy"};
  if (!arg.empty() && arg[0] >= '0' && arg[0] <= '5' && arg.size() == 1) {
    face.setExpression(static_cast<paramface::Expression>(arg[0] - '0'));
    return true;
  }
  for (int i = 0; i < paramface::kExpressionCount; i++) {
    if (arg == names[i]) {
      face.setExpression(static_cast<paramface::Expression>(i));
      return true;
    }
  }
  return false;
}

static void handleLine(const std::string& line) {
  if (line.empty()) return;
  if (line == "PING") {
    Serial.println("OK PF 1");
  } else if (line == "REBOOT") {
    Serial.println("OK REBOOT");
    delay(100);
    ESP.restart();
  } else if (line == "STAT") {
    Serial.printf("OK STAT sd=%d flashFs=%s heap=%u\r\n",
                  sdOk, flashFsName, (unsigned)ESP.getFreeHeap());
  } else if (line.rfind("FACE ", 0) == 0) {
    const char* json = line.c_str() + 5;
    if (face.load(json)) {
      lastJson = json;
      Serial.println("OK FACE");
    } else {
      Serial.printf("ERR %s\r\n", face.lastError());
    }
  } else if (line.rfind("EXPR ", 0) == 0) {
    if (setExpressionByArg(line.substr(5)))
      Serial.printf("OK EXPR %d\r\n", static_cast<int>(face.expression()));
    else
      Serial.println("ERR bad expression");
  } else if (line.rfind("TALK ", 0) == 0) {
    std::string arg = line.substr(5);
    if (arg == "off") {
      face.setMouthOpenOverride(false);
      Serial.println("OK TALK off");
    } else {
      char* end = nullptr;
      float v = strtof(arg.c_str(), &end);
      if (end == arg.c_str() || *end != '\0') {
        Serial.println("ERR bad talk value");
      } else {
        face.setMouthOpenOverride(true, v);
        Serial.printf("OK TALK %.2f\r\n", v);
      }
    }
  } else if (line == "SAVE") {
    if (lastJson.empty()) {
      Serial.println("ERR nothing to save");
      return;
    }
    if (!flashFs) {
      Serial.println("ERR no flash filesystem");
      return;
    }
    File f = flashFs->open("/face.json", FILE_WRITE);
    if (!f) {
      Serial.println("ERR flash open failed");
      return;
    }
    size_t n = f.print(lastJson.c_str());
    f.close();
    if (n == lastJson.size())
      Serial.printf("OK SAVE %u\r\n", (unsigned)n);
    else
      Serial.printf("ERR short write %u/%u\r\n", (unsigned)n, (unsigned)lastJson.size());
  } else {
    Serial.println("ERR unknown command");
  }
}

static void pollSerial() {
  while (Serial.available()) {
    char c = static_cast<char>(Serial.read());
    if (c == '\n') {
      handleLine(rxLine);
      rxLine.clear();
    } else if (c != '\r') {
      if (rxLine.size() < kMaxLine) {
        rxLine += c;
      } else {
        rxLine.clear();
        Serial.println("ERR line too long");
      }
    }
  }
}

// ---- optional WiFi channel --------------------------------------------------
#if PF_ENABLE_WIFI
static void sendCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
}

static void setupWifi() {
  WiFi.begin(PF_WIFI_SSID, PF_WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("# wifi connect failed");
    return;
  }
  Serial.printf("# wifi up: %s\r\n", WiFi.localIP().toString().c_str());
  // Endpoint set = the editor's WiFi-push contract (README path B, step 6).
  server.on("/status", HTTP_GET, []() {
    sendCors();
    server.send(200, "application/json",
                String("{\"ok\":true,\"heap\":") + ESP.getFreeHeap() + "}");
  });
  server.on("/face", HTTP_GET, []() {
    sendCors();
    String expr = server.arg("expr");
    if (expr.length()) {
      if (setExpressionByArg(expr.c_str()))
        server.send(200, "application/json", "{\"ok\":true}");
      else
        server.send(400, "text/plain", "bad expression");
      return;
    }
    server.send(200, "application/json", lastJson.c_str());
  });
  server.on("/face", HTTP_POST, []() {
    sendCors();
    String body = server.arg("plain");
    if (!face.load(body.c_str())) {
      server.send(400, "text/plain", face.lastError());
      return;
    }
    lastJson = body.c_str();
    if (server.arg("save") == "1" && flashFs) {
      File f = flashFs->open("/face.json", FILE_WRITE);
      if (f) { f.print(lastJson.c_str()); f.close(); }
    }
    server.send(200, "application/json", "{\"ok\":true}");
  });
  server.on("/face", HTTP_OPTIONS, []() {  // preflight, defensive
    sendCors();
    server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    server.send(204, "text/plain", "");
  });
  server.begin();
}
#endif

// ---- arduino entry points ---------------------------------------------------
void setup() {
  Serial.setRxBufferSize(20480); // FACE lines are multi-KB; must be set pre-begin
  auto cfg = M5.config();
  M5.begin(cfg);
  Serial.begin(115200);

  canvas.setColorDepth(16);
  if (!canvas.createSprite(M5.Display.width(), M5.Display.height())) {
    canvas.setColorDepth(8); // no-PSRAM boards: 8-bit sprite, M5GFX converts colors
    canvas.createSprite(M5.Display.width(), M5.Display.height());
  }

  loadBootFace();
#if PF_ENABLE_WIFI
  setupWifi();
#endif
  lastFrameMs = millis();
}

void loop() {
  M5.update();
  pollSerial();
#if PF_ENABLE_WIFI
  server.handleClient();
#endif

  uint32_t now = millis();
  uint32_t dt = now - lastFrameMs;
  if (dt >= kFrameMs) {
    lastFrameMs = now;
    face.tick(static_cast<float>(dt));
    face.render(&canvas);
    canvas.pushSprite(0, 0);
  }
}
