import type { Bank, ParsedStatement, TextItem } from '../domain/types'
import { parseDiscovery } from './discovery'
import { parseFnb } from './fnb'
import { groupLines, lineText } from './layout'

export class UnsupportedStatementError extends Error {
  constructor() {
    super("This doesn't look like an FNB or Discovery Bank statement. Only those two are supported for now.")
    this.name = 'UnsupportedStatementError'
  }
}

const MARKERS: Record<Bank, RegExp> = {
  discovery: /discovery bank limited/g,
  fnb: /first national bank|firstrand bank|fnb\.co\.za/g,
}

function countMarkers(lines: string[]): Record<Bank, number> {
  const text = lines.join(' | ')
  return {
    discovery: text.match(MARKERS.discovery)?.length ?? 0,
    fnb: text.match(MARKERS.fnb)?.length ?? 0,
  }
}

/**
 * Identify the bank from its own boilerplate (ignoring case and spacing). Page 1 decides if exactly one
 * bank's markers appear there; otherwise the bank with strictly more marker hits across all pages wins.
 * A tie or no markers gives null, so a transaction description naming the other bank cannot misroute.
 */
export function detectBank(items: TextItem[]): Bank | null {
  const lines = groupLines(items).map((l) => ({
    page: l.page,
    text: lineText(l).toLowerCase().replace(/\s+/g, ' '),
  }))
  const first = lines[0]?.page
  const p1 = countMarkers(lines.filter((l) => l.page === first).map((l) => l.text))
  if ((p1.discovery > 0) !== (p1.fnb > 0)) return p1.discovery > 0 ? 'discovery' : 'fnb'
  const all = countMarkers(lines.map((l) => l.text))
  if (all.discovery === all.fnb) return null
  return all.discovery > all.fnb ? 'discovery' : 'fnb'
}

export function parseStatement(items: TextItem[]): ParsedStatement {
  const bank = detectBank(items)
  if (bank === 'discovery') return parseDiscovery(items)
  if (bank === 'fnb') return parseFnb(items)
  throw new UnsupportedStatementError()
}
