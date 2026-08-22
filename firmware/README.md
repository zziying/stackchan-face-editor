# ParamFace reference firmware

The device half of the face editor: renders a `face.json` with live blink /
saccade / breath animation, and speaks the editor's serial protocol so you can
push faces over USB without recompiling.

## Flash

```bash
arduino-cli compile --fqbn m5stack:esp32:m5stack_cores3 \
  --library /path/to/stackchan-face-editor/lib/ParamFace \
  firmware/ParamFaceReference/
arduino-cli upload --fqbn m5stack:esp32:m5stack_cores3 --port /dev/cu.usbmodem* \
  firmware/ParamFaceReference/
```

Requires the M5Unified + M5GFX libraries and the m5stack:esp32 core. Arduino
IDE users: add `lib/ParamFace` to your sketchbook libraries folder instead of
`--library`.

Other M5Stack boards: adjust the `PF_SD_*` pin defines at the top of the
sketch (CoreS3 defaults; Core2/Basic pin notes inline). ParamFace itself is
plain M5GFX and scales to any display size.

## Face loading order (boot)

1. `SD:/face.json` — the no-cable path: export from the editor, copy onto the
   card, reboot.
2. Internal flash `/face.json` — whatever was last saved via `SAVE`. Mounted
   as FFat or SPIFFS, whichever the board's partition scheme provides (CoreS3
   defaults to FATFS).
3. Embedded default ("Classic").

A file that fails to parse falls through to the next source.

## Serial protocol

USB CDC, newline-delimited, any baud rate. The editor's **Connect device**
button speaks this; it also works by hand from a serial monitor.

| Command | Reply | Meaning |
|---|---|---|
| `PING` | `OK PF 1` | handshake, protocol version |
| `FACE <json>` | `OK FACE` / `ERR <msg>` | apply face.json live (RAM only; single line) |
| `EXPR <0-5\|name>` | `OK EXPR <n>` | switch expression (`neutral happy angry sad doubt sleepy`) |
| `TALK <0..1\|off>` | `OK TALK ...` | drive mouth-open externally (lipsync); `off` returns it to the animator |
| `SAVE` | `OK SAVE <bytes>` | persist the last applied json to internal flash |
| `STAT` | `OK STAT ...` | SD / flash-fs / heap diagnostics |
| `REBOOT` | `OK REBOOT` | restart (handy for testing the boot loading order) |

Lines starting with `# ` are boot/status logs; ignore them.

## Optional WiFi channel

Set `PF_ENABLE_WIFI 1` and fill in the SSID/password defines. The endpoint set
matches the editor's **WiFi** button, so edits live-push over the network with
no USB cable:

| Endpoint | Meaning |
|---|---|
| `GET /status` | liveness probe (the editor's connect check) |
| `GET /face` | current face.json |
| `GET /face?expr=<name>` | switch expression (`&hold=1` accepted; this firmware never auto-reverts) |
| `POST /face` | apply face.json from the body; `?save=1` persists to flash |

All responses carry `Access-Control-Allow-Origin: *` so browsers may call
them cross-origin. One browser rule remains: an HTTPS-served editor page
cannot call a plain-HTTP device (mixed content) — use a localhost / HTTP
editor origin, or curl.
