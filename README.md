# stackchan-face-editor

**中文** | [English](README.en.md)

基于浏览器的参数化捏脸器，适用于 [StackChan](https://github.com/meganetaaan/stack-chan) /
[m5stack-avatar](https://github.com/meganetaaan/m5stack-avatar)。它能让你像雕刻一样捏出一张活的脸（会眨眼、会呼吸、会对口型），通过 URL 轻松分享，并在硬件设备上零编译直接运行。

**保真靠构造（Fidelity by construction）**：编辑器的预览端和硬件设备运行的是**同一个 C++ 渲染器**（`lib/ParamFace`），分别被编译为用于浏览器的 WASM 和用于 ESP32 的 Arduino 库。没有代码生成，也就杜绝了双端实现漂移。

## 🍱 开盖即食

编辑器已托管在 GitHub Pages，打开就能捏，什么都不用装：

**https://zziying.github.io/stackchan-face-editor/**

在线版能做的事：实时预览（眨眼呼吸全都动）、六表情编辑、预设脸画廊、像素装饰层、URL 分享，以及通过 Web Serial 用 USB 线直推设备（Chromium 系浏览器）。第一次来建议直接点右上角的「向导」，一步步带你捏出一张活脸。

唯一的例外是 **WiFi 实时推送**：在线版跑在 HTTPS 上，浏览器的 mixed content 规则不允许它调用 HTTP 设备，所以 WiFi 按钮只在 http 环境下出现（在线版看不到它是正常的）。想用 WiFi 通道，就本地跑一份：

```bash
cd web && npm install && npm run dev   # localhost 上 WiFi 直推可用
```

想部署一份自己的在线版也很简单：fork 本仓库，在 Settings → Pages 里把 Source 设为 **GitHub Actions**——仓库自带部署 workflow（`.github/workflows/deploy-pages.yml`），此后每次 push 到 main 都会自动发布。

## 📁 目录结构

```text
web/       Vite + React 编辑器（WASM 预览、参数面板、表情标签页、URL 分享）
lib/       ParamFace — 参数化渲染器 + 动画引擎（C++，支持 WASM 与 Arduino 目标平台）
firmware/  参考固件（串口协议 / SD 卡 / 闪存加载 face.json）
faces/     官方预设脸（face.json）
spike/     可行性验证（m5stack-avatar 原封不动编译为 WASM）
DESIGN.md  完整决策日志：架构设计与 schema 规范 S1-S8
```

---

## 🚀 在你的 StackChan 上运行

提供两条路径，取决于你是哪种玩家。

### 路径 A — 烧录参考固件（除了 Arduino 外无需其他开发环境）

`firmware/ParamFaceReference/` 是一个极简固件，其唯一职责就是当一张脸：以约 30 fps 的帧率渲染 ParamFace 并解析编辑器的串口协议。
烧录一次即可，之后无需重新编译即可永久换脸 —— 可以通过编辑器（Web Serial「推送至设备」）、串口监视器的脚本，或者直接将 `face.json` 丢进 SD 卡。

```bash
arduino-cli compile --fqbn m5stack:esp32:m5stack_cores3 \
  --library $PWD/lib/ParamFace firmware/ParamFaceReference/
arduino-cli upload  --fqbn m5stack:esp32:m5stack_cores3 \
  --port /dev/cu.usbmodemXXX firmware/ParamFaceReference/
```

启动加载顺序：`SD:/face.json` → 闪存 `/face.json` → 内置默认脸。
串口协议（换行符分隔，也支持在串口监视器中手动输入）：

| 命令 | 效果 |
| --- | --- |
| `PING` | 回复 `OK PF 1` |
| `FACE <json>` | 实时应用一份 face.json（仅内存；单行） |
| `EXPR <0-5\|name>` | 切换表情（`neutral happy angry sad doubt sleepy`） |
| `TALK <0..1\|off>` | 外部驱动嘴巴开合（口型同步）；`off` 将控制权交还给动画引擎 |
| `SAVE` | 将最后应用的 json 持久化到闪存（重启后不丢失） |
| `STAT` / `REBOOT` | 状态查询 / 重启 |

**想要完全摆脱数据线？** 该固件提供了一个编译期 WiFi 选项（在 sketch 顶部开启 `PF_ENABLE_WIFI 1` 并填入你的 WiFi 凭证）：开启后它会提供与编辑器 **WiFi** 按钮相同的 HTTP 换脸 API，从而实现通过网络（而非 USB）实时推送修改。这在编辑器本身通过纯 HTTP 提供服务时可用（如 `localhost` 或你自己的开发服务器）；如果编辑器托管在 HTTPS 下，则由于浏览器的「混合内容（mixed content）」规则无法调用 HTTP 设备，此时串口通道和 `curl` 依然可用。

**权衡取舍**：参考固件会**替换**掉你 StackChan 原本运行的一切 —— 舵机编排、语音功能等原固件逻辑将会消失。它主要用作 Demo 和集成参考。如果你的机器人已经有一套满意的固件，请走**路径 B**。

---

### 路径 B — 将 ParamFace 集成到你自己的固件中（正餐）

绝大多数 StackChan 玩家都在运行自己的定制固件。ParamFace 的核心价值在于：**让脸不再是需要重新编译的 C++ 代码，而变成可以随时替换的数据**。保留你的舵机控制、语音管线、HTTP API —— 仅替换 m5stack-avatar 的渲染层。

1. **引入库**：将你的构建指向 `lib/ParamFace`（例如 `arduino-cli compile --library path/to/lib/ParamFace ...`，或者将其复制到你的 Arduino libraries 目录下）。除 M5GFX 外无其他外部依赖，ArduinoJson 已 vendor 在库内。

2. **掌控帧循环**。ParamFace 没有后台任务 —— 需要你主动驱动它：

   ```cpp
   #include <ParamFace.h>
   paramface::ParamFace face;
   M5Canvas canvas(&M5.Display);

   // setup() 中: canvas.setColorDepth(16); canvas.createSprite(320, 240);
   //           face.load(jsonString);
   // 每隔约 33 毫秒:
   face.tick(dtMs);        // 眨眼 / 扫视 / 呼吸状态机
   face.render(&canvas);   // 全帧重绘，缩放至 canvas
   canvas.pushSprite(0, 0);
   ```

   如果你的固件包含长时间阻塞的处理逻辑（如音频流传输、录音），请把这个循环放进独立的 FreeRTOS 任务中，脸就能一直动；同时由于 `face.load()` 会重建整张脸，而 `render()` 正在读取它，请在 `face.load()` 与 tick/render 之间加互斥锁（mutex）。

3. **把脸当数据加载**：开机从 SD 卡或闪存读取，内置默认脸兜底；支持在运行时通过固件现有的任意通道（HTTP POST、MQTT、串口 —— `face.load()` 不挑来源）接收新的 json。解析失败的 json 不会生效，上一张脸保持不变，并通过 `face.lastError()` 报告错误。

4. **映射你的表情**：ParamFace 的六种表情（`Neutral`、`Happy`、`Angry`、`Sad`、`Doubt`、`Sleepy`）与 m5stack-avatar 的标准表情集一一对应，因此只需重命名枚举即可平移现有的表情逻辑。schema 装不下的自家特色表情可以在 `face.render()` **之后**直接绘制在画布上 —— 那一帧的控制权完全在你手中。

5. **接上嘴巴（口型同步）**：将原本调用 `avatar.setMouthOpenRatio(r)` 的地方替换为：播放音频时调用 `face.setMouthOpenOverride(true, r)`，结束时调用 `face.setMouthOpenOverride(false)`。同理，人脸追踪可用 `setGazeOverride(...)`。而眨眼和视线的闲置动作完全不需要编写代码 —— 动画引擎会自动处理，其性格参数（频率、幅度）均来自 `face.json`。

6. **（可选）允许编辑器通过 WiFi 实时推送**：如果你的固件暴露了与 [stackchan-openapi](https://github.com/zziying/stackchan-openapi) 相同的 HTTP 端点 —— `POST /face`（请求体为 face.json，带 `?save=1` 参数可持久化）、`GET /face?expr=<name>&hold=1` —— 并且响应头包含 `Access-Control-Allow-Origin: *`，那么编辑器的 **WiFi** 按钮就可以直连设备：每次编辑都通过网络实时推送，体验与串口通道一致，但摆脱了 USB 数据线的束缚，且任意浏览器均可使用。

这套迁移的完整实例（移除 m5avatar、接入 ParamFace、带 CORS 的 HTTP 换脸、口型同步、以及叠加显示字幕）可参考 [keke_firmware](https://github.com/zziying/stackchan-openapi)。

---

## ❓ 常见问题（FAQ）

**哪些浏览器支持向设备推送？**
Web Serial 是 Chromium 系 API，并不是 Chrome 独占：Chrome、Edge、Arc、Brave、Opera 及大部分基于 Chromium 的浏览器均可（国产双核浏览器如 360/QQ 浏览器通常在「极速/Blink」模式下可用）。只要连接按钮是亮的，就可以正常使用。Firefox、Safari 以及移动端浏览器无法连接设备 —— 但编辑器本身的各项功能（包括 URL 分享）依然可以在这些浏览器上运行。

**完全没有实体设备能玩吗？**
能 —— 编辑器的预览用的就是同一份 C++ 渲染器编译成的 WASM，捏好的脸通过 URL 分享。

**为什么我的脸在设备上和浏览器里看起来一模一样？**
这正是本项目的核心目标。相同的渲染器，相同的动画引擎，相同的 json。

---

## 🛠️ 开发与构建

```bash
# 启动编辑器前端
cd web && npm install && npm run dev

# 修改 lib/ 之后重新编译 WASM（需要安装 emscripten）
./lib/ParamFace/build_wasm.sh

# 原生渲染验证（为每个表情导出 PPM 帧）
cd lib/ParamFace/test
c++ -O2 -std=c++17 -I../host -I../vendor -I../src ../src/*.cpp main.cpp -o pf_test && ./pf_test

# 运行逻辑测试
cd web && npx esbuild tests/editDoc.test.ts --bundle --format=esm --platform=node | node --input-type=module
```

## 📄 关于 face.json

Schema v1 —— 完整规范见 `DESIGN.md`。核心理念：左右部件显式分开；眼睑作为一层覆盖在任意眼型之上；表情以**相对偏移（relative deltas）**的形式存储（数值相加、枚举替换），因此当你重塑基础脸型时，六种表情依然全部成立；动画性格参数（眨眼/扫视/呼吸）也一并纳入 schema 管理。

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
