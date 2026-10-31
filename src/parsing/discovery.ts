import type { AccountRole, ParsedAccount, ParsedRow, ParsedStatement, TextItem } from '../domain/types'
import { parseRand } from '../domain/money'
import { assignColumns, findHeader, groupLines, lineText, pageTables, wrapContinuation } from './layout'

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
  let lastRow: { row: ParsedRow; page: number; y: number } | undefined

  for (const { page, lines: pageLines, header: tableHeader, columns } of pageTables(lines, HEADER_LABELS)) {
    const summaryHeader = findHeader(pageLines, SUMMARY_LABELS)
    let warnedNoHeader = false

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

      if (tableHeader && idx <= tableHeader.index) return
      const dateFirst = ISO_DATE.test(line.items[0].str.trim())
      if (!columns) {
        if (dateFirst && !warnedNoHeader) {
          warnings.push(`Page ${page}: transaction-like lines found but no table header seen yet`)
          warnedNoHeader = true
        }
        return
      }
      if (!dateFirst) {
        const more = wrapContinuation(line, columns, lastRow)
        if (lastRow && more) {
          lastRow.row.description = `${lastRow.row.description} ${more}`.trim()
          lastRow.y = line.y
        }
        return
      }

      if (!current) {
        warnings.push(`Transaction row before any account section: "${text}"`)
        return
      }
      const cells = assignColumns(line, columns)
      const date = (cells.Date ?? '').trim()
      const row: ParsedRow = {
        postedDate: date, date, description: (cells.Description ?? '').trim(), amount: 0, warnings: [],
      }
      if (cells.Debit && cells.Credit) {
        row.amount = Math.abs(parseRand(cells.Credit)) - Math.abs(parseRand(cells.Debit))
        row.warnings.push('Both debit and credit present')
      } else if (cells.Debit) row.amount = -Math.abs(parseRand(cells.Debit))
      else if (cells.Credit) row.amount = Math.abs(parseRand(cells.Credit))
      else row.warnings.push('No debit or credit amount found')
      if (cells.Balance) row.balance = parseRand(cells.Balance)
      else row.warnings.push('No balance found')
      lastRow = { row, page, y: line.y }
      current.rows.push(row)
    })
  }

  for (const acc of accounts) {
    const closing = summary.get(fullNumbers.get(acc) ?? '')
    if (closing !== undefined) acc.closingBalance = closing
    else warnings.push(`Account ending ${acc.last4} has no closing balance in the summary`)
  }
  const sectionNumbers = new Set(fullNumbers.values())
  for (const number of summary.keys()) {
    if (!sectionNumbers.has(number)) warnings.push(`Summary account ending ${number.slice(-4)} has no account section`)
  }
  if (!periodStart) warnings.push('Statement period (From/To) not found')
  if (accounts.length === 0) warnings.push('No accounts found')
  return { bank: 'discovery', periodStart, periodEnd, accounts, warnings }
}
