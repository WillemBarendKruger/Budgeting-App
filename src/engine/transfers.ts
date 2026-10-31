import type { Transaction } from '../domain/types';
import { daysBetween } from '../domain/dates';
import { safeRegex } from './rules';

const MAX_DAYS = 3;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function matchesTransferPattern(description: string, patterns: string[]): boolean {
  return patterns.some((p) => safeRegex(p)?.test(description) ?? false);
}

/**
 * Pairs own-account transfers (txId -> partner txId). Each tx pairs at most once.
 * Ranking: pairs where BOTH sides are flagged first (so an unrecognised same-amount
 * payment to a person can't steal a card credit from the real card payment), then
 * closest date, then outflow id, then inflow id (deterministic).
 * `alsoFlagged` marks extra tx ids as flagged (e.g. a rule sets kind 'transfer').
 */
export function pairTransfers(txs: Transaction[], patterns: string[], alsoFlagged?: ReadonlySet<string>): Map<string, string> {
  const flagged = txs.map((t) => (alsoFlagged?.has(t.id) ?? false) || matchesTransferPattern(t.description, patterns));
  const candidates: { i: number; j: number; both: number; gap: number; outId: string; inId: string }[] = [];
  for (let i = 0; i < txs.length; i++) {
    for (let j = i + 1; j < txs.length; j++) {
      const a = txs[i];
      const b = txs[j];
      if (a.accountId === b.accountId) continue;
      if (a.amount === 0 || a.amount !== -b.amount) continue;
      if (!flagged[i] && !flagged[j]) continue;
      const gap = Math.abs(daysBetween(a.date, b.date));
      if (gap > MAX_DAYS) continue;
      const [o, n] = a.amount < 0 ? [a, b] : [b, a];
      candidates.push({ i, j, both: flagged[i] && flagged[j] ? 1 : 0, gap, outId: o.id, inId: n.id });
    }
  }
  candidates.sort((x, y) => y.both - x.both || x.gap - y.gap || cmp(x.outId, y.outId) || cmp(x.inId, y.inId));
  const used = new Set<number>();
  const result = new Map<string, string>();
  for (const { i, j } of candidates) {
    if (used.has(i) || used.has(j)) continue;
    used.add(i);
    used.add(j);
    result.set(txs[i].id, txs[j].id);
    result.set(txs[j].id, txs[i].id);
  }
  return result;
}
