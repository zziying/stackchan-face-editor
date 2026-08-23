// Wires PixelBoard to the document: frame tabs (open/closed for eyes and
// mouth, single frame for brows/overlay), grid size, copy/squash drafts,
// and the L/R symmetry lock as horizontal-flip copy (P7). Sprite edits
// always land on the base face — expression deltas never touch frames (P5).
import { useEffect, useState } from 'react';
import {
  decodeFrame, encodeFrame, OVERLAY_H, OVERLAY_W,
  SPRITE_DEFAULT_DIM, SPRITE_MAX_DIM, SPRITE_MIN_DIM, type SpriteFrame,
} from '../face/sprite';
import { emptyFrame, flipH, resizeFrame, squashV } from '../face/spriteOps';
import { getPath, setPath } from '../face/pathUtils';
import { MIRROR_PAIR, type FaceDoc, type PartKey } from '../face/types';
import { useI18n } from '../i18n';
import PixelBoard, { type BoardHistory } from './PixelBoard';

export type PixelTarget = PartKey | 'overlay';
type FrameKey = 'open' | 'closed';

interface Props {
  target: PixelTarget;
  doc: FaceDoc;
  symLock: boolean;
  showBaseNote: boolean;  // true on expression tabs
  // v2.1: overlay expression frames live at overlay.expr.<name>; passing the
  // node path here points the board at that frame instead of the base one
  basePath?: string;
  // v3: where the symmetry mirror lands. Defaults to the partner's base
  // frames; expression tabs pass the partner's own-frame path instead.
  mirrorBase?: string;
  // wizard remote control: lands the board on this frame tab when it changes;
  // the user can still switch tabs freely afterwards
  frameOverride?: FrameKey;
  commit: (updater: (d: FaceDoc) => FaceDoc, key?: string) => void;
  history?: BoardHistory;   // undo/redo buttons in the board's toolbar
}

const DUAL: Record<string, [string, string]> = {
  eyeL: ['eyes open', 'eyes closed'],
  eyeR: ['eyes open', 'eyes closed'],
  mouth: ['mouth open frame', 'mouth closed frame'],
};

export default function PixelPartEditor({ target, doc, symLock, showBaseNote, basePath, mirrorBase, frameOverride, commit, history }: Props) {
  const { t } = useI18n();
  const dualLabels = DUAL[target];
  // resting frame first: eyes sit open, the mouth sits closed
  const [frameKey, setFrameKey] = useState<FrameKey>(target === 'mouth' ? 'closed' : 'open');
  useEffect(() => { if (frameOverride) setFrameKey(frameOverride); }, [frameOverride]);
  const active: FrameKey = dualLabels ? frameKey : 'open';

  // P6v2: the overlay board is a fixed grid mapped 1:1 onto the whole face —
  // position things by drawing them where they should sit; no size, no scale
  const isOverlay = target === 'overlay';
  const maxW = isOverlay ? OVERLAY_W : SPRITE_MAX_DIM;
  const maxH = isOverlay ? OVERLAY_H : SPRITE_MAX_DIM;
  const base = basePath ?? (isOverlay ? 'overlay' : `parts.${target}`);
  const readFrame = (k: FrameKey): SpriteFrame | null =>
    decodeFrame(getPath(doc, `${base}.frames.${k}`), maxW, maxH);

  const fallbackPalette = [doc.palette.primary, doc.palette.secondary]
    .filter((c): c is string => typeof c === 'string' && /^#/.test(c));
  const decoded = readFrame(active);
  const frame = isOverlay
    ? (decoded && decoded.w === OVERLAY_W && decoded.h === OVERLAY_H
        ? decoded
        : decoded
          ? resizeFrame(decoded, OVERLAY_W, OVERLAY_H, OVERLAY_W, OVERLAY_H)
          : emptyFrame(OVERLAY_W, OVERLAY_H, fallbackPalette))
    : decoded ?? emptyFrame(SPRITE_DEFAULT_DIM, SPRITE_DEFAULT_DIM, fallbackPalette);
  const other = dualLabels ? readFrame(active === 'open' ? 'closed' : 'open') : null;

  const pair = !isOverlay ? MIRROR_PAIR[target] : undefined;

  const commitFrame = (f: SpriteFrame, key?: string) =>
    commit((d) => {
      let next = setPath(d, `${base}.frames.${active}`, encodeFrame(f, maxW, maxH));
      if (symLock && pair && getPath(d, `parts.${pair}.shape`) === 'pixel') {
        // partner still inheriting while this side owns: promote it with a
        // copy of its base pair first, so one lock-drawn stroke flips both
        if (mirrorBase && !getPath(next, `${mirrorBase}.frames`)) {
          const bf = getPath(next, `parts.${pair}.frames`);
          if (bf) next = setPath(next, `${mirrorBase}.frames`, structuredClone(bf));
        }
        next = setPath(next, `${mirrorBase ?? `parts.${pair}`}.frames.${active}`, encodeFrame(flipH(f)));
      }
      return next;
    }, key);

  const resize = (w: number, h: number) => {
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    commitFrame(resizeFrame(frame, w, h), `pixel.${base}.${active}.size`);
  };

  // grid size is draft-first: resizing live while typing made the board (and
  // the inputs under it) jump around mid-edit, so ✓ / Enter applies instead
  const [draftW, setDraftW] = useState('');
  const [draftH, setDraftH] = useState('');
  useEffect(() => { setDraftW(''); setDraftH(''); }, [base, active]);
  const shownW = draftW === '' ? String(frame.w) : draftW;
  const shownH = draftH === '' ? String(frame.h) : draftH;
  const clamp = (s: string) =>
    Math.min(Math.max(parseInt(s, 10), SPRITE_MIN_DIM), SPRITE_MAX_DIM);
  const sizeDirty = (Number.isFinite(clamp(shownW)) && clamp(shownW) !== frame.w)
    || (Number.isFinite(clamp(shownH)) && clamp(shownH) !== frame.h);
  const applySize = () => {
    const w = clamp(shownW), h = clamp(shownH);
    if (Number.isFinite(w) && Number.isFinite(h) && (w !== frame.w || h !== frame.h))
      resize(w, h);
    setDraftW(''); setDraftH('');
  };
  const onSizeKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') applySize();
    else if (e.key === 'Escape') { setDraftW(''); setDraftH(''); }
  };

  return (
    <div className="pixel-editor">
      {showBaseNote && (
        <div className="panel-hint">
          {t(isOverlay
            ? 'editing the base layer — pick "own frame" to change it for this expression'
            : 'editing the base frames — pick "own frames" to redraw them for this expression')}
        </div>
      )}
      {dualLabels && (
        <div className="frame-tabs">
          {(['open', 'closed'] as const).map((k, i) => (
            <button
              key={k} className={`mini ${active === k ? 'active' : ''}`}
              onClick={() => setFrameKey(k)}
            >
              {t(dualLabels[i])}{!readFrame(k) && ' ·'}
            </button>
          ))}
        </div>
      )}
      <PixelBoard
        frame={frame} onion={other} history={history} bg={doc.palette.background}
        onStroke={(f, key) => commitFrame(f, key && `pixel.${base}.${active}.${key}`)}
        onPalette={(palette) => commitFrame({ ...frame, palette }, `pixel.${base}.${active}.palette`)}
      />
      <div className="pixel-actions">
        {!isOverlay && (
        <label className="frame-size">
          {t('grid')}
          <input
            type="number" min={1} max={SPRITE_MAX_DIM} value={shownW}
            onChange={(e) => setDraftW(e.target.value)} onKeyDown={onSizeKey}
          />
          ×
          <input
            type="number" min={1} max={SPRITE_MAX_DIM} value={shownH}
            onChange={(e) => setDraftH(e.target.value)} onKeyDown={onSizeKey}
          />
          {sizeDirty && (
            <button className="mini apply" onClick={applySize}>✓ {t('apply')}</button>
          )}
        </label>
        )}
        {dualLabels && other && (
          <button className="mini" onClick={() => commitFrame({ ...other, palette: [...other.palette], pixels: other.pixels.slice() })}>
            {t('copy other frame')}
          </button>
        )}
        {dualLabels && active === 'closed' && readFrame('open') && (
          <button className="mini" onClick={() => commitFrame(squashV(readFrame('open')!))}>
            {t('squash from open')}
          </button>
        )}
      </div>
    </div>
  );
}
