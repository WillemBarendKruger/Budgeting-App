import { describe, it, expect } from 'vitest'
import { parseFnbPeriod, resolveDayMonth, resolvePurchaseDate, addDays, daysBetween } from './dates'

describe('parseFnbPeriod', () => {
  it('parses a statement period line', () => {
    expect(parseFnbPeriod('Statement Period : 6 June 2026 to 7 September 2026')).toEqual({
      start: '2026-06-06',
      end: '2026-09-07',
    })
  })
  it('throws when no period is present', () => {
    expect(() => parseFnbPeriod('nothing here')).toThrow()
  })
})

describe('resolveDayMonth', () => {
  const p = { start: '2026-11-20', end: '2027-02-19' }
  it('picks the year that falls in the period', () => {
    expect(resolveDayMonth('28 Dec', p)).toBe('2026-12-28')
    expect(resolveDayMonth('03 Jan', p)).toBe('2027-01-03')
  })
  it('allows 7 days of slack either side', () => {
    expect(resolveDayMonth('15 Nov', p)).toBe('2026-11-15')
    expect(resolveDayMonth('24 Feb', p)).toBe('2027-02-24')
  })
})

describe('resolveDayMonth year boundaries', () => {
  it('resolves into the previous year when slack crosses back', () => {
    expect(resolveDayMonth('30 Dec', { start: '2026-01-03', end: '2026-03-31' })).toBe('2025-12-30')
  })
  it('resolves into the next year when slack crosses forward', () => {
    expect(resolveDayMonth('02 Jan', { start: '2026-10-01', end: '2026-12-28' })).toBe('2027-01-02')
  })
  it('throws for a date far outside the period', () => {
    expect(() => resolveDayMonth('15 Jul', { start: '2026-11-20', end: '2027-02-19' })).toThrow()
  })
})

describe('resolvePurchaseDate', () => {
  it('uses the posted year, or the previous year when that would be after posting', () => {
    expect(resolvePurchaseDate('31 Dec', '2027-01-02')).toBe('2026-12-31')
    expect(resolvePurchaseDate('05 Jun', '2026-06-08')).toBe('2026-06-05')
  })
})

describe('addDays / daysBetween', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('counts days between dates', () => {
    expect(daysBetween('2026-06-01', '2026-06-08')).toBe(7)
    expect(daysBetween('2026-06-08', '2026-06-01')).toBe(-7)
  })
})
