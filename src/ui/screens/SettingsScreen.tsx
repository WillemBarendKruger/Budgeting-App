import { useState } from 'react'
import { db } from '../../db/db'
import { exportBackup, importBackup } from '../../db/backup'
import { reapplyRules } from '../../db/importService'
import type { AccountRole, Settings } from '../../domain/types'
import { suggestSalaryPattern } from '../../engine/payMonths'
import { safeRegex } from '../../engine/rules'
import { localToday, useAll } from '../hooks'

const ROLES: AccountRole[] = ['everyday', 'credit', 'savings']

function SettingsForm({ settings, suggestion }: { settings: Settings; suggestion?: string }) {
  const [salary, setSalary] = useState(settings.salaryPattern ?? suggestion ?? '')
  const [payday, setPayday] = useState(String(settings.fallbackPayday))
  const [patterns, setPatterns] = useState(settings.transferPatterns.join('\n'))
  const [errors, setErrors] = useState<string[]>([])
  const [saved, setSaved] = useState(false)

  async function save() {
    const errs: string[] = []
    const sal = salary.trim()
    if (sal && !safeRegex(sal)) errs.push('Salary pattern is not a valid regular expression.')
    const day = Number(payday)
    if (!/^\d+$/.test(payday.trim()) || day < 1 || day > 31) errs.push('Payday must be a whole number from 1 to 31.')
    const list = patterns.split('\n').map(l => l.trim()).filter(Boolean)
    for (const p of list) if (!safeRegex(p)) errs.push(`Invalid transfer pattern: ${p}`)
    setErrors(errs)
    setSaved(false)
    if (errs.length) return
    await db.settings.update('settings', { salaryPattern: sal || undefined, fallbackPayday: day, transferPatterns: list })
    await reapplyRules()
    setSaved(true)
  }

  return (
    <form className="card" onSubmit={e => { e.preventDefault(); void save() }}>
      <label>Salary pattern <input aria-label="Salary pattern" value={salary} onChange={e => setSalary(e.target.value)} /></label>
      {!settings.salaryPattern && suggestion && <p className="muted">Suggested (auto-applied until you save)</p>}
      {suggestion && <button type="button" onClick={() => setSalary(suggestion)}>Use suggestion</button>}
      <p><label>Fallback payday (1-31) <input aria-label="Fallback payday" inputMode="numeric" value={payday} onChange={e => setPayday(e.target.value)} /></label></p>
      <p><label>Transfer patterns (one per line)<br />
        <textarea aria-label="Transfer patterns" rows={6} value={patterns} onChange={e => setPatterns(e.target.value)} /></label></p>
      {errors.map(e => <p key={e} className="notice" role="alert">{e}</p>)}
      {saved && <p role="status">Saved.</p>}
      <button type="submit">Save settings</button>
    </form>
  )
}

export default function SettingsScreen() {
  const { txs, accounts, settings, ready } = useAll()
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()
  if (!ready || !txs || !accounts || !settings) return null

  async function doExport() {
    const url = URL.createObjectURL(await exportBackup())
    const a = document.createElement('a')
    a.href = url
    a.download = `budget-backup-${localToday()}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function doImport(file: File) {
    if (!window.confirm('Importing replaces ALL data in this browser with the backup. Continue?')) return
    try {
      await importBackup(file)
      setMessage({ ok: true, text: 'Backup imported.' })
    } catch (e) {
      setMessage({ ok: false, text: `Import failed: ${e instanceof Error ? e.message : 'unknown error'}` })
    }
  }

  return (
    <>
      <h1>Settings</h1>
      <SettingsForm key={JSON.stringify(settings)} settings={settings} suggestion={suggestSalaryPattern(txs)} />

      <h2>Accounts</h2>
      <ul className="group-list">
        {accounts.map(a => (
          <li key={a.id} className="group-row">
            <input aria-label={`Name for ${a.typeLabel} ${a.last4}`} defaultValue={a.name}
              onBlur={e => { const n = e.target.value.trim(); if (n && n !== a.name) void db.accounts.update(a.id, { name: n }) }} />
            <span className="muted">{a.bank} ••{a.last4}</span>
            <select aria-label={`Role for ${a.name}`} value={a.role}
              onChange={async e => { await db.accounts.update(a.id, { role: e.target.value as AccountRole }); await reapplyRules() }}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </li>
        ))}
      </ul>

      <h2>Backup</h2>
      <p className="muted">Your data lives only in this browser. Export a backup regularly.</p>
      <div className="card">
        <button type="button" onClick={() => void doExport()}>Export backup</button>{' '}
        <label>Import backup <input type="file" accept="application/json,.json" aria-label="Import backup"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void doImport(f) }} /></label>
        {message && <p role={message.ok ? 'status' : 'alert'} className={message.ok ? undefined : 'notice'}>{message.text}</p>}
      </div>
    </>
  )
}
