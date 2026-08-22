import assert from 'node:assert';
import { PRESETS } from '../src/face/presets';
import defaultFace from '../../faces/default.json';

assert.equal(PRESETS.length, 5, 'gallery lineup');
for (const p of PRESETS) {
  assert.equal(p.doc.version, 1, `${p.key} version`);
  assert.ok(p.doc.meta?.name, `${p.key} has a name`);
}

// the gallery Classic carries the factory deltas...
const classic = PRESETS[0];
assert.equal(classic.doc.meta?.name, 'Classic');
for (const e of ['happy', 'angry', 'sad', 'doubt', 'sleepy'] as const) {
  assert.ok(classic.doc.expressions?.[e], `classic ${e} delta`);
}
// ...while the editor's blank default face stays delta-free
assert.equal((defaultFace as { expressions?: unknown }).expressions, undefined,
  'default.json ships no expressions');

console.log('presets ok');
