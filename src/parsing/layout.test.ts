import { describe, expect, it } from 'vitest'
import { discoveryHeader, fnbHeader, right, row } from '../../tests/fixtures/textItems'
import { assignColumns, findHeader, groupLines, lineText } from './layout'

const FNB_LABELS = ['Date', 'Description', 'Amount', 'Balance', 'Bank']
const DISC_LABELS = ['Date', 'Description', 'Debit', 'Credit', 'Balance']

describe('groupLines', () => {
  it('groups items whose y differs within tolerance into one line, sorted by x', () => {
    const items = [
      ...row(1, 700.4, [[100, 'World']]),
      ...row(1, 699.1, [[20, 'Hello']]),
    ]
    const lines = groupLines(items)
    expect(lines).toHaveLength(1)
    expect(lineText(lines[0])).toBe('Hello World')
  })

  it('sorts by page then y descending, and never merges across pages', () => {
    const items = [
      ...row(2, 700, [[10, 'p2']]),
      ...row(1, 500, [[10, 'low']]),
      ...row(1, 700, [[10, 'high']]),
    ]
    expect(groupLines(items).map(lineText)).toEqual(['high', 'low', 'p2'])
  })

  it('splits lines further apart than the tolerance', () => {
    const lines = groupLines([...row(1, 700, [[10, 'a']]), ...row(1, 696, [[10, 'b']])])
    expect(lines).toHaveLength(2)
  })
})

describe('findHeader', () => {
  it('finds the header line containing all labels and derives contiguous column spans', () => {
    const lines = groupLines([...row(1, 800, [[10, 'Statement']]), ...fnbHeader(1, 700)])
    const found = findHeader(lines, FNB_LABELS)!
    expect(found.index).toBe(1)
    expect(found.columns.map((c) => c.label)).toEqual(FNB_LABELS)
    expect(found.columns[0].x0).toBe(0)
    expect(found.columns[4].x1).toBe(Infinity)
    for (let i = 1; i < found.columns.length; i++) {
      expect(found.columns[i].x0).toBe(found.columns[i - 1].x1)
    }
  })

  it('returns undefined when a label is missing, and respects `from`', () => {
    const lines = groupLines(fnbHeader(1, 700))
    expect(findHeader(lines, ['Date', 'Nope'])).toBeUndefined()
    expect(findHeader(lines, FNB_LABELS, 1)).toBeUndefined()
  })
})

describe('assignColumns (FNB geometry)', () => {
  const columns = findHeader(groupLines(fnbHeader(1, 700)), FNB_LABELS)!.columns

  it('maps date, description, amount and balance; card-ref text stays in Description', () => {
    const line = groupLines(
      row(1, 680, [
        [12, '08 Jun'],
        [37, 'POS Purchase Shop'],
        [311, '123456*7890 05 Jun'],
        right(482, '245.39'),
        right(545, '5,071.04Cr'),
      ]),
    )[0]
    expect(assignColumns(line, columns)).toEqual({
      Date: '08 Jun',
      Description: 'POS Purchase Shop 123456*7890 05 Jun',
      Amount: '245.39',
      Balance: '5,071.04Cr',
    })
  })

  it('omits empty columns and keeps a short balance out of the Bank column', () => {
    const line = groupLines(row(1, 680, [[12, '09 Jun'], [37, 'Fee'], right(482, '9.00'), right(545, '9.00Cr')]))[0]
    const cells = assignColumns(line, columns)
    expect(cells.Balance).toBe('9.00Cr')
    expect(cells.Bank).toBeUndefined()
  })
})

describe('assignColumns (Discovery geometry)', () => {
  const columns = findHeader(groupLines(discoveryHeader(1, 700)), DISC_LABELS)!.columns

  it('places debit and credit amounts, joining a split R + number', () => {
    const debit = groupLines(
      row(1, 680, [[53, '12 Jun'], [120, 'Invented Cafe'], [383, 'R'], right(427, '1,234.56'), right(545, '9,000.00')]),
    )[0]
    expect(assignColumns(debit, columns)).toEqual({
      Date: '12 Jun',
      Description: 'Invented Cafe',
      Debit: 'R 1,234.56',
      Balance: '9,000.00',
    })

    const credit = groupLines(row(1, 660, [[53, '13 Jun'], [120, 'Refund'], right(480, 'R 50.00'), right(545, '9,050.00')]))[0]
    const cells = assignColumns(credit, columns)
    expect(cells.Credit).toBe('R 50.00')
    expect(cells.Debit).toBeUndefined()
  })
})

describe('assignColumns fallback (no overlap, caller-supplied columns)', () => {
  const columns = [
    { label: 'A', x0: 0, x1: 100, centre: 50 },
    { label: 'B', x0: 200, x1: 300, centre: 250 },
  ]

  it('uses the smallest horizontal gap for text', () => {
    const line = groupLines(row(1, 10, [[150, 'abcdefgh', 40]]))[0] // gap 10 to B, 50 to A
    expect(assignColumns(line, columns)).toEqual({ B: 'abcdefgh' })
  })

  it('uses the nearest header centre for numbers', () => {
    const line = groupLines(row(1, 10, [[150, '1,000.00', 40]]))[0] // centre 170: 120 from A, 80 from B
    expect(assignColumns(line, columns)).toEqual({ B: '1,000.00' })
  })
})

describe('numeric placement tolerates misaligned amounts', () => {
  const fnb = findHeader(groupLines(fnbHeader(1, 700)), FNB_LABELS)!.columns
  const disc = findHeader(groupLines(discoveryHeader(1, 700)), DISC_LABELS)!.columns
  const place = (cols: typeof fnb, edge: number, str: string) =>
    Object.entries(assignColumns(groupLines(row(1, 5, [right(edge, str)]))[0], cols))[0]

  it.each([-8, 0, 8])('FNB amount, balance and charges shifted by %d', (d) => {
    expect(place(fnb, 482 + d, '245.39')).toEqual(['Amount', '245.39'])
    expect(place(fnb, 545 + d, '5,071.04Cr')).toEqual(['Balance', '5,071.04Cr'])
    expect(place(fnb, 582 + d, '1.00')).toEqual(['Bank', '1.00'])
  })

  it.each([-8, 0, 8])('Discovery debit, credit and balance shifted by %d', (d) => {
    expect(place(disc, 427 + d, '1,234.56')).toEqual(['Debit', '1,234.56'])
    expect(place(disc, 480 + d, '50.00')).toEqual(['Credit', '50.00'])
    expect(place(disc, 545 + d, '9,000.00')).toEqual(['Balance', '9,000.00'])
  })

  it('places narrow and wide amounts', () => {
    expect(place(fnb, 482, '0.50')).toEqual(['Amount', '0.50'])
    expect(place(disc, 427, '12,345.67')).toEqual(['Debit', '12,345.67'])
  })

  it('accepts negative and trailing-minus forms', () => {
    expect(place(disc, 480, '-R 50.00')).toEqual(['Credit', '-R 50.00'])
    expect(place(disc, 480, 'R 50.00-')).toEqual(['Credit', 'R 50.00-'])
  })
})

describe('split currency token', () => {
  const disc = findHeader(groupLines(discoveryHeader(1, 700)), DISC_LABELS)!.columns

  it.each(['R', '-R', 'R-'])("attaches '%s' to the following wide amount, not Description", (tok) => {
    const amount = right(427, '12,345.67')
    const line = groupLines(
      row(1, 5, [[120, 'Invented Cafe'], [amount[0] - 8, tok], amount, right(545, '9,000.00')]),
    )[0]
    const cells = assignColumns(line, disc)
    expect(cells.Description).toBe('Invented Cafe')
    expect(cells.Debit).toBe(`${tok} 12,345.67`)
  })
})

describe('whitespace items', () => {
  it('are dropped by groupLines', () => {
    const items = [...row(1, 5, [[10, 'a'], [20, ' '], [30, 'b']]), ...row(1, 40, [[10, '  ']])]
    const lines = groupLines(items)
    expect(lines).toHaveLength(1)
    expect(lineText(lines[0])).toBe('a b')
  })
})

describe('integer references are text, not amounts', () => {
  const fnb = findHeader(groupLines(fnbHeader(1, 700)), FNB_LABELS)!.columns

  it.each(['34582316', '12345678901', '2024'])("'%s' at Description x stays in Description", (ref) => {
    const line = groupLines(row(1, 5, [[37, 'Prepaid Electricity'], [160, ref]]))[0]
    expect(assignColumns(line, fnb)).toEqual({ Description: `Prepaid Electricity ${ref}` })
  })

  it('accepts a trailing-minus amount with space', () => {
    const line = groupLines(row(1, 5, [right(482, 'R 188.01-')]))[0]
    expect(assignColumns(line, fnb)).toEqual({ Amount: 'R 188.01-' })
  })
})
