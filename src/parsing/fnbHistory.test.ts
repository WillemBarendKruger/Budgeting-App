import { describe, expect, it } from 'vitest'
import { header, right, row } from '../../tests/fixtures/textItems'
import type { TextItem } from '../domain/types'
import { checkBalances } from './check'
import { parseStatement } from './detect'
import { parseFnbHistory } from './fnbHistory'

// Geometry from a rendered FNB app "Transaction History" PDF (A4). Fees right-align at 318,
// amounts at 433, balances at 559; dates at x 36, descriptions at x 114.
const tableHeader = (page: number) =>
  header(page, 572, [[48, 'Date'], [145, 'Description'], [288, 'Service Fee'], [413, 'Amount'], [538, 'Balance']])

const tx = (page: number, y: number, date: string, desc: string, fee: string, amt: string, bal: string) =>
  row(page, y, [[36, date], [114, desc], right(318, fee), right(433, amt), right(559, bal)])

const wrap = (page: number, y: number, text: string) => row(page, y, [[114, text]])

const footer = (page: number) => [
  ...row(page, 30, [[36, 'Printed 2026-11-03, 16:40'], [330, '© 2009 First National Bank a division of FirstRand Bank Limited.']]),
  ...row(page, 22, [[36, 'info@fnb.co.za']]),
]

const meta = [
  ...row(1, 716, [[36, 'Transaction History']]),
  ...row(1, 677, [[36, 'Nickname:'], [167, 'Easy Account']]),
  ...row(1, 660, [[36, 'Selected Account:'], [167, '62000001234']]),
  ...row(1, 644, [[36, 'Date:'], [167, '03 Nov 2026']]),
  ...row(1, 627, [[36, 'Available Balance:'], [170, '2,500.00 CR']]),
  ...row(1, 611, [[36, 'Current Balance:'], [170, '3,000.00 CR']]),
]

// Newest first, as FNB prints it. Opening balance 500.00; closing 3,000.00.
const build = (): TextItem[] => [
  ...meta,
  ...tableHeader(1),
  ...tx(1, 555, '03 Nov 2026', 'FNB APP TRANSFER', '0.00', '2,000.00 CR', '3,000.00 CR'),
  ...wrap(1, 539, 'FROM JANE'),
  ...tx(1, 522, '02 Nov 2026', 'SHOP A', '0.00', '-100.00 DR', '1,000.00 CR'),
  ...wrap(1, 506, '123456*7890 30 OCT'),
  ...tx(1, 489, '01 Nov 2026', 'RENT PAYMENT', '0.00', '-1,750.00 DR', '1,100.00 CR'),
  ...tx(1, 473, '31 Oct 2026', 'SHOP B', '0.00', '-50.00 DR', '2,850.00 CR'),
  ...footer(1),
  ...tableHeader(2),
  ...wrap(2, 565, '123456*7890 29 OCT'), // SHOP B's card ref, carried over the page break
  ...tx(2, 555, '30 Oct 2026', 'AF00 ATM', '28.80', '-600.00 DR', '2,900.00 CR'),
  ...tx(2, 539, '29 Oct 2026', 'SALARY', '0.00', '10,000.00 CR', '3,500.00 CR'),
  ...tx(2, 522, '29 Oct 2026', 'BIG DEBIT', '0.00', '-7,000.00 DR', '-6,500.00 DR'),
  ...footer(2),
]

describe('parseFnbHistory', () => {
  const st = parseFnbHistory(build())
  const acc = st.accounts[0]

  it('reads the account from the header block', () => {
    expect(st.bank).toBe('fnb')
    expect(st.accounts).toHaveLength(1)
    expect(acc).toMatchObject({ typeLabel: 'Easy Account', last4: '1234', role: 'everyday', closingBalance: 300000 })
    expect(st.warnings).toEqual([])
  })

  it('returns every row oldest first with signed amounts and balances', () => {
    expect(acc.rows.map((r) => [r.postedDate, r.amount, r.balance])).toEqual([
      ['2026-10-29', -700000, -650000],
      ['2026-10-29', 1000000, 350000],
      ['2026-10-30', -60000, 290000],
      ['2026-10-31', -5000, 285000],
      ['2026-11-01', -175000, 110000],
      ['2026-11-02', -10000, 100000],
      ['2026-11-03', 200000, 300000],
    ])
  })

  it('never reads the Service Fee column as the amount', () => {
    const atm = acc.rows.find((r) => r.description === 'AF00 ATM')
    expect(atm?.amount).toBe(-60000)
  })

  it('joins wrapped descriptions, including across a page break, and takes the card purchase date', () => {
    const byDesc = Object.fromEntries(acc.rows.map((r) => [r.description, r]))
    expect(byDesc['FNB APP TRANSFER FROM JANE']).toBeDefined()
    expect(byDesc['SHOP A']).toMatchObject({ postedDate: '2026-11-02', date: '2026-10-30' })
    expect(byDesc['SHOP B']).toMatchObject({ postedDate: '2026-10-31', date: '2026-10-29' })
  })

  it('does not treat the page footer as description text', () => {
    expect(acc.rows.some((r) => /Printed|fnb\.co\.za|First National/.test(r.description))).toBe(false)
  })

  it('reconciles to the current balance', () => {
    expect(checkBalances(acc)).toMatchObject({ ok: true, badRows: [] })
  })

  it('sets the period from the first transaction to the statement date', () => {
    expect([st.periodStart, st.periodEnd]).toEqual(['2026-10-29', '2026-11-03'])
  })
})

describe('parseFnbHistory card refs far right in the description', () => {
  it('keeps a card ref that sits nearer the Service Fee column in the description', () => {
    const st = parseFnbHistory([
      ...meta,
      ...tableHeader(1),
      ...row(1, 555, [[36, '29 Oct 2026'], [114, 'ISP Co'], [188, '123456*7890', 60], right(318, '0.00'), right(433, '-10.00 DR'), right(559, '3,000.00 CR')]),
      ...wrap(1, 539, '27 OCT'),
    ])
    expect(st.accounts[0].rows[0]).toMatchObject({ description: 'ISP Co', date: '2026-10-27', amount: -1000 })
  })
})

describe('parseFnbHistory footer close under the last row', () => {
  it('only joins continuation text that starts in the Description column', () => {
    const st = parseFnbHistory([
      ...meta,
      ...tableHeader(1),
      ...tx(1, 60, '29 Oct 2026', 'LAST ROW', '0.00', '-10.00 DR', '3,000.00 CR'),
      ...row(1, 48, [[36, 'Printed 2026-11-03, 16:40']]),
    ])
    expect(st.accounts[0].rows[0].description).toBe('LAST ROW')
  })
})

describe('parseStatement', () => {
  it('routes an FNB Transaction History export to its own parser', () => {
    const st = parseStatement(build())
    expect(st.accounts[0]?.rows).toHaveLength(7)
  })
})
