// Schema-driven panel definitions: one descriptor list per part type keeps
// the UI a single generic renderer instead of five hand-built forms.
import type { PartNode } from './types';

export type FieldKind = 'num' | 'select' | 'bool' | 'color';

export interface FieldDef {
  path: string;           // relative to the part (or absolute for palette/anim)
  label: string;
  kind: FieldKind;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  showIf?: (part: PartNode) => boolean;
  optional?: boolean;     // color fields: absent = inherit palette
}

const shapeIs = (v: string) => (p: PartNode) => p.shape === v;
// vector-only fields: pixel parts draw from their sprite frames instead
const notPixel = (p: PartNode) => p.shape !== 'pixel';
const SCALE_FIELD: FieldDef = {
  path: 'scale', label: 'Pixel scale', kind: 'num', min: 1, max: 8, step: 1,
  showIf: shapeIs('pixel'),
};
// P8: Scale2x on the index grid; needs scale>=2 to have room to smooth into
const SMOOTH_FIELD: FieldDef = {
  path: 'smooth', label: 'Smooth pixels', kind: 'bool',
  showIf: (p) => p.shape === 'pixel' && (typeof p.scale !== 'number' || p.scale >= 2),
};

export const EYE_FIELDS: FieldDef[] = [
  { path: 'shape', label: 'Shape', kind: 'select', options: ['ellipse', 'roundRect', 'arc', 'pixel'] },
  { path: 'pos.x', label: 'X', kind: 'num', min: 0, max: 320, step: 1 },
  { path: 'pos.y', label: 'Y', kind: 'num', min: 0, max: 240, step: 1 },
  SCALE_FIELD,
  SMOOTH_FIELD,
  { path: 'width', label: 'Width', kind: 'num', min: 4, max: 160, step: 1, showIf: notPixel },
  { path: 'height', label: 'Height', kind: 'num', min: 4, max: 160, step: 1, showIf: notPixel },
  { path: 'cornerRadius', label: 'Corner radius', kind: 'num', min: 0, max: 80, step: 1, showIf: shapeIs('roundRect') },
  { path: 'curve', label: 'Curve', kind: 'num', min: -1, max: 1, step: 0.05, showIf: shapeIs('arc') },
  { path: 'thickness', label: 'Thickness', kind: 'num', min: 1, max: 16, step: 1, showIf: shapeIs('arc') },
  { path: 'upperLid.cover', label: 'Upper lid', kind: 'num', min: 0, max: 1, step: 0.01 },
  { path: 'upperLid.angle', label: 'Upper lid angle', kind: 'num', min: -60, max: 60, step: 1 },
  { path: 'lowerLid.cover', label: 'Lower lid', kind: 'num', min: 0, max: 1, step: 0.01 },
  { path: 'color', label: 'Color', kind: 'color', optional: true, showIf: notPixel },
];

export const BROW_FIELDS: FieldDef[] = [
  { path: 'shape', label: 'Shape', kind: 'select', options: ['rect', 'arc', 'pixel'] },
  { path: 'pos.x', label: 'X', kind: 'num', min: 0, max: 320, step: 1 },
  { path: 'pos.y', label: 'Y', kind: 'num', min: 0, max: 240, step: 1 },
  SCALE_FIELD,
  SMOOTH_FIELD,
  { path: 'width', label: 'Width', kind: 'num', min: 0, max: 160, step: 1, showIf: notPixel },
  { path: 'thickness', label: 'Thickness', kind: 'num', min: 1, max: 30, step: 1, showIf: notPixel },
  { path: 'angle', label: 'Angle', kind: 'num', min: -60, max: 60, step: 1, showIf: shapeIs('rect') },
  { path: 'curve', label: 'Curve', kind: 'num', min: -1, max: 1, step: 0.05, showIf: shapeIs('arc') },
  { path: 'color', label: 'Color', kind: 'color', optional: true, showIf: notPixel },
];

export const MOUTH_FIELDS: FieldDef[] = [
  { path: 'shape', label: 'Shape', kind: 'select', options: ['rect', 'arc', 'omega', 'pixel'] },
  { path: 'pos.x', label: 'X', kind: 'num', min: 0, max: 320, step: 1 },
  { path: 'pos.y', label: 'Y', kind: 'num', min: 0, max: 240, step: 1 },
  SCALE_FIELD,
  SMOOTH_FIELD,
  { path: 'minWidth', label: 'Min width', kind: 'num', min: 0, max: 200, step: 1, showIf: notPixel },
  { path: 'maxWidth', label: 'Max width', kind: 'num', min: 0, max: 200, step: 1, showIf: notPixel },
  { path: 'minHeight', label: 'Min height', kind: 'num', min: 0, max: 60, step: 1, showIf: notPixel },
  { path: 'maxHeight', label: 'Max height', kind: 'num', min: 0, max: 120, step: 1, showIf: notPixel },
  { path: 'curve', label: 'Curve', kind: 'num', min: -1, max: 1, step: 0.05, showIf: shapeIs('arc') },
  { path: 'color', label: 'Color', kind: 'color', optional: true, showIf: notPixel },
];

// absolute paths (no part prefix)
export const ANIM_FIELDS: FieldDef[] = [
  { path: 'animation.blink.interval', label: 'Blink interval (s)', kind: 'num', min: 0.5, max: 10, step: 0.1 },
  { path: 'animation.blink.duration', label: 'Blink duration (ms)', kind: 'num', min: 50, max: 500, step: 10 },
  { path: 'animation.saccade.interval', label: 'Gaze interval (s)', kind: 'num', min: 0.5, max: 10, step: 0.1 },
  { path: 'animation.saccade.amplitude', label: 'Gaze amplitude', kind: 'num', min: 0, max: 1, step: 0.01 },
  { path: 'animation.breath.period', label: 'Breath period (s)', kind: 'num', min: 1, max: 10, step: 0.1 },
  { path: 'animation.breath.depth', label: 'Breath depth', kind: 'num', min: 0, max: 1, step: 0.01 },
];

export const PALETTE_FIELDS: FieldDef[] = [
  { path: 'palette.primary', label: 'Primary', kind: 'color' },
  { path: 'palette.secondary', label: 'Secondary', kind: 'color' },
  { path: 'palette.background', label: 'Background', kind: 'color' },
];
