// One collapsible section of fields (a part, palette, or animation group).
import type { ReactNode } from 'react';
import { getPath } from '../face/pathUtils';
import type { FieldDef } from '../face/fields';
import type { FieldValue } from '../face/editDoc';
import type { FaceDoc, PartNode, Tab } from '../face/types';
import { FieldRow } from './Controls';
import { useI18n } from '../i18n';

interface Props {
  id?: string;               // anchor for the wizard's open-and-scroll
  title: string;
  fields: FieldDef[];
  // node the relative paths resolve against (effective part node), or the
  // whole effective doc for absolute groups (palette/animation)
  node: PartNode | FaceDoc;
  doc: FaceDoc;              // raw doc, for delta detection
  tab: Tab;
  pathPrefix: string;        // '' for absolute groups, 'parts.eyeL' for parts
  onEdit: (path: string, v: FieldValue) => void;
  onClear: (path: string) => void;
  present?: boolean;         // parts only: presence toggle (base tab)
  onTogglePresent?: (on: boolean) => void;
  defaultOpen?: boolean;
  extra?: ReactNode;         // rendered after the fields (pixel board)
}

export default function PartPanel({
  id, title, fields, node, doc, tab, pathPrefix, onEdit, onClear,
  present, onTogglePresent, defaultOpen, extra,
}: Props) {
  const { t } = useI18n();
  const full = (p: string) => (pathPrefix ? `${pathPrefix}.${p}` : p);
  const showBody = present !== false;
  return (
    <details id={id} className="panel" open={defaultOpen}>
      <summary>
        {title}
        {onTogglePresent && tab === 'base' && (
          <input
            type="checkbox" checked={present !== false}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onTogglePresent(e.target.checked)}
          />
        )}
      </summary>
      {!showBody && (
        <div className="panel-hint">{t('off — tick the box to add this part')}</div>
      )}
      {showBody && fields.map((def) => {
        if (def.showIf && !def.showIf(node as PartNode)) return null;
        const isDelta = tab !== 'base' &&
          getPath(doc.expressions?.[tab], full(def.path)) !== undefined;
        return (
          <FieldRow
            key={def.path} def={def}
            value={getPath(node, def.path)}
            isDelta={isDelta}
            // relative path: the onEdit handler owns prefixing (editField
            // prepends parts.<key> itself; absolute groups pass '' prefix)
            onChange={(v) => onEdit(def.path, v)}
            onClear={() => onClear(full(def.path))}
          />
        );
      })}
      {showBody && extra}
    </details>
  );
}
