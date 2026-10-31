import type { Cents } from './types'

/**
 * Parse a rand amount string into integer cents using digit-string math.
 * A trailing "-" means negative; a trailing "Cr" is ignored (positive).
 * Bank-specific Cr/Dr sign rules belong in the parsers, not here.
 */
export function parseRand(s: string): Cents {
  const m = /^\s*(-)?\s*R?\s*(-)?\s*(\d{1,3}(?:[,\s]\d{3})*|\d+)(?:\.(\d{1,2}))?\s*(-|Cr)?\s*$/i.exec(s)
  if (!m) throw new Error(`Cannot parse rand amount: "${s}"`)
  const [, lead, lead2, whole, frac = '', trail] = m
  const cents = Number(whole.replace(/[,\s]/g, '')) * 100 + Number(frac.padEnd(2, '0'))
  return lead || lead2 || trail === '-' ? -cents : cents
}

const formatter = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })

export function formatRand(c: Cents): string {
  return formatter.format(c / 100)
}
