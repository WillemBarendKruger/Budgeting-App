import { db } from './db'

export class InvalidBackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidBackupError'
  }
}

const TABLES = ['accounts', 'transactions', 'groups', 'rules', 'settings'] as const

export async function exportBackup(): Promise<Blob> {
  const [accounts, transactions, groups, rules, settings] = await Promise.all(
    TABLES.map(t => db.table(t).toArray()),
  )
  const data = { app: 'budget-app', version: 1, exportedAt: new Date().toISOString(), accounts, transactions, groups, rules, settings }
  return new Blob([JSON.stringify(data)], { type: 'application/json' })
}

function validate(text: string): Record<(typeof TABLES)[number], { id: string }[]> {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new InvalidBackupError('The file is not valid JSON.')
  }
  const d = data as Record<string, unknown> | null
  if (!d || typeof d !== 'object' || d.app !== 'budget-app') throw new InvalidBackupError('This is not a budget-app backup.')
  if (d.version !== 1) throw new InvalidBackupError('Unsupported backup version.')
  for (const t of TABLES) {
    const rows = d[t]
    if (!Array.isArray(rows)) throw new InvalidBackupError(`Backup table "${t}" is missing or not a list.`)
    for (const r of rows) {
      if (!r || typeof r !== 'object' || typeof (r as { id?: unknown }).id !== 'string') {
        throw new InvalidBackupError(`Backup table "${t}" has a row without an id.`)
      }
    }
  }
  const st = d.settings as { id: string }[]
  if (st.length !== 1 || st[0].id !== 'settings') throw new InvalidBackupError('Backup must contain exactly one settings row.')
  return d as Record<(typeof TABLES)[number], { id: string }[]>
}

/** Validates fully before touching the DB, then replaces all tables atomically. */
export async function importBackup(file: File): Promise<void> {
  const data = validate(await file.text())
  await db.transaction('rw', db.tables, async () => {
    for (const t of TABLES) {
      await db.table(t).clear()
      await db.table(t).bulkAdd(data[t])
    }
  })
}
