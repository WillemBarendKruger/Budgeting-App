import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { seedIfEmpty } from '../../db/seed'
import type { ParsedStatement } from '../../domain/types'
import { PasswordRequiredError, WrongPasswordError } from '../../parsing/pdfText'
import { UnsupportedStatementError } from '../../parsing/detect'
import ImportScreen from './ImportScreen'

vi.mock('../../parsing/pdfText', async (orig) => {
  const actual = await orig<typeof import('../../parsing/pdfText')>()
  return { ...actual, extractTextItems: vi.fn() }
})
vi.mock('../../parsing/detect', async (orig) => {
  const actual = await orig<typeof import('../../parsing/detect')>()
  return { ...actual, parseStatement: vi.fn() }
})
import { extractTextItems } from '../../parsing/pdfText'
import { parseStatement } from '../../parsing/detect'

const row = (d: string, amount: number, balance: number, description = 'Shop') =>
  ({ postedDate: d, date: d, description, amount, balance, warnings: [] as string[] })

const statement: ParsedStatement = {
  bank: 'fnb', periodStart: '2026-01-01', periodEnd: '2026-01-31', warnings: ['Check the totals'],
  accounts: [{
    bank: 'fnb', typeLabel: 'Cheque', last4: '1234', role: 'everyday', openingBalance: 10000,
    closingBalance: 10000 - 100 - 200 - 300,
    rows: [row('2026-01-02', -100, 9900), row('2026-01-03', -200, 9700), row('2026-01-04', -300, 9400, '')]
      .map((r, i) => (i === 2 ? { ...r, warnings: ['missing-description'] } : r)),
  }],
}

const pdf = () => new File([new Uint8Array([1, 2, 3])], 'jan.pdf', { type: 'application/pdf' })

function upload(input: HTMLElement, files: File | File[]) {
  fireEvent.change(input, { target: { files: Array.isArray(files) ? files : [files] } })
}

function setup() {
  return render(<MemoryRouter><ImportScreen /></MemoryRouter>)
}

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()))
  await seedIfEmpty()
  vi.mocked(extractTextItems).mockReset()
  vi.mocked(parseStatement).mockReset()
})

describe('ImportScreen', () => {
  it('handles password prompt, wrong password, preview and commit', async () => {
    const ex = vi.mocked(extractTextItems)
    ex.mockRejectedValueOnce(new PasswordRequiredError())
      .mockRejectedValueOnce(new WrongPasswordError())
      .mockResolvedValueOnce([])
    vi.mocked(parseStatement).mockReturnValue(statement)
    setup()
    upload(screen.getByLabelText(/choose pdf/i), pdf())
    expect(await screen.findByText(/password protected/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }))
    expect(await screen.findByText(/incorrect password/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toHaveValue('')
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'right' } })
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }))
    expect(ex.mock.calls[1][1]).toBe('wrong')
    expect(ex.mock.calls[2][1]).toBe('right')
    expect(await screen.findByText(/3 new/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
    expect(screen.getByText(/1 row had no description/)).toBeInTheDocument()
    expect(screen.getByText(/Check the totals/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByText('Added 3 transactions')).toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
    expect(await screen.findByRole('link', { name: /Sort 3 uncategorised/ })).toHaveAttribute('href', '/sort')
  })

  it('shows unsupported and unexpected errors and continues with the next file', async () => {
    const ex = vi.mocked(extractTextItems)
    ex.mockResolvedValue([])
    vi.mocked(parseStatement)
      .mockImplementationOnce(() => { throw new UnsupportedStatementError() })
      .mockImplementationOnce(() => { throw new Error('boom') })
      .mockReturnValueOnce(statement)
    setup()
    upload(screen.getByLabelText(/choose pdf/i), [pdf(), pdf(), pdf()])
    expect(await screen.findByText(/3 new/)).toBeInTheDocument()
    expect(screen.getByText(/isn't supported \(only FNB and Discovery Bank PDFs\)/)).toBeInTheDocument()
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })

  it('Skip discards the preview without saving', async () => {
    vi.mocked(extractTextItems).mockResolvedValue([])
    vi.mocked(parseStatement).mockReturnValue(statement)
    setup()
    upload(screen.getByLabelText(/choose pdf/i), pdf())
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(screen.queryByText(/3 new/)).toBeNull())
    expect(await db.transactions.count()).toBe(0)
  })

  it('shows a balance warning with bad row dates', async () => {
    vi.mocked(extractTextItems).mockResolvedValue([])
    const bad: ParsedStatement = { ...statement, accounts: [{ ...statement.accounts[0], rows: [row('2026-01-02', -100, 9900), row('2026-01-03', -200, 1)], closingBalance: undefined }] }
    vi.mocked(parseStatement).mockReturnValue(bad)
    setup()
    upload(screen.getByLabelText(/choose pdf/i), pdf())
    expect(await screen.findByText(/2026-01-03/)).toBeInTheDocument()
    expect(screen.getByText(/balance mismatch/i)).toBeInTheDocument()
  })
})
