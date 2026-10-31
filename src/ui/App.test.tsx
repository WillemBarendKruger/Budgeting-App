import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import GroupPicker from './components/GroupPicker'
import MoneyText from './components/MoneyText'
import { db } from '../db/db'
import { seedIfEmpty } from '../db/seed'

describe('App shell', () => {
  it('shows nav links and the empty-state call to action', async () => {
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
    render(<GroupPicker value="" onChange={() => {}} />)
    const select = await screen.findByRole('combobox')
    await screen.findByRole('option', { name: 'Utilities' })
    const names = within(select).getAllByRole('option').map(o => o.textContent)
    expect(names).not.toContain('Alcohol')
    expect(names[names.length - 1]).toBe('Uncategorised')
    expect(names.slice(0, -1)).toEqual([...names.slice(0, -1)].sort((a, b) => a!.localeCompare(b!)))
  })
})
