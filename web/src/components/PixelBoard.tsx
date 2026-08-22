// Animal-Crossing-style paint board for one sprite frame: chunky grid with
// center guides, checkerboard transparency, pen/eraser/bucket/eyedropper,
// in-sprite mirror pen, onion ghost of the sibling frame, swatch palette
// (click = select, double-click = edit, + = add, ≤15 colors).
//
// The board paints into a local buffer during a stroke and hands the whole
// frame back on pointer-up — one stroke, one undo step at the doc level.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpriteFrame } from '../face/sprite';
import { SPRITE_MAX_COLORS } from '../face/sprite';
import { floodFill, lineCells } from '../face/spriteOps';
import { useI18n } from '../i18n';

type Tool = 'pen' | 'eraser' | 'fill' | 'picker' | 'select';

export interface BoardHistory {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface Props {
  frame: SpriteFrame;
  onion?: SpriteFrame | null;   // sibling frame ghosted underneath
  onStroke: (f: SpriteFrame, coalesceKey?: string) => void;
  onPalette: (palette: string[]) => void;
  // undo/redo next to the tools: painting is where reaching for the header
  // buttons hurts most (a stroke = one undo step)
  history?: BoardHistory;
}

const CELL = 16;
const CHECKER = ['#23272f', '#2b3039'];

interface SelRect { x: number; y: number; w: number; h: number }
type Drag =
  | { mode: 'marquee'; sx: number; sy: number; cx: number; cy: number }
  | { mode: 'move'; grabDx: number; grabDy: number; pos: { x: number; y: number };
      float: Uint8Array; fw: number; fh: number };

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function liftRegion(pixels: Uint8Array, w: number, r: SelRect): Uint8Array {
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++)
      out[y * r.w + x] = pixels[(r.y + y) * w + (r.x + x)];
  return out;
}

function clearRegion(buf: Uint8Array, w: number, r: SelRect) {
  for (let y = 0; y < r.h; y++) buf.fill(0, (r.y + y) * w + r.x, (r.y + y) * w + r.x + r.w);
}

// Stamp skips transparent cells, so moving a heart over the blush doesn't
// punch a rectangular hole around it.
function stampRegion(buf: Uint8Array, w: number, float: Uint8Array, r: SelRect) {
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const idx = float[y * r.w + x];
      if (idx) buf[(r.y + y) * w + (r.x + x)] = idx;
    }
}

export default function PixelBoard({ frame, onion, onStroke, onPalette, history }: Props) {
  const { t } = useI18n();
  const [tool, setTool] = useState<Tool>('pen');
  const [selIdx, setSelIdx] = useState(1);
  const [mirror, setMirror] = useState(false);
  const [onionOn, setOnionOn] = useState(true);
  // magnifier for dense grids (the 80x60 overlay): CSS-scale the canvas and
  // scroll; cellAt maps through the bounding rect, so picking stays exact
  const [zoom, setZoom] = useState(1);
  // marquee selection (select tool): draw a rect, drag it (or arrow-nudge)
  // to move the lifted pixels; click outside or switch tool to drop it
  const [sel, setSel] = useState<SelRect | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<Uint8Array | null>(null);  // live buffer during a stroke
  const lastCellRef = useRef<[number, number] | null>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const editTargetRef = useRef<number | 'new'>('new');

  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext('2d')!;
    const { w, h, palette } = frame;
    const pixels = strokeRef.current ?? frame.pixels;
    const half = CELL / 2;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        for (let sy = 0; sy < 2; sy++)
          for (let sx = 0; sx < 2; sx++) {
            g.fillStyle = CHECKER[(x * 2 + sx + y * 2 + sy) % 2];
            g.fillRect(x * CELL + sx * half, y * CELL + sy * half, half, half);
          }
      }
    if (onion && onionOn) {
      g.globalAlpha = 0.28;
      const ow = Math.min(onion.w, w), oh = Math.min(onion.h, h);
      for (let y = 0; y < oh; y++)
        for (let x = 0; x < ow; x++) {
          const idx = onion.pixels[y * onion.w + x];
          if (!idx) continue;
          g.fillStyle = onion.palette[idx - 1] ?? '#888888';
          g.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      g.globalAlpha = 1;
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const idx = pixels[y * w + x];
        if (!idx) continue;
        g.fillStyle = palette[idx - 1] ?? '#888888';
        g.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 1; x < w; x++) { g.moveTo(x * CELL + 0.5, 0); g.lineTo(x * CELL + 0.5, h * CELL); }
    for (let y = 1; y < h; y++) { g.moveTo(0, y * CELL + 0.5); g.lineTo(w * CELL, y * CELL + 0.5); }
    g.stroke();
    g.strokeStyle = 'rgba(255,180,84,0.35)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo((w / 2) * CELL + 0.5, 0); g.lineTo((w / 2) * CELL + 0.5, h * CELL);
    g.moveTo(0, (h / 2) * CELL + 0.5); g.lineTo(w * CELL, (h / 2) * CELL + 0.5);
    g.stroke();
    g.setLineDash([]);

    // selection layer: floating pixels while a move drag is live, then the
    // dashed rect (live marquee, live move position, or the settled selection)
    const dr = dragRef.current;
    let rect: SelRect | null = sel;
    if (dr?.mode === 'marquee') {
      rect = {
        x: Math.min(dr.sx, dr.cx), y: Math.min(dr.sy, dr.cy),
        w: Math.abs(dr.cx - dr.sx) + 1, h: Math.abs(dr.cy - dr.sy) + 1,
      };
    } else if (dr?.mode === 'move') {
      rect = { x: dr.pos.x, y: dr.pos.y, w: dr.fw, h: dr.fh };
      for (let y = 0; y < dr.fh; y++)
        for (let x = 0; x < dr.fw; x++) {
          const idx = dr.float[y * dr.fw + x];
          if (!idx) continue;
          g.fillStyle = palette[idx - 1] ?? '#888888';
          g.fillRect((dr.pos.x + x) * CELL, (dr.pos.y + y) * CELL, CELL, CELL);
        }
    }
    if (rect) {
      g.strokeStyle = 'rgba(120,200,255,0.9)';
      g.lineWidth = 2;
      g.setLineDash([6, 4]);
      g.strokeRect(rect.x * CELL + 1, rect.y * CELL + 1, rect.w * CELL - 2, rect.h * CELL - 2);
      g.setLineDash([]);
    }
  }, [frame, onion, onionOn, sel]);

  useEffect(() => { strokeRef.current = null; repaint(); }, [repaint]);

  const cellAt = (e: React.PointerEvent): [number, number] | null => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * frame.w);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * frame.h);
    return x >= 0 && y >= 0 && x < frame.w && y < frame.h ? [x, y] : null;
  };

  // like cellAt but clamped into the grid, so marquee/move drags may leave
  // the canvas without dying
  const cellAtClamped = (e: React.PointerEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * frame.w);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * frame.h);
    return [clampN(x, 0, frame.w - 1), clampN(y, 0, frame.h - 1)];
  };

  // one selection move as a single frame delta: lift, clear, stamp shifted
  const moveSelTo = (from: SelRect, nx: number, ny: number, key?: string) => {
    const buf = frame.pixels.slice();
    const float = liftRegion(frame.pixels, frame.w, from);
    clearRegion(buf, frame.w, from);
    stampRegion(buf, frame.w, float, { x: nx, y: ny, w: from.w, h: from.h });
    onStroke({ ...frame, palette: [...frame.palette], pixels: buf }, key);
    setSel({ x: nx, y: ny, w: from.w, h: from.h });
  };

  // arrow keys nudge the active selection; Escape drops it. Consecutive
  // nudges coalesce into one undo step (same coalesce key).
  useEffect(() => {
    if (!sel || tool !== 'select') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSel(null); return; }
      const d: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      };
      const dd = d[e.key];
      if (!dd || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      const nx = clampN(sel.x + dd[0], 0, frame.w - sel.w);
      const ny = clampN(sel.y + dd[1], 0, frame.h - sel.h);
      if (nx !== sel.x || ny !== sel.y) moveSelTo(sel, nx, ny, 'selnudge');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const paintCell = (buf: Uint8Array, x: number, y: number, idx: number) => {
    buf[y * frame.w + x] = idx;
    if (mirror) buf[y * frame.w + (frame.w - 1 - x)] = idx;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (tool === 'select') {
      const [x, y] = cellAtClamped(e);
      if (sel && x >= sel.x && x < sel.x + sel.w && y >= sel.y && y < sel.y + sel.h) {
        // grab inside the selection: lift it and start the move drag
        const buf = frame.pixels.slice();
        clearRegion(buf, frame.w, sel);
        strokeRef.current = buf;
        dragRef.current = {
          mode: 'move', grabDx: x - sel.x, grabDy: y - sel.y, pos: { x: sel.x, y: sel.y },
          float: liftRegion(frame.pixels, frame.w, sel), fw: sel.w, fh: sel.h,
        };
      } else {
        dragRef.current = { mode: 'marquee', sx: x, sy: y, cx: x, cy: y };
        setSel(null);
      }
      canvasRef.current!.setPointerCapture(e.pointerId);
      repaint();
      return;
    }
    const cell = cellAt(e);
    if (!cell) return;
    const [x, y] = cell;
    if (tool === 'picker') {
      const idx = frame.pixels[y * frame.w + x];
      setSelIdx(idx);
      setTool(idx === 0 ? 'eraser' : 'pen');
      return;
    }
    if (tool === 'fill') {
      onStroke(floodFill(frame, x, y, selIdx));
      return;
    }
    canvasRef.current!.setPointerCapture(e.pointerId);
    const buf = frame.pixels.slice();
    paintCell(buf, x, y, tool === 'eraser' ? 0 : selIdx);
    strokeRef.current = buf;
    lastCellRef.current = cell;
    repaint();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const dr = dragRef.current;
    if (dr?.mode === 'marquee') {
      [dr.cx, dr.cy] = cellAtClamped(e);
      repaint();
      return;
    }
    if (dr?.mode === 'move') {
      const [x, y] = cellAtClamped(e);
      dr.pos.x = clampN(x - dr.grabDx, 0, frame.w - dr.fw);
      dr.pos.y = clampN(y - dr.grabDy, 0, frame.h - dr.fh);
      repaint();
      return;
    }
    const buf = strokeRef.current;
    if (!buf) return;
    const cell = cellAt(e);
    if (!cell) return;
    const [lx, ly] = lastCellRef.current ?? cell;
    for (const [x, y] of lineCells(lx, ly, cell[0], cell[1]))
      paintCell(buf, x, y, tool === 'eraser' ? 0 : selIdx);
    lastCellRef.current = cell;
    repaint();
  };

  const onPointerUp = () => {
    const dr = dragRef.current;
    if (dr?.mode === 'marquee') {
      dragRef.current = null;
      setSel({
        x: Math.min(dr.sx, dr.cx), y: Math.min(dr.sy, dr.cy),
        w: Math.abs(dr.cx - dr.sx) + 1, h: Math.abs(dr.cy - dr.sy) + 1,
      });
      repaint();
      return;
    }
    if (dr?.mode === 'move') {
      const buf = strokeRef.current!;
      stampRegion(buf, frame.w, dr.float, { x: dr.pos.x, y: dr.pos.y, w: dr.fw, h: dr.fh });
      dragRef.current = null;
      strokeRef.current = null;
      setSel({ x: dr.pos.x, y: dr.pos.y, w: dr.fw, h: dr.fh });
      onStroke({ ...frame, palette: [...frame.palette], pixels: buf });
      return;
    }
    const buf = strokeRef.current;
    if (!buf) return;
    strokeRef.current = null;
    lastCellRef.current = null;
    onStroke({ ...frame, palette: [...frame.palette], pixels: buf });
  };

  const openColorInput = (target: number | 'new', current: string, anchor: HTMLElement) => {
    editTargetRef.current = target;
    const input = colorInputRef.current!;
    // the native picker popover anchors to the input's box — a box-less
    // hidden input would put it at the viewport corner, so park the
    // invisible input under the clicked swatch first
    const r = anchor.getBoundingClientRect();
    input.style.left = `${r.left}px`;
    input.style.top = `${r.bottom}px`;
    input.value = current;
    input.click();
  };

  const onColorPicked = (hex: string) => {
    const target = editTargetRef.current;
    const palette = [...frame.palette];
    if (target === 'new') {
      if (palette.length >= SPRITE_MAX_COLORS) return;
      palette.push(hex);
      setSelIdx(palette.length);
      setTool('pen');
    } else {
      palette[target] = hex;
    }
    onPalette(palette);
  };

  const toolBtn = (tl: Tool, icon: string, label: string) => (
    <button
      className={`mini tool ${tool === tl ? 'active' : ''}`} data-tip={t(label)}
      onClick={() => { setTool(tl); if (tl !== 'select') setSel(null); }}
    >
      {icon}
    </button>
  );

  return (
    <div className="pixel-board">
      <div className="pixel-tools">
        {toolBtn('pen', '✏️', 'pen')}
        {toolBtn('eraser', '🧽', 'eraser')}
        {toolBtn('fill', '🪣', 'bucket')}
        {toolBtn('picker', '💉', 'eyedropper')}
        {toolBtn('select', '⬚', 'select & move')}
        <button
          className={`mini tool ${mirror ? 'active' : ''}`} data-tip={t('mirror pen')}
          onClick={() => setMirror(!mirror)}
        >
          ⇔
        </button>
        {onion && (
          <button
            className={`mini tool ${onionOn ? 'active' : ''}`} data-tip={t('ghost of the other frame')}
            onClick={() => setOnionOn(!onionOn)}
          >
            👻
          </button>
        )}
        <button
          className={`mini tool ${zoom > 1 ? 'active' : ''}`} data-tip={t('zoom')}
          onClick={() => setZoom(zoom >= 3 ? 1 : zoom + 1)}
        >
          🔍{zoom > 1 ? `${zoom}×` : ''}
        </button>
        {history && (
          <>
            <span className="tool-gap" />
            <button
              className="mini tool" disabled={!history.canUndo}
              data-tip={`${t('Undo')} (⌘Z)`} onClick={history.undo}
            >
              ↩️
            </button>
            <button
              className="mini tool" disabled={!history.canRedo}
              data-tip={`${t('Redo')} (⇧⌘Z)`} onClick={history.redo}
            >
              ↪️
            </button>
          </>
        )}
      </div>
      <div className="board-scroll">
        <canvas
          ref={canvasRef}
          width={frame.w * CELL} height={frame.h * CELL}
          // at 1x, cap the width so the height never exceeds the scroll box
          // (60vh) — a wide control column otherwise grows a scrollbar;
          // zoomed-in overflow is the point of the zoom tool
          style={zoom === 1
            ? { width: '100%', maxWidth: `calc(60vh * ${(frame.w / frame.h).toFixed(4)})`, margin: '0 auto' }
            : { width: `${zoom * 100}%` }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        />
      </div>
      <div className="pixel-palette">
        <button
          className={`swatch transparent ${selIdx === 0 ? 'active' : ''}`}
          data-tip={t('transparent (eraser)')}
          onClick={() => { setSelIdx(0); setTool('eraser'); }}
        />
        {frame.palette.map((hex, i) => (
          <button
            key={i}
            className={`swatch ${selIdx === i + 1 ? 'active' : ''}`}
            style={{ background: hex }}
            title={`${hex} — ${t('double-click to edit')}`}
            onClick={() => { setSelIdx(i + 1); if (tool === 'eraser' || tool === 'picker') setTool('pen'); }}
            onDoubleClick={(e) => openColorInput(i, hex, e.currentTarget)}
          />
        ))}
        {frame.palette.length < SPRITE_MAX_COLORS && (
          <button className="swatch add" data-tip={t('add color')} onClick={(e) => openColorInput('new', '#ffcc66', e.currentTarget)}>
            +
          </button>
        )}
        <input
          ref={colorInputRef} type="color" className="swatch-color-input"
          onChange={(e) => onColorPicked(e.target.value)}
        />
      </div>
    </div>
  );
}
