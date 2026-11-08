const PREFIXES = [
  'POS Purchase',
  'Fuel Purchase',
  'Magtape Debit',
  'Magtape Credit',
  'DebiCheck',
  'FNB App Payment To',
  'FNB App Payment From',
  'FNB App Transfer To',
  'FNB App Transfer From',
  'FNB App GEO Payment F',
  'Payshap Account Off-Us',
  'Scheduled Payment To',
]
const PREFIX_RE = new RegExp(`^(?:${PREFIXES.map((p) => p.split(' ').join('\\s+')).join('|')})\\s+`, 'i')

export function normaliseDescription(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)(\S)/g, (_, sp: string, c: string) => sp + c.toUpperCase())
}

export function cleanPayee(description: string): string {
  const cleaned = description
    .trim()
    .replace(/^#/, '') // FNB bank-fee marker
    .replace(PREFIX_RE, '')
    .replace(/^\d+\.\d{2}\s+/, '') // original (often foreign) amount leading a card purchase
    .replace(/-\d+\.\d{2}\b/g, ' ') // amount embedded in a fee line, e.g. "FEE-20.99"
    .replace(/(?:_\d{5,})+/g, ' ') // underscore-joined debit order references
    .replace(/\b\d+\*{2,}\d+\b/g, ' ') // masked card numbers
    .replace(/\b(?:\d+[A-Za-z]+\d{4,}|[A-Za-z]\d{4,})\b/g, ' ') // reference codes like 00ABC1234567, X12345
    .replace(/\d{6}\*\d{4}(\s+\d{2}\s\w{3})?/g, ' ')
    .replace(/\(\d+\s*$/, ' ')
    .replace(/\b\d{5,}(?:-\d+)?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return titleCase(cleaned || description.trim())
}
