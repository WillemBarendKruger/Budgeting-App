import 'fake-indexeddb/auto'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { seedIfEmpty } from '../../db/seed'
import { formatRand } from '../../domain/money'
import { makeTx } from '../../engine/testHelpers'
import BudgetBar from '../components/BudgetBar'
import OverviewScreen from './OverviewScreen'

const rand = (c: number) => formatRand(c).replace(/\s+/g, ' ')

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

function setup() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<OverviewScreen />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const acc = { id: 'acc1', bank: 'fnb' as const, typeLabel: 'Cheque', last4: '1111', name: 'Everyday', role: 'everyday' as const }

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()))
  await seedIfEmpty()
  await db.accounts.add(acc)
})

describe('BudgetBar', () => {
  it.each([
    [2000, 3000, 'normal'],
    [2500, 3000, 'amber'],
    [3000, 3000, 'amber'],
    [3001, 3000, 'red'],
  ])('spent %i of %i is %s', (spent, budget, state) => {
    render(<BudgetBar spent={spent} budget={budget} />)
    const bar = screen.getByRole('img')
    expect(bar).toHaveAttribute('data-state', state)
    expect(bar).toHaveAttribute('aria-label', `${formatRand(spent)} of ${formatRand(budget)}`)
  })
})

describe('OverviewScreen', () => {
  it('shows tiles for the newest pay month', async () => {
    await db.transactions.bulkAdd([
      makeTx({ kind: 'income', amount: 30000, groupId: null, date: '2026-08-01', payee: 'Invented Employer' }),
      makeTx({ amount: -4000, groupId: 'groceries', date: '2026-08-02' }),
    ])
    setup()
    expect(await within(await screen.findByTestId('tile-in')).findByText(rand(30000))).toBeInTheDocument()
    expect(within(screen.getByTestId('tile-out')).getByText(rand(4000))).toBeInTheDocument()
    expect(within(screen.getByTestId('tile-saved')).getByText(rand(26000))).toBeInTheDocument()
    expect(screen.getByTestId('tile-saved').querySelector('.neg')).toBeNull()
    expect(screen.getByLabelText(/spending by group/i)).toBeInTheDocument()
  })

  it('marks Saved red when negative', async () => {
    await db.transactions.add(makeTx({ amount: -4000, groupId: 'groceries', date: '2026-08-02' }))
    setup()
    const saved = await screen.findByTestId('tile-saved')
    expect(saved.querySelector('.neg')).not.toBeNull()
  })

  it('shows a red BudgetBar when over budget', async () => {
    await db.groups.update('groceries', { budget: 3000 })
    await db.transactions.add(makeTx({ amount: -4000, groupId: 'groceries', date: '2026-08-02' }))
    setup()
    const bar = await screen.findByRole('img', { name: `${formatRand(4000)} of ${formatRand(3000)}` })
    expect(bar).toHaveAttribute('data-state', 'red')
  })

  it('navigates from a group row to filtered transactions', async () => {
    await db.transactions.add(makeTx({ amount: -4000, groupId: 'groceries', date: '2026-08-02' }))
    setup()
    fireEvent.click(await screen.findByRole('link', { name: /Groceries/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/transactions?group=groceries&month=2026-07-25')
  })

  it('shows the uncategorised banner linking to /sort', async () => {
    await db.transactions.bulkAdd([
      makeTx({ amount: -100, groupId: null, date: '2026-08-02' }),
      makeTx({ amount: -100, groupId: null, date: '2026-08-03' }),
    ])
    setup()
    fireEvent.click(await screen.findByRole('link', { name: '2 transactions need a group' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/sort')
  })

  it('selects months and shows a change badge', async () => {
    await db.transactions.bulkAdd([
      makeTx({ amount: -1000, groupId: 'groceries', date: '2026-07-26' }),
      makeTx({ amount: -2000, groupId: 'groceries', date: '2026-08-26' }),
    ])
    setup()
    const prev = await screen.findByRole('button', { name: 'Previous month' })
    const next = screen.getByRole('button', { name: 'Next month' })
    expect(next).toBeDisabled()
    expect(prev).toBeEnabled()
    expect(screen.getByText('\u25B2 100% vs last month')).toBeInTheDocument()
    fireEvent.click(prev)
    expect(prev).toBeDisabled()
    expect(next).toBeEnabled()
    expect(screen.queryByText(/vs last month/)).toBeNull()
  })

  it('keeps the empty-state CTA', async () => {
    setup()
    expect(await screen.findByRole('link', { name: 'Import your first statement' })).toBeInTheDocument()
  })
})
