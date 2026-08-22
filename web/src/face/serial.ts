// Web Serial link to the reference firmware (firmware/ParamFaceReference):
// newline-delimited lines, FACE/EXPR/SAVE/PING out, "OK ..."/"ERR ..." back.
// Chrome/Edge only — callers gate UI on `serialSupported`.
import { useCallback, useRef, useState } from 'react';

// Web Serial isn't in TS's lib.dom yet; declare the slice we use.
interface PFSerialPort {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  open(opts: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}
declare global {
  interface Navigator {
    serial?: { requestPort(): Promise<PFSerialPort> };
  }
}

export const serialSupported =
  typeof navigator !== 'undefined' && 'serial' in navigator;

export type SerialStatus = 'idle' | 'connecting' | 'connected';

export function useDeviceSerial(onMessage: (line: string) => void) {
  const [status, setStatus] = useState<SerialStatus>('idle');
  const portRef = useRef<PFSerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const disconnect = useCallback(async () => {
    const port = portRef.current;
    portRef.current = null;
    try { await readerRef.current?.cancel(); } catch { /* already gone */ }
    readerRef.current = null;
    try { writerRef.current?.releaseLock(); } catch { /* already gone */ }
    writerRef.current = null;
    try { await port?.close(); } catch { /* already gone */ }
    setStatus('idle');
  }, []);

  const send = useCallback((line: string) => {
    writerRef.current
      ?.write(new TextEncoder().encode(line + '\n'))
      .catch(() => { /* surfaces as read-loop teardown */ });
  }, []);

  const connect = useCallback(async () => {
    if (!navigator.serial || portRef.current) return;
    setStatus('connecting');
    let port: PFSerialPort;
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
    } catch {
      setStatus('idle'); // picker dismissed or port busy
      return;
    }
    portRef.current = port;
    writerRef.current = port.writable.getWriter();
    setStatus('connected');

    (async () => {
      const decoder = new TextDecoder();
      const reader = port.readable.getReader();
      readerRef.current = reader;
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).replace(/\r$/, '');
            buf = buf.slice(nl + 1);
            if (line) onMessageRef.current(line);
          }
        }
      } catch { /* unplugged */ }
      reader.releaseLock();
      if (portRef.current === port) void disconnect();
    })();

    send('PING');
  }, [disconnect, send]);

  return { status, connect, disconnect, send };
}
