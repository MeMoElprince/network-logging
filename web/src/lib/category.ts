import type { LogEntry } from '../store';

export type Category = 'websocket';
export type CategoryFilter = 'all' | Category;

export function categoryOf(_entry: LogEntry): Category {
  return 'websocket';
}

export const CATEGORIES: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'websocket', label: 'WebSocket' },
];
