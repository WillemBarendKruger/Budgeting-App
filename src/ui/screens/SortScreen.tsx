import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { setGroup } from '../../db/actions'
import { UNCATEGORISED } from '../../domain/types'
import GroupPicker from '../components/GroupPicker'
import MoneyText from '../components/MoneyText'
import { useAll } from '../hooks'

interface PayeeRow { payee: string; firstId: string; count: number; total: number }

export default function SortScreen() {
  const { txs, ready } = useAll()
  const [error, setError] = useState('')
  const sort = (id: string, g: string) => {
    setError('')
    setGroup(id, g, true).catch(e => setError(e instanceof Error ? e.message : 'Could not save'))
  }
  const rows = useMemo(() => {
    const byPayee = new Map<string, PayeeRow>()
    for (const t of txs ?? []) {
      if (t.kind !== 'expense' || (t.groupId !== null && t.groupId !== UNCATEGORISED)) continue
      const r = byPayee.get(t.payee) ?? { payee: t.payee, firstId: t.id, count: 0, total: 0 }
      r.count += 1
      r.total += t.amount
      byPayee.set(t.payee, r)
    }
    // amounts are negative, so ascending total = biggest spend first
    return [...byPayee.values()].sort((a, b) => a.total - b.total || a.payee.localeCompare(b.payee))
  }, [txs])

  if (!ready) return null
  if (rows.length === 0) {
    return (
      <>
        <h1>Sort</h1>
        <p>Everything is sorted</p>
        <p><Link to="/">Back to Overview</Link></p>
      </>
    )
  }
  return (
    <>
      <h1>Sort</h1>
      <p className="muted">Pick a group once and it applies to every transaction from that payee, now and on future imports.</p>
      {error && <p className="notice" role="alert">{error}</p>}
      <ul className="group-list">
        {rows.map(r => (
          <li key={r.payee} className="group-row" data-testid="sort-row">
            <span className="group-name">
              {r.payee} <span className="muted">({r.count})</span>
            </span>
            <MoneyText cents={r.total} colourBySign />
            <GroupPicker value="" onChange={g => sort(r.firstId, g)} />
          </li>
        ))}
      </ul>
    </>
  )
}
