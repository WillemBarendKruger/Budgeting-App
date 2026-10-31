import { describe, expect, it } from 'vitest'
import type { Account, PayMonth } from '../domain/types'
import { UNCATEGORISED } from '../domain/types'
import { groupChange, monthSummary } from './reports'
import { makeTx } from './testHelpers'

const m: PayMonth = { start: '2026-07-25', end: '2026-08-24', label: 'x' }
const accounts: Account[] = [
  { id: 'acc1', bank: 'fnb', typeLabel: 'Cheque', last4: '1111', name: 'Everyday', role: 'everyday' },
  { id: 'sav', bank: 'fnb', typeLabel: 'Save', last4: '2222', name: 'Savings', role: 'savings' },
]
const d = '2026-08-01'

describe('monthSummary', () => {
  const txs = [
    makeTx({ kind: 'income', amount: 30000, date: d }),
    makeTx({ kind: 'expense', amount: -5000, groupId: 'groceries', date: d }),
    makeTx({ kind: 'transfer', amount: 3000, accountId: 'sav', date: d }),
    makeTx({ kind: 'transfer', amount: -3000, accountId: 'acc1', date: d }),
    makeTx({ kind: 'reimbursement', amount: 1000, reimbursesGroupId: 'groceries', date: d }),
    makeTx({ kind: 'expense', amount: -999, groupId: 'groceries', date: '2026-09-30' }),
  ]

  it('computes in/out/saved/movedToSavings and groups', () => {
    const s = monthSummary(txs, accounts, m)
    expect(s.in).toBe(30000)
    expect(s.out).toBe(4000)
    expect(s.saved).toBe(26000)
    expect(s.movedToSavings).toBe(3000)
    expect(s.byGroup).toEqual([{ groupId: 'groceries', amount: 4000 }])
  })

  it('counts unplanned, savings kind, and uncategorised', () => {
    const s = monthSummary([
      makeTx({ amount: -700, groupId: UNCATEGORISED, unplanned: true, date: d }),
      makeTx({ amount: -300, groupId: 'fun', date: d }),
      makeTx({ kind: 'savings', amount: -2000, groupId: null, date: d }),
    ], accounts, m)
    expect(s.unplanned).toBe(700)
    expect(s.uncategorisedCount).toBe(1)
    expect(s.movedToSavings).toBe(2000)
    expect(s.byGroup).toEqual([
      { groupId: UNCATEGORISED, amount: 700 },
      { groupId: 'fun', amount: 300 },
    ])
  })

  it('lets a reimbursed group with no expenses go negative and sort last', () => {
    const s = monthSummary([
      makeTx({ amount: -500, groupId: 'fun', date: d }),
      makeTx({ kind: 'reimbursement', amount: 200, reimbursesGroupId: 'travel', date: d }),
    ], accounts, m)
    expect(s.byGroup).toEqual([
      { groupId: 'fun', amount: 500 },
      { groupId: 'travel', amount: -200 },
    ])
    expect(s.out).toBe(300)
  })

  it('does not mutate inputs', () => {
    const copy = JSON.stringify(txs)
    monthSummary(txs, accounts, m)
    expect(JSON.stringify(txs)).toBe(copy)
  })
})

describe('groupChange', () => {
  const mk = (amount: number) => ({
    in: 0, out: 0, saved: 0, unplanned: 0, movedToSavings: 0, uncategorisedCount: 0,
    byGroup: [{ groupId: 'g', amount }],
  })
  it('flags growth over 15%', () => {
    expect(groupChange(mk(1200), mk(1000), 'g')).toEqual({ pct: 20, grew: true })
    expect(groupChange(mk(1100), mk(1000), 'g')).toEqual({ pct: 10, grew: false })
    expect(groupChange(mk(1150), mk(1000), 'g').grew).toBe(false)
    expect(groupChange(mk(115), mk(100), 'g').grew).toBe(false)
  })
  it('returns null pct without a usable previous', () => {
    expect(groupChange(mk(1200), undefined, 'g')).toEqual({ pct: null, grew: false })
    expect(groupChange(mk(1200), mk(-50), 'g')).toEqual({ pct: null, grew: false })
    expect(groupChange(mk(1200), mk(0), 'g')).toEqual({ pct: null, grew: false })
    expect(groupChange(mk(1200), mk(1000), 'other')).toEqual({ pct: null, grew: false })
  })
})
