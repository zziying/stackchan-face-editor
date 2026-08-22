# StackChan 网页捏脸器 — 设计文档

> 2026-08-09 工程窗grilling定稿。项目名：stackchan-face-editor。
> 愿景：人人都能用的StackChan参数化捏脸app——捏一张会眨眼、会lipsync的活脸，零编译上真机。

## 定位

- 面向 **m5stack-avatar (Arduino/C++) 生态**（用户大头），流派一（参数化矢量脸）专注路线
- 不做流派二（GIF/像素表情包）；对"为什么不画GIF"的回答：GIF是动画片，参数脸是提线木偶——能被声音/镜头/情绪实时牵动。（v2像素皮肤不违背此线：sprite只是木偶的脸皮，牵线的仍是Animator，见v2主线定位辩护）
- 是工具不是社区平台：无后端、无账号、无画廊

## 竞品结论（2026-08-09调研）

- 官方stack-chan Shape Face Editor：静态摆件排版器，只服务Moddable/JS固件生态，asset标准化排期2027Q1+
- Image-Avatar系（BMP+SD卡）：画图党路线，7部件+统一调色板，门槛高，非工具化
- Arduino生态（m5stack-avatar）网页编辑器：**零**，自定义=手写C++部件类
- migratorywhale/stackchan-mcp：AnimatedGIF表情包路线（流派二），非竞品
- kawaii-home-studio：语音agent桥接，非竞品

## 架构（三件套）

```
浏览器编辑器 (Vite+React+TS)          真机
  └─ WASM: ParamFace (Emscripten)      └─ ParamFace Arduino库
       canvas后端stub M5GFX原语             (同一份C++代码)
              ↑                                ↑
              └────────── face.json ───────────┘
                （schema = 核心资产/通用格式）
```

**保真原理：预览和真机跑的是同一份C++渲染代码，不靠codegen对齐。**

## 已定决策

| # | 决策 | 选择 |
|---|------|------|
| Q1 | 预览渲染引擎 | m5stack-avatar/ParamFace编译WASM（非TS重写） |
| Q2 | 参数自由度 | 参数化部件schema（有语义，表情/动画自动作用）；不做路径级自由绘制。v1脸型覆盖：官方默认脸/矩形眼系/AA颜文字系 |
| Q3 | 交付物 | 脸=JSON + ParamFace运行时库（零编译换脸）；.h codegen降为v2高级导出 |
| Q4 | 表情模型 | base参数 + 六表情delta覆盖层（通用变形规则做默认值）；动画性格参数（眨眼频率/幅度、呼吸深度）进schema，base+表情层均可覆盖 |
| Q5 | 热调参通道 | Web Serial（USB直连）主通道：实时变脸+保存到设备(SPIFFS)；WiFi HTTP为协议预留第二通道（mixed content问题写进文档）。**ParamFace库本体纯渲染**，串口/HTTP解析放参考固件 |
| Q6 | 分享 | URL即分享（JSON压缩进hash，零后端）；画廊不做，faces/目录只放官方预设 |
| Q7 | 发布形态 | GitHub Pages静态托管；Safari/Firefox功能降级（能捏能导出，直推按钮灰）；i18n框架v1进，首发英/中 |

## v1范围

1. ParamFace Arduino库（纯渲染吃JSON）
2. WASM构建（canvas stub M5GFX）
3. 编辑器：参数面板+活体预览（眨眼/saccade/呼吸；lipsync双音源=内置样本+麦克风，Web Audio API）
4. 六表情tab（默认值+delta覆盖）
5. JSON下载 + URL分享
6. Web Serial直推+保存到设备
7. 参考固件示例（串口必带，WiFi端点可选模块；SD卡face.json优先生效——不连线用户的换脸通道）
8. i18n英/中，GitHub Pages
9. 官方预设脸4-5张（含KeFace复刻彩蛋）

**推迟**：.h codegen / GIF导出（喂流派二）/ 日语 / 自定义表情名（love、eyeroll类枚举外）/ 一切后端 / 网页烧录器（esptool-js烧参考固件bin，Web Serial同API——补齐"全程不碰开发工具"的onboarding，v2优先候选）

### v2主线：像素皮肤包（2026-08-15imirenee提案，设计定稿）

> 动森式像素画自由捏脸 + keyframe流水线。发布卡在v2后：纯参数滑杆与官方差异不够大，这个才是招牌。

**定位辩护**（对着"不做流派二"红线说清楚）：这不是GIF表情包——骨架仍是参数化的（pos/动画/表情delta全在），只是部件**外观**从矢量参数换成用户手绘的sprite关键帧，**动画仍由Animator实时驱动**（眨眼节奏/saccade/呼吸/lipsync照常牵动）。"能被声音和情绪实时牵动的提线木偶"卖点原封不动，木偶的脸皮从矢量变成了手绘。

**核心机制（imirenee的keyframe流水线方案）**：用户画"睁眼帧"和"闭眼帧"（嘴=张/闭两帧），Animator让静态帧活起来。帧间**硬切不插值**（eyeOpen<0.5→闭眼帧）：眨眼本来就是100-300ms快动作，像素游戏正统做法，RGB565上交叉淡化只会糊。表达力质变：闭眼可以是`><`、月牙、笑成一条线——形变算法永远给不出这个。

| # | 决策 | 选择 |
|---|------|------|
| P1 | 部件pixel shape | shape枚举加`pixel`；眼/嘴存双帧`frames:{open,closed}`，brow/装饰单帧`frames:{open}`。帧选择阈值0.5硬编码（开洞等真实需求） |
| P2 | sprite网格与缩放 | 每帧自带`w,h`（编辑器默认24×24，上限48×48）+整数`scale`（默认4，最近邻放大保像素锐利）。锚点=sprite中心对齐部件`pos`——saccade/breath/表情位移delta照常作用 |
| P3 | 编码 | 帧内自带palette（≤16色hex数组，索引0=透明）+4bit索引位图，RLE后base64进JSON。24×24一帧<400B，URL分享链路无压力 |
| P4 | 动画映射 | Animator零改动：eyeOpenL/R选眼帧、mouthOpen选嘴帧、gaze/breath作用于绘制偏移、blink时序照旧。说话=张/闭嘴帧交替（现成mouthOpen波形直接吃） |
| P5 | 表情delta | pixel部件数值字段（pos等）照常加性delta；**sprite本身不参与delta**（防5表情×部件×2帧组合爆炸）。per-expression帧覆盖=v2.1可选项，语义整帧替换，没画fallback base帧；**overlay表情级显隐/整帧替换已落地（v2.1，2026-08-16）**：`overlay.expr.<表情>`三态——缺entry=继承base帧、`{hidden:true}`=隐藏、`{frames:{open:...}}`=专属帧整帧替换（有entry但无帧=继承）；编辑器选「专属帧」时从base帧复制起稿；`smooth`仍是overlay全局一个开关，base帧和每个专属帧各在载入时预展开一次 |
| P6 | 装饰层 | 顶层`overlay`槽（S8预留缝）：全屏静态像素层（同P3编码），画腮红/胡子/蝴蝶结。v2先静态，呼吸浮动后议。**P6v2（2026-08-16imirenee提案拍板）**：固定80×60网格**1:1等比映射整张脸**（uniform fit居中）——画哪是哪，pos/scale概念一起取消（多元素布局天然支持）；帧尺寸上限对overlay放宽到80×60（部件仍48）；支持`smooth:bool`，因overlay不受表情delta影响，Scale2x在**载入时预展开**（80×60→320×240缓存），渲染零开销 |
| P7 | 混搭与对称 | pixel与矢量部件可共存（schema天然允许）；对称锁归编辑器UI=sprite水平翻转复制，schema无镜像魔法（S4原则延续） |
| P8 | 平滑开关（2026-08-15imirenee拍板，已实现） | pixel部件加`smooth:bool`（默认false=硬块复古）；true时帧选择后对索引网格跑Scale2x（scale≥2一次、≥4两次，余数最近邻），blit不变。索引域运算不产新色，palette/RGB565天然兼容；固件WASM同源~60行；老固件忽略字段退回硬块。动机：48×48+scale2实测像素感仍重，Scale2x演示图她认可 |

**编辑器流水线（向导式）**：选部件→格子画板画睁眼帧→"下一步"**自动生成闭眼帧初稿**（睁眼帧垂直最近邻压扁~30%居中，用户在草稿上改而非面对空白）→改或直接采纳→嘴两帧同理。全程可跳过，四张小图=一杯奶茶时间。画板组件复用（笔/橡皮/油漆桶/取色器/左右对称镜像/调色板管理），部件和overlay共用同一个画板。

**C++侧**：RLE解码+跳透明blit+最近邻scale+帧选择，WASM/Arduino同源（保真原理不变）。

**wire format（P3字节级，已落地）**：帧=`{w,h,palette,data}`；`palette`≤15个`#RRGGBB`（像素索引0=透明，k=palette[k-1]）；`data`=base64(RLE)，1 token=1字节：高nibble=run长-1（1~16）、低nibble=色索引，行优先、run可跨行，run总数必须恰等于w×h（两端都整体拒载坏数据）。部件级`scale`整数1~8（数值字段，delta可加）。实现两端：`web/src/face/sprite.ts` ↔ `ParamFace.cpp`（parseSpriteFrame），跨端fixture=`faces/pixel-demo.json`（`web/scripts/gen-pixel-demo.ts`生成）。渲染细则：缺帧用另一帧兜底、双帧全缺回退矢量shape（S2精神）；眼睑bg四边形照常叠在sprite上（表情delta因此对pixel脸生效）；pixel眉不吃angle（旋转会碎像素）；overlay固定网格1:1等比映射画布（居中）、最后画、无scale字段；渲染时按当前表情查`overlay.expr`三态表选帧（v2.1，Neutral恒为base）。

**量级**：2-3个session。顺序：schema+编解码→C++渲染（native PPM验证）→WASM→画板组件→流水线向导→真机e2e。

### v2 backlog：自由形状包（2026-08-09提案，降级存档）

原三件套中：**直接操纵已上线**（2026-08-15插队进v1.x，SVG hit层方案）；polygon+morph眨眼（RDP简化+24点重采样+顶点lerp）与矢量decorations让位给像素皮肤包——编辑器侧贝塞尔顶点编辑是UI泥潭，投入产出比不如像素画板。设计细节留git history，若有真实用户要矢量自由形状再捡起。

**用户路径澄清**：捏脸纯网页零连接；烧录只需第一次（烧支持ParamFace的固件）；此后换脸=USB直推或SD卡拷json，永不再编译。

## 执行顺序

**第一步=技术spike**：把m5stack-avatar默认脸原样跑进浏览器canvas（验证M5GFX stub面积+Emscripten工具链）。这步通了后面全顺流；不通再议B计划（TS重写渲染器做临时前端）。

### Spike结果（2026-08-09，已通关✅）

代码在 `spike/`。未改一行库代码，默认脸+六表情+眨眼+张嘴在浏览器实时跑。

- **stub面积**：`stub/M5GFX.h`约220行（RGB565软渲染：fillRect/fillTriangle/fillEllipse/fillArc/fillCircle+draw系+sprite管理+文字哑stub）+ `stub/M5Unified.h` 15行（M5.Display即framebuffer，Face::draw的短册DMA路径原样跑通）
- **需编译的库文件**：Face/Eye/Eyeblow/Mouth/BoundingRect/ColorPalette/DrawContext/DrawingUtils/Gaze共9个cpp；Avatar.cpp（FreeRTOS task层）绕开，动画由JS驱动ctx参数
- **WASM产物30KB**（em++ -O2，注意用em++不是emcc否则C++链接错）；导出`_render(exp,breath,eyeOpen,mouthOpen,gazeH,gazeV)`+`_fb`，JS侧HEAPU16读framebuffer转canvas
- **坑**：Expression枚举顺序=Happy,Angry,Sad,Doubt,Sleepy,Neutral（JS索引必须对齐）；TFT_WHITE/TFT_BLACK/M5_LOGI需stub提供
- 预览页 `spike/web/index.html`：自动眨眼状态机+saccade+呼吸正弦+说话demo（本地 `python3 -m http.server` 即跑）
- Effect特效（happy心形/angry💢）也原样工作

## face.json schema（2026-08-09 grilling定稿）

| # | 决策 | 选择 |
|---|------|------|
| S1 | 表情画法 | **B-lite参数化**：不复用库里硬编码的表情if分支（那是配置器不是捏脸器），把画法翻译成参数，参数集从"能重现库里六表情效果"倒推，不做万能变形系统。保真承诺=编辑器vs真机同一份ParamFace C++，不是vs原库逐像素 |
| S2 | 形状基底 | 每部件shape枚举（字符串，固件遇陌生值回退ellipse+警告）：eye∈{ellipse, roundRect, arc}，mouth∈{rect, arc, omega}，brow∈{rect, arc}。眼睑独立成层叠加任何眼型（upperLid{angle,cover} / lowerLid{cover}），表情主要动眼睑不换shape。mouth保留min/max宽高开合插值（lipsync地基）。`>_<`交叉线眼进v2 |
| S3 | 坐标系 | 绝对像素+顶层`canvas:{width,height}`声明设计基准；固件屏幕不一致自行缩放（v1参考固件等比+居中）。部件位置=中心点`pos:{x,y}` |
| S4 | 左右部件 | 显式分开（eyeL/eyeR/browL/browR），schema无镜像魔法；对称锁是编辑器UI功能 |
| S5 | 表情delta语义 | **相对偏移非绝对快照**：数值字段=加性delta（越界clamp），枚举/bool=替换。改base六表情不散架；出厂六表情delta做成脸型无关的通用变形量（angry=眉外压+眼睑斜切，任何脸自动能用）。neutral=base本身，expressions只有五key。UI显示有效值，存盘减回delta。v1切表情瞬切，lerp过渡v2 |
| S6 | 动画性格 | `animation:{blink:{interval,duration}, saccade:{interval,amplitude}, breath:{period,depth}}`，全数值→自动获得表情delta能力。**Animator是ParamFace的C++模块**（WASM/Arduino同源，"活得一样"），spike的JS动画代码退役，WASM接口从传参数改传时间tick |
| S7 | 颜色 | hex字符串"#RRGGBB"（RGB565不进schema），全局palette三槽{primary,secondary,background}+部件级可选color覆盖；表情delta可覆盖颜色（替换语义，angry整脸涨红）。单色屏降级归渲染端 |
| S8 | 顶层骨架 | 固定5槽，槽缺席=不画（无magic zero）；`version:1`整数（加可选字段不bump，改语义才bump，高版本画认识的部分+警告）；可选`meta:{name,author}` |

### 骨架样例

```jsonc
{
  "version": 1,
  "meta": { "name": "KeFace", "author": "imirenee" },
  "canvas": { "width": 320, "height": 240 },
  "palette": { "primary": "#FFFFFF", "secondary": "#FF99CC", "background": "#000000" },
  "parts": {
    "eyeL":  { "pos": {"x": 230, "y": 96}, "shape": "ellipse", "width": 32, "height": 32,
               "upperLid": {"angle": 0, "cover": 0}, "lowerLid": {"cover": 0} },
    "eyeR":  { "pos": {"x": 90,  "y": 93}, "shape": "ellipse", "width": 32, "height": 32,
               "upperLid": {"angle": 0, "cover": 0}, "lowerLid": {"cover": 0} },
    "mouth": { "pos": {"x": 163, "y": 148}, "shape": "rect",
               "minWidth": 50, "maxWidth": 90, "minHeight": 4, "maxHeight": 60 }
  },
  "animation": { "blink": {"interval": 4, "duration": 150},
                 "saccade": {"interval": 3, "amplitude": 0.4},
                 "breath": {"period": 3.5, "depth": 0.6} },
  "expressions": {
    "happy": { "parts": { "eyeL": {"lowerLid": {"cover": 0.6}}, "eyeR": {"lowerLid": {"cover": 0.6}} } },
    "angry": { "parts": { "eyeL": {"upperLid": {"angle": 25, "cover": 0.3}},
                          "eyeR": {"upperLid": {"angle": 25, "cover": 0.3}} },
               "palette": { "background": "#3A0000" } }
  }
}
```

（expressions内数值均为加性delta；arc眼的curve、roundRect的cornerRadius、brow的angle/thickness等shape专属字段见S2）

## Repo

- monorepo：`web/` + `lib/` + `firmware/`
- MIT（与stackchan-openapi一致）
- 项目名：stackchan-face-editor（已定）
