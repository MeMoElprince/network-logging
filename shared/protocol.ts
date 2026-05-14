export type Direction = 'send' | 'recv';

export type Transport = 'websocket' | 'fetch' | 'xhr' | 'sse' | 'webrtc';

export type EventMeta = {
  method?: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  eventName?: string;
  lastEventId?: string;
  label?: string;
  error?: string;
};

export type CapturedEvent = {
  id: string;
  socketId: string;
  url: string;
  direction: Direction;
  timestamp: number;
  payloadType: 'string' | 'binary';
  payload: string;
  size: number;
  truncated?: boolean;
  transport: Transport;
  meta?: EventMeta;
};

export type SocketLifecycle = {
  socketId: string;
  url: string;
  kind: 'open' | 'close' | 'error';
  timestamp: number;
  code?: number;
  reason?: string;
  transport: Transport;
  meta?: EventMeta;
};

export type RelayMsg =
  | { type: 'event'; data: CapturedEvent }
  | { type: 'lifecycle'; data: SocketLifecycle };

export const RELAY_DEFAULT_PORT = 9999;
export const RELAY_DEFAULT_URL = `ws://localhost:${RELAY_DEFAULT_PORT}`;
export const MAX_PAYLOAD_BYTES = 64 * 1024;
