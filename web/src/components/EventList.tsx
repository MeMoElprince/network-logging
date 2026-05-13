import { useEffect, useRef } from 'react';
import { store, useStore } from '../store';
import { EventRow } from './EventRow';
import type { Group } from '../lib/select';

type Props = { groups: Group[] };

export function EventList({ groups }: Props) {
  const collapsed = useStore((s) => s.filters.collapsedGroups);
  const grouped = useStore((s) => s.filters.groupBy.kind !== 'none');
  const ref = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const totalItems = groups.reduce((a, g) => a + g.items.length, 0);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  useEffect(() => {
    const el = ref.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [totalItems]);

  if (totalItems === 0) {
    return (
      <div className="event-list" ref={ref}>
        <div className="empty">
          Waiting for frames…
          <br />
          Open a target page in Chrome with the extension configured.
        </div>
      </div>
    );
  }

  return (
    <div className="event-list" ref={ref} onScroll={onScroll}>
      {groups.map((g) => {
        if (!grouped) {
          return g.items.map((entry) => (
            <EventRow
              key={entry.kind === 'event' ? entry.data.id : `${entry.data.socketId}-${entry.data.kind}-${entry.data.timestamp}`}
              entry={entry}
            />
          ));
        }
        const isCollapsed = !!collapsed[g.key];
        return (
          <section key={g.key} className="group">
            <header
              className="group-header"
              onClick={() => store.toggleGroupCollapsed(g.key)}
            >
              <span className="caret">{isCollapsed ? '▶' : '▼'}</span>
              <span className="label">{g.label}</span>
              <span className="count">{g.count}</span>
            </header>
            {!isCollapsed &&
              g.items.map((entry) => (
                <EventRow
                  key={entry.kind === 'event' ? entry.data.id : `${entry.data.socketId}-${entry.data.kind}-${entry.data.timestamp}`}
                  entry={entry}
                />
              ))}
          </section>
        );
      })}
    </div>
  );
}
