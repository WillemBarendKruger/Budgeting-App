import { describe, expect, it } from 'vitest'
import { discoveryHeader, fnbHeader, header, right, row } from '../../tests/fixtures/textItems'
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
      row(1, 680, [[53, '12 Jun'], [120, 'Invented Cafe'], [386, 'R'], right(427, '1,234.56'), right(545, '9,000.00')]),
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

describe('assignColumns fallback (no overlap)', () => {
  const columns = [
    { label: 'A', x0: 0, x1: 100 },
    { label: 'B', x0: 200, x1: 300 },
  ]

  it('uses the smallest horizontal gap for text', () => {
    const line = groupLines(header(1, 10, [[130, 'xx']]))[0] // 125..135: gap 25 to A, 65 to B
    expect(assignColumns(line, columns)).toEqual({ A: 'xx' })
  })

  it('compares right edges for numbers', () => {
    // 150..190: text would go to B (gap 10 vs 50), but a number's right edge (190) is nearer A.x1 (100) than B.x1 (300)
    const num = groupLines(row(1, 10, [[150, '1,000.00', 40]]))[0]
    expect(assignColumns(num, columns)).toEqual({ A: '1,000.00' })
    const text = groupLines(row(1, 10, [[150, 'abcdefgh', 40]]))[0]
    expect(assignColumns(text, columns)).toEqual({ B: 'abcdefgh' })
  })
})
