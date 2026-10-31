import { describe, expect, it } from 'vitest'
import { row } from '../../tests/fixtures/textItems'
import { detectBank, parseStatement, UnsupportedStatementError } from './detect'

const page = (...lines: string[]) => lines.flatMap((s, i) => row(1, 800 - i * 14, [[53, s]]))

describe('detectBank', () => {
  it('detects Discovery by its legal name', () => {
    expect(detectBank(page('Example Bank Ltd', 'Discovery Bank Limited, 1 Sample Street'))).toBe('discovery')
  })
  it('detects FNB by name or web address', () => {
    expect(detectBank(page('First National Bank - a division of Example'))).toBe('fnb')
    expect(detectBank(page('Queries: www.fnb.co.za'))).toBe('fnb')
  })
  it('ignores case and spacing', () => {
    expect(detectBank(page('FNB.CO.ZA'))).toBe('fnb')
    expect(detectBank(page('DISCOVERY   BANK  LIMITED'))).toBe('discovery')
  })
  it('returns null for unknown banks and empty input', () => {
    expect(detectBank(page('Some Other Bank'))).toBeNull()
    expect(detectBank([])).toBeNull()
  })
})

describe('parseStatement', () => {
  it('throws a friendly UnsupportedStatementError for unknown statements', () => {
    expect(() => parseStatement(page('Some Other Bank'))).toThrow(UnsupportedStatementError)
    expect(() => parseStatement(page('Some Other Bank'))).toThrow(/FNB or Discovery/)
  })
})
