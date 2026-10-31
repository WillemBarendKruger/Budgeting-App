import type { TextItem } from '../domain/types'

export interface Line { page: number; y: number; items: TextItem[] }
export interface Column { label: string; x0: number; x1: number }

/** Group items into visual lines: by page, then y descending (pdf y grows upward); items sorted by x. */
export function groupLines(items: TextItem[], yTolerance = 2): Line[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y)
  const lines: Line[] = []
  for (const it of sorted) {
    const cur = lines[lines.length - 1]
    if (cur && cur.page === it.page && Math.abs(cur.y - it.y) <= yTolerance) cur.items.push(it)
    else lines.push({ page: it.page, y: it.y, items: [it] })
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x)
  return lines
}

export const lineText = (l: Line): string => l.items.map((i) => i.str).join(' ')

// A label is "much narrower" than its neighbour at this width ratio.
const NARROW_RATIO = 1.5

/**
 * Column boundary between adjacent header labels a (left) and b (right).
 * Labels are centred over their columns, so by default the gap between them is split evenly.
 * When one label is much narrower than the other, its column is assumed to hug it
 * (e.g. a short "Date" next to left-aligned "Description" text, or a numeric column next to a wide
 * description column), so the boundary sits on the narrower label's inner edge instead.
 */
function boundary(a: TextItem, b: TextItem): number {
  const aRight = a.x + a.width
  if (a.width * NARROW_RATIO <= b.width) return aRight
  if (b.width * NARROW_RATIO <= a.width) return b.x
  return (aRight + b.x) / 2
}

/** Find the first line at or after `from` that has an item for every label; derive contiguous column spans. */
export function findHeader(
  lines: Line[],
  labels: string[],
  from = 0,
): { index: number; columns: Column[] } | undefined {
  for (let index = from; index < lines.length; index++) {
    const found: TextItem[] = []
    for (const label of labels) {
      const it = lines[index].items.find((i) => i.str.trim() === label)
      if (!it) break
      found.push(it)
    }
    if (found.length !== labels.length) continue
    found.sort((a, b) => a.x - b.x)
    const columns = found.map((it, i): Column => ({
      label: it.str.trim(),
      x0: i === 0 ? 0 : boundary(found[i - 1], it),
      x1: i === found.length - 1 ? Infinity : boundary(it, found[i + 1]),
    }))
    return { index, columns }
  }
  return undefined
}

const NUMERIC = /^[R\s]*-?[\d,\s]*\.?\d+\s*(Cr|Dr)?$/i

function pickColumn(it: TextItem, columns: Column[]): Column {
  const left = it.x
  const right = it.x + it.width
  let best: Column | undefined
  let bestOverlap = 0
  for (const c of columns) {
    const overlap = Math.min(right, c.x1) - Math.max(left, c.x0)
    if (overlap > bestOverlap) { best = c; bestOverlap = overlap }
  }
  if (best) return best

  // No overlap: numbers are right-aligned, so compare right edges; otherwise use the horizontal gap.
  const isNumber = NUMERIC.test(it.str.trim())
  const distance = (c: Column) =>
    isNumber ? Math.abs(right - c.x1) : Math.max(c.x0 - right, left - c.x1, 0)
  return columns.reduce((a, b) => (distance(b) < distance(a) ? b : a))
}

/** Map a line's items to header columns (most overlap wins); items in one column are joined by a space. */
export function assignColumns(line: Line, columns: Column[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const it of line.items) {
    const { label } = pickColumn(it, columns)
    out[label] = label in out ? `${out[label]} ${it.str}` : it.str
  }
  return out
}
