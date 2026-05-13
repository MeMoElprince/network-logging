import { useSyncExternalStore } from 'react';
import type { CapturedEvent, SocketLifecycle } from '../../shared/protocol';
import type { CategoryFilter } from './lib/category';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export type LogEntry =
  | { kind: 'event'; data: CapturedEvent }
  | { kind: 'lifecycle'; data: SocketLifecycle };

export type GroupBy =
  | { kind: 'none' }
  | { kind: 'socket' }
  | { kind: 'sioEvent' }
  | { kind: 'path'; path: string }
  | { kind: 'session' };

export type RowLayout = 'compact' | 'cards' | 'bubbles';

export type SessionMode = 'bracket' | 'startOnly' | 'correlation' | 'both';

export type SessionConfig = {
  mode: SessionMode;
  startEvent: string;
  endEvent: string;
  triggerEvent: string;
  keyPath: string;
};

export type Filters = {
  search: string;
  searchRegex: boolean;
  activeCategory: CategoryFilter;
  showSend: boolean;
  showRecv: boolean;
  showLifecycle: boolean;
  hideNoise: boolean;
  customNoisePatterns: string[];
  groupBy: GroupBy;
  sessionConfig: SessionConfig;
  rowLayout: RowLayout;
  collapsedGroups: Record<string, true>;
};

const MAX_ENTRIES = 5000;
const LS_KEY = 'nl.ui.v2';
const LS_KEY_LEGACY = 'nl.ui.v1';

const defaultSessionConfig: SessionConfig = {
  mode: 'bracket',
  startEvent: 'query:started',
  endEvent: 'query:done',
  triggerEvent: 'sendMessage',
  keyPath: 'sessionId, chatRoomId',
};

const defaultFilters: Filters = {
  search: '',
  searchRegex: false,
  activeCategory: 'all',
  showSend: true,
  showRecv: true,
  showLifecycle: true,
  hideNoise: true,
  customNoisePatterns: [],
  groupBy: { kind: 'none' },
  sessionConfig: defaultSessionConfig,
  rowLayout: 'cards',
  collapsedGroups: {},
};

function coerceGroupBy(v: unknown): GroupBy {
  if (typeof v === 'string') {
    return v ? { kind: 'path', path: v } : { kind: 'none' };
  }
  if (v && typeof v === 'object' && 'kind' in v) {
    const g = v as GroupBy;
    if (g.kind === 'none' || g.kind === 'socket' || g.kind === 'sioEvent' || g.kind === 'session') return g;
    if (g.kind === 'path' && typeof g.path === 'string') return g;
  }
  return { kind: 'none' };
}

function coerceSessionConfig(v: unknown): SessionConfig {
  if (!v || typeof v !== 'object') return defaultSessionConfig;
  const p = v as Partial<SessionConfig>;
  const validModes: SessionMode[] = ['bracket', 'startOnly', 'correlation', 'both'];
  return {
    mode: validModes.includes(p.mode as SessionMode) ? (p.mode as SessionMode) : defaultSessionConfig.mode,
    startEvent: typeof p.startEvent === 'string' ? p.startEvent : defaultSessionConfig.startEvent,
    endEvent: typeof p.endEvent === 'string' ? p.endEvent : defaultSessionConfig.endEvent,
    triggerEvent: typeof p.triggerEvent === 'string' ? p.triggerEvent : defaultSessionConfig.triggerEvent,
    keyPath: typeof p.keyPath === 'string' ? p.keyPath : defaultSessionConfig.keyPath,
  };
}

export function normalizeFilters(parsed: unknown): Filters {
  if (!parsed || typeof parsed !== 'object') return defaultFilters;
  const p = parsed as Partial<Filters> & { groupBy?: unknown; sessionConfig?: unknown };
  return {
    ...defaultFilters,
    ...p,
    groupBy: coerceGroupBy(p.groupBy),
    sessionConfig: coerceSessionConfig(p.sessionConfig),
    rowLayout: p.rowLayout === 'compact' || p.rowLayout === 'cards' || p.rowLayout === 'bubbles'
      ? p.rowLayout
      : defaultFilters.rowLayout,
    collapsedGroups: p.collapsedGroups ?? {},
  };
}

function loadFilters(): Filters {
  try {
    let raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LS_KEY_LEGACY);
      if (legacy) raw = legacy;
    }
    if (!raw) return defaultFilters;
    return normalizeFilters(JSON.parse(raw));
  } catch {
    return defaultFilters;
  }
}

function persistFilters(f: Filters) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(f));
  } catch {
    // ignore quota
  }
}

type State = {
  entries: LogEntry[];
  connection: ConnectionStatus;
  filters: Filters;
  selectedId: string | null;
};

let state: State = {
  entries: [],
  connection: 'connecting',
  filters: typeof localStorage !== 'undefined' ? loadFilters() : defaultFilters,
  selectedId: null,
};
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setFilters(updater: (f: Filters) => Filters) {
  const next = updater(state.filters);
  state = { ...state, filters: next };
  persistFilters(next);
  emit();
}

export const store = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get(): State {
    return state;
  },
  pushEvent(data: CapturedEvent) {
    const next = state.entries.concat({ kind: 'event', data });
    if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES);
    state = { ...state, entries: next };
    emit();
  },
  pushLifecycle(data: SocketLifecycle) {
    const next = state.entries.concat({ kind: 'lifecycle', data });
    if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES);
    state = { ...state, entries: next };
    emit();
  },
  setConnection(c: ConnectionStatus) {
    if (state.connection === c) return;
    state = { ...state, connection: c };
    emit();
  },
  clear() {
    state = { ...state, entries: [], selectedId: null };
    emit();
  },
  importState({ entries, filters }: { entries: LogEntry[]; filters: Filters }) {
    const next = entries.length > MAX_ENTRIES
      ? entries.slice(entries.length - MAX_ENTRIES)
      : entries.slice();
    state = { ...state, entries: next, filters, selectedId: null };
    persistFilters(filters);
    emit();
  },
  select(id: string | null) {
    if (state.selectedId === id) return;
    state = { ...state, selectedId: id };
    emit();
  },
  setSearch(search: string) {
    setFilters((f) => ({ ...f, search }));
  },
  toggleSearchRegex() {
    setFilters((f) => ({ ...f, searchRegex: !f.searchRegex }));
  },
  setCategory(c: CategoryFilter) {
    setFilters((f) => (f.activeCategory === c ? f : { ...f, activeCategory: c, collapsedGroups: {} }));
  },
  toggleDirection(d: 'send' | 'recv' | 'lifecycle') {
    setFilters((f) => {
      if (d === 'send') return { ...f, showSend: !f.showSend };
      if (d === 'recv') return { ...f, showRecv: !f.showRecv };
      return { ...f, showLifecycle: !f.showLifecycle };
    });
  },
  toggleNoise() {
    setFilters((f) => ({ ...f, hideNoise: !f.hideNoise }));
  },
  setCustomNoisePatterns(patterns: string[]) {
    setFilters((f) => ({ ...f, customNoisePatterns: patterns }));
  },
  setGroupBy(groupBy: GroupBy) {
    setFilters((f) => ({ ...f, groupBy, collapsedGroups: {} }));
  },
  setRowLayout(rowLayout: RowLayout) {
    setFilters((f) => (f.rowLayout === rowLayout ? f : { ...f, rowLayout }));
  },
  setSessionConfig(patch: Partial<SessionConfig>) {
    setFilters((f) => ({ ...f, sessionConfig: { ...f.sessionConfig, ...patch }, collapsedGroups: {} }));
  },
  toggleGroupCollapsed(key: string) {
    setFilters((f) => {
      const next = { ...f.collapsedGroups };
      if (next[key]) delete next[key];
      else next[key] = true;
      return { ...f, collapsedGroups: next };
    });
  },
};

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(state),
    () => selector(state),
  );
}
