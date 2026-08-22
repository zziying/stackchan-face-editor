// Node smoke test for the delta write-back + mirror logic (S4/S5).
// Run: npx esbuild tests/editDoc.test.ts --bundle --format=esm | node --input-type=module
import assert from 'node:assert';
import { editField } from '../src/face/editDoc';
import { effectiveDoc } from '../src/face/merge';
import type { FaceDoc } from '../src/face/types';

const base = (): FaceDoc => ({
  version: 1,
  canvas: { width: 320, height: 240 },
  palette: { primary: '#FFFFFF', secondary: '#FF99CC', background: '#000000' },
  parts: {
    eyeL: { pos: { x: 230, y: 96 }, shape: 'ellipse', width: 32, height: 32,
            upperLid: { angle: 0, cover: 0 } },
    eyeR: { pos: { x: 90, y: 93 }, shape: 'ellipse', width: 32, height: 32,
            upperLid: { angle: 0, cover: 0 } },
    mouth: { pos: { x: 163, y: 148 }, shape: 'rect', minWidth: 50, maxWidth: 90,
             minHeight: 4, maxHeight: 60 },
  },
  animation: { blink: { interval: 4, duration: 150 } },
});

// base tab + symmetry: x mirrors around canvas midline, angle negates
{
  let d = editField(base(), 'base', 'eyeL', 'pos.x', 220, true);
  assert.equal((d.parts.eyeL as any).pos.x, 220);
  assert.equal((d.parts.eyeR as any).pos.x, 100);
  d = editField(d, 'base', 'eyeL', 'upperLid.angle', 25, true);
  assert.equal((d.parts.eyeL as any).upperLid.angle, 25);
  assert.equal((d.parts.eyeR as any).upperLid.angle, -25);
}

// expression tab: numeric edit stores value-minus-base as additive delta
{
  const d = editField(base(), 'happy', 'eyeL', 'upperLid.cover', 0.4, false);
  assert.equal((d.expressions!.happy as any).parts.eyeL.upperLid.cover, 0.4);
  const eff = effectiveDoc(d, 'happy');
  assert.equal((eff.parts.eyeL as any).upperLid.cover, 0.4);
  assert.equal((d.parts.eyeL as any).upperLid.cover, 0, 'base untouched');
}

// delta that lands back on base is dropped (and empty parents pruned)
{
  let d = editField(base(), 'happy', 'eyeL', 'width', 40, false);
  d = editField(d, 'happy', 'eyeL', 'width', 32, false);
  assert.equal(d.expressions?.happy, undefined);
}

// enum replaces, not adds; mirrored delta on x negates
{
  let d = editField(base(), 'angry', 'eyeL', 'shape', 'arc', false);
  assert.equal((d.expressions!.angry as any).parts.eyeL.shape, 'arc');
  d = editField(base(), 'angry', 'eyeL', 'pos.x', 240, true);
  assert.equal((d.expressions!.angry as any).parts.eyeL.pos.x, 10);
  assert.equal((d.expressions!.angry as any).parts.eyeR.pos.x, -10);
  const eff = effectiveDoc(d, 'angry');
  assert.equal((eff.parts.eyeL as any).pos.x, 240);
  assert.equal((eff.parts.eyeR as any).pos.x, 80);
}

console.log('editDoc tests passed');
