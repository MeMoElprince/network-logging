import type { Transport } from '../../../shared/protocol';

export function transportLabel(t: Transport): string {
  switch (t) {
    case 'websocket': return 'WS';
    case 'fetch': return 'FETCH';
    case 'xhr': return 'XHR';
    case 'sse': return 'SSE';
    case 'webrtc': return 'RTC';
  }
}
