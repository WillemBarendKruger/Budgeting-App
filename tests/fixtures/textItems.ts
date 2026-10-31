import type { TextItem } from '../../src/domain/types'

/** Approximate glyph width in points, used when a cell gives no explicit width. */
export const CHAR_WIDTH = 4.5

/** A cell: left x, text, optional width (estimated from text length when omitted). */
export type Cell = [x: number, str: string, width?: number]

export const estimateWidth = (str: string): number => str.length * CHAR_WIDTH

/** Right-aligned cell: `rightEdge` is where the text ends (pdf.js x = left edge, so x is derived). */
export function right(rightEdge: number, str: string, width = estimateWidth(str)): Cell {
  return [rightEdge - width, str, width]
}

/** A table row of text items sharing one baseline `y`. */
export function row(page: number, y: number, cells: Cell[]): TextItem[] {
  return cells.map(([x, str, width]) => ({ str, x, y, width: width ?? estimateWidth(str), page }))
}

/** A header row: labels are centred over their columns, so each cell gives the label's centre x. */
export function header(page: number, y: number, centred: [centreX: number, label: string][]): TextItem[] {
  return row(
    page,
    y,
    centred.map(([cx, label]): Cell => {
      const w = estimateWidth(label)
      return [cx - w / 2, label, w]
    }),
  )
}

/** Header geometry approximating a rendered FNB statement (A4, 595pt wide). 'Bank' is on the label line. */
export const fnbHeader = (page: number, y: number): TextItem[] =>
  header(page, y, [[29, 'Date'], [228, 'Description'], [455, 'Amount'], [515, 'Balance'], [558, 'Bank']])

/** Header geometry approximating a rendered Discovery statement. */
export const discoveryHeader = (page: number, y: number): TextItem[] =>
  header(page, y, [[84.5, 'Date'], [241.5, 'Description'], [397, 'Debit'], [453.5, 'Credit'], [512.5, 'Balance']])
