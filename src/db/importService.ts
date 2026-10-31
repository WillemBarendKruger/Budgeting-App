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
    balance: { ok: boolean; badRows: number[] }
  }[]
}

export function importHash(accountId: string, r: ParsedRow): string {
  return `${accountId}|${r.postedDate}|${r.amount}|${normaliseDescription(r.description)}|${r.balance ?? ''}`
}

async function findAccount(a: ParsedAccount): Promise<Account | undefined> {
  return db.accounts.where('[bank+last4+typeLabel]').equals([a.bank, a.last4, a.typeLabel]).first()
}

async function existingHashes(accountId: string): Promise<Set<string>> {
  const txs = await db.transactions.where('accountId').equals(accountId).toArray()
  return new Set(txs.map((t) => t.importHash))
}

/** Reads only; never writes. */
export async function previewImport(s: ParsedStatement): Promise<ImportPreview> {
  const accounts: ImportPreview['accounts'] = []
  for (const parsed of s.accounts) {
    const existing = await findAccount(parsed)
    const seen = existing ? await existingHashes(existing.id) : new Set<string>()
    const duplicateRows = existing ? parsed.rows.filter((r) => seen.has(importHash(existing.id, r))).length : 0
    const { ok, badRows } = checkBalances(parsed)
    accounts.push({
      parsed,
      existingAccountId: existing?.id,
      newRows: parsed.rows.length - duplicateRows,
      duplicateRows,
      balance: { ok, badRows },
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
      const seen = await existingHashes(account.id)
      for (const r of a.rows) {
        const hash = importHash(account.id, r)
        if (seen.has(hash)) continue
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
