import type { ParsedAccount } from '../domain/types'

/**
 * Verify a parsed account's running balance: starting from `openingBalance` (or the balance implied by
 * the first row), each `previous + amount` must equal the row's balance. If `closingBalance` is set it
 * must equal the last balance. After a mismatch the row's own balance is trusted, so one bad row is
 * reported once rather than cascading. `checked` counts the balances verified; if nothing was verified
 * (no row balances and no closing balance) the result is not ok.
 */
export function checkBalances(acc: ParsedAccount): { ok: boolean; badRows: number[]; checked: number } {
  const badRows: number[] = []
  let checked = 0
  const first = acc.rows[0]
  let prev: number | undefined =
    acc.openingBalance ?? (first?.balance !== undefined ? first.balance - first.amount : undefined)
  acc.rows.forEach((r, i) => {
    if (r.balance === undefined) {
      if (prev !== undefined) prev += r.amount
      return
    }
    checked++
    if (prev !== undefined && prev + r.amount !== r.balance) badRows.push(i)
    prev = r.balance
  })
  let closingOk = true
  if (acc.closingBalance !== undefined) {
    checked++
    closingOk = prev === acc.closingBalance
  }
  return { ok: checked > 0 && badRows.length === 0 && closingOk, badRows, checked }
}
