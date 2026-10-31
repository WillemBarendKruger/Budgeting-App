import { formatRand } from '../../domain/money'

export type BudgetState = 'normal' | 'amber' | 'red'

/** normal < 80%, amber 80-100%, red > 100% (integer maths, no float drift). */
export function budgetState(spent: number, budget: number): BudgetState {
  if (spent > budget) return 'red'
  return spent * 100 >= budget * 80 ? 'amber' : 'normal'
}

export default function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min(100, Math.max(0, (spent / budget) * 100)) : 100
  return (
    <div
      className="budget-bar"
      role="img"
      data-state={budgetState(spent, budget)}
      aria-label={`${formatRand(spent)} of ${formatRand(budget)}`}
    >
      <div className="budget-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}
