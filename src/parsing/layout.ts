import type { TextItem } from '../domain/types'

export interface Line { page: number; y: number; items: TextItem[] }
/** `centre` is the header label's centre (before boundaries are derived); numbers are matched against it. */
export interface Column { label: string; x0: number; x1: number; centre: number }

/** Group items into visual lines: by page, then y descending (pdf y grows upward); items sorted by x. */
export function groupLines(items: TextItem[], yTolerance = 2): Line[] {
  // pdf.js emits whitespace-only items; they are never cells.
  const sorted = items.filter((i) => i.str.trim() !== '').sort((a, b) => a.page - b.page || b.y - a.y)
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
      centre: it.x + it.width / 2,
      x0: i === 0 ? 0 : boundary(found[i - 1], it),
      x1: i === found.length - 1 ? Infinity : boundary(it, found[i + 1]),
    }))
    return { index, columns }
  }
  return undefined
}

// Money-shaped only: optional sign/'R', digits (optional thousands separators), a decimal point with
// exactly 2 digits, optional Cr/Dr/'-'. Bare integers (references, years) are text.
const NUMERIC = /^-?(R\s*)?-?(\d{1,3}(,\d{3})+|\d+)\.\d{2}\s*(Cr|Dr|-)?$/i
// A currency marker emitted as its own item, belonging to the amount that follows it.
const CURRENCY_TOKEN = /^-?R-?$/

const isNumeric = (it: TextItem) => NUMERIC.test(it.str.trim())

/** Text: most horizontal overlap with a column span, else the smallest gap. */
function pickTextColumn(it: TextItem, columns: Column[]): Column {
  const left = it.x
  const right = it.x + it.width
  let best: Column | undefined
  let bestOverlap = 0
  for (const c of columns) {
    const overlap = Math.min(right, c.x1) - Math.max(left, c.x0)
    if (overlap > bestOverlap) { best = c; bestOverlap = overlap }
  }
  if (best) return best
  const gap = (c: Column) => Math.max(c.x0 - right, left - c.x1, 0)
  return columns.reduce((a, b) => (gap(b) < gap(a) ? b : a))
}

/** Numbers are right-aligned, so spans are unreliable; use the column whose header centre is nearest. */
function pickNumericColumn(it: TextItem, columns: Column[]): Column {
  const c = it.x + it.width / 2
  return columns.reduce((a, b) => (Math.abs(b.centre - c) < Math.abs(a.centre - c) ? b : a))
}

/**
 * Map a line's items to header columns; items in one column are joined by a space.
 * Numeric items use the nearest header centre, other items use span overlap, and a standalone
 * currency marker ('R', '-R', 'R-') follows the next numeric item on the line.
 */
export function assignColumns(line: Line, columns: Column[]): Record<string, string> {
  const out: Record<string, string> = {}
  const add = (label: string, str: string) => { out[label] = label in out ? `${out[label]} ${str}` : str }
  let pending: TextItem[] = []
  const flush = () => {
    for (const p of pending) add(pickTextColumn(p, columns).label, p.str)
    pending = []
  }
  for (const it of line.items) {
    if (CURRENCY_TOKEN.test(it.str.trim())) { pending.push(it); continue }
    if (isNumeric(it)) {
      const { label } = pickNumericColumn(it, columns)
      for (const p of pending) add(label, p.str)
      pending = []
      add(label, it.str)
    } else {
      flush()
      add(pickTextColumn(it, columns).label, it.str)
    }
  }
  flush()
  return out
}

export interface PageTable { page: number; lines: Line[]; header?: { index: number; columns: Column[] }; columns?: Column[] }

/**
 * Walk pages in order, finding each page's table header. `columns` is the page's own header columns, or
 * the most recent header's columns on continuation pages (undefined until a header has been seen).
 * `adjust` may refine a header's columns using the page's lines.
 */
export function* pageTables(
  lines: Line[],
  labels: string[],
  adjust?: (columns: Column[], headerLine: Line, pageLines: Line[]) => Column[],
): Generator<PageTable> {
  let lastColumns: Column[] | undefined
  for (const page of new Set(lines.map((l) => l.page))) {
    const pageLines = lines.filter((l) => l.page === page)
    const found = findHeader(pageLines, labels)
    const header = found && adjust
      ? { index: found.index, columns: adjust(found.columns, pageLines[found.index], pageLines) }
      : found
    if (header) lastColumns = header.columns
    yield { page, lines: pageLines, header, columns: header?.columns ?? lastColumns }
  }
}

/** A wrapped description sits this close (in points) under its row; footers are far below. */
export const WRAP_MAX_GAP = 20

/**
 * If `line` continues the previous row's description (only Description-column text, starting inside that
 * column, on the same page right under the row) return that text, else undefined.
 */
export function wrapContinuation(
  line: Line,
  columns: Column[],
  last: { page: number; y: number } | undefined,
): string | undefined {
  const descCol = columns.find((c) => c.label === 'Description')
  if (!last || !descCol || last.page !== line.page || last.y - line.y > WRAP_MAX_GAP) return undefined
  if (line.items[0].x < descCol.x0 - 2) return undefined
  const cells = assignColumns(line, columns)
  return Object.keys(cells).length === 1 && cells.Description ? cells.Description.trim() : undefined
}
