import { useMemo, useState } from 'react';
import { flattenForTable } from '../lib/path';
import { store } from '../store';
import { PrettyJson } from './PrettyJson';

type Props = { value: unknown };

function fmtValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export function BodyTable({ value }: Props) {
  const rows = useMemo(() => flattenForTable(value, 2), [value]);
  const [expanded, setExpanded] = useState<Record<string, true>>({});

  if (rows.length === 0) return <div className="empty-mini">empty</div>;

  return (
    <table className="body-table">
      <tbody>
        {rows.map((r) => {
          const isOpen = !!expanded[r.path];
          return (
            <tr key={r.path}>
              <td className="key">{r.path || '(root)'}</td>
              <td className="value">
                {r.isLeaf ? (
                  <span className="leaf">{fmtValue(r.value)}</span>
                ) : (
                  <>
                    <button
                      className="link"
                      onClick={() =>
                        setExpanded((e) => {
                          const n = { ...e };
                          if (n[r.path]) delete n[r.path];
                          else n[r.path] = true;
                          return n;
                        })
                      }
                    >
                      {isOpen ? '▼' : '▶'} {Array.isArray(r.value) ? `[${r.childCount}]` : `{${r.childCount}}`}
                    </button>
                    {isOpen && (
                      <div className="nested">
                        <PrettyJson value={r.value} level={1} />
                      </div>
                    )}
                  </>
                )}
              </td>
              <td className="actions">
                {r.isLeaf && r.value !== null && r.value !== undefined && (
                  <>
                    <button
                      title="Filter by this value"
                      onClick={() => store.setSearch(fmtValue(r.value))}
                    >
                      ⌕
                    </button>
                    <button title="Group by this path" onClick={() => store.setGroupBy({ kind: 'path', path: r.path })}>
                      ◫
                    </button>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
