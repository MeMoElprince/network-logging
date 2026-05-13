export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function collectPaths(obj: unknown, maxDepth = 3, maxPaths = 200): string[] {
  const out: string[] = [];
  function walk(node: unknown, prefix: string, depth: number) {
    if (out.length >= maxPaths) return;
    if (node == null || typeof node !== 'object' || Array.isArray(node)) return;
    for (const k of Object.keys(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      out.push(path);
      if (depth < maxDepth) walk((node as Record<string, unknown>)[k], path, depth + 1);
      if (out.length >= maxPaths) return;
    }
  }
  walk(obj, '', 1);
  return out;
}

export function flattenForTable(
  obj: unknown,
  maxDepth = 2,
): Array<{ path: string; value: unknown; isLeaf: boolean; childCount?: number }> {
  const rows: Array<{ path: string; value: unknown; isLeaf: boolean; childCount?: number }> = [];
  function walk(node: unknown, prefix: string, depth: number) {
    if (node == null || typeof node !== 'object') {
      rows.push({ path: prefix, value: node, isLeaf: true });
      return;
    }
    if (Array.isArray(node)) {
      if (depth >= maxDepth) {
        rows.push({ path: prefix, value: node, isLeaf: false, childCount: node.length });
        return;
      }
      node.forEach((v, i) => walk(v, prefix ? `${prefix}[${i}]` : `[${i}]`, depth + 1));
      return;
    }
    const keys = Object.keys(node as Record<string, unknown>);
    if (depth >= maxDepth) {
      rows.push({ path: prefix, value: node, isLeaf: false, childCount: keys.length });
      return;
    }
    for (const k of keys) {
      const childPath = prefix ? `${prefix}.${k}` : k;
      walk((node as Record<string, unknown>)[k], childPath, depth + 1);
    }
  }
  walk(obj, '', 0);
  return rows;
}
