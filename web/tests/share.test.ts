import assert from 'node:assert';
import { encodeShareHash, decodeShareHash } from '../src/face/share';
import defaultFace from '../../faces/default.json';
const doc = defaultFace as any;
const hash = await encodeShareHash(doc);
assert.ok(hash.startsWith('#f=z'), 'compressed');
const back = await decodeShareHash(hash);
assert.deepEqual(back, doc, 'roundtrip');
// corruption in transit (truncated paste, one flipped char) must yield null,
// never a throw or a garbage doc — the app toasts on null
assert.equal(await decodeShareHash(hash.slice(0, -8)), null, 'truncated → null');
assert.equal(await decodeShareHash('#f=z' + 'A' + hash.slice(5)), null, 'corrupted → null');
assert.equal(await decodeShareHash('#unrelated'), null, 'foreign hash → null');
console.log(`share roundtrip ok, hash length: ${hash.length} chars`);
