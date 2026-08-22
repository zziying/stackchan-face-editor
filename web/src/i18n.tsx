// Tiny homemade i18n: English strings are the keys, missing entries fall
// back to English, so the app never breaks on an untranslated string.
import { createContext, useContext, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'zh';

const ZH: Record<string, string> = {
  // header
  'face name': '脸的名字',
  symmetry: '左右对称',
  talk: '说话',
  New: '新建',
  'start a new face? the current one will be replaced':
    '开一张新脸？当前这张会被替换（想留的话先导出）',
  'new face started': '已开新脸',
  Import: '导入',
  Export: '导出',
  Share: '分享',
  'Connect device': '连接设备',
  'Connecting…': '连接中…',
  Disconnect: '断开',
  'Save to device': '保存到设备',
  'USB-connect a StackChan running the reference firmware':
    '用USB线连接一台跑参考固件的StackChan',
  'Web Serial needs Chrome or Edge': 'Web Serial需要Chrome或Edge',
  WiFi: 'WiFi',
  'device IP': '填入设备IP',
  Connect: '连接',
  'live-push over WiFi to a StackChan whose firmware has the HTTP face API':
    'WiFi实时推送到实现了HTTP换脸API的StackChan（如keke_firmware），填设备IP即可',
  'connected over WiFi': '已连上WiFi设备，编辑实时同步',
  'device unreachable': '设备连不上',
  Undo: '撤销',
  Redo: '重做',
  'mouth open': '嘴巴开合',
  'View JSON': '查看JSON',
  copy: '复制',
  'JSON copied': 'JSON已复制',
  // tabs
  base: '基础',
  happy: '开心',
  angry: '生气',
  sad: '难过',
  doubt: '疑惑',
  sleepy: '困倦',
  // expression hint
  editing: '正在编辑',
  'as offsets from base': '（相对基础脸的偏移）',
  revert: '还原',
  clear: '清空',
  // panels
  Palette: '调色板',
  'Eye L': '左眼',
  'Eye R': '右眼',
  'Brow L': '左眉',
  'Brow R': '右眉',
  Mouth: '嘴巴',
  Animation: '动画',
  'off — tick the box to add this part': '未启用——勾选右上角的框添加这个部件',
  // fields
  Shape: '形状',
  Width: '宽',
  Height: '高',
  'Corner radius': '圆角',
  Curve: '弧度',
  Thickness: '粗细',
  'Upper lid': '上眼睑',
  'Upper lid angle': '上眼睑角度',
  'Lower lid': '下眼睑',
  Color: '颜色',
  Angle: '角度',
  'Min width': '张开时宽',
  'Max width': '闭合时宽',
  'Min height': '闭合时高',
  'Max height': '张开时高',
  'Blink interval (s)': '眨眼间隔（秒）',
  'Blink duration (ms)': '眨眼时长（毫秒）',
  'Gaze interval (s)': '眼神游移间隔（秒）',
  'Gaze amplitude': '眼神游移幅度',
  'Breath period (s)': '呼吸周期（秒）',
  'Breath depth': '呼吸深度',
  Primary: '主色',
  Secondary: '辅色',
  Background: '背景色',
  palette: '跟随调色板',
  // pixel board
  'Pixel scale': '像素大小',
  'Smooth pixels': '平滑像素',
  zoom: '放大镜',
  'select & move': '选区（框选后拖动，方向键微调，Esc取消）',
  pen: '画笔',
  eraser: '橡皮',
  bucket: '油漆桶',
  eyedropper: '取色器',
  'mirror pen': '镜像笔',
  'ghost of the other frame': '另一帧残影',
  'transparent (eraser)': '透明（橡皮）',
  'double-click to edit': '双击改色',
  'add color': '加颜色',
  'eyes open': '睁眼帧',
  'eyes closed': '闭眼帧',
  'mouth open frame': '张嘴帧',
  'mouth closed frame': '闭嘴帧',
  grid: '画布',
  apply: '应用',
  'copy other frame': '复制另一帧',
  'squash from open': '压扁生成初稿',
  'pixel frames belong to the base face': '像素画所有表情共用——这里改了，每个表情都会变（表情只能挪位置）',
  'editing the base layer — pick "own frame" to change it for this expression':
    '正在编辑基础层——想让这个表情不一样，选「专属帧」',
  Overlay: '装饰层',
  'a static pixel layer on top — blush, whiskers, bows':
    '盖在最上层的静态像素层——腮红、胡子、蝴蝶结',
  'the grid maps onto the whole face — draw things where they should sit':
    '格子1:1映射整张脸——画在哪，就出现在哪',
  'inherit base': '跟随基础',
  hidden: '隐藏',
  'own frame': '专属帧',
  'the overlay is hidden on this expression': '这个表情不显示装饰层',
  // wizard
  Wizard: '向导',
  'guided flow: four frames to a living face': '向导模式：四帧画出一张活脸',
  'new here? the wizard walks you to a living face': '第一次来？向导带你一步步捏出一张活脸',
  Start: '起点',
  'pick a starting point for your face': '选一个起点开始捏脸',
  'start fresh': '从头开始',
  'keep my current face': '保留当前的脸',
  'Open eyes': '睁眼',
  'Closed eyes': '闭眼',
  'Open mouth': '张嘴',
  'Resting mouth': '闭嘴',
  Brows: '眉毛',
  Extras: '装饰',
  'Done!': '完成',
  'draw the open eyes — the other side mirrors along':
    '画睁开的眼睛——画好一边，另一边会自动镜像',
  'a squashed closed-eye draft is ready — touch it up or keep it':
    '闭眼初稿已经压好铺在画布上——改两笔，或直接采纳',
  'draw the open mouth, mid-talk': '画张开的嘴——说话说到一半的样子',
  'squashed into a resting mouth — adjust the line': '已压扁成闭嘴初稿——把线条调顺',
  'optional: pixel brows on top': '可选：加一对像素眉毛',
  'optional: an overlay for blush, whiskers, bows': '可选：装饰层——腮红、胡子、蝴蝶结',
  'all four frames live — watch it blink and talk, then share it':
    '四帧齐活——看它眨眼说话，然后分享或推上真机',
  'connected — Save to device writes it to flash, blink included':
    '设备已连接——「保存到设备」会把脸写进flash，眨眼说话都带走',
  'to see it on a real StackChan: USB one running the reference firmware, then connect':
    '想上真机：用USB连一台刷了参考固件的StackChan，然后点「连接设备」',
  'pushing to a device needs Chrome on localhost or HTTPS — or export the JSON to its SD card':
    '直推设备需要Chrome+localhost或HTTPS（Web Serial限制）——也可以导出JSON拷进它的SD卡',
  'add brows': '加眉毛',
  'add overlay': '开装饰层',
  back: '上一步',
  next: '下一步',
  skip: '跳过',
  finish: '完成',
  'close the wizard': '关闭向导',
  // toasts / misc
  'link copied': '链接已复制',
  Presets: '预设脸',
  'preset loaded': '已载入预设',
  'broken share link — showing your saved face': '分享链接已损坏，先显示你本地的脸',
  imported: '已导入',
  'saved to device': '已保存到设备',
  'import failed': '导入失败',
  'loading WASM…': '加载WASM中…',
};

const STORAGE_KEY = 'pf-lang';

function initialLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'en' || saved === 'zh') return saved;
  return navigator.language.startsWith('zh') ? 'zh' : 'en';
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (s: string) => string;
}

const I18nCtx = createContext<I18n>({ lang: 'en', setLang: () => {}, t: (s) => s });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = (l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLangState(l);
  };
  const t = (s: string) => (lang === 'zh' ? ZH[s] ?? s : s);
  return <I18nCtx.Provider value={{ lang, setLang, t }}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
