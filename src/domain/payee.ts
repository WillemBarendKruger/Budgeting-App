const PREFIXES = [
  'POS Purchase',
  'Fuel Purchase',
  'Magtape Debit',
  'Magtape Credit',
  'DebiCheck',
  'FNB App Payment To',
  'FNB App Payment From',
  'Payshap Account Off-Us',
  'Scheduled Payment To',
]
const PREFIX_RE = new RegExp(`^(?:${PREFIXES.map((p) => p.split(' ').join('\\s+')).join('|')})\\s+`, 'i')

export function normaliseDescription(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function cleanPayee(description: string): string {
  return description
    .trim()
    .replace(PREFIX_RE, '')
    .replace(/\d{6}\*\d{4}(\s+\d{2}\s\w{3})?/g, ' ')
    .replace(/\(\d+\s*$/, ' ')
    .replace(/\b\d{5,}(?:-\d+)?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/(^|\s)(\S)/g, (_, sp: string, c: string) => sp + c.toUpperCase())
}
