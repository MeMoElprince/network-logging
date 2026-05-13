import { useEffect } from 'react';
import { store } from '../store';
import { RELAY_DEFAULT_URL, type RelayMsg } from '../../../shared/protocol';

const RELAY_URL = (import.meta.env.VITE_RELAY_URL as string | undefined) ?? RELAY_DEFAULT_URL;

export function useRelay() {
  useEffect(() => {
    let ws: WebSocket | null = null;
    let backoff = 500;
    let timer: number | null = null;
    let stopped = false;

    function connect() {
      if (stopped) return;
      store.setConnection('connecting');
      try {
        ws = new WebSocket(RELAY_URL + '/consumer');
      } catch {
        scheduleReconnect();
        return;
      }
      ws.addEventListener('open', () => {
        backoff = 500;
        store.setConnection('open');
      });
      ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as RelayMsg;
          if (msg.type === 'event') store.pushEvent(msg.data);
          else if (msg.type === 'lifecycle') store.pushLifecycle(msg.data);
        } catch {
          // ignore malformed
        }
      });
      ws.addEventListener('close', () => {
        store.setConnection('closed');
        scheduleReconnect();
      });
      ws.addEventListener('error', () => {
        try {
          ws?.close();
        } catch {}
      });
    }

    function scheduleReconnect() {
      if (stopped) return;
      ws = null;
      timer = window.setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 10_000);
    }

    connect();

    return () => {
      stopped = true;
      if (timer != null) window.clearTimeout(timer);
      try {
        ws?.close();
      } catch {}
    };
  }, []);
}
