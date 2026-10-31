import { describe, expect, it } from 'vitest'
import { formatRand, parseRand } from './money'

describe('money', () => {
  it('parses rand strings to integer cents', () => {
    expect(parseRand('R 1,234.56')).toBe(123456)
    expect(parseRand('R 188.01-')).toBe(-18801)
    expect(parseRand('23,553.75Cr')).toBe(2355375)
    expect(parseRand('0.37')).toBe(37)
    expect(parseRand('R 13,000.00')).toBe(1300000)
    expect(parseRand('3,811.37')).toBe(381137)
    expect(() => parseRand('abc')).toThrow()
  })
  it('formats cents as rand', () => {
    expect(formatRand(-18801)).toMatch(/188[,.]01/)
  })
})
