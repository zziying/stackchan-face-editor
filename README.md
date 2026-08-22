# stackchan-face-editor

**中文** | [English](README.en.md)

给 [StackChan](https://github.com/meganetaaan/stack-chan) /
[m5stack-avatar](https://github.com/meganetaaan/m5stack-avatar) 做的网页版参数化捏脸器——
捏一张活的脸（会眨眼、会呼吸、会对口型），一条 URL 就能分享，不用编译就能跑上设备。

**保真靠构造，不靠模拟**：编辑器预览和设备跑的是*同一份 C++ 渲染器*
（`lib/ParamFace`），浏览器端编译成 WASM，设备端编译成 Arduino 库。
没有代码生成，也就不存在两套实现慢慢漂移的问题。

## 目录结构

```
web/       Vite + React 编辑器（WASM 预览、参数面板、表情 tab、URL 分享）
lib/       ParamFace —— 参数化渲染器 + 动画器（C++，同时面向 WASM 与 Arduino）
firmware/  参考固件（串口协议 / SD 卡 / flash 加载 face.json）
faces/     官方预设脸（face.json）
spike/     可行性验证（m5stack-avatar 原样编译成 WASM）
DESIGN.md  完整决策记录：架构、schema S1-S8
```

## 跑上你的 StackChan

两条路，看你是哪种玩家。

### 路线 A —— 烧参考固件（除了 Arduino 不需要任何开发环境）

`firmware/ParamFaceReference/` 是一个极简固件，它唯一的工作就是当一张脸：
以约 30 fps 渲染 ParamFace，并听懂编辑器的串口协议。
烧一次，以后换脸永远不用重新编译——可以从编辑器推（Web Serial「推送到设备」）、
可以用脚本走串口，也可以直接把 `face.json` 丢进 SD 卡。

```bash
arduino-cli compile --fqbn m5stack:esp32:m5stack_cores3 \
  --library $PWD/lib/ParamFace firmware/ParamFaceReference/
arduino-cli upload  --fqbn m5stack:esp32:m5stack_cores3 \
  --port /dev/cu.usbmodemXXX firmware/ParamFaceReference/
```

开机加载顺序：`SD:/face.json` → flash `/face.json` → 内置默认脸。
串口协议（按行分隔，用串口监视器手敲也行）：

| 命令 | 作用 |
| --- | --- |
| `PING` | 回复 `OK PF 1` |
| `FACE <json>` | 实时应用一份 face.json（仅内存；单行） |
| `EXPR <0-5\|名字>` | 切换表情（`neutral happy angry sad doubt sleepy`） |
| `TALK <0..1\|off>` | 外部驱动嘴巴开合（对口型）；`off` 交还给动画器 |
| `SAVE` | 把最后应用的 json 持久化到 flash（重启不丢） |
| `STAT` / `REBOOT` | 状态 / 重启 |

想连线都省掉？固件有一个编译期 WiFi 选项（sketch 顶部 `PF_ENABLE_WIFI 1`
加你的 WiFi 凭证）：打开后它会提供编辑器 **WiFi** 按钮所用的同一套 HTTP 换脸
API，编辑就通过网络实时推送而不走 USB。前提是编辑器本身跑在普通 HTTP 上
（localhost 或你自己的 dev server）——HTTPS 托管的编辑器没法调用 HTTP 设备
（浏览器 mixed content 规则）；那种情况下串口通道和 curl 依然可用。

**代价**：参考固件会*替换掉*你 StackChan 上原来的一切——舵机编排、语音功能，
原固件会的它统统没有。它是一个 demo，也是一份集成参考。如果你的机器人已经
有一套你喜欢的固件，走路线 B。

### 路线 B —— 把 ParamFace 集成进你自己的固件（正餐）

大多数 StackChan 玩家跑的是自己的固件。ParamFace 的意义就在于：
脸从「要重新编译的 C++」变成「随时可换的数据」——舵机、语音管线、HTTP API
统统保留，只把 m5stack-avatar 的渲染层换掉。

1. **加库**：把构建指向 `lib/ParamFace`
   （`arduino-cli compile --library path/to/lib/ParamFace ...`，或拷进你的
   Arduino libraries 目录）。除 M5GFX 外零依赖；ArduinoJson 已 vendor 在库里。

2. **帧循环归你管。** ParamFace 没有后台任务——由你来泵：

   ```cpp
   #include <ParamFace.h>
   paramface::ParamFace face;
   M5Canvas canvas(&M5.Display);

   // setup(): canvas.setColorDepth(16); canvas.createSprite(320, 240);
   //          face.load(jsonString);
   // 每 ~33 ms：
   face.tick(dtMs);          // 眨眼 / 视线扫视 / 呼吸状态机
   face.render(&canvas);     // 整帧重绘，按 canvas 尺寸缩放
   canvas.pushSprite(0, 0);
   ```

   如果你的固件有长阻塞的 handler（音频流、录音），把泵放进独立的 FreeRTOS
   task 里，脸就能一直动——注意给 `face.load()` 和 tick/render 之间加互斥锁，
   因为 `load()` 会重建整张脸，而 `render()` 正在读它。

3. **把脸当数据加载。** 开机从 SD/flash 读，内置默认脸兜底；运行时通过你固件
   已有的任何通道接收新 json（HTTP POST、MQTT、串口——`face.load()` 不挑）。
   解析失败的脸不会生效，上一张脸保持不变，并通过 `face.lastError()` 报错。

4. **映射你的表情。** ParamFace 的六个表情
   （`Neutral Happy Angry Sad Doubt Sleepy`）与 m5stack-avatar 的标准表情集
   一一对应，现有表情逻辑改个枚举名就能平移。schema 装不下的自家特色表情，
   可以在 `face.render()` *之后*直接画在 canvas 上——那一帧归你。

5. **接上嘴巴（对口型）。** 原来调 `avatar.setMouthOpenRatio(r)` 的地方，改成
   放音频时调 `face.setMouthOpenOverride(true, r)`，播完调
   `face.setMouthOpenOverride(false)`。人脸追踪用 `setGazeOverride(...)`，
   同一个套路。眨眼和视线的 idle 动作一行代码都不用写——动画器全权负责，
   性格参数（间隔、幅度）来自 face.json。

6. **（可选）让编辑器通过 WiFi 实时推送。** 如果你的固件暴露 keke 风格的
   HTTP 端点——`POST /face`（body = face.json，`?save=1` 持久化）、
   `GET /face?expr=<名字>&hold=1`——并带上
   `Access-Control-Allow-Origin: *` 响应头，编辑器的 **WiFi** 按钮就能直连
   设备：每次编辑都通过网络实时推送，手感和串口通道一样，但不用 USB 线，
   任何浏览器都行。

这套迁移的完整实例（摘掉 m5avatar、装上 ParamFace、带 CORS 的 HTTP 换脸、
对口型、字幕叠加层）在
[keke_firmware](https://github.com/zziying/stackchan-openapi)。

## FAQ

**哪些浏览器能推送到设备？** Web Serial 是 Chromium 的 API，不是 Chrome
独占：Chrome、Edge、Arc、Brave、Opera 以及大多数 Chromium 内核浏览器都行
（360、QQ 浏览器这类国产壳通常在「极速/blink」模式下可用）。连接按钮是亮的
就没问题。Firefox、Safari 和手机浏览器连不上设备——但编辑器本身照常能用，
包括 URL 分享。

**完全没有设备能玩吗？** 能——编辑器的预览用的就是同一份 C++ 渲染器编译成的
WASM，脸用 URL 分享。

**为什么我的脸在设备上和浏览器里长得一模一样？** 这正是设计目标。
同一个渲染器、同一个动画器、同一份 json。

## 开发

```bash
# 编辑器
cd web && npm install && npm run dev

# 改过 lib/ 之后重建 WASM（需要 emscripten）
./lib/ParamFace/build_wasm.sh

# native 渲染验证（逐表情输出 PPM 帧）
cd lib/ParamFace/test
c++ -O2 -std=c++17 -I../host -I../vendor -I../src ../src/*.cpp main.cpp -o pf_test && ./pf_test

# 逻辑测试
cd web && npx esbuild tests/editDoc.test.ts --bundle --format=esm --platform=node | node --input-type=module
```

## face.json

Schema v1——完整规范见 DESIGN.md。核心思想：左右部件显式分开；眼睑是叠在
任意眼型之上的一层；表情存成*相对偏移*（数值相加、枚举替换），所以你重塑
基础脸之后六个表情照样全部成立；动画性格（眨眼/扫视/呼吸）也住在 schema 里。

MIT
