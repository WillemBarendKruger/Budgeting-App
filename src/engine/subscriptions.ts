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

/** Group charges into amount clusters: a charge joins the current cluster when within 10% of its median. */
function clusterByAmount(charges: Transaction[]): Transaction[][] {
  const sorted = [...charges].sort((a, b) => a.amount - b.amount || a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const clusters: Transaction[][] = []
  for (const t of sorted) {
    const last = clusters[clusters.length - 1]
    if (last) {
      const med = median(last.map(c => -c.amount))
      if (Math.abs(-t.amount - med) <= med * AMOUNT_TOLERANCE) {
        last.push(t)
        continue
      }
    }
    clusters.push([t])
  }
  return clusters
}

/**
 * Same payee (case-insensitive) as an expense in >= 3 consecutive entries of `months`
 * (newest first), amounts within 10% of the median, day-of-month within 5 days.
 * A payee's charges are first clustered by amount so one-off purchases do not hide a
 * recurring charge; each cluster keeps one charge per pay month (closest to the cluster
 * median, ties to the earlier date). A payee can yield several subscriptions.
 * A price rise starts a new cluster, so the older price is reported until the new one has 3 months.
 */
export function detectSubscriptions(txs: Transaction[], months: PayMonth[], dismissed: string[]): Subscription[] {
  const skip = new Set(dismissed.map(p => p.toLowerCase()))
  const byPayee = new Map<string, Transaction[]>()
  for (const t of txs) {
    if (t.kind !== 'expense' || t.amount >= 0) continue
    const key = t.payee.trim().toLowerCase()
    if (!key || skip.has(key)) continue
    byPayee.set(key, [...(byPayee.get(key) ?? []), t])
  }

  const out: Subscription[] = []
  for (const charges of byPayee.values()) {
    for (const cluster of clusterByAmount(charges)) {
      const med = median(cluster.map(t => -t.amount))
      const perMonth = new Map<number, Transaction>()
      for (const t of cluster) {
        const idx = months.findIndex(m => t.date >= m.start && t.date <= m.end)
        if (idx < 0) continue
        const cur = perMonth.get(idx)
        const dist = Math.abs(-t.amount - med)
        const curDist = cur ? Math.abs(-cur.amount - med) : Infinity
        if (dist < curDist || (dist === curDist && cur && t.date < cur.date)) perMonth.set(idx, t)
      }
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
  }
  return out.sort((a, b) => b.yearly - a.yearly || a.payee.localeCompare(b.payee))
}
