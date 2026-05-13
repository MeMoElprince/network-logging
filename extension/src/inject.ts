import type { CapturedEvent, SocketLifecycle } from '../../shared/protocol';
import { MAX_PAYLOAD_BYTES } from '../../shared/protocol';

declare global {
  interface Window {
    __NL_INSTALLED__?: boolean;
  }
}

(() => {
  if (window.__NL_INSTALLED__) return;
  window.__NL_INSTALLED__ = true;

  const OrigWS = window.WebSocket;
  if (!OrigWS) return;

  const TAG = '__nl';

  function uuid(): string {
    if (crypto && 'randomUUID' in crypto) return crypto.randomUUID();
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function bufToBase64(buf: ArrayBuffer): { payload: string; size: number; truncated: boolean } {
    const bytes = new Uint8Array(buf);
    const size = bytes.byteLength;
    const truncated = size > MAX_PAYLOAD_BYTES;
    const slice = truncated ? bytes.subarray(0, MAX_PAYLOAD_BYTES) : bytes;
    let bin = '';
    for (let i = 0; i < slice.length; i++) bin += String.fromCharCode(slice[i]);
    return { payload: btoa(bin), size, truncated };
  }

  function post(msg: { kind: 'event'; data: CapturedEvent } | { kind: 'lifecycle'; data: SocketLifecycle }) {
    window.postMessage({ [TAG]: true, ...msg }, '*');
  }

  function serialize(
    data: unknown,
  ): Promise<{ payload: string; payloadType: 'string' | 'binary'; size: number; truncated?: boolean }> {
    if (typeof data === 'string') {
      const truncated = data.length > MAX_PAYLOAD_BYTES;
      return Promise.resolve({
        payload: truncated ? data.slice(0, MAX_PAYLOAD_BYTES) : data,
        payloadType: 'string',
        size: data.length,
        truncated: truncated || undefined,
      });
    }
    if (data instanceof ArrayBuffer) {
      const { payload, size, truncated } = bufToBase64(data);
      return Promise.resolve({ payload, payloadType: 'binary', size, truncated: truncated || undefined });
    }
    if (ArrayBuffer.isView(data)) {
      const view = data as ArrayBufferView;
      const src = new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
      const copy = new Uint8Array(src.byteLength);
      copy.set(src);
      const { payload, size, truncated } = bufToBase64(copy.buffer);
      return Promise.resolve({ payload, payloadType: 'binary', size, truncated: truncated || undefined });
    }
    if (data instanceof Blob) {
      return data.arrayBuffer().then((buf) => {
        const { payload, size, truncated } = bufToBase64(buf);
        return { payload, payloadType: 'binary' as const, size, truncated: truncated || undefined };
      });
    }
    return Promise.resolve({ payload: String(data), payloadType: 'string', size: 0 });
  }

  function emitEvent(socketId: string, url: string, direction: 'send' | 'recv', data: unknown) {
    serialize(data).then((p) => {
      post({
        kind: 'event',
        data: {
          id: uuid(),
          socketId,
          url,
          direction,
          timestamp: Date.now(),
          payloadType: p.payloadType,
          payload: p.payload,
          size: p.size,
          truncated: p.truncated,
        },
      });
    });
  }

  function emitLifecycle(lc: SocketLifecycle) {
    post({ kind: 'lifecycle', data: lc });
  }

  const WrappedWS = function (this: WebSocket, url: string | URL, protocols?: string | string[]) {
    const socketId = uuid();
    const urlStr = typeof url === 'string' ? url : url.toString();
    const ws = new OrigWS(url, protocols);

    emitLifecycle({ socketId, url: urlStr, kind: 'open', timestamp: Date.now() });

    const origSend = ws.send.bind(ws);
    ws.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      try {
        emitEvent(socketId, urlStr, 'send', data);
      } catch {
        // ignore serialization errors
      }
      return origSend(data as never);
    };

    ws.addEventListener('message', (ev: MessageEvent) => {
      try {
        emitEvent(socketId, urlStr, 'recv', ev.data);
      } catch {
        // ignore
      }
    });

    ws.addEventListener('close', (ev: CloseEvent) => {
      emitLifecycle({
        socketId,
        url: urlStr,
        kind: 'close',
        timestamp: Date.now(),
        code: ev.code,
        reason: ev.reason,
      });
    });

    ws.addEventListener('error', () => {
      emitLifecycle({ socketId, url: urlStr, kind: 'error', timestamp: Date.now() });
    });

    return ws;
  } as unknown as typeof WebSocket;

  WrappedWS.prototype = OrigWS.prototype;
  (WrappedWS as unknown as { CONNECTING: number }).CONNECTING = OrigWS.CONNECTING;
  (WrappedWS as unknown as { OPEN: number }).OPEN = OrigWS.OPEN;
  (WrappedWS as unknown as { CLOSING: number }).CLOSING = OrigWS.CLOSING;
  (WrappedWS as unknown as { CLOSED: number }).CLOSED = OrigWS.CLOSED;

  window.WebSocket = WrappedWS;
})();
