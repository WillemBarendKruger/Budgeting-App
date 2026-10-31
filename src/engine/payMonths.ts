import type { PayMonth, Settings, Transaction } from '../domain/types'
import { addDays, daysBetween } from '../domain/dates'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MIN_SPACING_DAYS = 10
const MAX_GAP_DAYS = 40

const parts = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m, d }
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function paydayIn(y: number, m: number, payday: number): string {
  const d = Math.min(payday, daysInMonth(y, m))
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** All fallback paydays from the latest one on/before `from` through `to` (inclusive). */
function fallbackDates(from: string, to: string, payday: number): string[] {
  const f = parts(from)
  let y = f.y
  let m = f.m
  if (paydayIn(y, m, payday) > from) {
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
  }
  const out: string[] = []
  for (;;) {
    const d = paydayIn(y, m, payday)
    if (d > to) break
    out.push(d)
    m += 1
    if (m === 13) { m = 1; y += 1 }
  }
  return out
}

function collapse(sorted: string[]): string[] {
  const out: string[] = []
  for (const d of sorted) {
    if (out.length === 0 || daysBetween(out[out.length - 1], d) >= MIN_SPACING_DAYS) out.push(d)
  }
  return out
}

function fmt(iso: string, withYear: boolean): string {
  const { y, m, d } = parts(iso)
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`
}

function label(start: string, end: string): string {
  const spans = start.slice(0, 4) !== end.slice(0, 4)
  return `${fmt(start, spans)} – ${fmt(end, spans)}`
}

export function payMonths(txs: Transaction[], s: Settings, today: string): PayMonth[] {
  if (txs.length === 0) return []
  const pattern = s.salaryPattern?.trim().toLowerCase()
  const salary = pattern
    ? collapse(
        [...new Set(
          txs.filter(t => t.kind === 'income' && t.payee.toLowerCase().includes(pattern)).map(t => t.date),
        )].sort(),
      )
    : []

  let earliest = txs[0].date
  let latest = txs[0].date
  for (const t of txs) {
    if (t.date < earliest) earliest = t.date
    if (t.date > latest) latest = t.date
  }
  const candidates = fallbackDates(earliest, latest, s.fallbackPayday)
  const fills = candidates.filter(c => {
    if (salary.length === 0) return true
    if (salary.some(d => Math.abs(daysBetween(d, c)) < MIN_SPACING_DAYS)) return false
    const first = salary[0]
    const last = salary[salary.length - 1]
    if (c < first) return earliest < first
    if (c > last) return daysBetween(last, latest) > MAX_GAP_DAYS
    const prev = [...salary].reverse().find(d => d < c)!
    const next = salary.find(d => d > c)!
    return daysBetween(prev, next) > MAX_GAP_DAYS
  })

  const starts = [...new Set([...salary, ...fills])].sort()
  // Coverage invariant: the earliest tx must fall inside a month.
  if (earliest < starts[0]) starts.unshift(candidates[0])
  const end = today > latest ? today : latest
  const months = starts.map((start, i) => {
    const next = starts[i + 1]
    const e = next ? addDays(next, -1) : end
    return { start, end: e, label: label(start, e) }
  })
  return months.reverse()
}

export function payMonthFor(date: string, months: PayMonth[]): PayMonth | undefined {
  return months.find(m => date >= m.start && date <= m.end)
}

/** Payee of the largest income tx whose payee recurs as income in at least 2 calendar months. */
export function suggestSalaryPattern(txs: Transaction[]): string | undefined {
  const monthsByPayee = new Map<string, Set<string>>()
  for (const t of txs) {
    if (t.kind !== 'income') continue
    const set = monthsByPayee.get(t.payee) ?? new Set<string>()
    set.add(t.date.slice(0, 7))
    monthsByPayee.set(t.payee, set)
  }
  let best: Transaction | undefined
  for (const t of txs) {
    if (t.kind !== 'income' || (monthsByPayee.get(t.payee)?.size ?? 0) < 2) continue
    if (!best || t.amount > best.amount) best = t
  }
  return best?.payee
}
