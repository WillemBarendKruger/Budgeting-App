import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { UNCATEGORISED } from '../../domain/types'

interface Props { value: string; onChange: (id: string) => void; includeHidden?: boolean }

export default function GroupPicker({ value, onChange, includeHidden }: Props) {
  const groups = useLiveQuery(() => db.groups.toArray(), [])
  const rank = (id: string) => (id === UNCATEGORISED ? 1 : 0)
  const shown = (groups ?? [])
    .filter(g => includeHidden || !g.hidden || g.id === value)
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
  const matched = shown.some(g => g.id === value)
  return (
    <select value={matched ? value : ''} onChange={e => onChange(e.target.value)} aria-label="Group">
      {!matched && <option value="" disabled>Choose group\u2026</option>}
      {shown.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
    </select>
  )
}
