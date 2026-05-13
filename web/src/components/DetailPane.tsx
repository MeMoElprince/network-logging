import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { parseBody } from '../lib/parse';
import { BodyTable } from './BodyTable';
import { PrettyJson } from './PrettyJson';
import type { CapturedEvent } from '../../../shared/protocol';
import { transportLabel } from '../lib/transport';

function fmtTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

type View = 'table' | 'pretty' | 'raw';

export function DetailPane() {
  const entry = useStore((s) => {
    if (!s.selectedId) return null;
    return s.entries.find((e) => (e.kind === 'event' ? e.data.id : `${e.data.socketId}-${e.data.kind}-${e.data.timestamp}`) === s.selectedId) ?? null;
  });
  const [view, setView] = useState<View>('table');

  if (!entry) {
    return (
      <aside className="detail-pane empty">
        <div className="empty-msg">Select a frame to inspect</div>
      </aside>
    );
  }

  if (entry.kind === 'lifecycle') {
    const lc = entry.data;
    return (
      <aside className="detail-pane">
        <header>
          <span className="dir life">◇ {lc.kind}</span>
          <span className={`chip transport ${lc.transport ?? 'websocket'}`}>{transportLabel(lc.transport ?? 'websocket')}</span>
          <span className="ts">{fmtTime(lc.timestamp)}</span>
        </header>
        <table className="meta-table">
          <tbody>
            <tr><th>conn</th><td>{lc.socketId.slice(0, 12)}…</td></tr>
            <tr><th>url</th><td className="mono">{lc.url}</td></tr>
            {lc.code != null && <tr><th>code</th><td>{lc.code}</td></tr>}
            {lc.reason && <tr><th>reason</th><td>{lc.reason}</td></tr>}
            {lc.meta?.error && <tr><th>error</th><td>{lc.meta.error}</td></tr>}
            {lc.meta?.method && <tr><th>method</th><td>{lc.meta.method}</td></tr>}
            {lc.meta?.label && <tr><th>label</th><td>{lc.meta.label}</td></tr>}
          </tbody>
        </table>
      </aside>
    );
  }

  const e = entry.data;
  return <EventDetail event={e} view={view} setView={setView} />;
}

function EventDetail({ event: e, view, setView }: { event: CapturedEvent; view: View; setView: (v: View) => void }) {
  const parsed = useMemo(() => parseBody(e.payload), [e.payload]);
  const bodyValue = parsed.kind === 'sio' ? parsed.value : parsed.kind === 'json' ? parsed.value : null;

  const m = e.meta;
  return (
    <aside className="detail-pane">
      <header>
        <span className={`dir ${e.direction}`}>{e.direction === 'send' ? '▲ send' : '▼ recv'}</span>
        <span className={`chip transport ${e.transport ?? 'websocket'}`}>{transportLabel(e.transport ?? 'websocket')}</span>
        <span className="ts">{fmtTime(e.timestamp)}</span>
        <span className="size">{fmtBytes(e.size)}{e.truncated ? ' (truncated)' : ''}</span>
      </header>
      <table className="meta-table">
        <tbody>
          <tr><th>conn</th><td>{e.socketId.slice(0, 12)}…</td></tr>
          <tr><th>url</th><td className="mono">{e.url}</td></tr>
          <tr><th>type</th><td>{e.payloadType}</td></tr>
          {m?.method && <tr><th>method</th><td>{m.method}</td></tr>}
          {m?.status != null && <tr><th>status</th><td>{m.status} {m.statusText ?? ''}</td></tr>}
          {m?.eventName && <tr><th>event</th><td><span className="chip">{m.eventName}</span></td></tr>}
          {m?.lastEventId && <tr><th>last-id</th><td>{m.lastEventId}</td></tr>}
          {m?.label && <tr><th>label</th><td>{m.label}</td></tr>}
          {parsed.kind === 'sio' && (
            <>
              <tr><th>sio packet</th><td>{parsed.packetType}{parsed.namespace ? ` ns=${parsed.namespace}` : ''}{parsed.ackId ? ` ack=${parsed.ackId}` : ''}</td></tr>
              {parsed.event && <tr><th>event</th><td><span className="chip">{parsed.event}</span></td></tr>}
            </>
          )}
        </tbody>
      </table>

      {m?.headers && Object.keys(m.headers).length > 0 && (
        <details className="headers-block" open>
          <summary>Headers ({Object.keys(m.headers).length})</summary>
          <table className="meta-table headers">
            <tbody>
              {Object.entries(m.headers).map(([k, v]) => (
                <tr key={k}><th>{k}</th><td className="mono">{v}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <div className="view-tabs">
        <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')} disabled={!bodyValue}>
          Table
        </button>
        <button className={view === 'pretty' ? 'on' : ''} onClick={() => setView('pretty')} disabled={!bodyValue}>
          Pretty
        </button>
        <button className={view === 'raw' ? 'on' : ''} onClick={() => setView('raw')}>
          Raw
        </button>
      </div>

      <div className="body-view">
        {view === 'table' && bodyValue !== null && <BodyTable value={bodyValue} />}
        {view === 'pretty' && bodyValue !== null && (
          <div className="json-pretty">
            <PrettyJson value={bodyValue} />
          </div>
        )}
        {(view === 'raw' || bodyValue === null) && <pre className="raw">{e.payload}</pre>}
      </div>
    </aside>
  );
}
