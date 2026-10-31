import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary, ErrorScreen } from './ErrorBoundary'

function Boom(): never {
  throw new Error('Invented render failure')
}

afterEach(() => vi.restoreAllMocks())

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(<ErrorBoundary><p>All good</p></ErrorBoundary>)
    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('shows a friendly message with Download backup and Reload when a child throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(screen.getByText(/Invented render failure/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()

    const createObjectURL = vi.fn(() => 'blob:invented')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Download backup' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
  })

  it('ErrorScreen shows a start-up failure (e.g. seeding) the same way', () => {
    render(<ErrorScreen error={new Error('Invented IndexedDB failure')} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(screen.getByText(/Invented IndexedDB failure/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download backup' })).toBeInTheDocument()
  })
})
