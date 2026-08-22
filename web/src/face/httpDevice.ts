// HTTP link to a StackChan on the local network (a firmware exposing the
// keke-style endpoints: GET /face?expr=..., POST /face, ?save=1 persists).
// Same live-push semantics as the serial channel, but over fetch — works in
// any browser and the device can sit across the room on WiFi.
//
// POST bodies go out as text/plain: that keeps the request CORS-"simple"
// (no preflight), and the firmware reads the raw body regardless of type.
// Live pushes are latest-wins: a new edit aborts the in-flight POST.
import { useCallback, useRef, useState } from 'react';

export type HttpStatus = 'idle' | 'connecting' | 'connected';

const HOST_KEY = 'pf-http-host';

export function useDeviceHttp(onError: (msg: string) => void) {
  const [status, setStatus] = useState<HttpStatus>('idle');
  const [host, setHost] = useState(() => localStorage.getItem(HOST_KEY) ?? '');
  const hostRef = useRef(host);
  const abortRef = useRef<AbortController | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const setHostPersist = useCallback((h: string) => {
    setHost(h);
    hostRef.current = h;
    localStorage.setItem(HOST_KEY, h);
  }, []);

  const disconnect = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
  }, []);

  // returns whether the probe reached the device — the caller renders the
  // failure inline next to the guide instead of a toast
  const connect = useCallback(async (): Promise<boolean> => {
    const h = hostRef.current.trim();
    if (!h) return false;
    setStatus('connecting');
    try {
      const res = await fetch(`http://${h}/status`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(String(res.status));
      setStatus('connected');
      return true;
    } catch {
      setStatus('idle');
      return false;
    }
  }, []);

  // save=false applies to device RAM only; save=true also persists to flash.
  const pushFace = useCallback(async (json: string, save: boolean): Promise<boolean> => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(`http://${hostRef.current.trim()}/face${save ? '?save=1' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: json,
        signal: ac.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        onErrorRef.current(err?.error ?? `HTTP ${res.status}`);
        return false;
      }
      return true;
    } catch {
      if (!ac.signal.aborted) { // aborted = superseded by a newer push, not an error
        onErrorRef.current('device unreachable');
        disconnect();
      }
      return false;
    }
  }, [disconnect]);

  // hold=1: don't start the firmware's 30s auto-revert while an expression
  // tab is being edited (fire-and-forget, a miss just desyncs the mirror).
  const pushExpr = useCallback((name: string) => {
    fetch(`http://${hostRef.current.trim()}/face?expr=${name}&hold=1`).catch(() => {});
  }, []);

  return { status, host, setHost: setHostPersist, connect, disconnect, pushFace, pushExpr };
}
