import type { Cents, ParsedAccount, ParsedRow, ParsedStatement, TextItem } from '../domain/types'
import { parseRand } from '../domain/money'
import { resolvePurchaseDate } from '../domain/dates'
import { assignColumns, groupLines, lineText, pageTables, WRAP_MAX_GAP, type Line } from './layout'

/**
 * FNB app / online-banking "Transaction History" export. Unlike the official statement it has a
 * Service Fee column, full dates ("03 Nov 2026"), "-123.45 DR" / "2,000.00 CR" amounts, no statement
 * period or opening balance, and lists rows newest first.
 */
const HEADER_LABELS = ['Date', 'Description', 'Service Fee', 'Amount', 'Balance']
const TITLE = /^Transaction History$/i
const SELECTED_ACCOUNT = /Selected Account:\s*(\d{6,})/i
const NICKNAME = /^Nickname:\s*(.+)$/i
const STATEMENT_DATE = /^Date:\s*(\d{1,2} [A-Za-z]{3} \d{4})$/i
const CURRENT_BALANCE = /^Current Balance:\s*(.+)$/i
const FULL_DATE = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/
const CARD_REF = /\b\d{6}\*\d{4}(?:\s+(\d{2}\s+[A-Za-z]{3}))?/
const AMOUNT = /^(-)?\s*(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\s*(CR|DR)?$/i
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** True when the items look like an FNB Transaction History export (title plus "Selected Account:"). */
export function isFnbHistory(items: TextItem[]): boolean {
  const texts = groupLines(items).map(lineText)
  return texts.some((t) => TITLE.test(t.trim())) && texts.some((t) => SELECTED_ACCOUNT.test(t))
}

/** "-123.45 DR" → -12345; "2,000.00 CR" → 200000. DR or a leading minus is negative. */
function signedAmount(s: string): Cents | undefined {
  const m = AMOUNT.exec(s.trim())
  if (!m) return undefined
  const cents = parseRand(`${m[2]}.${m[3]}`)
  return m[1] || m[4]?.toUpperCase() === 'DR' ? -cents : cents
}

function isoDate(s: string): string | undefined {
  const m = FULL_DATE.exec(s.trim())
  if (!m) return undefined
  const month = MONTHS.indexOf(m[2].toLowerCase())
  if (month < 0) return undefined
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

interface Pending { row: ParsedRow; raw: string; page: number; y: number }

export function parseFnbHistory(items: TextItem[]): ParsedStatement {
  const lines: Line[] = groupLines(items)
  const warnings: string[] = []

  let accountNumber: string | undefined
  let nickname: string | undefined
  let statementDate: string | undefined
  let current: Cents | undefined
  for (const line of lines) {
    const text = lineText(line).replace(/\s+/g, ' ').trim()
    accountNumber ??= SELECTED_ACCOUNT.exec(text)?.[1]
    nickname ??= NICKNAME.exec(text)?.[1]?.trim()
    const d = STATEMENT_DATE.exec(text)
    if (d && !statementDate) statementDate = isoDate(d[1])
    const c = CURRENT_BALANCE.exec(text)
    if (c && current === undefined) current = signedAmount(c[1])
  }
  if (!accountNumber) {
    return { bank: 'fnb', periodStart: '', periodEnd: '', accounts: [], warnings: ['No account found (expected "Selected Account: <number>")'] }
  }
  const account: ParsedAccount = {
    bank: 'fnb',
    typeLabel: nickname ?? 'FNB Account',
    last4: accountNumber.slice(-4),
    role: 'everyday',
    rows: [],
  }
  if (current !== undefined) account.closingBalance = current
  else warnings.push('Current balance not found')

  const pending: Pending[] = []
  let last: Pending | undefined
  for (const { page, lines: pageLines, header, columns } of pageTables(lines, HEADER_LABELS)) {
    if (!columns) continue
    let rowOnPage = false
    pageLines.forEach((line, idx) => {
      if (header && idx <= header.index) return
      // The date is wider than its narrow "Date" label, so column spans can misplace it; a row is
      // identified by its first item being a full date instead, and the rest goes through the columns.
      const posted = isoDate(line.items[0].str)
      // Only Service Fee, Amount and Balance hold numbers; every text item is description, even a
      // card ref printed so far right that it sits nearer the Service Fee heading.
      const rest = posted ? line.items.slice(1) : line.items
      const money = rest.filter((i) => AMOUNT.test(i.str.trim()))
      const text = rest.filter((i) => !AMOUNT.test(i.str.trim()))
      const cells = assignColumns({ ...line, items: money }, columns)
      const descText = text.map((i) => i.str.trim()).join(' ')
      if (descText) cells.Description = descText
      else delete cells.Description
      if (!posted) {
        // Description-only text continues the previous row: directly under it, or at the top of the
        // next page before any new row (a description carried over the page break).
        const descCol = columns.find((c) => c.label === 'Description')
        const inDescCol = !!descCol && line.items[0].x >= descCol.x0 - 2
        const descOnly = inDescCol && Object.keys(cells).length === 1 && cells.Description
        const near = last && last.page === page && last.y - line.y <= WRAP_MAX_GAP
        const carried = last && !rowOnPage && last.page < page
        if (descOnly && last && (near || carried)) {
          last.raw = `${last.raw} ${cells.Description.trim()}`
          last.page = page
          last.y = line.y
        }
        return
      }
      rowOnPage = true
      const row: ParsedRow = { postedDate: posted, date: posted, description: '', amount: 0, warnings: [] }
      const amount = cells.Amount ? signedAmount(cells.Amount) : undefined
      if (amount !== undefined) row.amount = amount
      else row.warnings.push('no-amount')
      const balance = cells.Balance ? signedAmount(cells.Balance) : undefined
      if (balance !== undefined) row.balance = balance
      else row.warnings.push('no-balance')
      last = { row, raw: cells.Description ?? '', page, y: line.y }
      pending.push(last)
    })
  }

  for (const p of pending) {
    let desc = p.raw
    const ref = CARD_REF.exec(desc)
    if (ref) {
      desc = desc.replace(CARD_REF, ' ')
      if (ref[1]) {
        try { p.row.date = resolvePurchaseDate(ref[1].replace(/\s+/g, ' '), p.row.postedDate) } catch {
          p.row.warnings.push('bad-purchase-date')
        }
      }
    }
    desc = desc.replace(/\s+/g, ' ').trim()
    if (desc) p.row.description = desc
    else {
      p.row.description = 'Unknown (FNB)'
      p.row.warnings.push('missing-description')
    }
  }

  // Printed newest first; the balance check and the rest of the app expect oldest first.
  account.rows = pending.map((p) => p.row).reverse()
  if (account.rows.length === 0) warnings.push('No transaction rows found')

  return {
    bank: 'fnb',
    periodStart: account.rows[0]?.postedDate ?? '',
    periodEnd: statementDate ?? account.rows[account.rows.length - 1]?.postedDate ?? '',
    accounts: [account],
    warnings,
  }
}
