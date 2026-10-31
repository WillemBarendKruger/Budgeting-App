import { describe, it, expect } from 'vitest'
import { payMonths, payMonthFor, suggestSalaryPattern } from './payMonths'
import { makeTx } from './testHelpers'
import { addDays } from '../domain/dates'
import type { Settings } from '../domain/types'

const settings = (over: Partial<Settings> = {}): Settings => ({
  id: 'settings', salaryPattern: 'acme payroll', fallbackPayday: 25,
  transferPatterns: [], dismissedSubscriptions: [], ...over,
})
const pay = (date: string, payee = 'Acme Payroll', amount = 3000000) =>
  makeTx({ date, payee, amount, kind: 'income' })

describe('payMonths', () => {
  it('returns [] for no transactions', () => {
    expect(payMonths([], settings(), '2026-10-31')).toEqual([])
  })

  it('builds months from salary dates, newest first, ending the day before the next', () => {
    const txs = [pay('2026-06-30'), pay('2026-07-31'), pay('2026-08-29')]
    const ms = payMonths(txs, settings(), '2026-09-10')
    expect(ms.map(m => [m.start, m.end])).toEqual([
      ['2026-08-29', '2026-09-10'],
      ['2026-07-31', '2026-08-28'],
      ['2026-06-30', '2026-07-30'],
    ])
    expect(ms[1].label).toBe('31 Jul – 28 Aug')
  })

  it('adds a fallback month before the first salary to cover earlier transactions', () => {
    const txs = [makeTx({ date: '2026-06-10' }), pay('2026-06-30'), pay('2026-07-31')]
    const ms = payMonths(txs, settings(), '2026-08-05')
    expect(ms.map(m => [m.start, m.end])).toEqual([
      ['2026-07-31', '2026-08-05'],
      ['2026-06-30', '2026-07-30'],
      ['2026-05-25', '2026-06-29'],
    ])
  })

  it('uses fallback months only when there is no salary pattern', () => {
    const txs = [makeTx({ date: '2026-06-10' }), makeTx({ date: '2026-08-02' })]
    const ms = payMonths(txs, settings({ salaryPattern: undefined }), '2026-08-20')
    expect(ms.map(m => [m.start, m.end])).toEqual([
      ['2026-07-25', '2026-08-20'],
      ['2026-06-25', '2026-07-24'],
      ['2026-05-25', '2026-06-24'],
    ])
  })

  it('ignores non-income transactions matching the pattern', () => {
    const txs = [makeTx({ date: '2026-07-10', payee: 'Acme Payroll', kind: 'transfer', amount: 5000 })]
    const ms = payMonths(txs, settings(), '2026-07-20')
    expect(ms[0].start).toBe('2026-06-25')
  })

  it('collapses salary dates less than 10 days apart to the earliest', () => {
    const txs = [pay('2026-07-25'), pay('2026-07-31'), pay('2026-08-25')]
    const ms = payMonths(txs, settings(), '2026-08-30')
    expect(ms.map(m => m.start)).toEqual(['2026-08-25', '2026-07-25'])
  })

  it('fills gaps longer than 40 days with fallback paydays', () => {
    const txs = [pay('2026-05-01'), pay('2026-07-30')]
    const ms = payMonths(txs, settings(), '2026-07-31')
    expect(ms.map(m => m.start)).toEqual(['2026-07-30', '2026-06-25', '2026-05-25', '2026-05-01'])
    expect(ms[2].end).toBe('2026-06-24')
  })

  it('clamps fallbackPayday 31 to short months and February', () => {
    const txs = [makeTx({ date: '2027-01-15' }), makeTx({ date: '2027-04-02' })]
    const ms = payMonths(txs, settings({ salaryPattern: undefined, fallbackPayday: 31 }), '2027-04-10')
    expect(ms.map(m => m.start)).toEqual(['2027-03-31', '2027-02-28', '2027-01-31', '2026-12-31'])
  })

  it('never produces a negative range when today is before the last start', () => {
    const txs = [pay('2026-07-31'), pay('2026-08-29')]
    const ms = payMonths(txs, settings(), '2026-08-01')
    expect(ms[0]).toMatchObject({ start: '2026-08-29', end: '2026-08-29' })
  })

  it('includes years in the label only when the range spans years', () => {
    const txs = [pay('2026-12-29'), pay('2027-01-29')]
    const ms = payMonths(txs, settings(), '2027-02-05')
    expect(ms[1].label).toBe('29 Dec 2026 – 28 Jan 2027')
    expect(ms[0].label).toBe('29 Jan – 5 Feb')
  })

  it('does not mutate inputs', () => {
    const txs = [pay('2026-08-29'), pay('2026-06-30')]
    const copy = JSON.parse(JSON.stringify(txs))
    payMonths(txs, settings(), '2026-09-01')
    expect(txs).toEqual(copy)
  })
})

describe('payMonthFor', () => {
  const ms = payMonths([pay('2026-07-31'), pay('2026-08-29')], settings(), '2026-09-10')
  it('finds the containing month', () => {
    expect(payMonthFor('2026-08-28', ms)?.start).toBe('2026-07-31')
    expect(payMonthFor('2026-08-29', ms)?.start).toBe('2026-08-29')
  })
  it('returns undefined outside all months', () => {
    expect(payMonthFor('2026-07-01', ms)).toBeUndefined()
  })
})

describe('suggestSalaryPattern', () => {
  it('prefers a recurring credit over a larger one-off', () => {
    const txs = [
      pay('2026-06-30', 'Acme Payroll', 3000000),
      pay('2026-07-31', 'Acme Payroll', 3100000),
      pay('2026-07-15', 'Lucky Windfall', 9000000),
    ]
    expect(suggestSalaryPattern(txs)).toBe('Acme Payroll')
  })
  it('returns undefined when nothing recurs', () => {
    expect(suggestSalaryPattern([pay('2026-06-30')])).toBeUndefined()
  })
  it('ignores same-month repeats', () => {
    expect(suggestSalaryPattern([pay('2026-06-01'), pay('2026-06-20')])).toBeUndefined()
  })
})

describe('coverage invariant', () => {
  it('06-27 regression: earliest tx just before first salary is covered', () => {
    const txs = [makeTx({ date: '2026-06-27' }), pay('2026-06-30')]
    const ms = payMonths(txs, settings(), '2026-07-05')
    expect(payMonthFor('2026-06-27', ms)).toBeDefined()
    expect(ms.map(m => m.start)).toEqual(['2026-06-30', '2026-06-25'])
  })

  it('adds no leading month when earliest is the first salary', () => {
    const ms = payMonths([pay('2026-06-30'), pay('2026-07-31')], settings(), '2026-08-01')
    expect(ms.map(m => m.start)).toEqual(['2026-07-31', '2026-06-30'])
  })

  it('does not generate empty months up to a far-future today', () => {
    const ms = payMonths([pay('2026-06-30'), pay('2026-07-31')], settings(), '2027-03-01')
    expect(ms[0]).toMatchObject({ start: '2026-07-31', end: '2027-03-01' })
    expect(ms).toHaveLength(2)
  })

  const cases: Array<[string, ReturnType<typeof makeTx>[], Partial<Settings>, string]> = [
    ['salary present', [pay('2026-06-30'), pay('2026-07-31'), makeTx({ date: '2026-07-04' })], {}, '2026-08-10'],
    ['no salary pattern', [makeTx({ date: '2026-03-03' }), makeTx({ date: '2026-06-20' })], { salaryPattern: undefined }, '2026-06-21'],
    ['earliest just before first salary', [makeTx({ date: '2026-06-27' }), pay('2026-06-30')], {}, '2026-07-02'],
    ['gap over 40 days', [pay('2026-01-05'), pay('2026-05-20'), makeTx({ date: '2026-05-22' })], {}, '2026-05-25'],
    ['fallback 31', [makeTx({ date: '2027-01-15' }), pay('2027-03-05'), makeTx({ date: '2027-05-01' })], { fallbackPayday: 31 }, '2027-05-02'],
    ['tx after today', [pay('2026-06-30'), makeTx({ date: '2026-09-15' })], {}, '2026-08-01'],
    ['salary within 10 days of fallback', [makeTx({ date: '2026-06-26' }), pay('2026-06-29'), pay('2026-07-29')], {}, '2026-08-01'],
  ]
  it.each(cases)('%s: every date in exactly one contiguous month', (_n, txs, over, today) => {
    const ms = payMonths(txs, settings(over), today)
    const asc = [...ms].reverse()
    for (let i = 1; i < asc.length; i++) expect(asc[i].start).toBe(addDays(asc[i - 1].end, 1))
    for (const m of ms) expect(m.end >= m.start).toBe(true)
    const dates = [...txs.map(t => t.date), today].filter(d => d >= txs.map(t => t.date).sort()[0])
    for (const d of dates) expect(ms.filter(m => d >= m.start && d <= m.end)).toHaveLength(1)
  })
})

describe('salary pattern semantics (final review I4)', () => {
  const two = (payee: string) => [pay('2026-06-30', payee), pay('2026-07-31', payee)]
  const starts = (txs: ReturnType<typeof pay>[], salaryPattern: string) =>
    payMonths(txs, settings({ salaryPattern }), '2026-08-10').map(m => m.start)

  it("'a|b' alternation matches as a case-insensitive regex", () => {
    expect(starts(two('Invented Corp Salary'), 'acme|SALARY')).toEqual(['2026-07-31', '2026-06-30'])
  })

  it('an invalid regex falls back to case-insensitive substring', () => {
    expect(starts(two('Invented (Pty Salary'), 'invented (pty')).toEqual(['2026-07-31', '2026-06-30'])
  })

  it('suggested payee with regex metacharacters is escaped and matches itself', () => {
    const txs = [pay('2026-06-30', 'Invented (Pty) Ltd+Co', 3000000), pay('2026-07-31', 'Invented (Pty) Ltd+Co', 3000000)]
    const suggestion = suggestSalaryPattern(txs)!
    expect(suggestion).toBe('Invented \\(Pty\\) Ltd\\+Co')
    expect(new RegExp(suggestion, 'i').test('Invented (Pty) Ltd+Co')).toBe(true)
    expect(starts(txs, suggestion)).toEqual(['2026-07-31', '2026-06-30'])
  })
})
