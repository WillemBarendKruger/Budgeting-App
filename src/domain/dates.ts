const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAY_MS = 86_400_000

function monthIndex(name: string): number {
  const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase())
  if (i < 0) throw new Error(`Unknown month: "${name}"`)
  return i
}

function toIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function toUtcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function addDays(iso: string, n: number): string {
  const d = new Date(toUtcMs(iso) + n * DAY_MS)
  return toIso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Whole days from a to b (negative if b is before a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS)
}

/** Parse "6 June 2026 to 7 September 2026" (anywhere in the text) into ISO dates. */
export function parseFnbPeriod(text: string): { start: string; end: string } {
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+to\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text)
  if (!m) throw new Error(`Cannot find statement period in: "${text}"`)
  return {
    start: toIso(Number(m[3]), monthIndex(m[2]), Number(m[1])),
    end: toIso(Number(m[6]), monthIndex(m[5]), Number(m[4])),
  }
}

function parseDayMonth(dm: string): { day: number; month: number } {
  const m = /^\s*(\d{1,2})\s+([A-Za-z]{3,})\s*$/.exec(dm)
  if (!m) throw new Error(`Cannot parse day/month: "${dm}"`)
  return { day: Number(m[1]), month: monthIndex(m[2]) }
}

/** Resolve "08 Jun" to an ISO date whose year puts it within the period ±7 days. */
export function resolveDayMonth(dm: string, period: { start: string; end: string }): string {
  const { day, month } = parseDayMonth(dm)
  const lo = addDays(period.start, -7)
  const hi = addDays(period.end, 7)
  const startYear = Number(period.start.slice(0, 4))
  const endYear = Number(period.end.slice(0, 4))
  for (let y = startYear - 1; y <= endYear + 1; y++) {
    const iso = toIso(y, month, day)
    if (iso >= lo && iso <= hi) return iso
  }
  throw new Error(`"${dm}" is outside statement period ${period.start} to ${period.end}`)
}

/** Purchase date from a card ref: posted year, or the year before if that lands after posting. */
export function resolvePurchaseDate(dm: string, postedDate: string): string {
  const { day, month } = parseDayMonth(dm)
  const year = Number(postedDate.slice(0, 4))
  const iso = toIso(year, month, day)
  return iso > postedDate ? toIso(year - 1, month, day) : iso
}
