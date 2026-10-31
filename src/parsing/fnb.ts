import type { Cents, ParsedAccount, ParsedRow, ParsedStatement, TextItem } from '../domain/types'
import { parseRand } from '../domain/money'
import { parseFnbPeriod, resolveDayMonth, resolvePurchaseDate } from '../domain/dates'
import { assignColumns, groupLines, lineText, pageTables, wrapContinuation, type Column, type Line } from './layout'

const HEADER_LABELS = ['Date', 'Description', 'Amount', 'Balance']
const CHARGES_LABEL = /^(Accrued|Bank|Charges|Bank Charges|Accrued Bank Charges)$/i
const CHARGES_Y_TOLERANCE = 15
const CHARGES_OFFSET = 50 // synthetic charges column sits this far right of the Balance label centre
const DAY_MONTH = /^\d{2} [A-Z][a-z]{2}$/
const ACCOUNT = /([A-Za-z][A-Za-z ]*?Account)\s*:\s*(\d{6,})/
const MONEY = '(\\d{1,3}(?:,\\d{3})+|\\d+)\\.(\\d{2})'
const OPENING = new RegExp(`Opening Balance\\s+(${MONEY}\\s*(?:Cr|Dr)?)`, 'i')
const CLOSING = new RegExp(`Closing Balance\\s+(${MONEY}\\s*(?:Cr|Dr)?)`, 'i')
const TURN_CREDIT = new RegExp(`No\\. Credit Transactions\\s+(\\d+)\\s+${MONEY}`, 'i')
const TURN_DEBIT = new RegExp(`No\\. Debit Transactions\\s+(\\d+)\\s+${MONEY}`, 'i')
// Lines that are never description text: balances, turnover, verification stamp, page footer.
const NOT_DESCRIPTION =
  /^(Opening Balance|Closing Balance|Turnover for Statement Period|No\. (Credit|Debit) Transactions|FNB Verified Statement|Reference Number|To verify this statement|Page \d+ of \d+)/i
const TABLE_END = /^(Closing Balance|Turnover for Statement Period)/i
const CARD_REF = /\b\d{6}\*\d{4}(?: (\d{2} [A-Z][a-z]{2}))?/
const SUFFIX_ITEM = /^(Cr|Dr)$/i
const MONEY_ITEM = /^-?(R\s*)?-?(\d{1,3}(,\d{3})+|\d+)\.\d{2}$/i

/** Cents from a "1,234.56Cr"-style string. Cr is positive; Dr or no suffix is negative. */
function signedCents(str: string): Cents | undefined {
  const m = new RegExp(`${MONEY}\\s*(Cr|Dr)?`, 'i').exec(str)
  if (!m) return undefined
  const cents = parseRand(`${m[1]}.${m[2]}`)
  return m[3]?.toLowerCase() === 'cr' ? cents : -cents
}

const unsignedCents = (whole: string, frac: string): Cents => parseRand(`${whole}.${frac}`)

/** pdf.js may emit "Cr"/"Dr" as its own item after the amount; fold it back into that item. */
function mergeSuffixes(line: Line): Line {
  const items: TextItem[] = []
  for (const it of line.items) {
    const prev = items[items.length - 1]
    if (SUFFIX_ITEM.test(it.str.trim()) && prev && MONEY_ITEM.test(prev.str.trim())) {
      items[items.length - 1] = { ...prev, str: prev.str.trim() + it.str.trim(), width: prev.width }
    } else items.push(it)
  }
  return { ...line, items }
}

/**
 * Append an (ignored) 'Charges' column right of Balance so accrued bank charges can never land in Balance.
 * Uses the stacked/inline "Accrued Bank Charges" label items near the header line if present, else a
 * synthetic column further right.
 */
function addChargesColumn(columns: Column[], headerLine: Line, pageLines: Line[]): Column[] {
  const balance = columns.find((c) => c.label === 'Balance')
  if (!balance) return columns
  const labels = pageLines
    .filter((l) => Math.abs(l.y - headerLine.y) <= CHARGES_Y_TOLERANCE)
    .flatMap((l) => l.items)
    .filter((i) => CHARGES_LABEL.test(i.str.trim()) && i.x + i.width / 2 > balance.centre)
  let x0: number
  let centre: number
  if (labels.length) {
    x0 = Math.min(...labels.map((i) => i.x))
    centre = (x0 + Math.max(...labels.map((i) => i.x + i.width))) / 2
  } else {
    centre = balance.centre + CHARGES_OFFSET
    x0 = balance.centre + CHARGES_OFFSET / 2
  }
  return [
    ...columns.map((c) => (c === balance ? { ...c, x1: x0 } : c)),
    { label: 'Charges', x0, x1: Infinity, centre },
  ]
}

interface Pending { row: ParsedRow; raw: string; page: number; y: number }

export function parseFnb(items: TextItem[]): ParsedStatement {
  const lines = groupLines(items).map(mergeSuffixes)
  const warnings: string[] = []

  // Pass 1: statement-level facts, which can sit anywhere on the first or last page.
  let period: { start: string; end: string } | undefined
  let account: ParsedAccount | undefined
  let opening: Cents | undefined
  let closing: Cents | undefined
  let turnCredit: { count: number; total: Cents } | undefined
  let turnDebit: { count: number; total: Cents } | undefined
  const firstTable = [...pageTables(lines, HEADER_LABELS)].find((t) => t.header)
  const firstHeaderLine = firstTable && firstTable.lines[firstTable.header!.index]
  let beforeTable = true
  for (const line of lines) {
    if (line === firstHeaderLine) beforeTable = false
    const text = lineText(line)
    if (!period && /Statement Period/i.test(text)) {
      try { period = parseFnbPeriod(text) } catch { /* reported below if never found */ }
    }
    const acc = beforeTable ? ACCOUNT.exec(text) : null
    if (acc) {
      const last4 = acc[2].slice(-4)
      if (!account) account = { bank: 'fnb', typeLabel: acc[1].trim(), last4, role: 'everyday', rows: [] }
      else if (account.last4 !== last4) {
        warnings.push(`Second account number ending ${last4} found; only one account is parsed`)
      }
    }
    const o = OPENING.exec(text)
    if (o && opening === undefined) opening = signedCents(o[1])
    const c = CLOSING.exec(text)
    if (c) {
      const v = signedCents(c[1])
      if (closing === undefined) closing = v
      else if (closing !== v) warnings.push('Conflicting closing balances found; using the first')
    }
    const tc = TURN_CREDIT.exec(text)
    if (tc) turnCredit = { count: Number(tc[1]), total: unsignedCents(tc[2], tc[3]) }
    const td = TURN_DEBIT.exec(text)
    if (td) turnDebit = { count: Number(td[1]), total: unsignedCents(td[2], td[3]) }
  }
  if (!account) warnings.push('No account found (expected "<Product> Account : <number>")')
  if (!period) warnings.push('Statement period not found; transaction rows could not be dated')
  if (account) {
    if (opening !== undefined) account.openingBalance = opening
    else warnings.push('Opening balance not found')
    if (closing !== undefined) account.closingBalance = closing
    else warnings.push('Closing balance not found')
  }

  // Pass 2: transaction rows.
  const pending: Pending[] = []
  let lastRow: Pending | undefined
  let rowsSeen = 0

  for (const { page, lines: pageLines, header: tableHeader, columns } of pageTables(lines, HEADER_LABELS, addChargesColumn)) {
    let warnedNoHeader = false
    let tableOpen = true

    pageLines.forEach((line, idx) => {
      const text = lineText(line)
      if (tableHeader && idx <= tableHeader.index) return
      if (columns && TABLE_END.test(text)) tableOpen = false
      if (!tableOpen) return
      const dateFirst = DAY_MONTH.test(line.items[0].str.trim())

      if (!dateFirst) {
        if (!columns || NOT_DESCRIPTION.test(text)) return
        const more = wrapContinuation(line, columns, lastRow)
        if (lastRow && more) {
          lastRow.raw = `${lastRow.raw} ${more}`
          lastRow.y = line.y
        }
        return
      }

      rowsSeen++
      if (!columns) {
        if (!warnedNoHeader) {
          warnings.push(`Page ${page}: transaction-like lines found but no table header seen yet`)
          warnedNoHeader = true
        }
        return
      }
      if (!account || !period) {
        warnings.push(`Transaction row skipped (no ${account ? 'statement period' : 'account'}): "${text}"`)
        return
      }
      const cells = assignColumns(line, columns)
      let postedDate: string
      try { postedDate = resolveDayMonth((cells.Date ?? '').trim(), period) } catch (e) {
        warnings.push(`Transaction row skipped (${(e as Error).message}): "${text}"`)
        return
      }
      const row: ParsedRow = { postedDate, date: postedDate, description: '', amount: 0, warnings: [] }
      const amount = cells.Amount ? signedCents(cells.Amount) : undefined
      if (amount !== undefined) row.amount = amount
      else row.warnings.push('no-amount')
      const balance = cells.Balance ? signedCents(cells.Balance) : undefined
      if (balance !== undefined) row.balance = balance
      else row.warnings.push('no-balance')
      lastRow = { row, raw: cells.Description ?? '', page, y: line.y }
      pending.push(lastRow)
      account.rows.push(row)
    })
  }

  // Finalise descriptions: pull the card ref (and its purchase date) out of the Description text.
  for (const p of pending) {
    let desc = p.raw
    const ref = CARD_REF.exec(desc)
    if (ref) {
      desc = desc.replace(CARD_REF, ' ')
      if (ref[1]) {
        try { p.row.date = resolvePurchaseDate(ref[1], p.row.postedDate) } catch {
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

  // Turnover cross-check, only when the block is present.
  if (account && (turnCredit || turnDebit)) {
    const credits = account.rows.filter((r) => r.amount > 0)
    const debits = account.rows.filter((r) => r.amount <= 0)
    const sum = (rs: ParsedRow[]) => rs.reduce((s, r) => s + Math.abs(r.amount), 0)
    const diffs: string[] = []
    if (turnCredit && (turnCredit.count !== credits.length || turnCredit.total !== sum(credits))) {
      diffs.push(`credits statement ${turnCredit.count}/${turnCredit.total} vs parsed ${credits.length}/${sum(credits)}`)
    }
    if (turnDebit && (turnDebit.count !== debits.length || turnDebit.total !== sum(debits))) {
      diffs.push(`debits statement ${turnDebit.count}/${turnDebit.total} vs parsed ${debits.length}/${sum(debits)}`)
    }
    if (diffs.length) warnings.push(`turnover-mismatch: ${diffs.join('; ')} (count/cents)`)
  }

  if (rowsSeen > 0 && account && account.rows.length === 0 && period) {
    warnings.push('Transaction rows were found but none could be parsed')
  }

  return {
    bank: 'fnb',
    periodStart: period?.start ?? '',
    periodEnd: period?.end ?? '',
    accounts: account ? [account] : [],
    warnings,
  }
}
