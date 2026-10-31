import { useRef, useState } from 'react'
import { UNCATEGORISED } from '../../domain/types'
import type { DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { commitImport, previewImport } from '../../db/importService'
import type { ImportPreview } from '../../db/importService'
import { UnsupportedStatementError, parseStatement } from '../../parsing/detect'
import { PasswordRequiredError, WrongPasswordError, extractTextItems } from '../../parsing/pdfText'
import { useAll } from '../hooks'

type Stage = 'idle' | 'working' | 'password' | 'preview'

function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error ?? new Error('Could not read file'))
    r.readAsArrayBuffer(file)
  })
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

function rowWarningSummary(rows: { warnings: string[] }[]): string[] {
  const counts = new Map<string, number>()
  for (const r of rows) for (const w of r.warnings) counts.set(w, (counts.get(w) ?? 0) + 1)
  return [...counts].map(([w, n]) =>
    w === 'missing-description'
      ? plural(n, 'row had no description', 'rows had no description')
      : `${plural(n, 'row', 'rows')}: ${w}`)
}

export default function ImportScreen() {
  const { txs } = useAll()
  const queue = useRef<File[]>([])
  const [name, setName] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [data, setData] = useState<ArrayBuffer | null>(null)
  const [password, setPassword] = useState('')
  const [wrong, setWrong] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [notices, setNotices] = useState<string[]>([])
  const [added, setAdded] = useState<number | null>(null)

  const notify = (msg: string) => setNotices(n => [...n, msg])

  async function next(): Promise<void> {
    const file = queue.current.shift()
    setPreview(null)
    setData(null)
    setWrong(false)
    setPassword('')
    if (!file) {
      setStage('idle')
      setName('')
      return
    }
    setName(file.name)
    setStage('working')
    let buf: ArrayBuffer
    try {
      buf = await readFile(file)
    } catch (e) {
      notify(`${file.name}: ${e instanceof Error ? e.message : 'could not read file'}`)
      return next()
    }
    await attempt(file.name, buf)
  }

  async function attempt(fileName: string, buf: ArrayBuffer, pw?: string): Promise<void> {
    setStage('working')
    try {
      const items = await extractTextItems(buf, pw)
      const p = await previewImport(parseStatement(items))
      setPreview(p)
      setStage('preview')
    } catch (e) {
      if (e instanceof PasswordRequiredError || e instanceof WrongPasswordError) {
        setData(buf)
        setWrong(e instanceof WrongPasswordError)
        setStage('password')
        return
      }
      notify(
        e instanceof UnsupportedStatementError
          ? `${fileName}: This statement format isn't supported (only FNB and Discovery Bank PDFs).`
          : `${fileName}: Could not read this statement (${e instanceof Error ? e.message : 'unknown error'}).`,
      )
      await next()
    }
  }

  function enqueue(files: FileList | File[] | null) {
    const list = Array.from(files ?? [])
    if (list.length === 0) return
    const idle = stage === 'idle'
    queue.current.push(...list)
    setAdded(null)
    if (idle) void next()
  }

  function submitPassword() {
    const pw = password
    setPassword('')
    if (data) void attempt(name, data, pw)
  }

  async function doImport() {
    if (!preview) return
    try {
      const { added: n } = await commitImport(preview)
      setAdded(n)
    } catch (e) {
      notify(`${name}: Import failed (${e instanceof Error ? e.message : 'unknown error'}).`)
    }
    await next()
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    enqueue(e.dataTransfer.files)
  }

  const uncategorised = (txs ?? []).filter(t => t.kind === 'expense' && (t.groupId === null || t.groupId === UNCATEGORISED)).length

  return (
    <>
      <h1>Import</h1>
      <div className="dropzone" onDragOver={e => e.preventDefault()} onDrop={onDrop}>
        <p>Drop FNB or Discovery Bank PDF statements here, or</p>
        <label>
          Choose PDF statements
          <input
            type="file"
            accept="application/pdf"
            multiple
            onChange={e => { enqueue(e.target.files); e.target.value = '' }}
          />
        </label>
        <p className="muted">Statements are read in your browser and never uploaded.</p>
      </div>

      {notices.map((n, i) => <p key={i} role="alert" className="notice">{n}</p>)}
      {added !== null && (
        <p role="status">
          <span>{`Added ${added} transactions`}</span>
          {uncategorised > 0 && <> {'—'} <Link to="/sort">Sort {uncategorised} uncategorised</Link></>}
        </p>
      )}

      {stage === 'working' && <p>Reading {name}{'…'}</p>}

      {stage === 'password' && (
        <form onSubmit={e => { e.preventDefault(); submitPassword() }}>
          <p>This PDF is password protected ({name}).</p>
          {wrong && <p role="alert">Incorrect password, try again</p>}
          <label>
            Password
            <input type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          <button type="submit">Unlock</button>
          <button type="button" onClick={() => void next()}>Skip</button>
        </form>
      )}

      {stage === 'preview' && preview && (
        <section>
          <h2>{name}</h2>
          <p>Period {preview.statement.periodStart} to {preview.statement.periodEnd}</p>
          {preview.statement.warnings.length > 0 && (
            <ul>{preview.statement.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
          {preview.accounts.map((a, i) => {
            const { ok, badRows, checked } = a.balance
            return (
              <div key={i} className="card">
                <h3>{a.parsed.typeLabel} {'••'}{a.parsed.last4}</h3>
                <p>{a.newRows} new, {a.duplicateRows} duplicates</p>
                {ok
                  ? <p>{'✓'} Balances check out</p>
                  : checked === 0
                    ? <p>{'⚠'} Couldn't verify balances</p>
                    : (
                      <p>
                        {'⚠'} Balance mismatch
                        {badRows.length > 0 && <> near {badRows.map(r => a.parsed.rows[r]?.postedDate).filter(Boolean).join(', ')}</>}
                      </p>
                    )}
                {rowWarningSummary(a.parsed.rows).map(w => <p key={w}>{w}</p>)}
              </div>
            )
          })}
          <button type="button" onClick={() => void doImport()}>Import</button>
          <button type="button" onClick={() => void next()}>Skip</button>
        </section>
      )}
    </>
  )
}
