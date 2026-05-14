import { useEffect, useId, useRef, useState } from 'react';
import { store, useStore } from '../store';
import type { GroupBy, RowLayout, SessionConfig, SessionMode } from '../store';
import { ConnectionBadge } from './ConnectionBadge';
import { CATEGORIES, type CategoryFilter } from '../lib/category';
import type { PathStat, SessionStats } from '../lib/select';
import { exportState, importStateFromFile } from '../lib/exportImport';

type Props = {
  observedPaths: PathStat[];
  observedSioEvents: string[];
  sessionStats: SessionStats | null;
  totalFiltered: number;
  totalRaw: number;
};

export function Toolbar({ observedPaths, observedSioEvents, sessionStats, totalFiltered, totalRaw }: Props) {
  const filters = useStore((s) => s.filters);
  const [noiseEditing, setNoiseEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="toolbar">
      <div className="toolbar-row">
        <h1>Network Logging</h1>
        <ConnectionBadge />

        <div className="search-wrap">
          <input
            className="search"
            type="text"
            placeholder={filters.searchRegex ? 'regex…' : 'search payload / url'}
            value={filters.search}
            onChange={(e) => store.setSearch(e.target.value)}
          />
          <button
            className={`pill ${filters.searchRegex ? 'on' : ''}`}
            title="Toggle regex mode"
            onClick={() => store.toggleSearchRegex()}
          >
            .*
          </button>
        </div>

        <GroupByMenu groupBy={filters.groupBy} paths={observedPaths} />

        <span className="spacer" />
        <span className="stat">
          {totalFiltered} / {totalRaw}
        </span>
        <button className="pill ghost" onClick={() => store.clear()}>
          Clear
        </button>
        <button className="pill ghost" onClick={exportState} title="Download current logs + filters as JSON">
          Export
        </button>
        <button
          className="pill ghost"
          onClick={() => fileInputRef.current?.click()}
          title="Load logs from a previously exported JSON file"
        >
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const res = await importStateFromFile(file);
            if (!res.ok) alert(`Import failed: ${res.error}`);
            e.target.value = '';
          }}
        />
      </div>

      <div className="toolbar-row tabs-row">
        <CategoryTabs active={filters.activeCategory} />
        <LayoutSwitch layout={filters.rowLayout} />
        <span className="spacer" />
        <CategoryChips
          category={filters.activeCategory}
          showSend={filters.showSend}
          showRecv={filters.showRecv}
          showLifecycle={filters.showLifecycle}
          hideNoise={filters.hideNoise}
          onEditNoise={() => setNoiseEditing((v) => !v)}
        />
      </div>

      {filters.groupBy.kind === 'session' && (
        <SessionBar
          cfg={filters.sessionConfig}
          sioEvents={observedSioEvents}
          paths={observedPaths}
          stats={sessionStats}
        />
      )}

      {noiseEditing && (
        <NoisePatternsEditor
          patterns={filters.customNoisePatterns}
          onClose={() => setNoiseEditing(false)}
          onSave={(patterns) => {
            store.setCustomNoisePatterns(patterns);
            setNoiseEditing(false);
          }}
        />
      )}
    </div>
  );
}

function LayoutSwitch({ layout }: { layout: RowLayout }) {
  const opts: { id: RowLayout; label: string; title: string }[] = [
    { id: 'compact', label: 'Compact', title: 'one-line rows' },
    { id: 'cards', label: 'Cards', title: 'two-line cards' },
    { id: 'bubbles', label: 'Chat', title: 'chat bubbles (send right / recv left)' },
  ];
  return (
    <div className="layout-switch">
      {opts.map((o) => (
        <button
          key={o.id}
          className={`layout-btn ${layout === o.id ? 'on' : ''}`}
          title={o.title}
          onClick={() => store.setRowLayout(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CategoryTabs({ active }: { active: CategoryFilter }) {
  return (
    <div className="cat-tabs">
      {CATEGORIES.map((c) => (
        <button
          key={c.id}
          className={`cat-tab ${active === c.id ? 'on' : ''}`}
          onClick={() => store.setCategory(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function CategoryChips({
  category,
  showSend,
  showRecv,
  showLifecycle,
  hideNoise,
  onEditNoise,
}: {
  category: CategoryFilter;
  showSend: boolean;
  showRecv: boolean;
  showLifecycle: boolean;
  hideNoise: boolean;
  onEditNoise: () => void;
}) {
  const showDirChips = category !== 'sse';
  const showSendChip = category !== 'sse';
  const showLifeChip = category !== 'fetch' && category !== 'xhr';
  return (
    <div className="pills">
      {showDirChips && (
        <>
          {showSendChip && (
            <button
              className={`pill send ${showSend ? 'on' : ''}`}
              onClick={() => store.toggleDirection('send')}
            >
              ▲ send
            </button>
          )}
          <button
            className={`pill recv ${showRecv ? 'on' : ''}`}
            onClick={() => store.toggleDirection('recv')}
          >
            ▼ recv
          </button>
          {showLifeChip && (
            <button
              className={`pill life ${showLifecycle ? 'on' : ''}`}
              onClick={() => store.toggleDirection('lifecycle')}
            >
              ◇ life
            </button>
          )}
        </>
      )}
      <button className={`pill ${hideNoise ? 'on' : ''}`} onClick={() => store.toggleNoise()}>
        hide noise
      </button>
      <button className="pill ghost" onClick={onEditNoise} title="Edit noise patterns">
        ⚙
      </button>
    </div>
  );
}

function groupLabel(g: GroupBy): string {
  switch (g.kind) {
    case 'none': return 'none';
    case 'socket': return 'socket';
    case 'sioEvent': return 'socket.io event';
    case 'path': return g.path;
    case 'session': return 'stream session';
  }
}

function GroupByMenu({
  groupBy,
  paths,
}: {
  groupBy: GroupBy;
  paths: PathStat[];
}) {
  const [open, setOpen] = useState(false);
  const [showPaths, setShowPaths] = useState(false);
  const [pathFilter, setPathFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      if (!ref.current?.contains(ev.target as Node)) {
        setOpen(false);
        setShowPaths(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function pick(g: GroupBy) {
    store.setGroupBy(g);
    setOpen(false);
    setShowPaths(false);
    setPathFilter('');
  }

  const filteredPaths = pathFilter
    ? paths.filter((p) => p.path.toLowerCase().includes(pathFilter.toLowerCase()))
    : paths;

  return (
    <div className="group-menu" ref={ref}>
      <button
        className={`pill ${groupBy.kind !== 'none' ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Choose grouping"
      >
        Group: {groupLabel(groupBy)} ▾
      </button>
      {open && (
        <div className="menu">
          <button className={`menu-item ${groupBy.kind === 'none' ? 'on' : ''}`} onClick={() => pick({ kind: 'none' })}>
            None
          </button>
          <button className={`menu-item ${groupBy.kind === 'socket' ? 'on' : ''}`} onClick={() => pick({ kind: 'socket' })}>
            By socket
          </button>
          <button className={`menu-item ${groupBy.kind === 'sioEvent' ? 'on' : ''}`} onClick={() => pick({ kind: 'sioEvent' })}>
            By socket.io event
          </button>
          <button
            className={`menu-item has-sub ${groupBy.kind === 'path' ? 'on' : ''}`}
            onClick={() => setShowPaths((v) => !v)}
          >
            By JSON path {showPaths ? '▾' : '▸'}
          </button>
          {showPaths && (
            <div className="menu-sub">
              <input
                className="menu-search"
                placeholder="filter paths…"
                value={pathFilter}
                onChange={(e) => setPathFilter(e.target.value)}
                autoFocus
              />
              {filteredPaths.length === 0 && <div className="menu-empty">no paths yet</div>}
              {filteredPaths.slice(0, 200).map((p) => (
                <button
                  key={p.path}
                  className={`menu-item path ${groupBy.kind === 'path' && groupBy.path === p.path ? 'on' : ''}`}
                  onClick={() => pick({ kind: 'path', path: p.path })}
                >
                  <span className="p-path">{p.path}</span>
                  <span className="p-count">{p.count}</span>
                </button>
              ))}
            </div>
          )}
          <button
            className={`menu-item ${groupBy.kind === 'session' ? 'on' : ''}`}
            onClick={() => pick({ kind: 'session' })}
          >
            By stream session
          </button>
        </div>
      )}
    </div>
  );
}

function SessionBar({
  cfg,
  sioEvents,
  paths,
  stats,
}: {
  cfg: SessionConfig;
  sioEvents: string[];
  paths: PathStat[];
  stats: SessionStats | null;
}) {
  const sioListId = useId();
  const pathListId = useId();
  const showEnd = cfg.mode === 'bracket' || cfg.mode === 'both';
  const showStart = cfg.mode !== 'correlation';

  const ok = stats != null && stats.sessions > 0;
  let diag = '';
  if (stats) {
    if (cfg.mode === 'correlation') {
      diag = `${stats.sessions} session(s) · ${stats.keyMatches} events keyed · ${stats.outside} unkeyed`;
    } else {
      diag = `${stats.sessions} session(s) · starts=${stats.startMatches} ends=${stats.endMatches} triggers=${stats.triggerMatches} · ${stats.outside} outside`;
    }
  }

  const hint = stats && stats.sessions === 0
    ? (() => {
        if (cfg.mode === 'correlation') {
          if (!cfg.keyPath.trim()) return 'Add at least one key path (e.g. sessionId).';
          return `No event payload had a value at "${cfg.keyPath}". Check Keys above against actual payload paths.`;
        }
        if (!cfg.startEvent.trim()) return 'Set the Start event name (a socket.io event that begins each stream).';
        if (stats.startMatches === 0) return `No event named "${cfg.startEvent}" was seen. Pick an actual event name from the dropdown — try one of the recently received ones.`;
        return '';
      })()
    : '';

  return (
    <div className="session-bar-wrap">
    <div className="session-bar">
      <datalist id={sioListId}>
        {sioEvents.map((e) => <option key={e} value={e} />)}
      </datalist>
      <datalist id={pathListId}>
        {paths.map((p) => <option key={p.path} value={p.path} />)}
      </datalist>

      <span className={`sb-stat ${ok ? 'good' : 'warn'}`} title={ok ? '' : 'No sessions detected — check fields below match real event names'}>
        🔀 {diag || 'session mode'}
      </span>

      <label className="sb-field">
        <span>Mode</span>
        <select
          value={cfg.mode}
          onChange={(e) => store.setSessionConfig({ mode: e.target.value as SessionMode })}
        >
          <option value="bracket">Bracket</option>
          <option value="startOnly">Start only</option>
          <option value="correlation">Correlation</option>
          <option value="both">Bracket + corr</option>
        </select>
      </label>

      {showStart && (
        <label className="sb-field">
          <span>Start</span>
          <input
            type="text"
            list={sioListId}
            value={cfg.startEvent}
            onChange={(e) => store.setSessionConfig({ startEvent: e.target.value })}
          />
        </label>
      )}

      {showEnd && (
        <label className="sb-field">
          <span>End</span>
          <input
            type="text"
            list={sioListId}
            value={cfg.endEvent}
            onChange={(e) => store.setSessionConfig({ endEvent: e.target.value })}
          />
        </label>
      )}

      <label className="sb-field">
        <span>Trigger</span>
        <input
          type="text"
          list={sioListId}
          placeholder="(optional)"
          value={cfg.triggerEvent}
          onChange={(e) => store.setSessionConfig({ triggerEvent: e.target.value })}
        />
      </label>

      <label className="sb-field grow">
        <span>Keys</span>
        <input
          type="text"
          list={pathListId}
          placeholder="sessionId, chatRoomId"
          value={cfg.keyPath}
          onChange={(e) => store.setSessionConfig({ keyPath: e.target.value })}
        />
      </label>

      <button
        className="pill ghost"
        title="Exit session grouping"
        onClick={() => store.setGroupBy({ kind: 'none' })}
      >
        ✕
      </button>
    </div>
    {hint && <div className="session-hint">⚠ {hint}</div>}
    </div>
  );
}

function NoisePatternsEditor({
  patterns,
  onSave,
  onClose,
}: {
  patterns: string[];
  onSave: (p: string[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(patterns.join('\n'));
  return (
    <div className="popover">
      <div className="popover-title">Custom noise patterns (regex, one per line)</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
      <div className="popover-actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          onClick={() =>
            onSave(
              text
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}
