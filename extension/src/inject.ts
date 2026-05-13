import type { CapturedEvent, SocketLifecycle, Transport, EventMeta } from '../../shared/protocol';
import { MAX_PAYLOAD_BYTES } from '../../shared/protocol';

declare global {
  interface Window {
    __NL_INSTALLED__?: boolean;
  }
}

(() => {
  if (window.__NL_INSTALLED__) return;
  window.__NL_INSTALLED__ = true;

  const TAG = '__nl';
  const RELAY_HOST_HINT = 'localhost:9999';

  function uuid(): string {
    if (crypto && 'randomUUID' in crypto) return crypto.randomUUID();
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function isSelfTraffic(url: string): boolean {
    if (!url) return false;
    return url.includes(RELAY_HOST_HINT);
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

  type Serialized = {
    payload: string;
    payloadType: 'string' | 'binary';
    size: number;
    truncated?: boolean;
  };

  function serialize(data: unknown): Promise<Serialized> {
    if (data == null) {
      return Promise.resolve({ payload: '', payloadType: 'string', size: 0 });
    }
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
    if (data instanceof FormData || data instanceof URLSearchParams) {
      const s = String(data);
      return serialize(s);
    }
    try {
      return serialize(JSON.stringify(data));
    } catch {
      return Promise.resolve({ payload: String(data), payloadType: 'string', size: 0 });
    }
  }

  function emitEvent(opts: {
    socketId: string;
    url: string;
    direction: 'send' | 'recv';
    transport: Transport;
    data: unknown;
    meta?: EventMeta;
  }) {
    serialize(opts.data).then((p) => {
      post({
        kind: 'event',
        data: {
          id: uuid(),
          socketId: opts.socketId,
          url: opts.url,
          direction: opts.direction,
          timestamp: Date.now(),
          payloadType: p.payloadType,
          payload: p.payload,
          size: p.size,
          truncated: p.truncated,
          transport: opts.transport,
          meta: opts.meta,
        },
      });
    });
  }

  function emitLifecycle(lc: SocketLifecycle) {
    post({ kind: 'lifecycle', data: lc });
  }

  function headersToObj(h: Headers | Record<string, string> | undefined): Record<string, string> | undefined {
    if (!h) return undefined;
    if (h instanceof Headers) {
      const out: Record<string, string> = {};
      h.forEach((v, k) => {
        out[k] = v;
      });
      return out;
    }
    return { ...h };
  }

  function parseXhrHeaders(raw: string | null): Record<string, string> {
    const out: Record<string, string> = {};
    if (!raw) return out;
    for (const line of raw.trim().split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const k = line.slice(0, idx).trim().toLowerCase();
      const v = line.slice(idx + 1).trim();
      if (k) out[k] = v;
    }
    return out;
  }

  // ── WebSocket ────────────────────────────────────────────────────────────
  function installWebSocket() {
    const OrigWS = window.WebSocket;
    if (!OrigWS) return;

    const WrappedWS = function (this: WebSocket, url: string | URL, protocols?: string | string[]) {
      const socketId = uuid();
      const urlStr = typeof url === 'string' ? url : url.toString();
      const ws = new OrigWS(url, protocols);

      if (isSelfTraffic(urlStr)) return ws;

      emitLifecycle({ socketId, url: urlStr, kind: 'open', timestamp: Date.now(), transport: 'websocket' });

      const origSend = ws.send.bind(ws);
      ws.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        try {
          emitEvent({ socketId, url: urlStr, direction: 'send', transport: 'websocket', data });
        } catch {}
        return origSend(data as never);
      };

      ws.addEventListener('message', (ev: MessageEvent) => {
        try {
          emitEvent({ socketId, url: urlStr, direction: 'recv', transport: 'websocket', data: ev.data });
        } catch {}
      });

      ws.addEventListener('close', (ev: CloseEvent) => {
        emitLifecycle({
          socketId,
          url: urlStr,
          kind: 'close',
          timestamp: Date.now(),
          code: ev.code,
          reason: ev.reason,
          transport: 'websocket',
        });
      });

      ws.addEventListener('error', () => {
        emitLifecycle({ socketId, url: urlStr, kind: 'error', timestamp: Date.now(), transport: 'websocket' });
      });

      return ws;
    } as unknown as typeof WebSocket;

    WrappedWS.prototype = OrigWS.prototype;
    (WrappedWS as unknown as { CONNECTING: number }).CONNECTING = OrigWS.CONNECTING;
    (WrappedWS as unknown as { OPEN: number }).OPEN = OrigWS.OPEN;
    (WrappedWS as unknown as { CLOSING: number }).CLOSING = OrigWS.CLOSING;
    (WrappedWS as unknown as { CLOSED: number }).CLOSED = OrigWS.CLOSED;

    window.WebSocket = WrappedWS;
  }

  // ── fetch ────────────────────────────────────────────────────────────────
  function installFetch() {
    const origFetch = window.fetch;
    if (!origFetch) return;

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const req = input instanceof Request ? input.clone() : null;
      const url = req ? req.url : typeof input === 'string' ? input : (input as URL).toString();

      if (isSelfTraffic(url)) return origFetch.call(this, input as RequestInfo, init);

      const socketId = uuid();
      const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
      const reqHeaders = headersToObj(init?.headers as Headers | Record<string, string> | undefined) ??
        (req ? headersToObj(req.headers) : undefined);

      let reqBody: unknown = init?.body ?? null;
      if (reqBody == null && req && req.body != null) {
        try {
          reqBody = await req.clone().text();
        } catch {}
      }

      emitEvent({
        socketId,
        url,
        direction: 'send',
        transport: 'fetch',
        data: reqBody,
        meta: { method, headers: reqHeaders },
      });

      try {
        const res = await origFetch.call(this, input as RequestInfo, init);
        const clone = res.clone();
        const respHeaders = headersToObj(clone.headers);
        let body: unknown;
        const ct = clone.headers.get('content-type') ?? '';
        try {
          if (/^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded))/i.test(ct) || !ct) {
            body = await clone.text();
          } else {
            body = await clone.arrayBuffer();
          }
        } catch {
          body = '';
        }
        emitEvent({
          socketId,
          url,
          direction: 'recv',
          transport: 'fetch',
          data: body,
          meta: { method, status: res.status, statusText: res.statusText, headers: respHeaders },
        });
        return res;
      } catch (err) {
        emitLifecycle({
          socketId,
          url,
          kind: 'error',
          timestamp: Date.now(),
          transport: 'fetch',
          meta: { method, error: (err as Error)?.message ?? String(err) },
        });
        throw err;
      }
    };
  }

  // ── XMLHttpRequest ───────────────────────────────────────────────────────
  function installXHR() {
    const Xhr = window.XMLHttpRequest;
    if (!Xhr) return;
    const proto = Xhr.prototype;
    const origOpen = proto.open;
    const origSetHeader = proto.setRequestHeader;
    const origSend = proto.send;

    type XhrState = {
      socketId: string;
      method: string;
      url: string;
      reqHeaders: Record<string, string>;
    };
    const STATE = Symbol('__nl_xhr_state');

    proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      const urlStr = typeof url === 'string' ? url : url.toString();
      (this as unknown as Record<symbol, XhrState>)[STATE] = {
        socketId: uuid(),
        method: method.toUpperCase(),
        url: urlStr,
        reqHeaders: {},
      };
      return origOpen.apply(this, [method, url, ...(rest as [boolean?, string?, string?])] as never);
    } as typeof proto.open;

    proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
      const st = (this as unknown as Record<symbol, XhrState | undefined>)[STATE];
      if (st) st.reqHeaders[name.toLowerCase()] = value;
      return origSetHeader.call(this, name, value);
    };

    proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const st = (this as unknown as Record<symbol, XhrState | undefined>)[STATE];
      if (!st || isSelfTraffic(st.url)) return origSend.call(this, body as never);

      emitEvent({
        socketId: st.socketId,
        url: st.url,
        direction: 'send',
        transport: 'xhr',
        data: body,
        meta: { method: st.method, headers: st.reqHeaders },
      });

      this.addEventListener('loadend', () => {
        const respHeaders = parseXhrHeaders(this.getAllResponseHeaders());
        let respBody: unknown;
        const rt = this.responseType;
        try {
          if (rt === '' || rt === 'text') respBody = this.responseText;
          else if (rt === 'json') respBody = this.response;
          else if (rt === 'arraybuffer' || rt === 'blob') respBody = this.response;
          else respBody = this.response;
        } catch {
          respBody = '';
        }
        emitEvent({
          socketId: st.socketId,
          url: st.url,
          direction: 'recv',
          transport: 'xhr',
          data: respBody,
          meta: { method: st.method, status: this.status, statusText: this.statusText, headers: respHeaders },
        });
      });

      this.addEventListener('error', () => {
        emitLifecycle({
          socketId: st.socketId,
          url: st.url,
          kind: 'error',
          timestamp: Date.now(),
          transport: 'xhr',
          meta: { method: st.method, error: 'network error' },
        });
      });

      return origSend.call(this, body as never);
    };
  }

  // ── EventSource (SSE) ────────────────────────────────────────────────────
  function installSSE() {
    const OrigES = window.EventSource;
    if (!OrigES) return;

    const Wrapped = function (this: EventSource, url: string | URL, init?: EventSourceInit) {
      const urlStr = typeof url === 'string' ? url : url.toString();
      const es = new OrigES(url, init);
      const socketId = uuid();

      if (isSelfTraffic(urlStr)) return es;

      emitLifecycle({ socketId, url: urlStr, kind: 'open', timestamp: Date.now(), transport: 'sse' });

      const recordMessage = (ev: MessageEvent, eventName: string) => {
        emitEvent({
          socketId,
          url: urlStr,
          direction: 'recv',
          transport: 'sse',
          data: ev.data,
          meta: { eventName, lastEventId: ev.lastEventId || undefined },
        });
      };

      es.addEventListener('message', (ev) => recordMessage(ev as MessageEvent, 'message'));

      const origAdd = es.addEventListener.bind(es);
      es.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) {
        if (type !== 'message' && type !== 'open' && type !== 'error') {
          origAdd(type, (ev: Event) => recordMessage(ev as MessageEvent, type), opts);
        }
        return origAdd(type, listener, opts);
      } as typeof es.addEventListener;

      es.addEventListener('error', () => {
        emitLifecycle({ socketId, url: urlStr, kind: 'error', timestamp: Date.now(), transport: 'sse' });
      });

      const origClose = es.close.bind(es);
      es.close = function () {
        emitLifecycle({ socketId, url: urlStr, kind: 'close', timestamp: Date.now(), transport: 'sse' });
        return origClose();
      };

      return es;
    } as unknown as typeof EventSource;

    Wrapped.prototype = OrigES.prototype;
    (Wrapped as unknown as { CONNECTING: number }).CONNECTING = OrigES.CONNECTING;
    (Wrapped as unknown as { OPEN: number }).OPEN = OrigES.OPEN;
    (Wrapped as unknown as { CLOSED: number }).CLOSED = OrigES.CLOSED;

    window.EventSource = Wrapped;
  }

  // ── WebRTC DataChannel ───────────────────────────────────────────────────
  function installWebRTC() {
    const PC = window.RTCPeerConnection;
    if (!PC) return;

    function instrumentChannel(ch: RTCDataChannel) {
      const socketId = uuid();
      const label = ch.label || '(datachannel)';
      const urlStr = `rtc:${label}`;

      const announceOpen = () => {
        emitLifecycle({
          socketId,
          url: urlStr,
          kind: 'open',
          timestamp: Date.now(),
          transport: 'webrtc',
          meta: { label },
        });
      };
      if (ch.readyState === 'open') announceOpen();
      else ch.addEventListener('open', announceOpen);

      const origSend = ch.send.bind(ch);
      ch.send = function (data: string | Blob | ArrayBuffer | ArrayBufferView) {
        try {
          emitEvent({
            socketId,
            url: urlStr,
            direction: 'send',
            transport: 'webrtc',
            data,
            meta: { label },
          });
        } catch {}
        return origSend(data as never);
      } as typeof ch.send;

      ch.addEventListener('message', (ev) => {
        emitEvent({
          socketId,
          url: urlStr,
          direction: 'recv',
          transport: 'webrtc',
          data: (ev as MessageEvent).data,
          meta: { label },
        });
      });

      ch.addEventListener('close', () => {
        emitLifecycle({
          socketId,
          url: urlStr,
          kind: 'close',
          timestamp: Date.now(),
          transport: 'webrtc',
          meta: { label },
        });
      });

      ch.addEventListener('error', (ev) => {
        emitLifecycle({
          socketId,
          url: urlStr,
          kind: 'error',
          timestamp: Date.now(),
          transport: 'webrtc',
          meta: { label, error: (ev as RTCErrorEvent)?.error?.message },
        });
      });
    }

    const origCreate = PC.prototype.createDataChannel;
    PC.prototype.createDataChannel = function (label: string, init?: RTCDataChannelInit) {
      const ch = origCreate.call(this, label, init);
      try {
        instrumentChannel(ch);
      } catch {}
      return ch;
    };

    const origAddEv = PC.prototype.addEventListener;
    PC.prototype.addEventListener = function (
      this: RTCPeerConnection,
      type: string,
      listener: EventListenerOrEventListenerObject,
      opts?: boolean | AddEventListenerOptions,
    ) {
      const self = this;
      if (type === 'datachannel') {
        const wrapped = (ev: Event) => {
          try {
            instrumentChannel((ev as RTCDataChannelEvent).channel);
          } catch {}
          if (typeof listener === 'function') listener.call(self, ev);
          else (listener as EventListenerObject).handleEvent(ev);
        };
        return origAddEv.call(self, type, wrapped as EventListener, opts);
      }
      return origAddEv.call(self, type, listener, opts);
    } as typeof PC.prototype.addEventListener;
  }

  installWebSocket();
  installFetch();
  installXHR();
  installSSE();
  installWebRTC();
})();
