// "Live sculpt" hub: the guided on-ramp from the editor to a real StackChan.
// Sits above the control panels; explains the reference-firmware prerequisite
// (with the flashing guide inline) before offering the connect actions, and
// renders connection failures next to their remedy instead of in a toast.
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

const REPO = 'https://github.com/zziying/stackchan-face-editor';

interface SerialLink {
  status: string;
  verified: boolean;
  connect: () => void;
}
interface HttpLink {
  status: string;
  host: string;
  setHost: (h: string) => void;
  connect: () => Promise<boolean>;
}

interface Props {
  serial: SerialLink;
  serialOk: boolean;
  http: HttpLink;
  wifiOk: boolean;         // http origins only — mixed content blocks https
  onClose: () => void;
}

export default function DeviceHub({ serial, serialOk, http, wifiOk, onClose }: Props) {
  const { t, lang } = useI18n();
  // deep-link straight to Path A of the README the user can read
  const guideUrl = lang === 'zh'
    ? `${REPO}#路径-a--烧录参考固件除了-arduino-外无需其他开发环境`
    : `${REPO}/blob/main/README.en.md#path-a--flash-the-reference-firmware-no-dev-environment-beyond-arduino`;
  const serialConnected = serial.status === 'connected';
  const httpConnected = http.status === 'connected';

  // the port can open on a device that never answers (stock firmware) — give
  // the PING reply a grace period, then point at the guide
  const [silent, setSilent] = useState(false);
  useEffect(() => {
    if (!serialConnected || serial.verified) { setSilent(false); return; }
    const id = setTimeout(() => setSilent(true), 2500);
    return () => clearTimeout(id);
  }, [serialConnected, serial.verified]);

  const [httpErr, setHttpErr] = useState(false);
  const tryHttp = async () => {
    setHttpErr(false);
    if (!(await http.connect())) setHttpErr(true);
  };

  return (
    <div className="panel device-hub">
      <div className="hub-head">
        <span className="hub-title">{t('Live sculpt')}</span>
        <button className="wiz-close" onClick={onClose}>✕</button>
      </div>
      <p className="hub-intro">
        {t('push every edit to a real StackChan as you sculpt — the device needs the reference firmware, or your own firmware with the ParamFace library integrated')}
      </p>

      <details className="hub-guide">
        <summary>{t('Flashing guide')}</summary>
        <p>{t('the reference firmware turns a StackChan into a face this editor drives live; faces load as data, so swapping faces never needs another compile')}</p>
        <ul>
          <li>{t('it replaces the firmware the robot was running — servo moves / voice features of the original are gone')}</li>
          <li>{t('want your sculpted face AND your own firmware? integrate the ParamFace library instead — Path B in the README')}</li>
          <li>{t('flashing fails while a browser tab holds the serial port — disconnect (or close the editor tab) first')}</li>
        </ul>
        <pre>{`git clone https://github.com/zziying/stackchan-face-editor
cd stackchan-face-editor
arduino-cli compile --fqbn m5stack:esp32:m5stack_cores3 \\
  --library $PWD/lib/ParamFace firmware/ParamFaceReference/
arduino-cli upload  --fqbn m5stack:esp32:m5stack_cores3 \\
  --port /dev/cu.usbmodemXXX firmware/ParamFaceReference/`}</pre>
        <a href={guideUrl} target="_blank" rel="noreferrer">
          {t('full guide in the README')} ↗
        </a>
      </details>

      <div className="hub-channel">
        <div className="hub-label">{t('USB serial')}</div>
        {serialConnected ? (
          silent && !serial.verified ? (
            <div className="hub-err">
              {t('port opened but the device never replied — is the reference firmware flashed? See the guide above.')}
            </div>
          ) : (
            <div className="hub-ok">{t('connected — edits sync live')}</div>
          )
        ) : serialOk ? (
          <button
            className="wiz-primary" disabled={serial.status === 'connecting'}
            onClick={() => serial.connect()}
          >
            {t(serial.status === 'connecting' ? 'Connecting…' : 'flashed it — connect device')}
          </button>
        ) : (
          <div className="hub-dim">{t('needs a Chromium browser (Chrome / Edge)')}</div>
        )}
      </div>

      {wifiOk && (
        <div className="hub-channel">
          <div className="hub-label">{t('WiFi — no cable, needs a firmware with the HTTP face API')}</div>
          {httpConnected ? (
            <div className="hub-ok">{t('connected — edits sync live')}</div>
          ) : (
            <>
              <span className="hub-wifi-row">
                <input
                  className="http-host" placeholder={t('device IP')}
                  value={http.host}
                  onChange={(e) => http.setHost(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void tryHttp(); }}
                />
                <button
                  disabled={http.status === 'connecting' || !http.host.trim()}
                  onClick={() => void tryHttp()}
                >
                  {t(http.status === 'connecting' ? 'Connecting…' : 'Connect')}
                </button>
              </span>
              {httpErr && (
                <div className="hub-err">
                  {t("can't reach the device — check the IP, and that it sits on the same network with its HTTP API enabled")}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
