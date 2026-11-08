import { cleanPayee } from '../domain/payee'
import type { Rule, Transaction } from '../domain/types'

/**
 * Re-derives every stored payee with the current `cleanPayee` and moves `equals` rules from an old
 * payee name to its new one, so learned "this payee → this group" rules keep matching. When several
 * rules end up on the same payee, the newest wins (the same tie-break `matchRule` uses: later
 * createdAt, then smaller id). Pure: inputs are not modified.
 */
export function migratePayees(txs: Transaction[], rules: Rule[]): { txs: Transaction[]; rules: Rule[] } {
  const renames = new Map<string, Set<string>>()
  const outTxs = txs.map((t) => {
    if (typeof t.description !== 'string' || typeof t.payee !== 'string') return t // incomplete row: leave it
    const payee = cleanPayee(t.description)
    if (payee === t.payee) return t
    const key = t.payee.toLowerCase()
    const targets = renames.get(key) ?? new Set<string>()
    targets.add(payee)
    renames.set(key, targets)
    return { ...t, payee }
  })

  const moved: Rule[] = []
  for (const r of rules) {
    const targets = r.matchType === 'equals' ? renames.get(r.pattern.toLowerCase()) : undefined
    if (!targets) moved.push(r)
    else [...targets].forEach((pattern, i) => moved.push({ ...r, ...(i > 0 ? { id: `${r.id}-${i}` } : {}), pattern }))
  }

  const newest = new Map<string, Rule>()
  for (const r of moved) {
    if (r.matchType !== 'equals') continue
    const key = r.pattern.toLowerCase()
    const best = newest.get(key)
    if (!best || r.createdAt > best.createdAt || (r.createdAt === best.createdAt && r.id < best.id)) newest.set(key, r)
  }
  return { txs: outTxs, rules: moved.filter((r) => r.matchType !== 'equals' || newest.get(r.pattern.toLowerCase()) === r) }
}
