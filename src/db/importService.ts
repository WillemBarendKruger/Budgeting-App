import type { Account, ParsedAccount, ParsedRow, ParsedStatement, Transaction } from '../domain/types'
import { cleanPayee, normaliseDescription } from '../domain/payee'
import { recategorise } from '../engine/recategorise'
import { checkBalances } from '../parsing/check'
import { db } from './db'
import { DEFAULT_TRANSFER_PATTERNS } from './seed'

export interface ImportPreview {
  statement: ParsedStatement
  accounts: {
    parsed: ParsedAccount
    existingAccountId?: string
    newRows: number
    duplicateRows: number
    balance: { ok: boolean; badRows: number[]; checked: number }
  }[]
}

export function importHash(accountId: string, r: ParsedRow): string {
  return `${accountId}|${r.postedDate}|${r.amount}|${normaliseDescription(r.description)}|${r.balance ?? ''}`
}

/**
 * Account identity is bank + last4. The parsed typeLabel is free text lifted from the
 * statement and may differ between statements of the same account, so it is used only
 * to name a NEW account; an existing account is reused untouched (its typeLabel and the
 * user's name are never overwritten by a later statement).
 */
async function findAccount(a: ParsedAccount): Promise<Account | undefined> {
  return db.accounts.where('[bank+last4]').equals([a.bank, a.last4]).first()
}

async function existingHashCounts(accountId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  await db.transactions.where('accountId').equals(accountId).each((t) => {
    counts.set(t.importHash, (counts.get(t.importHash) ?? 0) + 1)
  })
  return counts
}

/** Multiset dedupe: per hash, new = max(0, countInStatement - countExisting). Returns the new rows (with hashes). */
function splitNewRows(accountId: string, rows: ParsedRow[], existing: Map<string, number>) {
  const seen = new Map<string, number>()
  const fresh: { row: ParsedRow; hash: string }[] = []
  for (const row of rows) {
    const hash = importHash(accountId, row)
    const n = (seen.get(hash) ?? 0) + 1
    seen.set(hash, n)
    if (n > (existing.get(hash) ?? 0)) fresh.push({ row, hash })
  }
  return fresh
}

/** Reads only; never writes. */
export async function previewImport(s: ParsedStatement): Promise<ImportPreview> {
  const accounts: ImportPreview['accounts'] = []
  for (const parsed of s.accounts) {
    const existing = await findAccount(parsed)
    const newCount = existing
      ? splitNewRows(existing.id, parsed.rows, await existingHashCounts(existing.id)).length
      : parsed.rows.length
    const duplicateRows = parsed.rows.length - newCount
    const { ok, badRows, checked } = checkBalances(parsed)
    accounts.push({
      parsed,
      existingAccountId: existing?.id,
      newRows: newCount,
      duplicateRows,
      balance: { ok, badRows, checked },
    })
  }
  return { statement: s, accounts }
}

async function recategoriseAll(): Promise<void> {
  const [txs, rules, settings] = await Promise.all([
    db.transactions.toArray(),
    db.rules.toArray(),
    db.settings.get('settings'),
  ])
  const updated = recategorise(txs, rules, settings?.transferPatterns ?? DEFAULT_TRANSFER_PATTERNS)
  const changed = updated.filter((u, i) => JSON.stringify(u) !== JSON.stringify(txs[i]))
  if (changed.length) await db.transactions.bulkPut(changed)
}

export async function commitImport(p: ImportPreview): Promise<{ added: number }> {
  let added = 0
  await db.transaction('rw', [db.accounts, db.transactions, db.rules, db.settings], async () => {
    const toAdd: Transaction[] = []
    for (const entry of p.accounts) {
      const a = entry.parsed
      let account = await findAccount(a)
      if (!account) {
        account = {
          id: crypto.randomUUID(),
          bank: a.bank,
          typeLabel: a.typeLabel,
          last4: a.last4,
          name: `${a.typeLabel} ••${a.last4}`,
          role: a.role,
        }
        await db.accounts.add(account)
      }
      const existing = await existingHashCounts(account.id)
      for (const { row: r, hash } of splitNewRows(account.id, a.rows, existing)) {
        toAdd.push({
          id: crypto.randomUUID(),
          accountId: account.id,
          date: r.date,
          postedDate: r.postedDate,
          description: r.description,
          payee: cleanPayee(r.description),
          amount: r.amount,
          ...(r.balance !== undefined ? { balance: r.balance } : {}),
          groupId: null,
          kind: r.amount < 0 ? 'expense' : 'income',
          unplanned: false,
          setManually: false,
          importHash: hash,
        })
      }
    }
    await db.transactions.bulkAdd(toAdd)
    added = toAdd.length
    await recategoriseAll()
  })
  return { added }
}

export async function reapplyRules(): Promise<void> {
  await db.transaction('rw', [db.transactions, db.rules, db.settings], recategoriseAll)
}
