import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { exportBackup } from '../db/backup'
import { localToday } from './hooks'

/**
 * Friendly full-page error with an escape hatch: download a backup of the local data
 * (if IndexedDB is still readable) and reload. Used by the boundary and for start-up
 * failures such as seeding, so the user never gets a blank screen.
 */
export function ErrorScreen({ error }: { error: unknown }) {
  const [downloadError, setDownloadError] = useState('')
  const detail = error instanceof Error ? error.message : String(error)

  async function download() {
    setDownloadError('')
    try {
      const url = URL.createObjectURL(await exportBackup())
      const a = document.createElement('a')
      a.href = url
      a.download = `budget-backup-${localToday()}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setDownloadError(`Could not create a backup: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }

  return (
    <main className="main">
      <div className="card" role="alert">
        <h1>Something went wrong</h1>
        <p>The app hit an unexpected error. Your data stays in this browser. Download a backup first, then reload.</p>
        <p className="muted">Details: {detail}</p>
      </div>
      <p>
        <button type="button" onClick={() => void download()}>Download backup</button>{' '}
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
      </p>
      {downloadError && <p className="notice">{downloadError}</p>}
    </main>
  )
}

interface State { error?: unknown }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {}

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    return this.state.error !== undefined ? <ErrorScreen error={this.state.error} /> : this.props.children
  }
}
