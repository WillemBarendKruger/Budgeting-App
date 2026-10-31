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

describe('detectBank with cross-mentions', () => {
  const onPage = (n: number, ...lines: string[]) => lines.flatMap((s, i) => row(n, 800 - i * 14, [[53, s]]))
  it('Discovery statement whose rows mention FNB stays Discovery', () => {
    // The footer repeats on every page, so Discovery's own markers outnumber the stray mention.
    const items = [
      ...onPage(1, 'FNB CARD PURCHASE', 'Paid to First National Bank', 'Discovery Bank Limited. Registration number 0000'),
      ...onPage(2, 'Discovery Bank Limited. Registration number 0000'),
    ]
    expect(detectBank(items)).toBe('discovery')
  })
  it('FNB statement with a later-page Discovery mention stays FNB', () => {
    const items = [
      ...onPage(1, 'www.fnb.co.za', 'First National Bank'),
      ...onPage(2, 'Discbank 000000001-2', 'Discovery Bank Limited'),
    ]
    expect(detectBank(items)).toBe('fnb')
  })
  it('uses overall counts when page 1 has no or both markers; tie is null', () => {
    expect(detectBank([...onPage(1, 'nothing'), ...onPage(2, 'fnb.co.za', 'First National Bank', 'Discovery Bank Limited')])).toBe('fnb')
    expect(detectBank([...onPage(1, 'fnb.co.za', 'Discovery Bank Limited')])).toBeNull()
  })
  it('detects a marker split across two items on one line', () => {
    const items = row(1, 800, [[53, 'Discovery Bank'], [150, 'Limited']])
    expect(detectBank(items)).toBe('discovery')
  })
})

describe('parseStatement', () => {
  it('throws a friendly UnsupportedStatementError for unknown statements', () => {
    expect(() => parseStatement(page('Some Other Bank'))).toThrow(UnsupportedStatementError)
    expect(() => parseStatement(page('Some Other Bank'))).toThrow(/FNB or Discovery/)
  })
})
