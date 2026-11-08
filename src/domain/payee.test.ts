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

describe('cleanPayee keeps one payee per merchant across months (FNB Transaction History)', () => {
  const same = (a: string, b: string, expected: string) => {
    expect(cleanPayee(a)).toBe(expected)
    expect(cleanPayee(b)).toBe(expected)
  }
  it('drops underscore-joined debit order references', () => {
    same('SOMECLUB _111111112_222222223', 'SOMECLUB _111111111_222222223', 'Someclub')
  })
  it('drops short alphanumeric reference codes', () => {
    same('TRACKER 00ABC1234567 X12345', 'TRACKER 00ABC1234567 Y54321', 'Tracker')
  })
  it('drops the leading foreign/original amount on card purchases', () => {
    same('20.99 APPLE.COM/BIL 123456*7890 12 MAR', '10.99 APPLE.COM/BIL 123456*7890 12 APR', 'Apple.com/bil')
    expect(cleanPayee('450.00 HARBOUR GRILL 123456*7890 03 MAY')).toBe('Harbour Grill')
  })
  it('drops the "#" marker and embedded amounts from bank fee lines', () => {
    same('#INT PYMT FEE-20.99 APPLE', '#INT PYMT FEE-10.99 APPLE', 'Int Pymt Fee Apple')
    expect(cleanPayee('#MONTHLY ACCOUNT FEE')).toBe('Monthly Account Fee')
  })
  it('drops masked card numbers', () => {
    expect(cleanPayee('STORECARD 1234****567890123456')).toBe('Storecard')
  })
  it('strips FNB app transfer prefixes', () => {
    expect(cleanPayee('FNB APP TRANSFER FROM JANE')).toBe('Jane')
    expect(cleanPayee('FNB APP GEO PAYMENT F JOHN SMITH')).toBe('John Smith')
  })
  it('leaves ordinary merchant names alone', () => {
    expect(cleanPayee('ABCD.0012.03 RENT')).toBe('Abcd.0012.03 Rent')
    expect(cleanPayee('CORNER CAFE CEL33')).toBe('Corner Cafe Cel33')
    expect(cleanPayee('STEAKHOUSE CENTUR 26')).toBe('Steakhouse Centur 26')
  })
})

describe('normaliseDescription', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normaliseDescription('  Foo   BAR ')).toBe('foo bar')
  })
})
