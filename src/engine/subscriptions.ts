import type { Cents, PayMonth, Transaction } from '../domain/types'

export interface Subscription {
  payee: string
  monthly: Cents
  yearly: Cents
  lastDate: string
  months: number
}

const MIN_MONTHS = 3
const AMOUNT_TOLERANCE = 0.1
const DAY_TOLERANCE = 5

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/** Circular distance between days of month (31-day wrap, so 30th vs 2nd = 3). */
const dayGap = (a: number, b: number) => {
  const d = Math.abs(a - b)
  return Math.min(d, 31 - d)
}

const dayOf = (iso: string) => Number(iso.slice(8, 10))

function consistent(run: Transaction[]): boolean {
  const med = median(run.map(t => -t.amount))
  if (run.some(t => Math.abs(-t.amount - med) > med * AMOUNT_TOLERANCE)) return false
  const days = run.map(t => dayOf(t.date))
  return days.every(a => days.every(b => dayGap(a, b) <= DAY_TOLERANCE))
}

/**
 * Same payee (case-insensitive) as an expense in >= 3 consecutive entries of `months`
 * (newest first), amounts within 10% of the median, day-of-month within 5 days.
 * If a payee has several charges in one pay month, the earliest is used.
 */
export function detectSubscriptions(txs: Transaction[], months: PayMonth[], dismissed: string[]): Subscription[] {
  const skip = new Set(dismissed.map(p => p.toLowerCase()))
  // payee key -> per-month-index earliest expense
  const byPayee = new Map<string, Map<number, Transaction>>()
  for (const t of txs) {
    if (t.kind !== 'expense' || t.amount >= 0) continue
    const key = t.payee.toLowerCase()
    if (skip.has(key)) continue
    const idx = months.findIndex(m => t.date >= m.start && t.date <= m.end)
    if (idx < 0) continue
    const perMonth = byPayee.get(key) ?? new Map<number, Transaction>()
    const existing = perMonth.get(idx)
    if (!existing || t.date < existing.date) perMonth.set(idx, t)
    byPayee.set(key, perMonth)
  }

  const out: Subscription[] = []
  for (const perMonth of byPayee.values()) {
    // Most recent qualifying run: start at the newest month and grow into older ones.
    for (let start = 0; start < months.length; start++) {
      const first = perMonth.get(start)
      if (!first) continue
      let run = [first]
      for (let j = start + 1; perMonth.has(j) && consistent([...run, perMonth.get(j)!]); j++) {
        run = [...run, perMonth.get(j)!]
      }
      if (run.length >= MIN_MONTHS) {
        const monthly = median(run.map(t => -t.amount))
        out.push({ payee: first.payee, monthly, yearly: monthly * 12, lastDate: first.date, months: run.length })
        break
      }
    }
  }
  return out.sort((a, b) => b.yearly - a.yearly || a.payee.localeCompare(b.payee))
}
