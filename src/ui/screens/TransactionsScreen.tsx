import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { setGroup, setKind, setUnplanned } from '../../db/actions'
import type { Transaction, TxKind } from '../../domain/types'
import { payMonthFor } from '../../engine/payMonths'
import GroupPicker from '../components/GroupPicker'
import MoneyText from '../components/MoneyText'
import { useAll } from '../hooks'

const KINDS: TxKind[] = ['expense', 'income', 'transfer', 'savings', 'reimbursement']
const PAGE = 300

/**
 * URL contract: `month` is a pay-month start; absent or unknown means all months.
 * `group` is a group id; absent means all groups.
 */
export default function TransactionsScreen() {
  const { txs, accounts, groups, months, ready } = useAll()
  const [params, setParams] = useSearchParams()
  const [kind, setKindFilter] = useState('')
  const [q, setQ] = useState('')
  const [unplannedOnly, setUnplannedOnly] = useState(false)
  const [tag, setTag] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [editing, setEditing] = useState<Transaction | null>(null)

  const monthStart = params.get('month') ?? ''
  const groupId = params.get('group') ?? ''
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const accountName = useMemo(() => new Map((accounts ?? []).map(a => [a.id, a.name])), [accounts])
  const groupById = useMemo(() => new Map((groups ?? []).map(g => [g.id, g])), [groups])
  const tags = useMemo(
    () => [...new Set((txs ?? []).map(t => t.unplannedTag).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b)),
    [txs],
  )

  const rows = useMemo(() => {
    const month = months.find(m => m.start === monthStart)
    const needle = q.trim().toLowerCase()
    return (txs ?? [])
      .filter(t => {
        if (month && payMonthFor(t.date, months)?.start !== month.start) return false
        // Reimbursements of the group are listed too: the Overview figure is net of them.
        if (groupId && t.groupId !== groupId && t.reimbursesGroupId !== groupId) return false
        if (kind && t.kind !== kind) return false
        if (unplannedOnly && !t.unplanned) return false
        if (tag && t.unplannedTag !== tag) return false
        if (needle && !t.payee.toLowerCase().includes(needle) && !t.description.toLowerCase().includes(needle)) return false
        return true
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.postedDate.localeCompare(a.postedDate) || (a.id < b.id ? -1 : 1))
  }, [txs, months, monthStart, groupId, kind, q, unplannedOnly, tag])

  if (!ready || !txs || !accounts || !groups) return null

  const chipFor = (t: Transaction) =>
    t.kind === 'expense' ? (groupById.get(t.groupId ?? '')?.name ?? 'Uncategorised') : t.kind

  return (
    <>
      <h1>Transactions</h1>
      <div className="filters card">
        <label>Month
          <select value={months.some(m => m.start === monthStart) ? monthStart : ''} onChange={e => { setParam('month', e.target.value); setLimit(PAGE) }}>
            <option value="">All</option>
            {months.map(m => <option key={m.start} value={m.start}>{m.label}</option>)}
          </select>
        </label>
        <label>Group
          <select value={groupId} onChange={e => { setParam('group', e.target.value); setLimit(PAGE) }}>
            <option value="">All</option>
            {groupId && !groupById.has(groupId) && <option value={groupId}>{groupId}</option>}
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <label>Kind
          <select value={kind} onChange={e => { setKindFilter(e.target.value); setLimit(PAGE) }}>
            <option value="">All</option>
            {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label>Search
          <input type="search" value={q} onChange={e => { setQ(e.target.value); setLimit(PAGE) }} />
        </label>
        <label>
          <input type="checkbox" checked={unplannedOnly} onChange={e => { setUnplannedOnly(e.target.checked); setLimit(PAGE) }} /> Unplanned only
        </label>
        <label>Tag
          <select value={tag} onChange={e => { setTag(e.target.value); setLimit(PAGE) }}>
            <option value="">Any</option>
            {tags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      <p className="muted" aria-live="polite">{rows.length} transaction{rows.length === 1 ? '' : 's'}</p>
      <ul className="group-list">
        {rows.slice(0, limit).map(t => (
          <li key={t.id}>
            <button type="button" className="tx-row" data-testid="tx-row" onClick={() => setEditing(t)}>
              <span className="tx-date muted">{t.date}</span>
              <span className="tx-payee">{t.payee}{t.unplanned && <span className="badge badge-warn">{t.unplannedTag ?? 'unplanned'}</span>}</span>
              <span className="tx-account muted">{accountName.get(t.accountId) ?? ''}</span>
              <MoneyText cents={t.amount} colourBySign />
              <span className="chip">{chipFor(t)}</span>
            </button>
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <p><button type="button" onClick={() => setLimit(l => l + PAGE)}>Show more</button></p>
      )}

      {editing && (
        <EditPanel
          key={editing.id}
          tx={txs.find(t => t.id === editing.id) ?? editing}
          tags={tags}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function EditPanel({ tx, tags, onClose }: { tx: Transaction; tags: string[]; onClose: () => void }) {
  const [group, setGroupDraft] = useState(tx.groupId ?? '')
  const [kind, setKindDraft] = useState<TxKind>(tx.kind)
  const [reimburses, setReimburses] = useState(tx.reimbursesGroupId ?? '')
  const [applyAll, setApplyAll] = useState(true)
  const [unplanned, setUnplannedDraft] = useState(tx.unplanned)
  const [tag, setTagDraft] = useState(tx.unplannedTag ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const needsGroup = kind === 'expense' && !group
  const needsReimburses = kind === 'reimbursement' && !reimburses
  const invalid = needsGroup || needsReimburses

  const save = async () => {
    if (busy || invalid) return
    setBusy(true)
    setError('')
    try {
      if (kind === 'expense') {
        if (tx.kind !== 'expense' || tx.groupId !== group) await setGroup(tx.id, group, applyAll)
      } else if (tx.kind !== kind || (kind === 'reimbursement' && tx.reimbursesGroupId !== reimburses)) {
        await setKind(tx.id, kind, { reimbursesGroupId: kind === 'reimbursement' ? reimburses : undefined, applyToAll: applyAll })
      }
      if (unplanned !== tx.unplanned || (unplanned && tag.trim() !== (tx.unplannedTag ?? ''))) {
        await setUnplanned(tx.id, unplanned, tag)
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
      setBusy(false)
    }
  }

  return (
    <div className="edit-panel card" role="dialog" aria-label="Edit transaction">
      <h2>{tx.payee}</h2>
      <p className="muted">{tx.date} · {tx.description}</p>
      <label>Kind
        <select value={kind} onChange={e => setKindDraft(e.target.value as TxKind)} aria-label="Kind">
          {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      {kind === 'expense' && (
        <label>Group <GroupPicker value={group} onChange={setGroupDraft} /></label>
      )}
      {kind === 'reimbursement' && (
        <label>Reimburses group <GroupPicker value={reimburses} onChange={setReimburses} /></label>
      )}
      <label>
        <input type="checkbox" checked={applyAll} onChange={e => setApplyAll(e.target.checked)} /> {`Apply to all from ${tx.payee}`}
      </label>
      <label>
        <input type="checkbox" checked={unplanned} onChange={e => setUnplannedDraft(e.target.checked)} /> Unplanned
      </label>
      {unplanned && (
        <label>Tag
          <input list="tx-tags" value={tag} onChange={e => setTagDraft(e.target.value)} aria-label="Tag" />
          <datalist id="tx-tags">{tags.map(t => <option key={t} value={t} />)}</datalist>
        </label>
      )}
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" onClick={save} disabled={busy || invalid}>Save</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
