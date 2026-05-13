import type { RelayMsg, CapturedEvent, SocketLifecycle } from '../../shared/protocol';
import { RELAY_DEFAULT_URL } from '../../shared/protocol';

type PageMsg =
  | { __nl: true; kind: 'event'; data: CapturedEvent }
  | { __nl: true; kind: 'lifecycle'; data: SocketLifecycle };

let ws: WebSocket | null = null;
let relayUrl = RELAY_DEFAULT_URL;
let backoff = 500;
let queued: RelayMsg[] = [];
const QUEUE_CAP = 1000;

function connect() {
  try {
    ws = new WebSocket(relayUrl + '/producer');
  } catch (e) {
    scheduleReconnect();
    return;
  }
  ws.addEventListener('open', () => {
    backoff = 500;
    // flush queue
    while (queued.length && ws && ws.readyState === WebSocket.OPEN) {
      const m = queued.shift()!;
      ws.send(JSON.stringify(m));
    }
    notifyStatus('open');
  });
  ws.addEventListener('close', () => {
    notifyStatus('closed');
    scheduleReconnect();
  });
  ws.addEventListener('error', () => {
    try {
      ws?.close();
    } catch {}
  });
}

function scheduleReconnect() {
  ws = null;
  setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 10_000);
}

function notifyStatus(status: 'open' | 'closed') {
  chrome.runtime.sendMessage({ type: 'producer-status', status }).catch(() => {});
}

function send(msg: RelayMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    queued.push(msg);
    if (queued.length > QUEUE_CAP) queued.shift();
  }
}

window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const data = ev.data as PageMsg | undefined;
  if (!data || (data as { __nl?: boolean }).__nl !== true) return;
  if (data.kind === 'event') send({ type: 'event', data: data.data });
  else if (data.kind === 'lifecycle') send({ type: 'lifecycle', data: data.data });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'get-producer-status') {
    sendResponse({ status: ws?.readyState === WebSocket.OPEN ? 'open' : 'closed' });
  }
  return true;
});

chrome.storage.sync.get(['relayUrl'], (cfg) => {
  if (typeof cfg.relayUrl === 'string' && cfg.relayUrl) relayUrl = cfg.relayUrl;
  connect();
});
