import type { CapturedEvent } from '../../../shared/protocol';

const DEFAULT_NOISE = [/^\d{1,2}$/, /^(ping|pong)$/i];

export function compilePatterns(patterns: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const p of patterns) {
    if (!p.trim()) continue;
    try {
      out.push(new RegExp(p));
    } catch {
      // skip invalid
    }
  }
  return out;
}

export function isNoise(e: CapturedEvent, extra: RegExp[]): boolean {
  if (e.payloadType !== 'string') return false;
  if (e.size <= 4 && DEFAULT_NOISE.some((r) => r.test(e.payload))) return true;
  if (extra.length && extra.some((r) => r.test(e.payload))) return true;
  return false;
}
