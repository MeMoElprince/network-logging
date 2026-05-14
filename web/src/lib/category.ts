import type { LogEntry } from '../store';
import type { Transport } from '../../../shared/protocol';

export type Category = Transport;
export type CategoryFilter = 'all' | Category;

export function categoryOf(entry: LogEntry): Category {
  return entry.data.transport ?? 'websocket';
}

export const CATEGORIES: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'websocket', label: 'WebSocket' },
  { id: 'fetch', label: 'Fetch' },
  { id: 'xhr', label: 'XHR' },
  { id: 'sse', label: 'SSE' },
  { id: 'webrtc', label: 'WebRTC' },
];
