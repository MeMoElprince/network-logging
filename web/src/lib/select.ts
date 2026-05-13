import { useMemo } from 'react';
import type { LogEntry, Filters, SessionConfig } from '../store';
import { parseBody } from './parse';
import { compilePatterns, isNoise } from './noise';
import { getByPath, collectPaths } from './path';
import { categoryOf } from './category';

export type Group = {
  key: string;
  label: string;
  count: number;
  items: LogEntry[];
};

export type PathStat = { path: string; count: number };

export type SessionStats = {
  sessions: number;
  outside: number;
  startMatches: number;
  endMatches: number;
  triggerMatches: number;
  keyMatches: number;
};

export type Derived = {
  groups: Group[];
  totalFiltered: number;
  observedPaths: PathStat[];
  observedSioEvents: string[];
  sessionStats: SessionStats | null;
};

export function useDerived(entries: LogEntry[], filters: Filters): Derived {
  return useMemo(() => {
    const noisePatterns = compilePatterns(filters.customNoisePatterns);
    let searchRe: RegExp | null = null;
    if (filters.search) {
      try {
        searchRe = filters.searchRegex
          ? new RegExp(filters.search, 'i')
          : new RegExp(escapeRegex(filters.search), 'i');
      } catch {
        searchRe = null;
      }
    }

    const pathCounts = new Map<string, number>();
    const sioEvents = new Set<string>();
    const filtered: LogEntry[] = [];

    for (const entry of entries) {
      if (filters.activeCategory !== 'all' && categoryOf(entry) !== filters.activeCategory) continue;

      if (entry.kind === 'lifecycle') {
        if (!filters.showLifecycle) continue;
        if (searchRe && !searchRe.test(entry.data.url) && !searchRe.test(entry.data.kind)) continue;
        filtered.push(entry);
        continue;
      }
      const e = entry.data;
      if (e.direction === 'send' && !filters.showSend) continue;
      if (e.direction === 'recv' && !filters.showRecv) continue;
      if (filters.hideNoise && isNoise(e, noisePatterns)) continue;
      if (searchRe && !searchRe.test(e.payload) && !searchRe.test(e.url)) continue;
      filtered.push(entry);

      const parsed = parseBody(e.payload);
      if (parsed.kind === 'sio' && parsed.event) sioEvents.add(parsed.event);
      const obj = parsed.kind === 'sio' ? parsed.value : parsed.kind === 'json' ? parsed.value : null;
      if (obj && typeof obj === 'object') {
        for (const p of collectPaths(obj)) {
          pathCounts.set(p, (pathCounts.get(p) ?? 0) + 1);
        }
      }
    }

    const { groups, sessionStats } = buildGroups(filtered, filters.groupBy, filters.sessionConfig);

    const observedPaths: PathStat[] = [...pathCounts.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));

    return {
      groups,
      totalFiltered: filtered.length,
      observedPaths,
      observedSioEvents: [...sioEvents].sort(),
      sessionStats,
    };
  }, [entries, filters]);
}

function buildGroups(
  filtered: LogEntry[],
  groupBy: Filters['groupBy'],
  sessionConfig: SessionConfig,
): { groups: Group[]; sessionStats: SessionStats | null } {
  if (groupBy.kind === 'none') {
    return {
      groups: [{ key: '', label: '', count: filtered.length, items: filtered }],
      sessionStats: null,
    };
  }

  if (groupBy.kind === 'session') {
    return buildSessionGroups(filtered, sessionConfig);
  }

  const map = new Map<string, { label: string; items: LogEntry[] }>();
  const push = (key: string, label: string, entry: LogEntry) => {
    const cur = map.get(key);
    if (cur) cur.items.push(entry);
    else map.set(key, { label, items: [entry] });
  };

  for (const entry of filtered) {
    if (groupBy.kind === 'socket') {
      const sid = entry.kind === 'event' ? entry.data.socketId : entry.data.socketId;
      const url = entry.kind === 'event' ? entry.data.url : entry.data.url;
      push(sid, `socket ${shortUrl(url)} · ${sid.slice(0, 6)}`, entry);
    } else if (groupBy.kind === 'sioEvent') {
      if (entry.kind === 'lifecycle') {
        push('(lifecycle)', '(lifecycle)', entry);
        continue;
      }
      const parsed = parseBody(entry.data.payload);
      const ev = parsed.kind === 'sio' ? parsed.event ?? `sio:${parsed.packetType}` : '(non-sio)';
      push(ev, `event = ${ev}`, entry);
    } else if (groupBy.kind === 'path') {
      if (entry.kind === 'lifecycle') {
        push('(lifecycle)', '(lifecycle)', entry);
        continue;
      }
      const parsed = parseBody(entry.data.payload);
      const obj = parsed.kind === 'sio' ? parsed.value : parsed.kind === 'json' ? parsed.value : null;
      const v = obj && typeof obj === 'object' ? getByPath(obj, groupBy.path) : undefined;
      const key = v === undefined ? '(no value)' : String(v);
      push(key, `${groupBy.path} = ${key}`, entry);
    }
  }

  const out: Group[] = [];
  for (const [key, { label, items }] of map) {
    out.push({ key, label, count: items.length, items });
  }
  return { groups: out, sessionStats: null };
}

type EventInfo = {
  entry: LogEntry;
  sioEvent: string | null;
  payloadObj: unknown;
  timestamp: number;
  socketId: string;
};

function infoOf(entry: LogEntry): EventInfo {
  if (entry.kind === 'lifecycle') {
    return {
      entry,
      sioEvent: null,
      payloadObj: null,
      timestamp: entry.data.timestamp,
      socketId: entry.data.socketId,
    };
  }
  const e = entry.data;
  const parsed = parseBody(e.payload);
  const sioEvent = parsed.kind === 'sio' ? parsed.event ?? null : null;
  const payloadObj = parsed.kind === 'sio' ? parsed.value : parsed.kind === 'json' ? parsed.value : null;
  return { entry, sioEvent, payloadObj, timestamp: e.timestamp, socketId: e.socketId };
}

function fmtSessionTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function shortKey(v: unknown): string {
  if (v == null) return '?';
  const s = String(v);
  return s.length <= 10 ? s : s.slice(0, 8) + '…';
}

const TRIGGER_WINDOW_MS = 30_000;

function splitKeyPaths(s: string): string[] {
  return s
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function getByKeyPaths(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    const v = getByPath(obj, p);
    if (v !== undefined) return v;
  }
  return undefined;
}

function buildSessionGroups(
  filtered: LogEntry[],
  cfg: SessionConfig,
): { groups: Group[]; sessionStats: SessionStats } {
  if (cfg.mode === 'correlation') return buildCorrelationGroups(filtered, cfg);

  const stats: SessionStats = {
    sessions: 0,
    outside: 0,
    startMatches: 0,
    endMatches: 0,
    triggerMatches: 0,
    keyMatches: 0,
  };
  const keyPaths = splitKeyPaths(cfg.keyPath);
  const infos = filtered.map(infoOf);

  const sessions: Array<{ key: string; label: string; items: LogEntry[]; firstTs: number; keyValue: unknown }> = [];
  const lifecycleItems: LogEntry[] = [];
  const outsideItems: LogEntry[] = [];

  type Open = { idx: number; key: string; lastEventTs: number };
  const openBySocket = new Map<string, Open>();
  // recent trigger event per socketId: last sent matching triggerEvent not yet consumed
  const triggerBySocket = new Map<string, EventInfo>();
  // for 'both': merge sessions sharing the same keyValue
  const byKeyValueIdx = new Map<string, number>();

  function ordinal() {
    return sessions.length + 1;
  }

  function openSession(info: EventInfo, triggerInfo: EventInfo | null): Open {
    let keyValue = info.payloadObj && typeof info.payloadObj === 'object'
      ? getByKeyPaths(info.payloadObj, keyPaths)
      : undefined;
    if (keyValue === undefined && triggerInfo && triggerInfo.payloadObj && typeof triggerInfo.payloadObj === 'object') {
      keyValue = getByKeyPaths(triggerInfo.payloadObj, keyPaths);
    }
    if (keyValue !== undefined) stats.keyMatches += 1;

    if (cfg.mode === 'both' && keyValue !== undefined) {
      const k = String(keyValue);
      const existing = byKeyValueIdx.get(k);
      if (existing !== undefined) {
        const s = sessions[existing];
        if (triggerInfo) s.items.push(triggerInfo.entry);
        s.items.push(info.entry);
        return { idx: existing, key: s.key, lastEventTs: info.timestamp };
      }
    }

    const n = ordinal();
    const idx = sessions.length;
    const items: LogEntry[] = [];
    if (triggerInfo) items.push(triggerInfo.entry);
    items.push(info.entry);
    const key = `S${n}-${info.socketId.slice(0, 6)}-${info.timestamp}`;
    const label = `S${n} · ${shortKey(keyValue)} · ${fmtSessionTime(info.timestamp)}`;
    sessions.push({ key, label, items, firstTs: info.timestamp, keyValue });
    if (cfg.mode === 'both' && keyValue !== undefined) byKeyValueIdx.set(String(keyValue), idx);
    return { idx, key, lastEventTs: info.timestamp };
  }

  for (const info of infos) {
    if (info.entry.kind === 'lifecycle') {
      lifecycleItems.push(info.entry);
      continue;
    }

    const sid = info.socketId;
    const open = openBySocket.get(sid) ?? null;

    // Trigger pickup (only sent direction by convention; matches event name)
    if (info.sioEvent && info.sioEvent === cfg.triggerEvent && cfg.triggerEvent) {
      stats.triggerMatches += 1;
      // store only if this entry not consumed by current open session
      if (open) {
        sessions[open.idx].items.push(info.entry);
      } else {
        triggerBySocket.set(sid, info);
      }
      continue;
    }

    const isStart = !!cfg.startEvent && info.sioEvent === cfg.startEvent;
    const isEnd = cfg.mode === 'bracket' || cfg.mode === 'both'
      ? !!cfg.endEvent && info.sioEvent === cfg.endEvent
      : false;

    if (isEnd && open) {
      stats.endMatches += 1;
      sessions[open.idx].items.push(info.entry);
      openBySocket.delete(sid);
      continue;
    }

    if (isStart) {
      stats.startMatches += 1;
      // close prior open (for bracket/both) or replace (startOnly)
      if (open) openBySocket.delete(sid);
      // pull recent trigger if within window
      let trig: EventInfo | null = null;
      const t = triggerBySocket.get(sid);
      if (t && info.timestamp - t.timestamp <= TRIGGER_WINDOW_MS) trig = t;
      triggerBySocket.delete(sid);
      const newOpen = openSession(info, trig);
      openBySocket.set(sid, newOpen);
      continue;
    }

    // Non-marker event
    if (open) {
      sessions[open.idx].items.push(info.entry);
    } else {
      outsideItems.push(info.entry);
    }
  }

  // expire stale triggers (purely housekeeping, not really needed at end)

  const out: Group[] = sessions
    .sort((a, b) => a.firstTs - b.firstTs)
    .map((s) => ({ key: s.key, label: s.label, count: s.items.length, items: s.items }));

  stats.sessions = sessions.length;
  stats.outside = outsideItems.length;

  if (outsideItems.length > 0) {
    out.push({ key: '(outside)', label: '(outside session)', count: outsideItems.length, items: outsideItems });
  }
  if (lifecycleItems.length > 0) {
    out.push({ key: '(lifecycle)', label: '(lifecycle)', count: lifecycleItems.length, items: lifecycleItems });
  }
  return { groups: out, sessionStats: stats };
}

function buildCorrelationGroups(
  filtered: LogEntry[],
  cfg: SessionConfig,
): { groups: Group[]; sessionStats: SessionStats } {
  const stats: SessionStats = {
    sessions: 0,
    outside: 0,
    startMatches: 0,
    endMatches: 0,
    triggerMatches: 0,
    keyMatches: 0,
  };
  const keyPaths = splitKeyPaths(cfg.keyPath);
  const map = new Map<string, { label: string; items: LogEntry[]; firstTs: number; keyValue: unknown }>();
  const lifecycleItems: LogEntry[] = [];
  const noKeyItems: LogEntry[] = [];
  let ordinal = 0;

  for (const entry of filtered) {
    if (entry.kind === 'lifecycle') {
      lifecycleItems.push(entry);
      continue;
    }
    const info = infoOf(entry);
    const v = info.payloadObj && typeof info.payloadObj === 'object'
      ? getByKeyPaths(info.payloadObj, keyPaths)
      : undefined;
    if (v === undefined) {
      noKeyItems.push(entry);
      continue;
    }
    stats.keyMatches += 1;
    const k = String(v);
    let bucket = map.get(k);
    if (!bucket) {
      ordinal += 1;
      bucket = {
        label: `S${ordinal} · ${shortKey(v)} · ${fmtSessionTime(info.timestamp)}`,
        items: [],
        firstTs: info.timestamp,
        keyValue: v,
      };
      map.set(k, bucket);
    }
    bucket.items.push(entry);
  }

  const out: Group[] = [...map.entries()]
    .sort((a, b) => a[1].firstTs - b[1].firstTs)
    .map(([key, b]) => ({ key, label: b.label, count: b.items.length, items: b.items }));

  stats.sessions = map.size;
  stats.outside = noKeyItems.length;

  if (noKeyItems.length > 0) {
    out.push({ key: '(no key)', label: '(no key)', count: noKeyItems.length, items: noKeyItems });
  }
  if (lifecycleItems.length > 0) {
    out.push({ key: '(lifecycle)', label: '(lifecycle)', count: lifecycleItems.length, items: lifecycleItems });
  }
  return { groups: out, sessionStats: stats };
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.host + url.pathname;
  } catch {
    return u;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
