import { UNCATEGORISED, type Rule, type Transaction, type TxKind } from '../domain/types';
import { matchRule } from './rules';
import { matchesTransferPattern, pairTransfers } from './transfers';

/**
 * Re-derives kind/group for every non-manual transaction. Returns new objects; inputs are untouched.
 *
 * Pairing:
 * - A manual 'transfer' tx with a transferPairId keeps its pair: the partner (if non-manual and its
 *   rule doesn't set a non-transfer kind) is reserved for it and becomes the matching transfer leg.
 * - Other manual txs never take part in pairing. Non-manual txs whose rule sets a kind other than
 *   'transfer' are excluded; a rule with kind 'transfer' counts as a flagged (recognised) side.
 * - The only change ever made to a manual tx is dropping a dangling transferPairId whose partner
 *   no longer points back (kind/group/notes are never touched).
 */
export function recategorise(txs: Transaction[], rules: Rule[], patterns: string[]): Transaction[] {
  const byId = new Map(txs.map((t) => [t.id, t]));
  const ruleKind = (t: Transaction) => matchRule(t, rules)?.kind;
  const canPair = (t: Transaction) => {
    const k = ruleKind(t);
    return k === undefined || k === 'transfer';
  };

  // Pairs kept from a manual transfer leg to its non-manual partner.
  const reserved = new Map<string, string>();
  for (const m of txs) {
    if (!m.setManually || m.kind !== 'transfer' || m.transferPairId === undefined) continue;
    const p = byId.get(m.transferPairId);
    if (!p || p.setManually || reserved.has(p.id) || !canPair(p)) continue;
    reserved.set(p.id, m.id);
  }

  const eligible = txs.filter((t) => !t.setManually && !reserved.has(t.id) && canPair(t));
  const ruleTransfers = new Set(eligible.filter((t) => ruleKind(t) === 'transfer').map((t) => t.id));
  const pairs = pairTransfers(eligible, patterns, ruleTransfers);
  for (const [p, m] of reserved) pairs.set(p, m);

  const out = txs.map((tx) => categoriseOne(tx, pairs, rules, patterns));

  // No dangling pairs: a manual leg whose partner doesn't point back loses its transferPairId.
  const outById = new Map(out.map((t) => [t.id, t]));
  return out.map((t) => {
    if (!t.setManually || t.transferPairId === undefined) return t;
    if (outById.get(t.transferPairId)?.transferPairId === t.id) return t;
    const { transferPairId: _p, ...rest } = t;
    return rest;
  });
}

function categoriseOne(tx: Transaction, pairs: Map<string, string>, rules: Rule[], patterns: string[]): Transaction {
  if (tx.setManually) return tx;

  const { reimbursesGroupId: _r, transferPairId: _p, ...rest } = tx;
  let kind: TxKind = tx.amount < 0 ? 'expense' : 'income';
  let groupId: string | null = null;
  let reimbursesGroupId: string | undefined;
  let transferPairId: string | undefined;

  const partner = pairs.get(tx.id);
  if (partner) {
    kind = 'transfer';
    transferPairId = partner;
  } else if (matchesTransferPattern(tx.description, patterns)) {
    kind = 'transfer';
  }

  const rule = matchRule(tx, rules);
  if (rule) {
    if (rule.kind) kind = rule.kind;
    if (rule.groupId !== undefined) groupId = rule.groupId;
    if (rule.reimbursesGroupId !== undefined) reimbursesGroupId = rule.reimbursesGroupId;
  }

  if (kind === 'expense') groupId = groupId ?? UNCATEGORISED;
  else groupId = null;

  const out: Transaction = { ...rest, kind, groupId };
  if (kind === 'reimbursement' && reimbursesGroupId !== undefined) out.reimbursesGroupId = reimbursesGroupId;
  if (kind === 'transfer' && transferPairId !== undefined) out.transferPairId = transferPairId;
  return out;
}
