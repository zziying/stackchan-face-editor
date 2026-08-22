// Generic field renderers driven by FieldDef descriptors.
import type { FieldDef } from '../face/fields';
import type { FieldValue } from '../face/editDoc';
import { useI18n } from '../i18n';

interface RowProps {
  def: FieldDef;
  value: unknown;
  isDelta: boolean;  // expression tab + this field differs from base
  onChange: (v: FieldValue) => void;
  onClear?: () => void;  // optional color: revert to palette inherit
}

export function FieldRow({ def, value, isDelta, onChange, onClear }: RowProps) {
  const { t } = useI18n();
  return (
    <label className={`field ${isDelta ? 'field-delta' : ''}`}>
      <span className="field-label">{t(def.label)}</span>
      {def.kind === 'num' && (
        <>
          <input
            type="range" min={def.min} max={def.max} step={def.step}
            value={typeof value === 'number' ? value : 0}
            onChange={(e) => onChange(parseFloat(e.target.value))}
          />
          <input
            className="field-num" type="number" min={def.min} max={def.max} step={def.step}
            value={typeof value === 'number' ? Math.round(value * 100) / 100 : 0}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v)) onChange(v);
            }}
          />
        </>
      )}
      {def.kind === 'select' && (
        <select value={String(value ?? def.options![0])} onChange={(e) => onChange(e.target.value)}>
          {def.options!.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {def.kind === 'bool' && (
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
      )}
      {def.kind === 'color' && (
        <span className="field-color">
          <input
            type="color"
            value={typeof value === 'string' ? value : '#ffffff'}
            onChange={(e) => onChange(e.target.value)}
          />
          {def.optional && (
            typeof value === 'string'
              ? <button className="mini" onClick={(e) => { e.preventDefault(); onClear?.(); }}>×</button>
              : <span className="inherit">{t('palette')}</span>
          )}
        </span>
      )}
    </label>
  );
}
