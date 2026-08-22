// The wizard stepper: a collapsible strip above the editor body. It only
// navigates — all drawing happens in the normal editor below, so the user
// can bail into free editing at any step without losing anything.
import { WIZ_STEPS, stepEngaged, type WizStart } from '../face/wizard';
import type { FaceDoc } from '../face/types';
import { useI18n } from '../i18n';

interface Props {
  step: number;
  doc: FaceDoc;
  connected: boolean;
  onStep: (i: number) => void;
  onStart: (choice: WizStart) => void;
  onEngage: (kind: 'brows' | 'overlay') => void;
  onConnect: () => void;
  onShare: () => void;
  onSaveDevice: () => void;
  onClose: () => void;
}

const START_CHOICES: [WizStart, string][] = [
  ['fresh', 'start fresh'],
  ['preset', 'start from a preset'],
  ['keep', 'keep my current face'],
];

export default function WizardBar({
  step, doc, connected,
  onStep, onStart, onEngage, onConnect, onShare, onSaveDevice, onClose,
}: Props) {
  const { t } = useI18n();
  const cur = WIZ_STEPS[step];
  const last = step === WIZ_STEPS.length - 1;
  const engaged = stepEngaged(doc, cur);

  return (
    <div className="wizard">
      <div className="wiz-steps">
        {WIZ_STEPS.map((s, i) => (
          <button
            key={s.key}
            className={`wiz-chip ${i === step ? 'active' : i < step ? 'past' : ''}`}
            onClick={() => onStep(i)}
          >
            {i < step ? '✓' : i + 1} {t(s.label)}
          </button>
        ))}
      </div>
      <div className="wiz-hint">
        {t(cur.hint)}
        {last && (
          <div className="wiz-sub">
            {connected
              ? t('connected — Save to device writes it to flash, blink included')
              : t('to see it on a real StackChan: open Live sculpt — the flashing guide and both connect channels live there')}
          </div>
        )}
      </div>
      {cur.key === 'start' && (
        <div className="wiz-choices">
          {START_CHOICES.map(([choice, label]) => (
            <button key={choice} className="wiz-primary" onClick={() => onStart(choice)}>
              {t(label)}
            </button>
          ))}
        </div>
      )}
      <div className="wiz-actions">
        {cur.engage && !engaged && (
          <button className="wiz-primary" onClick={() => onEngage(cur.engage!)}>
            {t(cur.engageLabel!)}
          </button>
        )}
        {step > 0 && !last && (
          <button onClick={() => onStep(step - 1)}>← {t('back')}</button>
        )}
        {!last && cur.key !== 'start' && (
          <button
            className={cur.optional && !engaged ? '' : 'wiz-primary'}
            onClick={() => onStep(step + 1)}
          >
            {cur.optional && !engaged ? t('skip') : `${t('next')} →`}
          </button>
        )}
        {last && (
          <>
            <button onClick={onShare}>{t('Share')}</button>
            {connected ? (
              <button className="wiz-primary" onClick={onSaveDevice}>{t('Save to device')}</button>
            ) : (
              <button className="wiz-primary" onClick={onConnect}>{t('Live sculpt')}</button>
            )}
            <button className={connected ? 'wiz-primary' : ''} onClick={onClose}>{t('finish')}</button>
          </>
        )}
        <button className="wiz-close" data-tip={t('close the wizard')} onClick={onClose}>✕</button>
      </div>
    </div>
  );
}
