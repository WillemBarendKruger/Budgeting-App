import { describe, expect, it } from 'vitest'
import { discoveryHeader, header, right, row } from '../../tests/fixtures/textItems'
import { checkBalances } from './check'
import { parseDiscovery } from './discovery'

const footer = (page: number) => [
  ...row(page, 60, [[53, 'Example Bank Ltd, 1 Sample Street, Testville, 0000']]),
  ...row(page, 48, [[53, 'Reg No 1900/000000/00  VAT No 4000000000  Tel 0800 000 000']]),
]

const top = (page: number, y: number, type: string, number: string) => [
  ...row(page, y, [[53, 'Account holder:'], [130, 'A N Other'], [330, 'From:'], [360, '2026-01-01'], [420, 'To:'], [440, '2026-01-31']]),
  ...row(page, y - 14, [[53, 'Account type:'], [120, type], [380, 'Account number:'], [470, number]]),
]

// Amount cells: debit right edge 425, credit 478, balance 543.
const tx = (page: number, y: number, date: string, desc: string, side: 'debit' | 'credit', amt: string, bal: string) =>
  row(page, y, [[53, date], [120, desc], right(side === 'debit' ? 425 : 478, amt), right(543, bal)])

const summaryHeader = (page: number, y: number) =>
  header(page, y, [[80, 'Account Type'], [250, 'Account Number'], [510, 'Balance']])

const items = [
  // page 1 summary
  ...summaryHeader(1, 700),
  ...row(1, 680, [[53, 'Credit Card Account'], [250, '10000001234'], right(543, 'R 50.00-')]),
  ...row(1, 666, [[53, 'Savings Account'], [250, '10000005678'], right(543, 'R 100.00')]),
  ...row(1, 650, [[53, 'Total Closing Balance'], right(543, 'R 50.00')]),
  ...footer(1),
  // page 2 credit card
  ...top(2, 790, 'Credit Card Account', '10000001234'),
  ...discoveryHeader(2, 740),
  ...tx(2, 720, '2026-01-03', 'FNB CARD', 'debit', 'R 100.00', 'R 100.00-'),
  ...tx(2, 706, '2026-01-05', '87654321', 'debit', 'R 225.13', 'R 325.13-'),
  ...tx(2, 692, '2026-01-07', 'Payment received', 'credit', 'R 800.00', 'R 474.87'),
  ...footer(2),
  // page 3 continuation, no account header
  ...discoveryHeader(3, 760),
  ...tx(3, 740, '2026-01-20', 'Coffee Shop', 'debit', 'R 524.87', 'R 50.00-'),
  ...footer(3),
  // page 4 savings
  ...top(4, 790, 'Savings Account', '10000005678'),
  ...discoveryHeader(4, 740),
  ...tx(4, 720, '2026-01-10', 'Inter account transfer from account...1234 Oe', 'credit', 'R 99.00', 'R 99.00'),
  ...tx(4, 706, '2026-01-31', 'Interest Earned at 6.75%', 'credit', 'R 1.00', 'R 100.00'),
  ...footer(4),
]

describe('parseDiscovery', () => {
  const st = parseDiscovery(items)

  it('reads period and accounts', () => {
    expect(st.bank).toBe('discovery')
    expect([st.periodStart, st.periodEnd]).toEqual(['2026-01-01', '2026-01-31'])
    expect(st.accounts).toHaveLength(2)
    const [cc, sv] = st.accounts
    expect([cc.role, cc.last4, cc.typeLabel]).toEqual(['credit', '1234', 'Credit Card Account'])
    expect([sv.role, sv.last4]).toEqual(['savings', '5678'])
  })

  it('takes closing balances from the summary page', () => {
    expect(st.accounts.map((a) => a.closingBalance)).toEqual([-5000, 10000])
  })

  it('parses rows, continuing the account on pages without a header', () => {
    const cc = st.accounts[0]
    expect(cc.rows).toHaveLength(4)
    expect(cc.rows.map((r) => r.amount)).toEqual([-10000, -22513, 80000, -52487])
    expect(cc.rows[2].balance).toBe(47487)
    expect(cc.rows[1].description).toBe('87654321')
    expect(cc.rows[0].postedDate).toBe('2026-01-03')
    expect(st.accounts[1].rows.map((r) => r.description)).toEqual([
      'Inter account transfer from account...1234 Oe',
      'Interest Earned at 6.75%',
    ])
  })

  it('ignores footer lines and has no warnings', () => {
    expect(st.accounts.flatMap((a) => a.rows)).toHaveLength(6)
    expect(st.warnings).toEqual([])
  })

  it('balances check out, and a tampered amount is caught', () => {
    for (const a of st.accounts) expect(checkBalances(a)).toMatchObject({ ok: true, badRows: [] })
    const bad = structuredClone(st.accounts[0])
    bad.rows[2].amount += 1
    expect(checkBalances(bad)).toMatchObject({ ok: false, badRows: [2] })
  })

  it('flags a summary closing balance that disagrees with the last row', () => {
    const tampered = items.map((i) => (i.str === 'R 100.00' && i.page === 1 ? { ...i, str: 'R 101.00' } : i))
    const sv = parseDiscovery(tampered).accounts[1]
    expect(sv.closingBalance).toBe(10100)
    expect(checkBalances(sv).ok).toBe(false)
  })
})

describe('parseDiscovery edge cases', () => {
  const base = (page3: ReturnType<typeof row>) => [
    ...summaryHeader(1, 700),
    ...row(1, 680, [[53, 'Credit Card Account'], [250, '10000001234'], right(543, 'R 50.00-')]),
    ...top(2, 790, 'Credit Card Account', '10000001234'),
    ...discoveryHeader(2, 740),
    ...tx(2, 720, '2026-01-03', 'FNB CARD', 'debit', 'R 50.00', 'R 50.00-'),
    ...footer(2),
    ...page3,
  ]

  it('continues the account on a page with no table header row', () => {
    const st = parseDiscovery(base([...tx(3, 760, '2026-01-20', 'Coffee Shop', 'debit', 'R 10.00', 'R 60.00-'), ...footer(3)]))
    expect(st.accounts[0].rows.map((r) => r.description)).toEqual(['FNB CARD', 'Coffee Shop'])
    expect(st.accounts[0].rows[1].amount).toBe(-1000)
  })

  it('warns when date-first lines appear before any table header', () => {
    const st = parseDiscovery([...tx(1, 760, '2026-01-20', 'Orphan', 'debit', 'R 10.00', 'R 10.00-')])
    expect(st.warnings.some((w) => /no table header/.test(w))).toBe(true)
  })

  it('warns about summary accounts without a section and sections without a summary entry', () => {
    const st = parseDiscovery([
      ...summaryHeader(1, 700),
      ...row(1, 680, [[53, 'Savings Account'], [250, '10000005678'], right(543, 'R 100.00')]),
      ...top(2, 790, 'Credit Card Account', '10000001234'),
      ...discoveryHeader(2, 740),
      ...tx(2, 720, '2026-01-03', 'FNB CARD', 'debit', 'R 50.00', 'R 50.00-'),
    ])
    expect(st.warnings).toContain('Account ending 1234 has no closing balance in the summary')
    expect(st.warnings).toContain('Summary account ending 5678 has no account section')
  })

  it('adds row warnings for a missing balance and for both debit and credit', () => {
    const st = parseDiscovery(
      base([
        ...discoveryHeader(3, 760),
        ...row(3, 740, [[53, '2026-01-21'], [120, 'No bal'], right(425, 'R 5.00')]),
        ...row(3, 726, [[53, '2026-01-22'], [120, 'Both'], right(425, 'R 5.00'), right(478, 'R 7.00'), right(543, 'R 52.00-')]),
      ]),
    )
    const [, noBal, both] = st.accounts[0].rows
    expect(noBal.balance).toBeUndefined()
    expect(noBal.warnings).toContain('No balance found')
    expect(both.warnings).toContain('Both debit and credit present')
  })

  it('appends wrapped description lines to the previous row, but never footer lines', () => {
    const st = parseDiscovery(
      base([
        ...discoveryHeader(3, 760),
        ...tx(3, 740, '2026-01-21', 'Long merchant name', 'debit', 'R 10.00', 'R 60.00-'),
        ...row(3, 728, [[120, 'continued here']]),
        ...footer(3),
      ]),
    )
    const rows = st.accounts[0].rows
    expect(rows[1].description).toBe('Long merchant name continued here')
    expect(rows.map((r) => r.description).join('|')).not.toMatch(/Sample Street|VAT/)
  })
})
