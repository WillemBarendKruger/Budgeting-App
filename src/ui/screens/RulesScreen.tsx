import { useState } from 'react'
import { db } from '../../db/db'
import { reapplyRules } from '../../db/importService'
import type { MatchType, Rule, TxKind } from '../../domain/types'
import { safeRegex } from '../../engine/rules'
import GroupPicker from '../components/GroupPicker'
import { useAll } from '../hooks'

const KINDS: TxKind[] = ['expense', 'income', 'transfer', 'savings', 'reimbursement']
const TYPES: MatchType[] = ['equals', 'contains', 'regex']

interface Draft { id?: string; matchType: MatchType; pattern: string; groupId: string; kind: string; reimbursesGroupId: string }
const EMPTY: Draft = { matchType: 'contains', pattern: '', groupId: '', kind: '', reimbursesGroupId: '' }

export default function RulesScreen() {
  const { rules, groups, ready } = useAll()
  const [draft, setDraft] = useState<Draft | undefined>()
  const [error, setError] = useState('')
  if (!ready || !rules || !groups) return null
  const nameOf = (id: string) => groups.find(g => g.id === id)?.name ?? id

  async function save() {
    if (!draft) return
    const pattern = draft.pattern.trim()
    if (!pattern) return setError('Enter a pattern.')
    if (draft.matchType === 'regex' && !safeRegex(pattern)) return setError('Invalid regular expression.')
    if (!draft.groupId && !draft.kind) return setError('Choose a group or a kind.')
    if (draft.kind === 'reimbursement' && !draft.reimbursesGroupId) return setError('Choose the group this reimburses.')
    const existing = draft.id ? await db.rules.get(draft.id) : undefined
    const rule: Rule = {
      id: draft.id ?? crypto.randomUUID(),
      matchType: draft.matchType,
      pattern,
      ...(draft.groupId ? { groupId: draft.groupId } : {}),
      ...(draft.kind ? { kind: draft.kind as TxKind } : {}),
      ...(draft.kind === 'reimbursement' ? { reimbursesGroupId: draft.reimbursesGroupId } : {}),
      createdAt: existing?.createdAt ?? Date.now(),
    }
    await db.rules.put(rule)
    await reapplyRules()
    setDraft(undefined)
    setError('')
  }

  async function remove(id: string) {
    await db.rules.delete(id)
    await reapplyRules()
  }

  const sorted = [...rules].sort((a, b) => a.pattern.localeCompare(b.pattern))
  return (
    <>
      <h1>Rules</h1>
      <p><button type="button" onClick={() => { setDraft({ ...EMPTY }); setError('') }}>Add rule</button></p>
      {draft && (
        <form className="card" aria-label="Rule form" onSubmit={e => { e.preventDefault(); void save() }}>
          <label>Match <select aria-label="Match type" value={draft.matchType} onChange={e => setDraft({ ...draft, matchType: e.target.value as MatchType })}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></label>{' '}
          <label>Pattern <input aria-label="Pattern" value={draft.pattern} onChange={e => setDraft({ ...draft, pattern: e.target.value })} /></label>{' '}
          <label>Group <GroupPicker value={draft.groupId} onChange={id => setDraft({ ...draft, groupId: id })} /></label>{' '}
          <label>Kind <select aria-label="Kind" value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value, reimbursesGroupId: e.target.value === 'reimbursement' ? draft.reimbursesGroupId : '' })}>
            <option value="">(unchanged)</option>{KINDS.map(k => <option key={k} value={k}>{k}</option>)}</select></label>
          {draft.kind === 'reimbursement' && (
            <label> Reimburses group <GroupPicker value={draft.reimbursesGroupId} onChange={id => setDraft({ ...draft, reimbursesGroupId: id })} /></label>
          )}
          {error && <p className="notice" role="alert">{error}</p>}
          <div className="actions">
            <button type="submit">Save rule</button>
            <button type="button" onClick={() => { setDraft(undefined); setError('') }}>Cancel</button>
          </div>
        </form>
      )}
      <ul className="group-list">
        {sorted.map(r => (
          <li key={r.id} className="group-row" data-testid={`rule-${r.id}`}>
            <code className="group-name">{r.pattern}</code>
            <span className="chip">{r.matchType}</span>
            <span>{[r.groupId && nameOf(r.groupId), r.kind].filter(Boolean).join(' / ')}</span>
            <button type="button" onClick={() => { setDraft({ id: r.id, matchType: r.matchType, pattern: r.pattern, groupId: r.groupId ?? '', kind: r.kind ?? '', reimbursesGroupId: r.reimbursesGroupId ?? '' }); setError('') }}>Edit</button>
            <button type="button" onClick={() => void remove(r.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </>
  )
}
