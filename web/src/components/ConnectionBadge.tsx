import { useStore } from '../store';

export function ConnectionBadge() {
  const status = useStore((s) => s.connection);
  const label = status === 'open' ? 'relay connected' : status === 'connecting' ? 'connecting…' : 'disconnected';
  return (
    <span className={`badge ${status}`}>
      <span className="dot" />
      {label}
    </span>
  );
}
