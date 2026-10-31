import type { Bank, ParsedStatement, TextItem } from '../domain/types'
import { parseDiscovery } from './discovery'
import { parseFnb } from './fnb'

export class UnsupportedStatementError extends Error {
  constructor() {
    super("This doesn't look like an FNB or Discovery Bank statement. Only those two are supported for now.")
    this.name = 'UnsupportedStatementError'
  }
}

/** Identify the bank from statement text, ignoring case and spacing. */
export function detectBank(items: TextItem[]): Bank | null {
  const text = items.map((i) => i.str).join(' ').toLowerCase().replace(/\s+/g, ' ')
  if (/discovery bank limited/.test(text)) return 'discovery'
  if (/first national bank|fnb\.co\.za/.test(text)) return 'fnb'
  return null
}

export function parseStatement(items: TextItem[]): ParsedStatement {
  const bank = detectBank(items)
  if (bank === 'discovery') return parseDiscovery(items)
  if (bank === 'fnb') return parseFnb(items)
  throw new UnsupportedStatementError()
}
