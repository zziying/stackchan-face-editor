// Bundled preset faces: the gallery's catalog. Vector variants live in
// faces/*.json next to the default; adding one file + one entry here is the
// whole recipe for a new preset.
import defaultFace from '../../../faces/default.json';
import mochi from '../../../faces/mochi.json';
import cat from '../../../faces/cat.json';
import moon from '../../../faces/moon.json';
import pixelDemo from '../../../faces/pixel-demo.json';
import type { FaceDoc } from './types';

export interface Preset {
  key: string;
  doc: FaceDoc;
}

// The gallery's Classic carries the factory expression deltas; the editor's
// blank default face (faces/default.json) deliberately ships none, so a new
// face starts with every tab equal to the base.
const CLASSIC_EXPRESSIONS: FaceDoc['expressions'] = {
  happy: {
    parts: {
      eyeL: { lowerLid: { cover: 0.6 } },
      eyeR: { lowerLid: { cover: 0.6 } },
    },
  },
  angry: {
    parts: {
      eyeL: { upperLid: { angle: -22, cover: 0.4 } },
      eyeR: { upperLid: { angle: 22, cover: 0.4 } },
    },
  },
  sad: {
    parts: {
      eyeL: { upperLid: { angle: 18, cover: 0.35 } },
      eyeR: { upperLid: { angle: -18, cover: 0.35 } },
    },
  },
  doubt: {
    parts: {
      eyeL: { upperLid: { cover: 0.45 } },
      eyeR: { upperLid: { cover: 0.1 } },
      mouth: { minWidth: -14, maxWidth: -30 },
    },
  },
  sleepy: {
    parts: {
      eyeL: { upperLid: { cover: 0.6 } },
      eyeR: { upperLid: { cover: 0.6 } },
    },
    animation: {
      blink: { interval: 3, duration: 250 },
      breath: { depth: 0.4 },
    },
  },
};

export const PRESETS: Preset[] = [
  {
    key: 'classic',
    doc: { ...(defaultFace as unknown as FaceDoc), expressions: CLASSIC_EXPRESSIONS },
  },
  { key: 'mochi', doc: mochi as unknown as FaceDoc },
  { key: 'cat', doc: cat as unknown as FaceDoc },
  { key: 'moon', doc: moon as unknown as FaceDoc },
  { key: 'pixel-demo', doc: pixelDemo as unknown as FaceDoc },
];
