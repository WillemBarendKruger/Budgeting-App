import { describe, it, expect } from 'vitest'
import { cleanPayee, normaliseDescription } from './payee'

describe('cleanPayee', () => {
  it('strips prefix and card ref', () => {
    expect(cleanPayee('POS Purchase Checkers Sixty60 123456*7890 05 Jun')).toBe('Checkers Sixty60')
  })
  it('removes long digit runs', () => {
    const r = cleanPayee('Magtape Debit Tracker 00Abc1234567 998877')
    expect(r).not.toContain('998877')
    expect(r).toMatch(/^Tracker/)
    expect(cleanPayee('Electricity Prepaid Electricity 12345678901')).toBe('Electricity Prepaid Electricity')
  })
  it('falls back to the title-cased original when cleaning leaves nothing', () => {
    expect(cleanPayee('POS Purchase 123456*7890')).toBe('Pos Purchase 123456*7890')
  })
  it('title-cases plain descriptions', () => {
    expect(cleanPayee('SHELL SAMRAND Midrand')).toBe('Shell Samrand Midrand')
  })
  it('strips trailing branch codes', () => {
    expect(cleanPayee('POS Purchase Mcd Mall@Reds (0218')).toBe('Mcd Mall@reds')
  })
  it('strips transfer prefixes', () => {
    expect(cleanPayee('FNB App Payment To Credit Card')).toBe('Credit Card')
    expect(cleanPayee('Payshap Account Off-Us Credit Card')).toBe('Credit Card')
  })
})

describe('normaliseDescription', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normaliseDescription('  Foo   BAR ')).toBe('foo bar')
  })
})
