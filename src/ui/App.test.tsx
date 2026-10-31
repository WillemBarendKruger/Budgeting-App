import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeTx } from '../engine/testHelpers'
import App from './App'
import GroupPicker from './components/GroupPicker'
import MoneyText from './components/MoneyText'
import { db } from '../db/db'
import { seedIfEmpty } from '../db/seed'

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()))
})

describe('App shell', () => {
  it('shows nav links and the empty-state call to action', async () => {
    await seedIfEmpty()
    render(<App />)
    const nav = screen.getByRole('navigation')
    for (const name of ['Overview', 'Import', 'Transactions']) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument()
    }
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    const cta = await screen.findByRole('link', { name: 'Import your first statement' })
    expect(cta).toHaveAttribute('href', '#/import')
  })
})

describe('Overview empty state', () => {
  it('hides the CTA when a transaction exists', async () => {
    await seedIfEmpty()
    await db.transactions.add(makeTx())
    render(<App />)
    await screen.findByRole('heading', { name: 'Overview' })
    expect(screen.queryByRole('link', { name: 'Import your first statement' })).toBeNull()
  })
  it('renders nothing until loaded, then shows the CTA', async () => {
    await seedIfEmpty()
    render(<App />)
    expect(screen.queryByRole('link', { name: 'Import your first statement' })).toBeNull()
    expect(await screen.findByRole('link', { name: 'Import your first statement' })).toBeInTheDocument()
  })
})

describe('MoneyText', () => {
  it('formats and colours by sign', () => {
    render(<><MoneyText cents={-12345} colourBySign /><MoneyText cents={500} colourBySign /></>)
    const neg = screen.getByText(/123,45/)
    expect(neg).toHaveClass('neg')
    expect(screen.getByText(/5,00/)).toHaveClass('pos')
  })
})

describe('GroupPicker', () => {
  it('sorts by name, Uncategorised last, hides hidden groups', async () => {
    await seedIfEmpty()
    await db.groups.update('alcohol', { hidden: true })
    render(<GroupPicker value="utilities" onChange={() => {}} />)
    const select = await screen.findByRole('combobox')
    await screen.findByRole('option', { name: 'Utilities' })
    const names = within(select).getAllByRole('option').map(o => o.textContent)
    expect(names).not.toContain('Alcohol')
    expect(names[names.length - 1]).toBe('Uncategorised')
    expect(names.slice(0, -1)).toEqual([...names.slice(0, -1)].sort((a, b) => a!.localeCompare(b!)))
  })

  it('shows a disabled placeholder for an empty value', async () => {
    await seedIfEmpty()
    render(<GroupPicker value="" onChange={() => {}} />)
    const ph = await screen.findByRole('option', { name: 'Choose group…' })
    expect(ph).toBeDisabled()
    expect(screen.getByRole('combobox')).toHaveValue('')
  })

  it('keeps the current value visible even if its group is hidden', async () => {
    await seedIfEmpty()
    await db.groups.update('alcohol', { hidden: true })
    render(<GroupPicker value="alcohol" onChange={() => {}} />)
    await screen.findByRole('option', { name: 'Alcohol' })
    expect(screen.getByRole('combobox')).toHaveValue('alcohol')
    expect(screen.queryByRole('option', { name: 'Choose group…' })).toBeNull()
  })
})
