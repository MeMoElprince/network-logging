import { useMemo } from 'react';
import type { LogEntry } from '../store';
import { store, useStore } from '../store';
import { parseBody } from '../lib/parse';
import { pickHighlight, fmtHighlight, type Highlight } from '../lib/highlight';
import { transportLabel } from '../lib/transport';

function fmtTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function entryId(entry: LogEntry): string {
  return entry.kind === 'event' ? entry.data.id : `${entry.data.socketId}-${entry.data.kind}-${entry.data.timestamp}`;
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.host + url.pathname;
  } catch {
    return u;
  }
}

type Parts = {
  badge: string | null;
  highlight: Highlight | null;
  rawPreview: string;
};

function buildParts(payload: string): Parts {
  const parsed = parseBody(payload);
  if (parsed.kind === 'sio') {
    const badge = parsed.event ?? `sio:${parsed.packetType}`;
    const highlight = pickHighlight(parsed.value);
    return { badge, highlight, rawPreview: payload };
  }
  if (parsed.kind === 'json') {
    return { badge: null, highlight: pickHighlight(parsed.value), rawPreview: payload };
  }
  return { badge: null, highlight: null, rawPreview: payload };
}

function transportBadge(e: import('../../../shared/protocol').CapturedEvent): string | null {
  const m = e.meta;
  if (!m) return null;
  if (e.transport === 'fetch' || e.transport === 'xhr') {
    if (e.direction === 'send' && m.method) return m.method;
    if (e.direction === 'recv' && m.status != null) return `${m.method ?? ''} ${m.status}`.trim();
    return m.method ?? null;
  }
  if (e.transport === 'sse' && m.eventName) return m.eventName;
  if (e.transport === 'webrtc' && m.label) return m.label;
  return null;
}

export function EventRow({ entry }: { entry: LogEntry }) {
  const layout = useStore((s) => s.filters.rowLayout);
  const selected = useStore((s) => s.selectedId === entryId(entry));
  const onClick = () => store.select(entryId(entry));

  if (entry.kind === 'lifecycle') {
    return <LifecycleRow entry={entry} layout={layout} selected={selected} onClick={onClick} />;
  }
  return <DataRow entry={entry} layout={layout} selected={selected} onClick={onClick} />;
}

function LifecycleRow({
  entry,
  layout,
  selected,
  onClick,
}: {
  entry: Extract<LogEntry, { kind: 'lifecycle' }>;
  layout: 'compact' | 'cards' | 'bubbles';
  selected: boolean;
  onClick: () => void;
}) {
  const lc = entry.data;
  const arrow = lc.kind === 'open' ? '◇' : lc.kind === 'close' ? '◆' : '✕';

  if (layout === 'compact') {
    return (
      <div className={`row lifecycle ${selected ? 'selected' : ''}`} onClick={onClick}>
        <span className="ts">{fmtTime(lc.timestamp)}</span>
        <span className="dir">{arrow}</span>
        <span className="preview">
          <em>{lc.kind}</em> {shortUrl(lc.url)}
        </span>
      </div>
    );
  }

  // cards + bubbles both render lifecycle as centered divider
  return (
    <div className={`life-divider ${layout} ${selected ? 'selected' : ''}`} onClick={onClick}>
      <span className="line" />
      <span className="badge-life">
        {arrow} {lc.kind}
        <span className="muted"> · {shortUrl(lc.url)} · {fmtTime(lc.timestamp)}</span>
        {lc.code != null && <span className="muted"> · {lc.code}</span>}
      </span>
      <span className="line" />
    </div>
  );
}

function DataRow({
  entry,
  layout,
  selected,
  onClick,
}: {
  entry: Extract<LogEntry, { kind: 'event' }>;
  layout: 'compact' | 'cards' | 'bubbles';
  selected: boolean;
  onClick: () => void;
}) {
  const e = entry.data;
  const parts = useMemo(() => buildParts(e.payload), [e.payload]);
  const arrow = e.direction === 'send' ? '▲' : '▼';
  const tBadge = transportBadge(e);
  const tLabel = transportLabel(e.transport ?? 'websocket');

  if (layout === 'compact') {
    let preview: string;
    if (parts.highlight) {
      preview = parts.highlight.key
        ? `${parts.highlight.key}: ${fmtHighlight(parts.highlight.value, 160)}`
        : fmtHighlight(parts.highlight.value, 160);
    } else {
      preview = parts.rawPreview.length > 160 ? parts.rawPreview.slice(0, 160) + '…' : parts.rawPreview;
    }
    return (
      <div className={`row ${e.direction} ${selected ? 'selected' : ''}`} onClick={onClick}>
        <span className="ts">{fmtTime(e.timestamp)}</span>
        <span className="dir">{arrow}</span>
        <span className="preview">
          <span className={`chip transport ${e.transport ?? 'websocket'}`}>{tLabel}</span>
          {tBadge && <span className="chip">{tBadge}</span>}
          {parts.badge && <span className="chip">{parts.badge}</span>}
          <span className="payload-preview">{preview}</span>
        </span>
        <span className="size">{fmtBytes(e.size)}</span>
      </div>
    );
  }

  if (layout === 'cards') {
    return (
      <div className={`card ${e.direction} ${selected ? 'selected' : ''}`} onClick={onClick}>
        <div className="card-head">
          <span className="dir-tag">{arrow}</span>
          <span className={`chip transport ${e.transport ?? 'websocket'}`}>{tLabel}</span>
          {tBadge && <span className="chip">{tBadge}</span>}
          {parts.badge ? <span className="chip">{parts.badge}</span> : !tBadge && <span className="chip muted">raw</span>}
          <span className="card-ts">{fmtTime(e.timestamp)}</span>
          <span className="card-size">{fmtBytes(e.size)}</span>
        </div>
        <div className="card-body">
          {parts.highlight ? (
            <>
              {parts.highlight.key && <span className="hl-key">{parts.highlight.key}</span>}
              <span className="hl-value">{fmtHighlight(parts.highlight.value, 240)}</span>
            </>
          ) : (
            <span className="hl-value muted">
              {parts.rawPreview.length > 240 ? parts.rawPreview.slice(0, 240) + '…' : parts.rawPreview || '(empty)'}
            </span>
          )}
        </div>
      </div>
    );
  }

  // bubbles
  return (
    <div className={`bubble-wrap ${e.direction}`}>
      <div className={`bubble ${e.direction} ${selected ? 'selected' : ''}`} onClick={onClick}>
        <div className="bubble-head">
          <span className={`chip transport ${e.transport ?? 'websocket'}`}>{tLabel}</span>
          {tBadge && <span className="chip">{tBadge}</span>}
          {parts.badge ? <span className="chip">{parts.badge}</span> : !tBadge && <span className="chip muted">raw</span>}
          <span className="bubble-ts">{fmtTime(e.timestamp).slice(0, 12)}</span>
        </div>
        <div className="bubble-body">
          {parts.highlight ? (
            <>
              {parts.highlight.key && <span className="hl-key">{parts.highlight.key}:</span>}
              <span className="hl-value">{fmtHighlight(parts.highlight.value, 180)}</span>
            </>
          ) : (
            <span className="hl-value muted">
              {parts.rawPreview.length > 180 ? parts.rawPreview.slice(0, 180) + '…' : parts.rawPreview || '(empty)'}
            </span>
          )}
        </div>
        <div className="bubble-foot">{fmtBytes(e.size)}</div>
      </div>
    </div>
  );
}
