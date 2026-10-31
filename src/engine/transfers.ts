import type { Transaction } from '../domain/types';
import { daysBetween } from '../domain/dates';
import { safeRegex } from './rules';

const MAX_DAYS = 3;

export function matchesTransferPattern(description: string, patterns: string[]): boolean {
  return patterns.some((p) => safeRegex(p)?.test(description) ?? false);
}

/** Pairs own-account transfers (txId -> partner txId). Closest date first; each tx pairs at most once. */
export function pairTransfers(txs: Transaction[], patterns: string[]): Map<string, string> {
  const flagged = txs.map((t) => matchesTransferPattern(t.description, patterns));
  const candidates: { i: number; j: number; gap: number }[] = [];
  for (let i = 0; i < txs.length; i++) {
    for (let j = i + 1; j < txs.length; j++) {
      const a = txs[i];
      const b = txs[j];
      if (a.accountId === b.accountId) continue;
      if (a.amount === 0 || a.amount !== -b.amount) continue;
      if (!flagged[i] && !flagged[j]) continue;
      const gap = Math.abs(daysBetween(a.date, b.date));
      if (gap > MAX_DAYS) continue;
      candidates.push({ i, j, gap });
    }
  }
  candidates.sort((x, y) => x.gap - y.gap || x.i - y.i || x.j - y.j);
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
