import type { Account, Cents, PayMonth, Transaction } from '../domain/types'
import { UNCATEGORISED } from '../domain/types'

export interface MonthSummary {
  in: Cents
  out: Cents
  saved: Cents
  unplanned: Cents
  movedToSavings: Cents
  uncategorisedCount: number
  byGroup: { groupId: string; amount: Cents }[]
}

/**
 * Summary for one pay month (membership by tx.date, inclusive).
 * A reimbursement reduces its target group's total; if that group has no expenses
 * in the month its total goes negative (kept, and it sorts last) and still reduces `out`.
 */
export function monthSummary(txs: Transaction[], accounts: Account[], m: PayMonth): MonthSummary {
  const savingsIds = new Set(accounts.filter(a => a.role === 'savings').map(a => a.id))
  const groups = new Map<string, Cents>()
  const add = (g: string, n: Cents) => groups.set(g, (groups.get(g) ?? 0) + n)
  let income = 0
  let unplanned = 0
  let moved = 0
  let uncategorisedCount = 0

  for (const t of txs) {
    if (t.date < m.start || t.date > m.end) continue
    switch (t.kind) {
      case 'income':
        income += t.amount
        break
      case 'expense': {
        const g = t.groupId ?? UNCATEGORISED
        add(g, -t.amount)
        if (g === UNCATEGORISED) uncategorisedCount++
        if (t.unplanned) unplanned -= t.amount
        break
      }
      case 'reimbursement':
        add(t.reimbursesGroupId ?? UNCATEGORISED, -t.amount)
        break
      case 'transfer':
        if (savingsIds.has(t.accountId)) moved += t.amount
        break
      case 'savings':
        moved -= t.amount
        break
    }
  }

  const byGroup = [...groups].map(([groupId, amount]) => ({ groupId, amount }))
    .sort((a, b) => b.amount - a.amount || a.groupId.localeCompare(b.groupId))
  const out = byGroup.reduce((s, g) => s + g.amount, 0)
  return { in: income, out, saved: income - out, unplanned, movedToSavings: moved, uncategorisedCount, byGroup }
}

export function groupChange(
  curr: MonthSummary,
  prev: MonthSummary | undefined,
  groupId: string,
): { pct: number | null; grew: boolean } {
  const c = curr.byGroup.find(g => g.groupId === groupId)?.amount ?? 0
  const p = prev?.byGroup.find(g => g.groupId === groupId)?.amount ?? 0
  if (!prev || p === 0) return { pct: null, grew: false }
  const pct = ((c - p) / p) * 100
  return { pct, grew: pct > 15 }
}
