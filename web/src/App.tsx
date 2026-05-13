import { useRelay } from './hooks/useRelay';
import { Toolbar } from './components/Toolbar';
import { EventList } from './components/EventList';
import { DetailPane } from './components/DetailPane';
import { useStore } from './store';
import { useDerived } from './lib/select';

export function App() {
  useRelay();
  const entries = useStore((s) => s.entries);
  const filters = useStore((s) => s.filters);
  const derived = useDerived(entries, filters);

  return (
    <div className="app">
      <Toolbar
        observedPaths={derived.observedPaths}
        observedSioEvents={derived.observedSioEvents}
        sessionStats={derived.sessionStats}
        totalFiltered={derived.totalFiltered}
        totalRaw={entries.length}
      />
      <div className="split">
        <EventList groups={derived.groups} />
        <DetailPane />
      </div>
    </div>
  );
}
