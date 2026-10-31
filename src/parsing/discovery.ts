import type { AccountRole, ParsedAccount, ParsedRow, ParsedStatement, TextItem } from '../domain/types'
import { parseRand } from '../domain/money'
import { assignColumns, findHeader, groupLines, lineText } from './layout'

const HEADER_LABELS = ['Date', 'Description', 'Debit', 'Credit', 'Balance']
const SUMMARY_LABELS = ['Account Type', 'Account Number', 'Balance']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const PERIOD = /From:\s*(\d{4}-\d{2}-\d{2})\s*To:\s*(\d{4}-\d{2}-\d{2})/i
const SECTION = /Account type:\s*(.*?)\s*Account number:\s*(\d+)/i
const SUMMARY_ROW = /^(.*?)\s+(\d{6,})\s+(R?\s*-?\s*[\d,]+\.\d{2}\s*-?)$/i

const roleFor = (type: string): AccountRole =>
  /credit card/i.test(type) ? 'credit' : /savings/i.test(type) ? 'savings' : 'everyday'

export function parseDiscovery(items: TextItem[]): ParsedStatement {
  const lines = groupLines(items)
  const warnings: string[] = []
  const accounts: ParsedAccount[] = []
  const summary = new Map<string, number>() // full account number -> closing balance
  const fullNumbers = new Map<ParsedAccount, string>() // never stored; only used to join the summary
  let periodStart = ''
  let periodEnd = ''
  let current: ParsedAccount | undefined

  for (const page of new Set(lines.map((l) => l.page))) {
    const pageLines = lines.filter((l) => l.page === page)
    const tableHeader = findHeader(pageLines, HEADER_LABELS)
    const summaryHeader = findHeader(pageLines, SUMMARY_LABELS)

    pageLines.forEach((line, idx) => {
      const text = lineText(line)

      const period = PERIOD.exec(text)
      if (period && !periodStart) [, periodStart, periodEnd] = period

      const section = SECTION.exec(text)
      if (section) {
        const [, typeLabel, number] = section
        current = { bank: 'discovery', typeLabel, last4: number.slice(-4), role: roleFor(typeLabel), rows: [] }
        fullNumbers.set(current, number)
        accounts.push(current)
        return
      }

      if (summaryHeader && idx > summaryHeader.index) {
        const m = SUMMARY_ROW.exec(text)
        if (m) summary.set(m[2], parseRand(m[3]))
        return
      }

      if (!tableHeader || idx <= tableHeader.index) return
      if (!ISO_DATE.test(line.items[0].str.trim())) return // footer / address / stray text

      if (!current) {
        warnings.push(`Transaction row before any account section: "${text}"`)
        return
      }
      const cells = assignColumns(line, tableHeader.columns)
      const date = (cells.Date ?? '').trim()
      const row: ParsedRow = {
        postedDate: date, date, description: (cells.Description ?? '').trim(), amount: 0, warnings: [],
      }
      if (cells.Debit) row.amount = -Math.abs(parseRand(cells.Debit))
      else if (cells.Credit) row.amount = Math.abs(parseRand(cells.Credit))
      else row.warnings.push('No debit or credit amount found')
      if (cells.Balance) row.balance = parseRand(cells.Balance)
      current.rows.push(row)
    })
  }

  for (const acc of accounts) {
    const closing = summary.get(fullNumbers.get(acc) ?? '')
    if (closing !== undefined) acc.closingBalance = closing
  }
  if (!periodStart) warnings.push('Statement period (From/To) not found')
  if (accounts.length === 0) warnings.push('No accounts found')
  return { bank: 'discovery', periodStart, periodEnd, accounts, warnings }
}
