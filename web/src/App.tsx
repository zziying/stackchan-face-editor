import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import defaultFaceJson from '../../faces/default.json';
import Preview from './components/Preview';
import PartPanel from './components/PartPanel';
import PixelPartEditor from './components/PixelPartEditor';
import { FieldRow } from './components/Controls';
import { editField, type FieldValue } from './face/editDoc';
import { useDocHistory } from './face/history';
import { effectiveDoc } from './face/merge';
import { deletePath, getPath, setPath } from './face/pathUtils';
import { encodeShareHash, decodeShareHash } from './face/share';
import { serialSupported, useDeviceSerial } from './face/serial';
import { useDeviceHttp } from './face/httpDevice';
import { WIZ_STEPS, prepareStep, stepEngaged, type WizStart } from './face/wizard';
import WizardBar from './components/WizardBar';
import PresetGallery from './components/PresetGallery';
import { useI18n } from './i18n';
import {
  ANIM_FIELDS, BROW_FIELDS, EYE_FIELDS, MOUTH_FIELDS, PALETTE_FIELDS,
} from './face/fields';
import {
  EXPR_INDEX, EXPRESSIONS, MIRROR_PAIR,
  type FaceDoc, type PartKey, type PartNode, type Tab,
} from './face/types';

const DEFAULT_FACE = defaultFaceJson as unknown as FaceDoc;

const defaultBrow = (x: number): PartNode => ({
  pos: { x, y: 65 }, shape: 'rect', width: 40, thickness: 6, angle: 0,
});

export default function App() {
  const { lang, setLang, t } = useI18n();
  // progress persists in localStorage: opening the editor restores whatever
  // was on the canvas last time (share links still win, see the hash effect)
  const [initialDoc] = useState<FaceDoc>(() => {
    try {
      const saved = localStorage.getItem('pf-doc');
      if (saved) {
        const d = JSON.parse(saved);
        if (d.version === 1) return d as FaceDoc;
      }
    } catch { /* corrupt save: fall back to the default face */ }
    return DEFAULT_FACE;
  });
  const { doc, commit, undo, redo, reset, breakCoalesce, canUndo, canRedo } = useDocHistory(initialDoc);
  const [tab, setTab] = useState<Tab>('base');
  const [symLock, setSymLock] = useState(true);
  const [talking, setTalking] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [toast, setToast] = useState('');
  // wizard: index into WIZ_STEPS, or null when off. Only navigation state —
  // the face itself lives in the doc, so closing the wizard loses nothing.
  const [wiz, setWiz] = useState<number | null>(null);
  // first-visit bubble pointing at the wizard button
  const [wizHint, setWizHint] = useState(() => !localStorage.getItem('pf-wiz-hint'));
  const dismissWizHint = () => {
    setWizHint(false);
    localStorage.setItem('pf-wiz-hint', '1');
  };
  // draggable splitter: width of the right control column, persisted locally
  const [rightW, setRightW] = useState(() => {
    const saved = parseInt(localStorage.getItem('pf-right-w') ?? '', 10);
    return Number.isFinite(saved) ? Math.min(Math.max(saved, 300), 760) : 420;
  });
  const fileRef = useRef<HTMLInputElement>(null);
  // pristine copy of whatever was last loaded (default/import/share):
  // "revert <expr>" restores that version's delta, not an empty one
  const initialRef = useRef<FaceDoc>(initialDoc);

  useEffect(() => {
    decodeShareHash(location.hash).then((d) => {
      if (d) { initialRef.current = d; reset(d); }
      // a hash that claims to be a face but doesn't decode (truncated paste,
      // mangled by a chat app): say so instead of silently showing the old face
      else if (location.hash.startsWith('#f=')) flash(t('broken share link — showing your saved face'), 3200);
    });
  }, [reset]);

  // Cmd/Ctrl+Z undo, +Shift redo. Text inputs keep the browser's own undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const el = e.target as HTMLElement;
      if (el instanceof HTMLInputElement && el.type === 'text') return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const docJson = useMemo(() => JSON.stringify(doc), [doc]);
  const eff = useMemo(() => effectiveDoc(doc, tab), [doc, tab]);

  // autosave the working face (debounced past rapid slider/paint commits)
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem('pf-doc', docJson), 400);
    return () => clearTimeout(t);
  }, [docJson]);

  const editPart = (partKey: PartKey) => (path: string, v: FieldValue) =>
    commit((d) => editField(d, tab, partKey, path, v, symLock), `${tab}.${partKey}.${path}`);
  const editAbs = (path: string, v: FieldValue) =>
    commit((d) => editField(d, tab, null, path, v, false), `${tab}.${path}`);
  const clearField = (fullPath: string) =>
    commit((d) => deletePath(d, tab === 'base' ? fullPath : `expressions.${tab}.${fullPath}`));

  // Canvas drag: both coordinates land in one commit so a whole drag
  // gesture coalesces into a single undo step.
  const dragPart = (partKey: PartKey, x: number, y: number) =>
    commit((d) => {
      const next = editField(d, tab, partKey, 'pos.x', x, symLock);
      return editField(next, tab, partKey, 'pos.y', y, symLock);
    }, `${tab}.${partKey}.drag`);

  const toggleBrow = (key: 'browL' | 'browR') => (on: boolean) =>
    commit((d) => {
      const pair = MIRROR_PAIR[key]!;
      const keys = symLock ? [key, pair] : [key];
      let next = d;
      for (const k of keys) {
        next = on
          ? setPath(next, `parts.${k}`, defaultBrow(k === 'browL' ? 230 : 90))
          : deletePath(next, `parts.${k}`);
      }
      return next;
    });

  const flash = (msg: string, ms = 1800) => {
    setToast(msg);
    setTimeout(() => setToast(''), ms);
  };

  const serial = useDeviceSerial((line) => {
    if (line.startsWith('ERR')) flash(`device: ${line}`);
    else if (line.startsWith('OK SAVE')) flash(t('saved to device'));
    // OK FACE / OK EXPR / OK PF / "# ..." logs: silent
  });
  const connected = serial.status === 'connected';

  // Second push channel: HTTP over WiFi (keke-style firmware endpoints).
  const http = useDeviceHttp((msg) => flash(`device: ${t(msg)}`));
  const httpConnected = http.status === 'connected';
  const [httpOpen, setHttpOpen] = useState(false);
  useEffect(() => {
    if (httpConnected) {
      setHttpOpen(false);
      flash(t('connected over WiFi'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [httpConnected]);

  // Live push: any edit reaches the device after a short debounce. The
  // firmware applies to RAM only; Save to device is the explicit persist.
  // HTTP debounces a bit longer than serial — a whole request per push.
  useEffect(() => {
    if (!connected && !httpConnected) return;
    const t = setTimeout(() => {
      if (connected) serial.send(`FACE ${docJson}`);
      else void http.pushFace(docJson, false);
    }, connected ? 150 : 250);
    return () => clearTimeout(t);
  }, [connected, httpConnected, docJson, serial, http]);

  // Device mirrors the expression tab being edited.
  useEffect(() => {
    if (connected) serial.send(`EXPR ${EXPR_INDEX[tab]}`);
    else if (httpConnected) http.pushExpr(tab === 'base' ? 'neutral' : tab);
  }, [connected, httpConnected, tab, serial, http]);

  const saveToDevice = () => {
    if (connected) {
      serial.send(`FACE ${docJson}`);
      serial.send('SAVE');
    } else if (httpConnected) {
      void http.pushFace(docJson, true).then((ok) => {
        if (ok) flash(t('saved to device'));
      });
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.meta?.name || 'face'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = (file: File) => {
    file.text().then((text) => {
      try {
        const d = JSON.parse(text);
        if (d.version !== 1) throw new Error('unsupported version');
        initialRef.current = d;
        reset(d);
        flash(t('imported'));
      } catch (e) {
        flash(`${t('import failed')}: ${(e as Error).message}`);
      }
    });
  };

  const newFace = () => {
    if (!window.confirm(t('start a new face? the current one will be replaced'))) return;
    localStorage.removeItem('pf-doc');
    history.replaceState(null, '', location.pathname);  // drop any share hash
    initialRef.current = DEFAULT_FACE;
    reset(DEFAULT_FACE);
    flash(t('new face started'));
  };

  // Loading a preset is a plain commit — one undo step brings the old face
  // back — but it resets the revert baseline like import/share do.
  const pickPreset = (d: FaceDoc) => {
    initialRef.current = d;
    commit(() => d);
    flash(t('preset loaded'));
  };

  const share = async () => {
    const hash = await encodeShareHash(doc);
    history.replaceState(null, '', hash);
    await navigator.clipboard.writeText(location.href);
    flash(t('link copied'));
  };

  const hasDelta = (name: string) => {
    const d = doc.expressions?.[name];
    return !!d && Object.keys(d).length > 0;
  };

  const parts = eff.parts;

  const wizStep = wiz === null ? null : WIZ_STEPS[wiz];

  // Step entry: convert the step's part to pixel / lay out the squashed
  // draft (prepareStep no-ops by reference, so re-entry is free), point the
  // demo at the done page, and open + scroll the step's panel. The open flag
  // is set on the DOM directly: React only owns these details' initial state.
  useEffect(() => {
    if (!wizStep) { setTalking(false); return; }
    commit((d) => prepareStep(d, wizStep.key), `wiz.${wizStep.key}`);
    setTalking(wizStep.key === 'done');
    if (wizStep.target) {
      const id = `panel-${wizStep.target}`;
      setTimeout(() => {
        const el = document.getElementById(id) as HTMLDetailsElement | null;
        if (el) {
          el.open = true;
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 60);
    }
  }, [wizStep, commit]);

  const startWizard = () => {
    dismissWizHint();
    setTab('base');  // pixel frames belong to the base face
    setWiz(0);
  };

  // start-step choice: what the four frames build on. Replacing the face is
  // a normal commit, so it stays a single undo step.
  const wizStart = (choice: WizStart) => {
    if (choice === 'fresh') commit(() => DEFAULT_FACE);
    setWiz(1);
  };

  const engageWiz = (kind: 'brows' | 'overlay') => {
    if (kind === 'overlay') { toggleOverlay(true); return; }
    commit((d) => {
      let next = d;
      for (const [k, x] of [['browL', 230], ['browR', 90]] as const) {
        next = getPath(next, `parts.${k}`)
          ? setPath(next, `parts.${k}.shape`, 'pixel')
          : setPath(next, `parts.${k}`, { ...defaultBrow(x), shape: 'pixel' });
      }
      return next;
    });
  };

  // pixel-skin board under a part's fields when its shape is pixel
  const pixelExtra = (key: PartKey) =>
    parts[key]?.shape === 'pixel' ? (
      <PixelPartEditor
        target={key} doc={doc} symLock={symLock}
        showBaseNote={tab !== 'base'} commit={commit}
        frameOverride={wizStep?.target === key ? wizStep.frame : undefined}
        history={{ undo, redo, canUndo, canRedo }}
      />
    ) : undefined;

  const toggleOverlay = (on: boolean) =>
    commit((d) => (on ? setPath(d, 'overlay', {}) : deletePath(d, 'overlay')));

  // splitter drag: the right column tracks the pointer, clamped so neither
  // side collapses; final width sticks in localStorage
  const onSplitDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const body = el.parentElement!;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const max = Math.min(760, body.clientWidth - 320);
      const w = body.getBoundingClientRect().right - ev.clientX;
      setRightW(Math.min(Math.max(w, 300), max));
    };
    const onUp = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      setRightW((w) => { localStorage.setItem('pf-right-w', String(w)); return w; });
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  };

  // v2.1 per-expression overlay: absent entry inherits the base frame,
  // {hidden:true} suppresses it, {frames:{open}} replaces it wholesale.
  type OverlayMode = 'inherit' | 'hidden' | 'own';
  const overlayMode: OverlayMode = (() => {
    if (tab === 'base') return 'inherit';
    const e = getPath(doc, `overlay.expr.${tab}`) as PartNode | undefined;
    if (!e) return 'inherit';
    return e.hidden ? 'hidden' : 'own';
  })();
  const setOverlayMode = (m: OverlayMode) =>
    commit((d) => {
      if (m === 'inherit') return deletePath(d, `overlay.expr.${tab}`);
      if (m === 'hidden') return setPath(d, `overlay.expr.${tab}`, { hidden: true });
      // own: seed the frame from a copy of the base one so the board doesn't
      // start blank (same draft spirit as squash-from-open)
      const baseFrame = getPath(d, 'overlay.frames.open');
      const seed = baseFrame
        ? { frames: { open: JSON.parse(JSON.stringify(baseFrame)) } }
        : {};
      return setPath(deletePath(d, `overlay.expr.${tab}`), `overlay.expr.${tab}`, seed);
    });

  return (
    <div className="app">
      <header>
        <h1>StackChan Face Editor</h1>
        <span className="face-name-wrap">
          <input
            className="face-name" placeholder={t('face name')}
            value={doc.meta?.name ?? ''}
            onChange={(e) => commit((d) => setPath(d, 'meta.name', e.target.value), 'meta.name')}
          />
          <span className="pencil">✎</span>
        </span>
        <span className="spacer" />
        <button disabled={!canUndo} data-tip={`${t('Undo')} (⌘Z)`} onClick={undo}>↶</button>
        <button disabled={!canRedo} data-tip={`${t('Redo')} (⇧⌘Z)`} onClick={redo}>↷</button>
        <button onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>
          {lang === 'en' ? '中文' : 'EN'}
        </button>
        <span className="wiz-anchor">
          <button
            className={wiz !== null ? 'serial-on' : ''}
            data-tip={t('guided flow: four frames to a living face')}
            onClick={() => (wiz === null ? startWizard() : setWiz(null))}
          >
            {t('Wizard')}
          </button>
          {wizHint && wiz === null && (
            <span className="wiz-bubble">
              {t('new here? the wizard walks you to a living face')}
              <button className="wiz-bubble-x" onClick={dismissWizHint}>✕</button>
            </span>
          )}
        </span>
        <span className="preset-anchor">
          <button
            className={presetsOpen ? 'serial-on' : ''}
            onClick={() => setPresetsOpen((o) => !o)}
          >
            {t('Presets')}
          </button>
          {presetsOpen && (
            <PresetGallery onPick={pickPreset} onClose={() => setPresetsOpen(false)} />
          )}
        </span>
        <button onClick={newFace}>{t('New')}</button>
        <button onClick={() => fileRef.current?.click()}>{t('Import')}</button>
        <button onClick={exportJson}>{t('Export')}</button>
        <button onClick={share}>{t('Share')}</button>
        {connected || httpConnected ? (
          <>
            <button className="serial-on" onClick={saveToDevice}>{t('Save to device')}</button>
            <button onClick={() => (connected ? serial.disconnect() : http.disconnect())}>
              {t('Disconnect')}
            </button>
          </>
        ) : (
          <>
            {/* the tip lives on a wrapper: disabled buttons don't fire :hover,
                and the disabled state is exactly when the reason matters */}
            <span
              className="tip-wrap"
              data-tip={t(serialSupported ? 'USB-connect a StackChan running the reference firmware'
                : 'pushing to a device needs Chrome on localhost or HTTPS — or export the JSON to its SD card')}
            >
              <button
                disabled={!serialSupported || serial.status === 'connecting'}
                onClick={() => serial.connect()}
              >
                {t(serial.status === 'connecting' ? 'Connecting…' : 'Connect device')}
              </button>
            </span>
            <span className="http-anchor">
              <button
                className={httpOpen ? 'serial-on' : ''}
                data-tip={t('live-push over WiFi to a StackChan whose firmware has the HTTP face API')}
                onClick={() => setHttpOpen((o) => !o)}
              >
                {t('WiFi')}
              </button>
              {httpOpen && (
                <span className="http-pop">
                  <input
                    className="http-host" placeholder={t('device IP')}
                    value={http.host}
                    onChange={(e) => http.setHost(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void http.connect(); }}
                  />
                  <button
                    disabled={http.status === 'connecting' || !http.host.trim()}
                    onClick={() => void http.connect()}
                  >
                    {t(http.status === 'connecting' ? 'Connecting…' : 'Connect')}
                  </button>
                </span>
              )}
            </span>
          </>
        )}
        <input
          ref={fileRef} type="file" accept=".json" hidden
          onChange={(e) => { if (e.target.files?.[0]) importJson(e.target.files[0]); e.target.value = ''; }}
        />
      </header>

      {wiz !== null && (
        <WizardBar
          step={wiz} doc={doc} connected={connected}
          serialStatus={serial.status} serialOk={serialSupported}
          onStep={(i) => setWiz(Math.min(Math.max(i, 0), WIZ_STEPS.length - 1))}
          onStart={wizStart} onEngage={engageWiz} onConnect={() => serial.connect()}
          onShare={share} onSaveDevice={saveToDevice}
          onClose={() => setWiz(null)}
        />
      )}

      <div className="body">
        <div className="left">
          <Preview
            docJson={docJson} exprIndex={EXPR_INDEX[tab]} talking={talking}
            mouthOpen={mouthOpen} parts={parts}
            onDragPart={dragPart} onDragEnd={breakCoalesce}
          />
          <div className="mouth-bar">
            <span className="field-label">{t('mouth open')}</span>
            <input
              type="range" min={0} max={1} step={0.01}
              value={talking ? 0 : mouthOpen} disabled={talking}
              onChange={(e) => setMouthOpen(parseFloat(e.target.value))}
            />
            <span className="mouth-val">{talking ? '—' : mouthOpen.toFixed(2)}</span>
          </div>
          <nav className="tabs">
            <button className={tab === 'base' ? 'active' : ''} onClick={() => setTab('base')}>
              {t('base')}
            </button>
            {EXPRESSIONS.map((name) => (
              <button
                key={name} className={tab === name ? 'active' : ''}
                onClick={() => setTab(name)}
              >
                {t(name)}{hasDelta(name) && <span className="dot" />}
              </button>
            ))}
          </nav>
          <div className="face-toggles">
            <label className="toggle">
              <input type="checkbox" checked={symLock} onChange={(e) => setSymLock(e.target.checked)} />
              {t('symmetry')}
            </label>
            <label className="toggle">
              <input type="checkbox" checked={talking} onChange={(e) => setTalking(e.target.checked)} />
              {t('talk')}
            </label>
          </div>
          {tab !== 'base' && (
            <div className="expr-hint">
              {t('editing')} <b>{t(tab)}</b> {t('as offsets from base')}
              <button
                className="mini"
                onClick={() => commit((d) => {
                  const pristine = initialRef.current.expressions?.[tab];
                  const cleared = deletePath(d, `expressions.${tab}`);
                  return pristine
                    ? setPath(cleared, `expressions.${tab}`, structuredClone(pristine))
                    : cleared;
                })}
              >
                {t('revert')} {t(tab)}
              </button>
              {hasDelta(tab) && (
                <button className="mini" onClick={() => commit((d) => deletePath(d, `expressions.${tab}`))}>
                  {t('clear')}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="splitter" onPointerDown={onSplitDown} />
        <div className="right" style={{ flexBasis: rightW }}>
          <PartPanel
            title={t('Palette')} fields={PALETTE_FIELDS} node={eff} doc={doc} tab={tab}
            pathPrefix="" onEdit={editAbs} onClear={clearField} defaultOpen
          />
          <PartPanel
            id="panel-eyeL"
            title={t('Eye L')} fields={EYE_FIELDS} node={parts.eyeL ?? {}} doc={doc} tab={tab}
            pathPrefix="parts.eyeL" onEdit={editPart('eyeL')} onClear={clearField} defaultOpen
            extra={pixelExtra('eyeL')}
          />
          <PartPanel
            title={t('Eye R')} fields={EYE_FIELDS} node={parts.eyeR ?? {}} doc={doc} tab={tab}
            pathPrefix="parts.eyeR" onEdit={editPart('eyeR')} onClear={clearField}
            extra={pixelExtra('eyeR')}
          />
          <PartPanel
            id="panel-browL"
            title={t('Brow L')} fields={BROW_FIELDS} node={parts.browL ?? {}} doc={doc} tab={tab}
            pathPrefix="parts.browL" onEdit={editPart('browL')} onClear={clearField}
            present={!!parts.browL} onTogglePresent={toggleBrow('browL')}
            extra={pixelExtra('browL')}
          />
          <PartPanel
            title={t('Brow R')} fields={BROW_FIELDS} node={parts.browR ?? {}} doc={doc} tab={tab}
            pathPrefix="parts.browR" onEdit={editPart('browR')} onClear={clearField}
            present={!!parts.browR} onTogglePresent={toggleBrow('browR')}
            extra={pixelExtra('browR')}
          />
          <PartPanel
            id="panel-mouth"
            title={t('Mouth')} fields={MOUTH_FIELDS} node={parts.mouth ?? {}} doc={doc} tab={tab}
            pathPrefix="parts.mouth" onEdit={editPart('mouth')} onClear={clearField}
            extra={pixelExtra('mouth')}
          />
          <details id="panel-overlay" className="panel">
            <summary>
              {t('Overlay')}
              <input
                type="checkbox" checked={!!doc.overlay}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => toggleOverlay(e.target.checked)}
              />
            </summary>
            {!doc.overlay && (
              <div className="panel-hint">{t('a static pixel layer on top — blush, whiskers, bows')}</div>
            )}
            {doc.overlay && (
              <>
                <div className="panel-hint">{t('the grid maps onto the whole face — draw things where they should sit')}</div>
                <FieldRow
                  def={{ path: 'overlay.smooth', label: 'Smooth pixels', kind: 'bool' }}
                  value={doc.overlay.smooth ?? false} isDelta={false}
                  onChange={(v) => commit((d) => setPath(d, 'overlay.smooth', v), 'overlay.smooth')}
                />
                {tab !== 'base' && (
                  <div className="frame-tabs">
                    {([['inherit', 'inherit base'], ['hidden', 'hidden'], ['own', 'own frame']] as const).map(([m, label]) => (
                      <button
                        key={m} className={`mini ${overlayMode === m ? 'active' : ''}`}
                        onClick={() => setOverlayMode(m)}
                      >
                        {t(label)}
                      </button>
                    ))}
                  </div>
                )}
                {overlayMode === 'hidden' ? (
                  <div className="panel-hint">{t('the overlay is hidden on this expression')}</div>
                ) : (
                  <PixelPartEditor
                    target="overlay" doc={doc} symLock={false}
                    basePath={overlayMode === 'own' ? `overlay.expr.${tab}` : undefined}
                    showBaseNote={tab !== 'base' && overlayMode === 'inherit'} commit={commit}
                    history={{ undo, redo, canUndo, canRedo }}
                  />
                )}
              </>
            )}
          </details>
          <PartPanel
            title={t('Animation')} fields={ANIM_FIELDS} node={eff} doc={doc} tab={tab}
            pathPrefix="" onEdit={editAbs} onClear={clearField}
          />
          <details
            className="panel json-panel"
            onToggle={(e) => setJsonOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary>
              {t('View JSON')}
              {jsonOpen && (
                <button
                  className="mini"
                  onClick={(e) => {
                    e.preventDefault();
                    navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
                    flash(t('JSON copied'));
                  }}
                >
                  {t('copy')}
                </button>
              )}
            </summary>
            {jsonOpen && <pre className="json-view">{JSON.stringify(doc, null, 2)}</pre>}
          </details>
        </div>
      </div>
      {/* floating twin of the wizard-bar primary action: the active step's
          panel usually sits deep in the scrolled right column, far from the
          top strip */}
      {wizStep && wizStep.key !== 'start' && wiz! < WIZ_STEPS.length - 1 && (
        <button className="wiz-float" onClick={() => setWiz(wiz! + 1)}>
          {wizStep.optional && !stepEngaged(doc, wizStep) ? t('skip') : `${t('next')} →`}
        </button>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
