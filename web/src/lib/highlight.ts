const PRIORITY_KEYS = [
  'error',
  'errorMessage',
  'finalAnswer',
  'message',
  'content',
  'node',
  'sessionId',
  'status',
  'type',
  'event',
  'name',
  'id',
];

export type Highlight = { key: string; value: unknown };

export function pickHighlight(payload: unknown): Highlight | null {
  if (payload === undefined) return null;
  if (payload === null) return { key: '', value: null };
  if (typeof payload !== 'object') return { key: '', value: payload };
  if (Array.isArray(payload)) {
    if (payload.length === 0) return { key: '', value: '[]' };
    return { key: `[${payload.length}]`, value: payload[0] };
  }

  const obj = payload as Record<string, unknown>;
  for (const k of PRIORITY_KEYS) {
    if (k in obj) return { key: k, value: obj[k] };
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || typeof v !== 'object') return { key: k, value: v };
  }
  const firstKey = Object.keys(obj)[0];
  if (firstKey) return { key: firstKey, value: obj[firstKey] };
  return null;
}

export function fmtHighlight(v: unknown, max = 120): string {
  if (v === null) return 'null';
  if (v === undefined) return '—';
  if (typeof v === 'string') return v.length > max ? v.slice(0, max) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return '[object]';
  }
}
