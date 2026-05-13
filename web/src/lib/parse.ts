export type Parsed =
  | { kind: 'json'; value: unknown }
  | { kind: 'sio'; packetType: string; namespace?: string; ackId?: string; event?: string; value: unknown }
  | { kind: 'raw'; value: string };

const SIO_PREFIX = /^(\d{1,2})(\/[^,]*?,)?(\d+)?/;

export function parseBody(payload: string): Parsed {
  const trimmed = payload.trim();
  if (!trimmed) return { kind: 'raw', value: payload };

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { kind: 'json', value: JSON.parse(trimmed) };
    } catch {
      // fall through
    }
  }

  const m = trimmed.match(SIO_PREFIX);
  if (m) {
    const packetType = m[1];
    const namespace = m[2] ? m[2].slice(0, -1) : undefined;
    const ackId = m[3];
    const rest = trimmed.slice(m[0].length);
    if (rest && (rest.startsWith('[') || rest.startsWith('{'))) {
      try {
        const value = JSON.parse(rest);
        if (Array.isArray(value) && typeof value[0] === 'string') {
          return {
            kind: 'sio',
            packetType,
            namespace,
            ackId,
            event: value[0],
            value: value.length === 2 ? value[1] : value.slice(1),
          };
        }
        return { kind: 'sio', packetType, namespace, ackId, value };
      } catch {
        // fall through
      }
    }
  }

  return { kind: 'raw', value: payload };
}
