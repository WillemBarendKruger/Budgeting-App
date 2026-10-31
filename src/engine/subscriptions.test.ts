import { describe, expect, it } from 'vitest'
import type { PayMonth, Transaction } from '../domain/types'
import { detectSubscriptions } from './subscriptions'
import { makeTx } from './testHelpers'

// newest first
const months: PayMonth[] = [
  { start: '2026-09-25', end: '2026-10-24', label: 'c' },
  { start: '2026-08-25', end: '2026-09-24', label: 'b' },
  { start: '2026-07-25', end: '2026-08-24', label: 'a' },
  { start: '2026-06-25', end: '2026-07-24', label: 'z' },
]
const sub = (date: string, amount = -1499, payee = 'Invented Stream'): Transaction =>
  makeTx({ date, amount, payee })

describe('detectSubscriptions', () => {
  const three = [sub('2026-07-28'), sub('2026-08-28'), sub('2026-09-28')]

  it('detects 3 consecutive months at the same amount', () => {
    expect(detectSubscriptions(three, months, [])).toEqual([
      { payee: 'Invented Stream', monthly: 1499, yearly: 17988, lastDate: '2026-09-28', months: 3 },
    ])
  })
  it('rejects amounts outside 10% of median', () => {
    const txs = [sub('2026-07-28', -10000), sub('2026-08-28', -10000), sub('2026-09-28', -20000)]
    expect(detectSubscriptions(txs, months, [])).toEqual([])
  })
  it('rejects only 2 months', () => {
    expect(detectSubscriptions(three.slice(0, 2), months, [])).toEqual([])
  })
  it('rejects non-consecutive months', () => {
    const txs = [sub('2026-06-28'), sub('2026-08-28'), sub('2026-09-28')]
    expect(detectSubscriptions(txs, months, [])).toEqual([])
  })
  it('excludes dismissed payees case-insensitively', () => {
    expect(detectSubscriptions(three, months, ['invented stream'])).toEqual([])
  })
  it('matches payees case-insensitively', () => {
    const txs = [sub('2026-07-28', -1499, 'INVENTED STREAM'), sub('2026-08-28'), sub('2026-09-28', -1499, 'invented stream')]
    expect(detectSubscriptions(txs, months, [])).toHaveLength(1)
  })
  it('ignores non-expense kinds', () => {
    const txs = three.map(t => ({ ...t, kind: 'income' as const, amount: 1499 }))
    expect(detectSubscriptions(txs, months, [])).toEqual([])
  })
  it('rejects day-of-month more than 5 apart, handles month wrap', () => {
    const far = [sub('2026-07-26'), sub('2026-08-26'), sub('2026-09-26'), ]
    expect(detectSubscriptions(far, months, [])).toHaveLength(1)
    const apart = [sub('2026-07-26'), sub('2026-08-26'), sub('2026-10-10')]
    expect(detectSubscriptions(apart, months, [])).toEqual([])
    const wrap = [sub('2026-07-30'), sub('2026-08-31'), sub('2026-10-02')]
    expect(detectSubscriptions(wrap, months, [])).toHaveLength(1)
  })
  it('uses the median amount and the most recent run', () => {
    const txs = [
      sub('2026-06-28', -1000), sub('2026-07-28', -1500), sub('2026-08-28', -1500), sub('2026-09-28', -1500),
    ]
    const [s] = detectSubscriptions(txs, months, [])
    expect(s.monthly).toBe(1500)
    expect(s.months).toBe(3)
  })
  it('does not mutate inputs', () => {
    const copy = JSON.stringify(three)
    detectSubscriptions(three, months, [])
    expect(JSON.stringify(three)).toBe(copy)
  })
})
