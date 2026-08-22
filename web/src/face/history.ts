// Undo history over the immutable FaceDoc. Every panel/canvas edit funnels
// through commit(); continuous gestures (slider drags, typing) pass a
// coalesceKey so a whole gesture collapses into one undo step.
import { useCallback, useRef, useState } from 'react';
import type { FaceDoc } from './types';

const COALESCE_MS = 800;
const HISTORY_CAP = 100;

interface Hist {
  past: FaceDoc[];
  present: FaceDoc;
  future: FaceDoc[];
}

export function useDocHistory(initial: FaceDoc) {
  const [hist, setHist] = useState<Hist>({ past: [], present: initial, future: [] });
  const lastKey = useRef<string | undefined>(undefined);
  const lastTime = useRef(0);

  // Coalescing is decided outside the state updater: updaters must stay pure
  // (StrictMode replays them), and commit runs once per user action anyway.
  const commit = useCallback((updater: (d: FaceDoc) => FaceDoc, coalesceKey?: string) => {
    const now = Date.now();
    const merge = !!coalesceKey && coalesceKey === lastKey.current
      && now - lastTime.current < COALESCE_MS;
    lastKey.current = coalesceKey;
    lastTime.current = now;
    setHist((h) => {
      const next = updater(h.present);
      if (next === h.present) return h;
      return {
        past: merge ? h.past : [...h.past, h.present].slice(-HISTORY_CAP),
        present: next,
        future: [],
      };
    });
  }, []);

  const breakCoalesce = useCallback(() => { lastKey.current = undefined; }, []);

  const undo = useCallback(() => {
    breakCoalesce();
    setHist((h) => (h.past.length ? {
      past: h.past.slice(0, -1),
      present: h.past[h.past.length - 1],
      future: [h.present, ...h.future],
    } : h));
  }, []);

  const redo = useCallback(() => {
    breakCoalesce();
    setHist((h) => (h.future.length ? {
      past: [...h.past, h.present],
      present: h.future[0],
      future: h.future.slice(1),
    } : h));
  }, []);

  // Fresh document (import / share link): history starts over.
  const reset = useCallback((doc: FaceDoc) => {
    breakCoalesce();
    setHist({ past: [], present: doc, future: [] });
  }, []);

  return {
    doc: hist.present,
    commit, undo, redo, reset, breakCoalesce,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
  };
}
