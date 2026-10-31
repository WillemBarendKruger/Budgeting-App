import { describe, expect, it } from 'vitest'
import { fnbHeader, right, row } from '../../tests/fixtures/textItems'
import { checkBalances } from './check'
import { parseFnb } from './fnb'

const bottom = (page: number) => [
  ...row(page, 40, [[12, `Page ${page} of 2`]]),
  ...row(page, 30, [[12, 'Branch Number'], [100, 'Account Number'], [200, 'Date']]),
  ...row(page, 20, [[12, '250'], [100, '62000001234'], [200, '2026/02/19']]),
]

const title = (page: number) => [
  ...row(page, 800, [[12, 'Transactions in RAND (ZAR) : 62000001234']]),
]

// Amount right edge 482, balance 545, accrued charges 582; description left 37, card ref x 311.
const tx = (
  page: number, y: number, date: string, desc: string | undefined, amt: string, bal: string,
  extra: { ref?: string; accrued?: string } = {},
) =>
  row(page, y, [
    [12, date],
    ...(desc ? [[37, desc] as [number, string]] : []),
    ...(extra.ref ? [[311, extra.ref] as [number, string]] : []),
    right(482, amt),
    right(545, bal),
    ...(extra.accrued ? [right(582, extra.accrued)] : []),
  ])

const page1Top = [
  ...row(1, 820, [[12, 'Gold Cheque Account : 62000001234'], [300, 'Statement Period : 20 November 2026 to 19 February 2027']]),
  ...row(1, 806, [[300, 'Statement Date : 19 February 2027']]),
  ...row(1, 780, [[300, 'Statement Balances']]),
  ...row(1, 768, [[300, 'Opening Balance'], right(545, '100.00Cr')]),
  ...row(1, 756, [[300, 'Closing Balance'], right(545, '169.63Cr')]),
  ...row(1, 740, [[300, 'Bank Charges']]),
  ...row(1, 728, [[300, 'Service Fees'], right(545, '124.77Dr')]),
  ...row(1, 716, [[300, 'Total VAT'], right(545, '16.25Dr')]),
  ...row(1, 704, [[300, 'Interest Rate'], right(545, '0.00%')]),
]

const turnover = (credits: number) => [
  ...row(2, 560, [[12, 'Closing Balance'], right(545, '169.63Cr')]),
  ...row(2, 548, [[12, 'Turnover for Statement Period']]),
  ...row(2, 536, [[12, 'No. Credit Transactions'], [250, String(credits)], right(545, '200.00Cr')]),
  ...row(2, 524, [[12, 'No. Debit Transactions'], [250, '3'], right(545, '130.37Dr')]),
]

const build = (credits = 1) => [
  ...page1Top,
  ...fnbHeader(1, 680),
  ...row(1, 690, [[558, 'Accrued']]),
  ...row(1, 670, [[558, 'Charges']]),
  ...tx(1, 650, '28 Dec', 'POS Purchase Shop A', '50.00', '50.00Cr'),
  ...tx(1, 636, '02 Jan', 'Card Purchase Shop B', '80.00', '30.00', { ref: '654321*0987 31 Dec' }),
  ...bottom(1),
  ...title(2),
  ...row(2, 790, [[300, 'FNB Verified Statement 31/10/2026']]),
  ...row(2, 778, [[300, 'Reference Number: 000000']]),
  ...row(2, 766, [[300, 'To verify this statement visit example.test']]),
  ...fnbHeader(2, 740),
  ...tx(2, 720, '03 Jan', 'Salary Example Co', '200.00Cr', '170.00Cr', { accrued: '3.50' }),
  ...tx(2, 706, '04 Jan', undefined, '0.37', '169.63Cr'),
  ...turnover(credits),
  ...bottom(2),
]

describe('parseFnb', () => {
  const st = parseFnb(build())
  const acc = st.accounts[0]

  it('reads period, account, balances', () => {
    expect(st.bank).toBe('fnb')
    expect([st.periodStart, st.periodEnd]).toEqual(['2026-11-20', '2027-02-19'])
    expect(st.accounts).toHaveLength(1)
    expect([acc.typeLabel, acc.last4, acc.role]).toEqual(['Gold Cheque Account', '1234', 'everyday'])
    expect([acc.openingBalance, acc.closingBalance]).toEqual([10000, 16963])
  })

  it('parses only transaction rows (boxes, stamp, footers are not rows)', () => {
    expect(acc.rows).toHaveLength(4)
  })

  it('resolves posted date and debit amount', () => {
    expect(acc.rows[0]).toMatchObject({ postedDate: '2026-12-28', date: '2026-12-28', amount: -5000, balance: 5000, description: 'POS Purchase Shop A' })
  })

  it('uses the card ref date as purchase date and strips the ref; no Cr on balance is overdrawn', () => {
    expect(acc.rows[1]).toMatchObject({ postedDate: '2027-01-02', date: '2026-12-31', amount: -8000, balance: -3000, description: 'Card Purchase Shop B' })
  })

  it('treats Cr as credit and ignores accrued charges', () => {
    expect(acc.rows[2]).toMatchObject({ amount: 20000, balance: 17000 })
  })

  it('flags a missing description', () => {
    expect(acc.rows[3]).toMatchObject({ description: 'Unknown (FNB)', amount: -37, balance: 16963 })
    expect(acc.rows[3].warnings).toContain('missing-description')
  })

  it('passes the balance check and has no statement warnings when turnover matches', () => {
    expect(checkBalances(acc).ok).toBe(true)
    expect(st.warnings).toEqual([])
  })

  it('warns when turnover counts differ', () => {
    const bad = parseFnb(build(4))
    expect(bad.warnings.some((w) => w.startsWith('turnover-mismatch'))).toBe(true)
  })

  it('warns when turnover totals differ', () => {
    const items = build().map((i) => (i.str === '130.37Dr' ? { ...i, str: '131.37Dr' } : i))
    expect(parseFnb(items).warnings.some((w) => w.startsWith('turnover-mismatch'))).toBe(true)
  })

  it('accepts Cr as a separate item and merges wrapped description lines', () => {
    const items = [
      ...page1Top,
      ...fnbHeader(1, 680),
      ...row(1, 650, [[12, '28 Dec'], [37, 'Long description'], right(482, '50.00'), right(486, 'Cr'), right(545, '50.00'), right(550, 'Cr')]),
      ...row(1, 640, [[37, 'continued here']]),
      ...row(1, 628, [[12, '29 Dec'], [37, 'Next'], right(482, '5.00'), right(545, '45.00'), right(550, 'Cr')]),
    ]
    const r = parseFnb(items).accounts[0].rows
    expect(r[0].description).toBe('Long description continued here')
    expect(r[0].amount).toBe(5000)
    expect(r[0].balance).toBe(5000)
    expect(r[1]).toMatchObject({ amount: -500, balance: 4500 })
  })

  it('warns instead of dropping unexpected input', () => {
    const noHeader = parseFnb([...page1Top, ...tx(1, 650, '28 Dec', 'X', '1.00', '99.00Cr')])
    expect(noHeader.accounts[0].rows).toHaveLength(0)
    expect(noHeader.warnings.length).toBeGreaterThan(0)
    const noPeriod = parseFnb([...row(1, 820, [[12, 'Gold Cheque Account : 62000001234']]), ...fnbHeader(1, 680), ...tx(1, 650, '28 Dec', 'X', '1.00', '99.00Cr')])
    expect(noPeriod.warnings.join('|')).toMatch(/period/i)
    expect(parseFnb([]).warnings.join('|')).toMatch(/account/i)
  })

  const withHeader = (hdr: ReturnType<typeof fnbHeader>) => [
    ...page1Top,
    ...hdr,
    ...tx(1, 650, '28 Dec', 'Shop', '50.00', '50.00Cr', { accrued: '3.50' }),
  ]
  const noBank = fnbHeader(1, 680).filter((i) => i.str !== 'Bank')

  it('ignores accrued charges when the header has no Bank item', () => {
    const r = parseFnb(withHeader(noBank)).accounts[0].rows
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ amount: -5000, balance: 5000, description: 'Shop' })
  })

  it('ignores accrued charges with a single "Accrued Bank Charges" header item', () => {
    const hdr = [...noBank, ...row(1, 680, [[540, 'Accrued Bank Charges']])]
    const r = parseFnb(withHeader(hdr)).accounts[0].rows
    expect(r[0]).toMatchObject({ amount: -5000, balance: 5000 })
  })

  it('does not take an account from a transaction description', () => {
    const items = [
      ...build(),
      ...tx(2, 690, '05 Jan', 'Transfer Other Account : 99887766', '1.00', '168.63Cr'),
    ]
    const st2 = parseFnb(items)
    expect(st2.accounts[0].last4).toBe('1234')
    expect(st2.warnings.join('|')).not.toMatch(/Second account/)
  })
})
