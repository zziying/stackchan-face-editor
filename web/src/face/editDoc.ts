// The single write path for every panel edit.
//
// Base tab: value goes straight into the doc. Expression tab: the user drags
// the *effective* value; we store value-minus-base as an additive delta for
// numbers, or the raw value as a replacement otherwise, and drop entries that
// land back on base (S5). Symmetry lock mirrors the edit onto the paired
// part: x flips around the canvas midline, *angle fields negate, the rest copy.
import { getPath, setPath, deletePath } from './pathUtils';
import { MIRROR_PAIR, type FaceDoc, type PartKey, type Tab } from './types';

export type FieldValue = number | string | boolean;

function applyOne(doc: FaceDoc, tab: Tab, fullPath: string, value: FieldValue): FaceDoc {
  if (tab === 'base') return setPath(doc, fullPath, value);
  const deltaPath = `expressions.${tab}.${fullPath}`;
  const baseVal = getPath(doc, fullPath);
  if (typeof value === 'number' && typeof baseVal === 'number') {
    const delta = value - baseVal;
    return Math.abs(delta) < 1e-6 ? deletePath(doc, deltaPath) : setPath(doc, deltaPath, round4(delta));
  }
  return value === baseVal ? deletePath(doc, deltaPath) : setPath(doc, deltaPath, value);
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

function mirrorValue(path: string, value: FieldValue, canvasW: number): FieldValue {
  if (typeof value !== 'number') return value;
  if (path === 'pos.x') return canvasW - value;
  if (path.endsWith('angle')) return -value;
  return value;
}

// partKey===null → non-part paths (palette.*, animation.*, meta.*): no mirroring.
export function editField(
  doc: FaceDoc, tab: Tab, partKey: PartKey | null, path: string,
  value: FieldValue, symLock: boolean,
): FaceDoc {
  const fullPath = partKey ? `parts.${partKey}.${path}` : path;
  let next = applyOne(doc, tab, fullPath, value);
  const pair = partKey ? MIRROR_PAIR[partKey] : undefined;
  if (symLock && partKey && pair && next.parts[pair]) {
    next = applyOne(next, tab, `parts.${pair}.${path}`,
                    mirrorValue(path, value, doc.canvas.width));
  }
  return next;
}
