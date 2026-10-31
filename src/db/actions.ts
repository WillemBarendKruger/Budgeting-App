import { UNCATEGORISED, type Rule, type Transaction, type TxKind } from '../domain/types'
import { db } from './db'
import { reapplyRules } from './importService'

/**
 * Upserts the single `equals` rule for this tx's payee (case-insensitive),
 * clears `setManually` on the tx so the rule applies to it, then re-runs rules.
 * Rules always carry `kind` (even 'expense'): explicitly grouping a previously
 * income/transfer tx turns it into an expense.
 */
async function upsertPayeeRule(txId: string, fields: Pick<Rule, 'kind' | 'groupId' | 'reimbursesGroupId'>): Promise<void> {
  await db.transaction('rw', [db.transactions, db.rules], async () => {
    const tx = await db.transactions.get(txId)
    if (!tx) throw new Error(`Transaction not found: ${txId}`)
    const key = tx.payee.toLowerCase()
    const stale = (await db.rules.toArray()).filter(r => r.matchType === 'equals' && r.pattern.toLowerCase() === key)
    await db.rules.bulkDelete(stale.map(r => r.id))
    const rule: Rule = { id: crypto.randomUUID(), matchType: 'equals', pattern: tx.payee, createdAt: Date.now() }
    if (fields.kind !== undefined) rule.kind = fields.kind
    if (fields.groupId !== undefined) rule.groupId = fields.groupId
    if (fields.reimbursesGroupId !== undefined) rule.reimbursesGroupId = fields.reimbursesGroupId
    await db.rules.add(rule)
    await db.transactions.update(txId, { setManually: false })
  })
  await reapplyRules()
}

async function setManual(txId: string, kind: TxKind, groupId: string | null, reimbursesGroupId?: string): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const tx = await db.transactions.get(txId)
    if (!tx) throw new Error(`Transaction not found: ${txId}`)
    const { reimbursesGroupId: _r, transferPairId: _p, ...rest } = tx
    const next: Transaction = { ...rest, kind, groupId, setManually: true }
    if (kind === 'reimbursement' && reimbursesGroupId !== undefined) next.reimbursesGroupId = reimbursesGroupId
    if (kind === 'transfer' && tx.transferPairId !== undefined) next.transferPairId = tx.transferPairId
    await db.transactions.put(next)
  })
}

export async function setGroup(txId: string, groupId: string, applyToAll = true): Promise<void> {
  if (applyToAll) return upsertPayeeRule(txId, { kind: 'expense', groupId })
  return setManual(txId, 'expense', groupId)
}

export async function setKind(
  txId: string,
  kind: TxKind,
  opts: { reimbursesGroupId?: string; applyToAll: boolean },
): Promise<void> {
  if (kind === 'reimbursement' && !opts.reimbursesGroupId) throw new Error('A reimbursement needs the group it reimburses')
  const reimburses = kind === 'reimbursement' ? opts.reimbursesGroupId : undefined
  if (opts.applyToAll) {
    return upsertPayeeRule(txId, { kind, ...(reimburses !== undefined ? { reimbursesGroupId: reimburses } : {}) })
  }
  if (kind === 'expense') {
    const tx = await db.transactions.get(txId)
    return setManual(txId, 'expense', tx?.groupId ?? UNCATEGORISED)
  }
  return setManual(txId, kind, null, reimburses)
}

/** Only this tx; `unplanned` is never overwritten by rules, so `setManually` is untouched. */
export async function setUnplanned(txId: string, unplanned: boolean, tag?: string): Promise<void> {
  const trimmed = tag?.trim()
  await db.transaction('rw', db.transactions, async () => {
    const tx = await db.transactions.get(txId)
    if (!tx) throw new Error(`Transaction not found: ${txId}`)
    const { unplannedTag: _t, ...rest } = tx
    const next: Transaction = { ...rest, unplanned }
    if (unplanned && trimmed) next.unplannedTag = trimmed
    await db.transactions.put(next)
  })
}
