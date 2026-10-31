import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { seedIfEmpty } from '../../db/seed'
import { makeTx } from '../../engine/testHelpers'
import SortScreen from './SortScreen'
import TransactionsScreen from './TransactionsScreen'

const acc = { id: 'acc1', bank: 'fnb' as const, typeLabel: 'Cheque', last4: '1111', name: 'Everyday', role: 'everyday' as const }

function setup(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/transactions" element={<TransactionsScreen />} />
        <Route path="/sort" element={<SortScreen />} />
        <Route path="/" element={<p>Overview page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()))
  await seedIfEmpty()
  await db.rules.clear()
  await db.accounts.add(acc)
})

describe('TransactionsScreen', () => {
  it('?group= filters to that group only', async () => {
    await db.transactions.bulkAdd([
      makeTx({ id: 'g1', payee: 'Invented Grocer', groupId: 'groceries' }),
      makeTx({ id: 'g2', payee: 'Invented Grocer Two', groupId: 'groceries' }),
      makeTx({ id: 'e1', payee: 'Invented Cafe', groupId: 'eating-out' }),
    ])
    setup('/transactions?group=groceries')
    await waitFor(() => expect(screen.getAllByTestId('tx-row')).toHaveLength(2))
    expect(screen.queryByText('Invented Cafe')).toBeNull()
  })

  it('filters by text and unplanned', async () => {
    await db.transactions.bulkAdd([
      makeTx({ id: 'a', payee: 'Invented Cafe', description: 'Invented Cafe', groupId: 'eating-out', unplanned: true, unplannedTag: 'weekend drinks' }),
      makeTx({ id: 'b', payee: 'Invented Grocer', groupId: 'groceries' }),
    ])
    setup('/transactions')
    await waitFor(() => expect(screen.getAllByTestId('tx-row')).toHaveLength(2))
    fireEvent.click(screen.getByLabelText('Unplanned only'))
    expect(screen.getAllByTestId('tx-row')).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('Unplanned only'))
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'GROCER' } })
    expect(screen.getAllByTestId('tx-row')).toHaveLength(1)
    expect(screen.getByText('Invented Grocer')).toBeInTheDocument()
  })

  it('flags a tx unplanned with a tag and persists it; Escape closes the panel', async () => {
    await db.transactions.bulkAdd([makeTx({ id: 'a', payee: 'Invented Cafe', groupId: 'eating-out' })])
    setup('/transactions')
    fireEvent.click(await screen.findByTestId('tx-row'))
    const dlg = screen.getByRole('dialog', { name: 'Edit transaction' })
    fireEvent.click(within(dlg).getByLabelText('Unplanned'))
    fireEvent.change(within(dlg).getByLabelText('Tag'), { target: { value: 'weekend drinks' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect(await db.transactions.get('a')).toMatchObject({ unplanned: true, unplannedTag: 'weekend drinks' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByTestId('tx-row'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('changing group with "apply to all" creates a rule', async () => {
    await db.transactions.bulkAdd([
      makeTx({ id: 'a', payee: 'Invented Cafe', groupId: 'eating-out' }),
      makeTx({ id: 'b', payee: 'Invented Cafe', groupId: 'eating-out' }),
    ])
    setup('/transactions')
    fireEvent.click((await screen.findAllByTestId('tx-row'))[0])
    const dlg = screen.getByRole('dialog')
    expect(within(dlg).getByLabelText('Apply to all from Invented Cafe')).toBeChecked()
    await within(dlg).findByRole('option', { name: 'Alcohol' })
    fireEvent.change(within(dlg).getByLabelText('Group'), { target: { value: 'alcohol' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect(await db.rules.count()).toBe(1))
    await waitFor(async () => expect((await db.transactions.toArray()).map(t => t.groupId)).toEqual(['alcohol', 'alcohol']))
  })
})

describe('TransactionsScreen group drill-down (final review minor 5)', () => {
  it('?group= also lists reimbursements of that group so the list reconciles with Overview', async () => {
    await db.transactions.bulkAdd([
      makeTx({ id: 'g1', payee: 'Invented Grocer', groupId: 'groceries', amount: -30000 }),
      makeTx({ id: 'r1', payee: 'Invented Flatmate', kind: 'reimbursement', groupId: null, reimbursesGroupId: 'groceries', amount: 10000 }),
      makeTx({ id: 'r2', payee: 'Invented Colleague', kind: 'reimbursement', groupId: null, reimbursesGroupId: 'eating-out', amount: 5000 }),
    ])
    setup('/transactions?group=groceries')
    await waitFor(() => expect(screen.getAllByTestId('tx-row')).toHaveLength(2))
    expect(screen.getByText('Invented Flatmate')).toBeInTheDocument()
    expect(screen.queryByText('Invented Colleague')).toBeNull()
  })
})

describe('SortScreen', () => {
  it('lists uncategorised payees by total and sorts them via rules', async () => {
    await db.transactions.bulkAdd([
      makeTx({ id: 'a', payee: 'Small Shop', amount: -100, groupId: 'uncategorised' }),
      makeTx({ id: 'b', payee: 'Big Shop', amount: -5000, groupId: 'uncategorised' }),
      makeTx({ id: 'c', payee: 'Big Shop', amount: -5000, groupId: 'uncategorised' }),
      makeTx({ id: 'd', payee: 'Done', groupId: 'groceries', setManually: true }),
    ])
    setup('/sort')
    const rows = await screen.findAllByTestId('sort-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Big Shop')
    expect(rows[0]).toHaveTextContent('(2)')
    await within(rows[0]).findByRole('option', { name: 'Shopping' })
    fireEvent.change(within(rows[0]).getByLabelText('Group'), { target: { value: 'shopping' } })
    await waitFor(() => expect(screen.getAllByTestId('sort-row')).toHaveLength(1))
    expect((await db.transactions.get('c'))!.groupId).toBe('shopping')
  })

  it('shows the empty state', async () => {
    await db.transactions.bulkAdd([makeTx({ groupId: 'groceries' })])
    setup('/sort')
    expect(await screen.findByText('Everything is sorted')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument()
  })
})

describe('SortScreen transfer action (final review I2c)', () => {
  it('"Not spending (transfer)" makes a transfer rule for the payee and removes it from Sort', async () => {
    await db.transactions.bulkAdd([
      makeTx({ id: 't1', payee: 'Invented Savings Move', amount: -200000, groupId: 'uncategorised' }),
      makeTx({ id: 't2', payee: 'Invented Savings Move', amount: -100000, groupId: 'uncategorised' }),
      makeTx({ id: 'x', payee: 'Small Shop', amount: -100, groupId: 'uncategorised' }),
    ])
    setup('/sort')
    const rows = await screen.findAllByTestId('sort-row')
    expect(rows).toHaveLength(2)
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Not spending (transfer)' }))
    await waitFor(() => expect(screen.getAllByTestId('sort-row')).toHaveLength(1))
    const rules = await db.rules.toArray()
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ matchType: 'equals', pattern: 'Invented Savings Move', kind: 'transfer' })
    expect(await db.transactions.get('t2')).toMatchObject({ kind: 'transfer', groupId: null })
  })

  it('shows a save error via role=alert', async () => {
    await db.transactions.bulkAdd([makeTx({ id: 't1', payee: 'Invented Savings Move', amount: -200000, groupId: 'uncategorised' })])
    setup('/sort')
    const row = await screen.findByTestId('sort-row')
    const spy = vi.spyOn(db.rules, 'add').mockImplementation(() => Promise.reject(new Error('Disk full (invented)')))
    try {
      fireEvent.click(within(row).getByRole('button', { name: 'Not spending (transfer)' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Disk full (invented)')
    } finally {
      spy.mockRestore()
    }
    expect(await db.rules.count()).toBe(0)
  })
})
