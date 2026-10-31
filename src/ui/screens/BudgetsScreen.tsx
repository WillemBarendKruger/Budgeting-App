import { useState } from 'react'
import { db } from '../../db/db'
import { parseRand } from '../../domain/money'
import { UNCATEGORISED, type Group } from '../../domain/types'
import { monthSummary } from '../../engine/reports'
import BudgetBar from '../components/BudgetBar'
import MoneyText from '../components/MoneyText'
import { useAll, useSelectedMonth } from '../hooks'

/** "1 500,50" / "1500.50" / "R1,500" -> cents; undefined for empty; throws on junk or negatives. */
export function parseBudget(input: string): number | undefined {
  let s = input.trim().replace(/^R\s*/i, '').replace(/\s/g, '')
  if (s === '') return undefined
  if (/,\d{1,2}$/.test(s)) s = s.replace(/,(\d{1,2})$/, '.$1')
  const c = parseRand(s)
  if (c <= 0) throw new Error('budget must be positive')
  return c
}

function slugId(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (base && !taken.has(base)) return base
  return crypto.randomUUID()
}

const COLOURS = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#76b7b2', '#edc948', '#9c755f']

function GroupRow({ g, spent }: { g: Group; spent: number }) {
  const [error, setError] = useState('')
  const [renaming, setRenaming] = useState(false)
  const fixed = g.id === UNCATEGORISED

  async function saveBudget(value: string) {
    let budget: number | undefined
    try {
      budget = parseBudget(value)
    } catch {
      setError('Enter an amount in rands, e.g. 1500 or 1 500,50')
      return
    }
    setError('')
    await db.groups.update(g.id, { budget })
  }
  async function rename(name: string) {
    setRenaming(false)
    const n = name.trim()
    if (n && n !== g.name) await db.groups.update(g.id, { name: n })
  }

  return (
    <li className="budget-row" data-testid={`group-${g.id}`} data-hidden={g.hidden}>
      <div className="row-head">
        <span className="swatch" style={{ background: g.colour }} />
        {renaming
          ? <input aria-label={`Rename ${g.name}`} defaultValue={g.name} autoFocus
              onBlur={e => void rename(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
          : <span className="group-name">{g.name}{g.hidden && <span className="chip">hidden</span>}</span>}
        <MoneyText cents={spent} />
      </div>
      {!fixed && (
        <div className="row-actions">
          <label>Budget (R)
            <input key={g.budget ?? 'none'} inputMode="decimal" aria-label={`Budget for ${g.name}`}
              defaultValue={g.budget === undefined ? '' : (g.budget / 100).toFixed(2)}
              onBlur={e => void saveBudget(e.target.value)} />
          </label>
          <button type="button" onClick={() => setRenaming(true)}>Rename</button>
          <button type="button" onClick={() => void db.groups.update(g.id, { hidden: !g.hidden })}>{g.hidden ? 'Unhide' : 'Hide'}</button>
        </div>
      )}
      {error && <p className="notice" role="alert">{error}</p>}
      {g.budget !== undefined && <BudgetBar spent={spent} budget={g.budget} />}
    </li>
  )
}

export default function BudgetsScreen() {
  const { txs, accounts, groups, months, ready } = useAll()
  const [month] = useSelectedMonth(months)
  const [name, setName] = useState('')
  if (!ready || !txs || !accounts || !groups) return null

  const spentBy = new Map<string, number>()
  if (month) for (const g of monthSummary(txs, accounts, month).byGroup) spentBy.set(g.groupId, g.amount)

  async function add() {
    const n = name.trim()
    if (!n) return
    const taken = new Set(groups!.map(g => g.id))
    await db.groups.add({ id: slugId(n, taken), name: n, colour: COLOURS[groups!.length % COLOURS.length], hidden: false })
    setName('')
  }

  const sorted = [...groups].sort((a, b) => Number(a.id === UNCATEGORISED) - Number(b.id === UNCATEGORISED) || a.name.localeCompare(b.name))
  return (
    <>
      <h1>Budgets</h1>
      {month && <p className="muted">Spent in {month.label}</p>}
      <ul className="group-list">
        {sorted.map(g => <GroupRow key={g.id} g={g} spent={spentBy.get(g.id) ?? 0} />)}
      </ul>
      <form className="card" onSubmit={e => { e.preventDefault(); void add() }}>
        <label>New group <input value={name} onChange={e => setName(e.target.value)} /></label>{' '}
        <button type="submit" disabled={!name.trim()}>Add group</button>
      </form>
    </>
  )
}
