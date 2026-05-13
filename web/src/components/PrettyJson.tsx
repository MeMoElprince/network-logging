import { useState } from 'react';

type Props = { value: unknown; level?: number };

export function PrettyJson({ value, level = 0 }: Props) {
  if (value === null) return <span className="j-null">null</span>;
  if (typeof value === 'boolean') return <span className="j-bool">{String(value)}</span>;
  if (typeof value === 'number') return <span className="j-num">{value}</span>;
  if (typeof value === 'string') return <span className="j-str">"{value}"</span>;
  if (Array.isArray(value)) return <PrettyArray value={value} level={level} />;
  if (typeof value === 'object') return <PrettyObject value={value as Record<string, unknown>} level={level} />;
  return <span>{String(value)}</span>;
}

function PrettyArray({ value, level }: { value: unknown[]; level: number }) {
  const [open, setOpen] = useState(level < 2);
  if (value.length === 0) return <span>[]</span>;
  return (
    <span>
      <span className="j-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▼' : '▶'} [{value.length}]
      </span>
      {open && (
        <div className="j-indent">
          {value.map((v, i) => (
            <div key={i}>
              <span className="j-key">{i}:</span> <PrettyJson value={v} level={level + 1} />
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

function PrettyObject({ value, level }: { value: Record<string, unknown>; level: number }) {
  const [open, setOpen] = useState(level < 2);
  const keys = Object.keys(value);
  if (keys.length === 0) return <span>{'{}'}</span>;
  return (
    <span>
      <span className="j-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▼' : '▶'} {`{${keys.length}}`}
      </span>
      {open && (
        <div className="j-indent">
          {keys.map((k) => (
            <div key={k}>
              <span className="j-key">{k}:</span> <PrettyJson value={value[k]} level={level + 1} />
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
