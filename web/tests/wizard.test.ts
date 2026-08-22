// Wizard step preparation: pixel conversion, squashed drafts, no-op reuse.
import assert from 'node:assert';
import { prepareStep, stepEngaged, WIZ_STEPS } from '../src/face/wizard';
import { decodeFrame, encodeFrame, SPRITE_MAX_DIM } from '../src/face/sprite';
import { getPath } from '../src/face/pathUtils';
import type { FaceDoc } from '../src/face/types';

const baseDoc = (): FaceDoc => ({
  version: 1,
  palette: { primary: '#ffffff', secondary: '#000000' },
  parts: {
    eyeL: { pos: { x: 230, y: 130 }, shape: 'ellipse' },
    eyeR: { pos: { x: 90, y: 130 }, shape: 'ellipse' },
    mouth: { pos: { x: 160, y: 185 }, shape: 'roundRect' },
  },
} as unknown as FaceDoc);

// the start step never touches the doc
assert.equal(WIZ_STEPS[0].key, 'start');
{
  const d = baseDoc();
  assert.equal(prepareStep(d, 'start'), d);
}

// eyes-open converts both eyes to pixel, leaves the mouth alone
let doc = prepareStep(baseDoc(), 'eyes-open');
assert.equal(getPath(doc, 'parts.eyeL.shape'), 'pixel');
assert.equal(getPath(doc, 'parts.eyeR.shape'), 'pixel');
assert.notEqual(getPath(doc, 'parts.mouth.shape'), 'pixel');

// already-pixel parts: same reference back (no empty history entry)
assert.equal(prepareStep(doc, 'eyes-open'), doc);

// eyes-closed with no open frame drawn: nothing to draft, same reference
assert.equal(prepareStep(doc, 'eyes-closed'), doc);

// draw an open frame, then the closed step lays out a squashed draft
const open = { w: 8, h: 8, palette: ['#ffffff'], pixels: new Uint8Array(64) };
doc = {
  ...doc,
  parts: {
    ...doc.parts,
    eyeL: { ...doc.parts.eyeL, frames: { open: encodeFrame(open as never) } },
  },
} as FaceDoc;
doc = prepareStep(doc, 'eyes-closed');
const closed = decodeFrame(
  getPath(doc, 'parts.eyeL.frames.closed'), SPRITE_MAX_DIM, SPRITE_MAX_DIM);
assert.ok(closed, 'closed draft generated');
assert.equal(closed!.w, open.w, 'draft keeps the width');
// eyeR never got an open frame, so it must not gain a draft
assert.equal(getPath(doc, 'parts.eyeR.frames'), undefined);

// an existing closed frame is never overwritten by re-entry
assert.equal(prepareStep(doc, 'eyes-closed'), doc);

// mouth steps mirror the eye behavior
doc = prepareStep(doc, 'mouth-open');
assert.equal(getPath(doc, 'parts.mouth.shape'), 'pixel');

// optional steps: engaged once their part exists as pixel / overlay exists
const browStep = WIZ_STEPS.find((s) => s.engage === 'brows')!;
const overlayStep = WIZ_STEPS.find((s) => s.engage === 'overlay')!;
assert.equal(stepEngaged(doc, browStep), false);
assert.equal(stepEngaged(doc, overlayStep), false);
assert.equal(stepEngaged({ ...doc, overlay: {} } as FaceDoc, overlayStep), true);

console.log('wizard tests passed');
