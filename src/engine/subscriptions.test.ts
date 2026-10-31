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
  it('finds a recurring charge despite an earlier one-off from the same payee', () => {
    const txs = [...three, sub('2026-08-26', -8000)]
    const r = detectSubscriptions(txs, months, [])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ monthly: 1499, months: 3, lastDate: '2026-09-28' })
  })
  it('does not flag a payee with varied amounts', () => {
    const txs = [sub('2026-06-28', -5199, 'Games Store'), sub('2026-07-28', -17010, 'Games Store'),
      sub('2026-08-28', -5940, 'Games Store'), sub('2026-09-28', -10340, 'Games Store')]
    expect(detectSubscriptions(txs, months, [])).toEqual([])
  })
  it('still detects a cancelled subscription with its real last date', () => {
    const wide: PayMonth[] = [
      { start: '2026-11-25', end: '2026-12-24', label: 'e' },
      { start: '2026-10-25', end: '2026-11-24', label: 'd' },
      ...months,
    ]
    const r = detectSubscriptions(three, wide, [])
    expect(r).toHaveLength(1)
    expect(r[0].lastDate).toBe('2026-09-28')
  })
  it('detects when the newest month has no charge yet', () => {
    const wide: PayMonth[] = [{ start: '2026-10-25', end: '2026-11-24', label: 'e' }, ...months]
    expect(detectSubscriptions(three, wide, [])).toHaveLength(1)
  })
  it('reports the old price after a price rise (new price has < 3 months)', () => {
    // Accepted behaviour: 1700 is >10% from 1500, so it forms its own cluster until it has 3 months.
    const txs = [sub('2026-06-28', -1500), sub('2026-07-28', -1500), sub('2026-08-28', -1500), sub('2026-09-28', -1700)]
    const r = detectSubscriptions(txs, months, [])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ monthly: 1500, lastDate: '2026-08-28' })
  })
  it('does not mutate inputs', () => {
    const copy = JSON.stringify(three)
    detectSubscriptions(three, months, [])
    expect(JSON.stringify(three)).toBe(copy)
  })
})
