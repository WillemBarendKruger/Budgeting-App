import { UNCATEGORISED, type Rule, type Transaction, type TxKind } from '../domain/types'
import { db } from './db'
import { reapplyRules } from './importService'

/**
 * Upserts the single `equals` rule for this tx's payee (case-insensitive),
 * clears `setManually` on the tx so the rule applies to it, then re-runs rules.
 * When an existing equals rule is replaced and the new fields don't set `kind`,
 * the old rule's kind (and its reimbursesGroupId for a reimbursement) is kept,
 * so re-grouping never silently reverts the payee's converted txs.
 */
async function upsertPayeeRule(txId: string, fields: Pick<Rule, 'kind' | 'groupId' | 'reimbursesGroupId'>): Promise<void> {
  // Rule upsert and reapply share one transaction: a failure can't leave a saved rule with stale txs.
  await db.transaction('rw', [db.transactions, db.rules, db.settings], async () => {
    const tx = await db.transactions.get(txId)
    if (!tx) throw new Error(`Transaction not found: ${txId}`)
    const key = tx.payee.toLowerCase()
    const stale = (await db.rules.toArray()).filter(r => r.matchType === 'equals' && r.pattern.toLowerCase() === key)
    await db.rules.bulkDelete(stale.map(r => r.id))
    const rule: Rule = { id: crypto.randomUUID(), matchType: 'equals', pattern: tx.payee, createdAt: Date.now() }
    const previous = stale.find(r => r.kind !== undefined)
    if (fields.kind !== undefined) rule.kind = fields.kind
    else if (previous?.kind !== undefined) {
      rule.kind = previous.kind
      if (previous.kind === 'reimbursement' && previous.reimbursesGroupId !== undefined && fields.reimbursesGroupId === undefined) {
        rule.reimbursesGroupId = previous.reimbursesGroupId
      }
    }
    if (fields.groupId !== undefined) rule.groupId = fields.groupId
    if (fields.reimbursesGroupId !== undefined) rule.reimbursesGroupId = fields.reimbursesGroupId
    await db.rules.add(rule)
    await db.transactions.update(txId, { setManually: false })
    await reapplyRules()
  })
}

/**
 * Marks one tx as manually set. Rules are then re-applied in the same transaction so that a
 * paired transfer leg that stops being a transfer never leaves its partner with a stale
 * transferPairId (non-manual partner is re-derived; a manual partner's dangling id is dropped).
 */
async function setManual(txId: string, kind: TxKind, groupId: string | null, reimbursesGroupId?: string): Promise<void> {
  await db.transaction('rw', [db.transactions, db.rules, db.settings], async () => {
    const tx = await db.transactions.get(txId)
    if (!tx) throw new Error(`Transaction not found: ${txId}`)
    const { reimbursesGroupId: _r, transferPairId: _p, ...rest } = tx
    const next: Transaction = { ...rest, kind, groupId, setManually: true }
    if (kind === 'reimbursement' && reimbursesGroupId !== undefined) next.reimbursesGroupId = reimbursesGroupId
    if (kind === 'transfer' && tx.transferPairId !== undefined) next.transferPairId = tx.transferPairId
    await db.transactions.put(next)
    await reapplyRules()
  })
}

export async function setGroup(txId: string, groupId: string, applyToAll = true): Promise<void> {
  if (applyToAll) {
    // A groupId-only rule leaves the payee's credits/transfers alone (recategorise
    // only gives groupId to computed expenses). The shape is decided from the tx's
    // state BEFORE upsertPayeeRule clears setManually: a manual tx's kind may be the
    // user's override (rules might compute transfer/income for it), so a manual tx or
    // a non-expense gets `kind: 'expense'` and stays an expense in the chosen group.
    const tx = await db.transactions.get(txId)
    if (!tx) throw new Error(`Transaction not found: ${txId}`)
    const needsKind = tx.setManually || tx.kind !== 'expense'
    return upsertPayeeRule(txId, needsKind ? { kind: 'expense', groupId } : { groupId })
  }
  return setManual(txId, 'expense', groupId)
}

export async function setKind(
  txId: string,
  kind: TxKind,
  opts: { reimbursesGroupId?: string; applyToAll: boolean },
): Promise<void> {
  if (kind === 'expense' && opts.applyToAll) throw new Error('Use setGroup to create an expense rule')
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
