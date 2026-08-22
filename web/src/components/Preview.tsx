// Live preview: the ParamFace WASM module (the same C++ that runs on the
// device) renders into an RGB565 framebuffer; we blit it to a canvas each
// frame. Animation runs in C++ — this component only feeds dt and overrides.
//
// A transparent SVG hit layer sits on top of the canvas so parts can be
// dragged (and arrow-key nudged) directly; rendering stays 100% WASM.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import createParamFace from '../wasm/paramface.js';
import { PART_KEYS, type PartKey, type PartNode } from '../face/types';
import { useI18n } from '../i18n';

interface PfModule {
  ccall: (name: string, ret: string | null, argTypes: string[], args: unknown[]) => unknown;
  HEAPU16: Uint16Array;
}

interface Props {
  docJson: string;       // serialized full face.json (base + all deltas)
  exprIndex: number;
  talking: boolean;
  mouthOpen: number;     // manual 0..1 override; 0 = let the animator own it
  parts: Record<string, PartNode | undefined>;  // effective parts (for hit boxes)
  onDragPart: (part: PartKey, x: number, y: number) => void;
  onDragEnd: () => void;
}

const W = 320, H = 240;

const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);

// Axis-aligned hit box around a part's pos, generous enough to grab.
function hitBox(key: PartKey, p: PartNode) {
  const pos = p.pos as PartNode | undefined;
  const x = num(pos?.x, W / 2), y = num(pos?.y, H / 2);
  let w = 40, h = 40;
  if (key === 'eyeL' || key === 'eyeR') {
    w = num(p.width, 40); h = num(p.height, w);
  } else if (key === 'browL' || key === 'browR') {
    w = num(p.width, 40); h = num(p.thickness, 6) + 10;
  } else if (key === 'mouth') {
    w = Math.max(num(p.minWidth, 0), num(p.maxWidth, 60));
    h = Math.max(num(p.minHeight, 0), num(p.maxHeight, 30), 16);
  }
  w = Math.max(w, 24) + 8; h = Math.max(h, 24) + 8;
  return { x: x - w / 2, y: y - h / 2, w, h, cx: x, cy: y };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function Preview({
  docJson, exprIndex, talking, mouthOpen, parts, onDragPart, onDragEnd,
}: Props) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const modRef = useRef<PfModule | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const talkingRef = useRef(talking);
  talkingRef.current = talking;
  const mouthRef = useRef(mouthOpen);
  mouthRef.current = mouthOpen;
  const dragRef = useRef<{
    pointerId: number; part: PartKey; offsetX: number; offsetY: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    createParamFace({
      locateFile: (f: string) => `${import.meta.env.BASE_URL}${f}`,
    }).then((mod: PfModule) => {
      if (cancelled) return;
      mod.ccall('pf_init', 'number', ['number', 'number'], [W, H]);
      modRef.current = mod;
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const mod = modRef.current;
    if (!mod || !ready) return;
    const ok = mod.ccall('pf_load', 'number', ['string'], [docJson]) as number;
    setLoadError(ok ? '' : (mod.ccall('pf_error', 'string', [], []) as string));
  }, [docJson, ready]);

  useEffect(() => {
    modRef.current?.ccall('pf_set_expression', null, ['number'], [exprIndex]);
  }, [exprIndex, ready]);

  useEffect(() => {
    if (!ready) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const image = ctx.createImageData(W, H);
    const rgba = new Uint32Array(image.data.buffer);
    let last = performance.now();
    let raf = 0;
    let tTalk = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const mod = modRef.current!;
      const dt = now - last;
      last = now;
      if (talkingRef.current) {
        tTalk += dt;
        const open = Math.abs(Math.sin(tTalk * 0.012)) * (0.55 + 0.45 * Math.sin(tTalk * 0.0031));
        mod.ccall('pf_set_mouth_open', null, ['number', 'number'], [1, open]);
      } else if (mouthRef.current > 0) {
        mod.ccall('pf_set_mouth_open', null, ['number', 'number'], [1, mouthRef.current]);
        tTalk = 0;
      } else {
        mod.ccall('pf_set_mouth_open', null, ['number', 'number'], [0, 0]);
        tTalk = 0;
      }
      mod.ccall('pf_tick', null, ['number'], [dt]);
      const fbPtr = (mod.ccall('pf_fb', 'number', [], []) as number) >> 1;
      const fb = mod.HEAPU16.subarray(fbPtr, fbPtr + W * H);
      for (let i = 0; i < W * H; i++) {
        const p = fb[i];
        const r = ((p >> 11) & 0x1f) << 3;
        const g = ((p >> 5) & 0x3f) << 2;
        const b = (p & 0x1f) << 3;
        rgba[i] = 0xff000000 | (b << 16) | (g << 8) | r;
      }
      ctx.putImageData(image, 0, 0);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  // --- direct manipulation ---------------------------------------------

  // screen px → viewBox coords via the rendered rect, robust to CSS scaling
  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const b = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * W, y: ((e.clientY - b.top) / b.height) * H };
  };

  const startDrag = (part: PartKey) => (e: ReactPointerEvent<SVGGElement>) => {
    const p = parts[part];
    if (!p) return;
    const cur = toCanvas(e);
    const box = hitBox(part, p);
    dragRef.current = {
      pointerId: e.pointerId, part,
      offsetX: cur.x - box.cx, offsetY: cur.y - box.cy,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    e.preventDefault();
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const cur = toCanvas(e);
    onDragPart(
      d.part,
      Math.round(clamp(cur.x - d.offsetX, 0, W)),
      Math.round(clamp(cur.y - d.offsetY, 0, H)),
    );
  };

  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    onDragEnd();
  };

  const nudge = (part: PartKey) => (e: ReactKeyboardEvent<SVGGElement>) => {
    const dir: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const v = dir[e.key];
    const p = parts[part];
    if (!v || !p) return;
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    const box = hitBox(part, p);
    onDragPart(
      part,
      Math.round(clamp(box.cx + v[0] * step, 0, W)),
      Math.round(clamp(box.cy + v[1] * step, 0, H)),
    );
  };

  return (
    <div className="preview">
      <canvas ref={canvasRef} width={W} height={H} />
      <svg
        ref={svgRef} className="hit-layer" viewBox={`0 0 ${W} ${H}`}
        onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}
      >
        {PART_KEYS.map((key) => {
          const p = parts[key];
          if (!p) return null;
          const box = hitBox(key, p);
          return (
            <g
              key={key} className="hit-part" tabIndex={0} role="button"
              onPointerDown={startDrag(key)} onKeyDown={nudge(key)}
            >
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={6} />
            </g>
          );
        })}
      </svg>
      {!ready && <div className="preview-note">{t('loading WASM…')}</div>}
      {loadError && <div className="preview-error">{loadError}</div>}
    </div>
  );
}
