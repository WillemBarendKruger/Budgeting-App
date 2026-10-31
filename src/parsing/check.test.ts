import { describe, expect, it } from 'vitest'
import type { ParsedAccount, ParsedRow } from '../domain/types'
import { checkBalances } from './check'

const r = (amount: number, balance?: number): ParsedRow => ({
  postedDate: '2026-01-01', date: '2026-01-01', description: 'x', amount, balance, warnings: [],
})
const acc = (rows: ParsedRow[], extra: Partial<ParsedAccount> = {}): ParsedAccount => ({
  bank: 'discovery', typeLabel: 't', last4: '1234', role: 'everyday', rows, ...extra,
})

describe('checkBalances', () => {
  it('passes a consistent run, deriving the opening balance from the first row', () => {
    expect(checkBalances(acc([r(-100, 900), r(50, 950)]))).toEqual({ ok: true, badRows: [] })
  })
  it('uses openingBalance when given', () => {
    expect(checkBalances(acc([r(-100, 900)], { openingBalance: 1000 })).ok).toBe(true)
    expect(checkBalances(acc([r(-100, 900)], { openingBalance: 999 })).badRows).toEqual([0])
  })
  it('reports only the tampered row', () => {
    expect(checkBalances(acc([r(-100, 900), r(51, 950), r(10, 960)]))).toEqual({ ok: false, badRows: [1] })
  })
  it('requires closingBalance to equal the last balance', () => {
    expect(checkBalances(acc([r(-100, 900)], { closingBalance: 900 })).ok).toBe(true)
    expect(checkBalances(acc([r(-100, 900)], { closingBalance: 901 })).ok).toBe(false)
  })
  it('handles an empty account', () => {
    expect(checkBalances(acc([]))).toEqual({ ok: true, badRows: [] })
  })
})
