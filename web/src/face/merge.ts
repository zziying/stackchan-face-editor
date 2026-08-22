// Display-side mirror of the C++ merge rule (S5): numbers add, everything
// else replaces, objects recurse. Only used to show effective values in the
// expression tabs — the rendered truth always comes from the C++ side.
import type { FaceDoc, PartNode, Tab } from './types';

function mergeNode(base: PartNode, delta: PartNode): PartNode {
  const out: PartNode = { ...base };
  for (const [key, dv] of Object.entries(delta)) {
    const bv = out[key];
    if (dv !== null && typeof dv === 'object') {
      out[key] = mergeNode(
        bv !== null && typeof bv === 'object' ? (bv as PartNode) : {},
        dv as PartNode,
      );
    } else if (typeof dv === 'number' && typeof bv === 'number') {
      out[key] = bv + dv;
    } else {
      out[key] = dv;
    }
  }
  return out;
}

// Effective document for a tab: base itself, or base ⊕ that expression's delta.
export function effectiveDoc(doc: FaceDoc, tab: Tab): FaceDoc {
  if (tab === 'base') return doc;
  const delta = doc.expressions?.[tab];
  if (!delta) return doc;
  return mergeNode(doc as unknown as PartNode, delta) as unknown as FaceDoc;
}
