import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { payMonths } from '../engine/payMonths'
import type { PayMonth } from '../domain/types'

/** Today's date as ISO from local parts (toISOString is UTC and can be yesterday in SAST). */
export function localToday(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function useAll() {
  const txs = useLiveQuery(() => db.transactions.toArray(), [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [])
  const groups = useLiveQuery(() => db.groups.toArray(), [])
  const rules = useLiveQuery(() => db.rules.toArray(), [])
  const settings = useLiveQuery(() => db.settings.get('settings'), [])
  const ready = !!(txs && accounts && groups && rules && settings)
  const months = useMemo(
    () => (ready ? payMonths(txs!, settings!, localToday()) : []),
    [ready, txs, settings],
  )
  return { txs, accounts, groups, rules, settings, months, ready }
}

/**
 * Selected pay month; defaults to the newest. A chosen month that no longer
 * exists in `months` falls back to the newest (derived, so always valid).
 */
export function useSelectedMonth(months: PayMonth[]) {
  const [chosen, setChosen] = useState<string | undefined>()
  const month: PayMonth | undefined = months.find(m => m.start === chosen) ?? months[0]
  return [month, (start: string) => setChosen(start)] as const
}
