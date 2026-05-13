import { store, normalizeFilters, type Filters, type LogEntry } from '../store';

type ExportFile = {
  version: 1;
  exportedAt: string;
  entries: LogEntry[];
  filters: Filters;
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function filename(now: Date): string {
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `network-log-${stamp}.json`;
}

export function exportState(): void {
  const s = store.get();
  const file: ExportFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: s.entries,
    filters: s.filters,
  };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename(new Date());
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function isCapturedEvent(d: unknown): boolean {
  if (!d || typeof d !== 'object') return false;
  const e = d as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.socketId === 'string' &&
    typeof e.url === 'string' &&
    (e.direction === 'send' || e.direction === 'recv') &&
    typeof e.timestamp === 'number' &&
    (e.payloadType === 'string' || e.payloadType === 'binary') &&
    typeof e.payload === 'string' &&
    typeof e.size === 'number'
  );
}

function isLifecycle(d: unknown): boolean {
  if (!d || typeof d !== 'object') return false;
  const e = d as Record<string, unknown>;
  return (
    typeof e.socketId === 'string' &&
    typeof e.url === 'string' &&
    (e.kind === 'open' || e.kind === 'close' || e.kind === 'error') &&
    typeof e.timestamp === 'number'
  );
}

function validateEntry(e: unknown): e is LogEntry {
  if (!e || typeof e !== 'object') return false;
  const x = e as { kind?: unknown; data?: unknown };
  if (x.kind === 'event') return isCapturedEvent(x.data);
  if (x.kind === 'lifecycle') return isLifecycle(x.data);
  return false;
}

export async function importStateFromFile(
  file: File,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: 'could not read file' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `invalid JSON (${(e as Error).message})` };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'file is not a JSON object' };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    return { ok: false, error: `unsupported version: ${String(obj.version)}` };
  }
  if (!Array.isArray(obj.entries)) {
    return { ok: false, error: '"entries" missing or not an array' };
  }
  for (let i = 0; i < obj.entries.length; i++) {
    if (!validateEntry(obj.entries[i])) {
      return { ok: false, error: `entry at index ${i} is malformed` };
    }
  }

  store.importState({
    entries: obj.entries as LogEntry[],
    filters: normalizeFilters(obj.filters),
  });
  return { ok: true };
}
