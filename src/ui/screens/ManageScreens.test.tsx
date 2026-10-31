import 'fake-indexeddb/auto'
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { seedIfEmpty } from '../../db/seed'
import { makeTx } from '../../engine/testHelpers'
import BudgetsScreen, { parseBudget } from './BudgetsScreen'
import { useAll } from '../hooks'
import RulesScreen from './RulesScreen'
import SettingsScreen from './SettingsScreen'
import SubscriptionsScreen from './SubscriptionsScreen'

const acc = { id: 'acc1', bank: 'fnb' as const, typeLabel: 'Cheque', last4: '1111', name: 'Everyday', role: 'everyday' as const }
const wrap = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>)

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()))
  await seedIfEmpty()
  await db.accounts.add(acc)
})

describe('parseBudget', () => {
  it.each([['1 500,50', 150050], ['1500.50', 150050], ['R1,500', 150000], ['300', 30000], ['', undefined]])('%s', (i, c) => {
    expect(parseBudget(i)).toBe(c)
  })
  it('rejects junk and negatives', () => {
    expect(() => parseBudget('abc')).toThrow()
    expect(() => parseBudget('-5')).toThrow()
    expect(() => parseBudget('0')).toThrow()
  })
})

describe('BudgetsScreen', () => {
  it('saves a budget in cents, removes it when emptied, and hides a group', async () => {
    wrap(<BudgetsScreen />)
    const input = await screen.findByLabelText('Budget for Groceries')
    fireEvent.change(input, { target: { value: '1 500,50' } })
    fireEvent.blur(input)
    await waitFor(async () => expect((await db.groups.get('groceries'))?.budget).toBe(150050))
    const again = await screen.findByLabelText('Budget for Groceries')
    fireEvent.change(again, { target: { value: '' } })
    fireEvent.blur(again)
    await waitFor(async () => expect((await db.groups.get('groceries'))?.budget).toBeUndefined())
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide' })[0])
    await waitFor(async () => expect((await db.groups.toArray()).some(g => g.hidden)).toBe(true))
  })
  it('does not offer controls for Uncategorised and adds a group', async () => {
    wrap(<BudgetsScreen />)
    await screen.findByLabelText('Budget for Groceries')
    expect(screen.queryByLabelText('Budget for Uncategorised')).toBeNull()
    fireEvent.change(screen.getByLabelText('New group'), { target: { value: 'Pets' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }))
    await waitFor(async () => expect((await db.groups.get('pets'))?.name).toBe('Pets'))
  })
})

describe('RulesScreen', () => {
  it('rejects invalid regex, adds a valid rule and re-applies it', async () => {
    await db.transactions.add(makeTx({ id: 'x1', payee: 'Zorp Mart', description: 'Zorp Mart', groupId: null }))
    wrap(<RulesScreen />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add rule' }))
    fireEvent.change(screen.getByLabelText('Match type'), { target: { value: 'regex' } })
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: '(' } })
    await screen.findByRole('option', { name: 'Shopping' })
    fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'shopping' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid regular expression')
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: 'zorp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    await waitFor(async () => expect((await db.transactions.get('x1'))?.groupId).toBe('shopping'))
  })
  it('deletes a rule', async () => {
    wrap(<RulesScreen />)
    const before = await db.rules.count()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Delete' }))[0])
    await waitFor(async () => expect(await db.rules.count()).toBe(before - 1))
  })
})

describe('SubscriptionsScreen', () => {
  it('dismisses a detected subscription', async () => {
    const dates = ['2026-05-26', '2026-06-26', '2026-07-26', '2026-08-26']
    await db.transactions.bulkAdd(dates.map((date, i) => makeTx({ id: `s${i}`, date, postedDate: date, payee: 'Streamly', description: 'Streamly', amount: -9900, groupId: 'subscriptions' })))
    wrap(<SubscriptionsScreen />)
    const btn = await screen.findByRole('button', { name: 'Not a subscription' })
    expect(screen.getByTestId('yearly-total')).toBeInTheDocument()
    fireEvent.click(btn)
    await waitFor(async () => expect((await db.settings.get('settings'))?.dismissedSubscriptions).toContain('Streamly'))
  })
})

describe('SettingsScreen', () => {
  it('validates payday and saves transfer patterns dropping blank lines', async () => {
    wrap(<SettingsScreen />)
    const payday = await screen.findByLabelText('Fallback payday')
    fireEvent.change(payday, { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByText(/from 1 to 31/)).toBeInTheDocument()
    fireEvent.change(payday, { target: { value: '28' } })
    fireEvent.change(screen.getByLabelText('Transfer patterns'), { target: { value: 'abc\n\n  \ndef' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(async () => {
      const s = await db.settings.get('settings')
      expect(s?.fallbackPayday).toBe(28)
      expect(s?.transferPatterns).toEqual(['abc', 'def'])
    })
  })
  it('flags an invalid transfer pattern without saving', async () => {
    wrap(<SettingsScreen />)
    fireEvent.change(await screen.findByLabelText('Transfer patterns'), { target: { value: 'ok\n(' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByText(/Invalid transfer pattern/)).toBeInTheDocument()
  })
  it('changes an account role', async () => {
    wrap(<SettingsScreen />)
    fireEvent.change(await screen.findByLabelText('Role for Everyday'), { target: { value: 'savings' } })
    await waitFor(async () => expect((await db.accounts.get('acc1'))?.role).toBe('savings'))
  })
  it('import: no change when declined; failure shown for a bad file', async () => {
    await db.transactions.add(makeTx({ id: 'keep' }))
    wrap(<SettingsScreen />)
    const input = await screen.findByLabelText('Import backup')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.change(input, { target: { files: [new File(['{"foo":1}'], 'b.json')] } })
    expect(confirm).toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.change(input, { target: { files: [new File(['{"foo":1}'], 'b.json')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Import failed')
    expect(await db.transactions.count()).toBe(1)
    confirm.mockRestore()
  })
  it('export downloads a dated file and revokes the object URL', async () => {
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toMatch(/^budget-backup-\d{4}-\d{2}-\d{2}\.json$/)
    })
    wrap(<SettingsScreen />)
    fireEvent.click(await screen.findByRole('button', { name: 'Export backup' }))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:x'))
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })
})

describe('reimbursement rules', () => {
  it('stores reimbursesGroupId and applies it on reapply', async () => {
    await db.transactions.add(makeTx({ id: 'r1', payee: 'Refundco', description: 'Refundco', amount: 5000, kind: 'income' }))
    wrap(<RulesScreen />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add rule' }))
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: 'refundco' } })
    await screen.findByRole('option', { name: 'Shopping' })
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'reimbursement' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('reimburses')
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Groceries' })).toHaveLength(2))
    const pickers = screen.getAllByLabelText('Group')
    fireEvent.change(pickers[1], { target: { value: 'groceries' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    await waitFor(async () => {
      const t = await db.transactions.get('r1')
      expect(t?.kind).toBe('reimbursement')
      expect(t?.reimbursesGroupId).toBe('groceries')
    })
    const rule = (await db.rules.toArray()).find(r => r.pattern === 'refundco')
    expect(rule?.kind).toBe('reimbursement')
    expect(rule?.reimbursesGroupId).toBe('groceries')
  })
})

describe('effective salary pattern', () => {
  it('uses the suggestion for pay months when none is saved', async () => {
    const pay = ['2026-06-28', '2026-07-28', '2026-08-28']
    await db.transactions.bulkAdd(pay.map((date, i) => makeTx({ id: 'p' + i, date, postedDate: date, payee: 'Acme Payroll', description: 'Acme Payroll', amount: 900000, kind: 'income' })))
    const { result } = renderHook(() => useAll())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.settings?.salaryPattern).toBeUndefined()
    expect(result.current.months.map(m => m.start)).toEqual(['2026-08-28', '2026-07-28', '2026-06-28'])
  })
})
