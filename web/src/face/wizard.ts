// Guided pipeline for a first pixel face: four core frames, optional brows
// and overlay, then a live demo. Each step remote-controls the existing
// editor (part panel, frame tab); entering a step runs prepareStep so the
// user lands on a pixel board — never a blank shape — and closed frames
// start as squashed drafts of the open ones instead of an empty grid.
import { decodeFrame, encodeFrame, SPRITE_MAX_DIM, type SpriteFrame } from './sprite';
import { squashV } from './spriteOps';
import { getPath, setPath } from './pathUtils';
import type { FaceDoc, PartKey } from './types';

export type WizFrame = 'open' | 'closed';

export interface WizStep {
  key: string;
  label: string;           // i18n key for the stepper chip
  hint: string;            // i18n key for the guidance line
  target?: PartKey | 'overlay';
  frame?: WizFrame;
  optional?: boolean;      // shows Skip; engage button creates the part
  engage?: 'brows' | 'overlay';
  engageLabel?: string;
}

// start-step choices: what the four frames build on
export type WizStart = 'fresh' | 'keep' | 'preset';

export const WIZ_STEPS: WizStep[] = [
  {
    key: 'start', label: 'Start',
    hint: 'pick a starting point for your face',
  },
  {
    key: 'eyes-open', label: 'Open eyes', target: 'eyeL', frame: 'open',
    hint: 'draw the open eyes — the other side mirrors along',
  },
  {
    key: 'eyes-closed', label: 'Closed eyes', target: 'eyeL', frame: 'closed',
    hint: 'a squashed closed-eye draft is ready — touch it up or keep it',
  },
  {
    key: 'mouth-open', label: 'Open mouth', target: 'mouth', frame: 'open',
    hint: 'draw the open mouth, mid-talk',
  },
  {
    key: 'mouth-closed', label: 'Resting mouth', target: 'mouth', frame: 'closed',
    hint: 'squashed into a resting mouth — adjust the line',
  },
  {
    key: 'brows', label: 'Brows', target: 'browL', frame: 'open',
    optional: true, engage: 'brows', engageLabel: 'add brows',
    hint: 'optional: pixel brows on top',
  },
  {
    key: 'overlay', label: 'Extras', target: 'overlay', frame: 'open',
    optional: true, engage: 'overlay', engageLabel: 'add overlay',
    hint: 'optional: an overlay for blush, whiskers, bows',
  },
  {
    key: 'done', label: 'Done!',
    hint: 'all four frames live — watch it blink and talk, then share it',
  },
];

const readFrame = (doc: FaceDoc, part: string, k: WizFrame): SpriteFrame | null =>
  decodeFrame(getPath(doc, `parts.${part}.frames.${k}`), SPRITE_MAX_DIM, SPRITE_MAX_DIM);

// Doc transform on step entry. Returns the doc unchanged (same reference)
// when there is nothing to do, so the caller can skip an empty history entry.
export function prepareStep(doc: FaceDoc, stepKey: string): FaceDoc {
  const toPixel = (d: FaceDoc, parts: string[]) =>
    parts.reduce((acc, p) =>
      getPath(acc, `parts.${p}`) && getPath(acc, `parts.${p}.shape`) !== 'pixel'
        ? setPath(acc, `parts.${p}.shape`, 'pixel')
        : acc, d);
  // closed frames draft from each part's own open frame (eyeR's open is
  // already the mirrored copy, so squashing per-part keeps the flip)
  const draftClosed = (d: FaceDoc, parts: string[]) =>
    parts.reduce((acc, p) => {
      if (readFrame(acc, p, 'closed')) return acc;
      const open = readFrame(acc, p, 'open');
      return open
        ? setPath(acc, `parts.${p}.frames.closed`, encodeFrame(squashV(open)))
        : acc;
    }, d);

  switch (stepKey) {
    case 'eyes-open': return toPixel(doc, ['eyeL', 'eyeR']);
    case 'eyes-closed': return draftClosed(doc, ['eyeL', 'eyeR']);
    case 'mouth-open': return toPixel(doc, ['mouth']);
    case 'mouth-closed': return draftClosed(doc, ['mouth']);
    default: return doc;
  }
}

// Optional-step state: the step is "engaged" once its part exists as pixel.
export function stepEngaged(doc: FaceDoc, step: WizStep): boolean {
  if (step.engage === 'brows') return getPath(doc, 'parts.browL.shape') === 'pixel';
  if (step.engage === 'overlay') return !!doc.overlay;
  return true;
}
