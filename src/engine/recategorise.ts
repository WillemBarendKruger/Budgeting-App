import { UNCATEGORISED, type Rule, type Transaction, type TxKind } from '../domain/types';
import { matchRule } from './rules';
import { matchesTransferPattern, pairTransfers } from './transfers';

/** Re-derives kind/group for every non-manual transaction. Returns new objects; inputs are untouched. */
export function recategorise(txs: Transaction[], rules: Rule[], patterns: string[]): Transaction[] {
  // Manual txs and txs whose rule sets a kind are decided elsewhere; they never take part in pairing.
  const pairs = pairTransfers(
    txs.filter((t) => !t.setManually && matchRule(t, rules)?.kind === undefined),
    patterns,
  );

  return txs.map((tx) => {
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
  });
}
