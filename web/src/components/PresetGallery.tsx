// Preset gallery popover: thumbnails rendered by the same WASM engine as the
// live preview, through a private module instance so the main canvas keeps
// its own load/tick state untouched.
import { useEffect, useState } from 'react';
import createParamFace from '../wasm/paramface.js';
import { PRESETS } from '../face/presets';
import type { FaceDoc } from '../face/types';

const W = 320, H = 240;   // engine framebuffer
const TW = 128, TH = 96;  // thumbnail size

interface Props {
  onPick: (doc: FaceDoc) => void;
  onClose: () => void;
}

export default function PresetGallery({ onPick, onClose }: Props) {
  const [thumbs, setThumbs] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    createParamFace({
      locateFile: (f: string) => `${import.meta.env.BASE_URL}${f}`,
    }).then((mod: any) => {
      if (cancelled) return;
      mod.ccall('pf_init', 'number', ['number', 'number'], [W, H]);
      const full = document.createElement('canvas');
      full.width = W; full.height = H;
      const fctx = full.getContext('2d')!;
      const image = fctx.createImageData(W, H);
      const rgba = new Uint32Array(image.data.buffer);
      const small = document.createElement('canvas');
      small.width = TW; small.height = TH;
      const sctx = small.getContext('2d')!;
      setThumbs(PRESETS.map(({ doc }) => {
        const ok = mod.ccall('pf_load', 'number', ['string'], [JSON.stringify(doc)]);
        if (!ok) return '';
        mod.ccall('pf_set_expression', null, ['number'], [0]);
        mod.ccall('pf_tick', null, ['number'], [16]);
        const fbPtr = (mod.ccall('pf_fb', 'number', [], []) as number) >> 1;
        const fb = mod.HEAPU16.subarray(fbPtr, fbPtr + W * H);
        for (let i = 0; i < W * H; i++) {
          const p = fb[i];
          rgba[i] = 0xff000000 | ((p & 0x1f) << 19) | (((p >> 5) & 0x3f) << 10) | (((p >> 11) & 0x1f) << 3);
        }
        fctx.putImageData(image, 0, 0);
        sctx.drawImage(full, 0, 0, TW, TH);
        return small.toDataURL();
      }));
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <div className="preset-backdrop" onClick={onClose} />
      <div className="preset-pop">
        {PRESETS.map((p, i) => (
          <button
            key={p.key}
            className="preset-card"
            onClick={() => { onPick(p.doc); onClose(); }}
          >
            {thumbs[i]
              ? <img src={thumbs[i]} alt={p.doc.meta?.name ?? p.key} width={TW} height={TH} />
              : <span className="preset-ph" style={{ width: TW, height: TH }} />}
            <span>{p.doc.meta?.name ?? p.key}</span>
          </button>
        ))}
      </div>
    </>
  );
}
