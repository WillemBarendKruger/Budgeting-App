import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ParsedRow, ParsedStatement } from '../domain/types'
import { db } from './db'
import { commitImport, importHash, previewImport, reapplyRules } from './importService'
import { seedIfEmpty } from './seed'

const row = (over: Partial<ParsedRow>): ParsedRow => ({
  postedDate: '2026-03-02', date: '2026-03-02', description: 'POS Purchase Test Shop',
  amount: -5000, warnings: [], ...over,
})
const stmt = (rows: ParsedRow[]): ParsedStatement => ({
  bank: 'fnb', periodStart: '2026-03-01', periodEnd: '2026-03-31', warnings: [],
  accounts: [{ bank: 'fnb', typeLabel: 'Gold Cheque', last4: '1234', role: 'everyday', rows }],
})

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await seedIfEmpty()
})

describe('seed', () => {
  it('creates 17 groups including uncategorised, rules and settings, idempotently', async () => {
    await seedIfEmpty()
    expect(await db.groups.count()).toBe(17)
    expect(await db.groups.get('uncategorised')).toBeTruthy()
    expect(new Set((await db.groups.toArray()).map((g) => g.colour)).size).toBe(17)
    expect(await db.rules.count()).toBe(7)
    expect((await db.settings.get('settings'))?.fallbackPayday).toBe(25)
  })

  it("seeds the 'payment to discovery' transfer pattern (final review I2b)", async () => {
    expect((await db.settings.get('settings'))?.transferPatterns).toContain('payment to discovery')
  })
})

describe('import', () => {
  const three = [
    row({ description: 'POS Purchase Shell Garage', amount: -45000, balance: 955000 }),
    row({ description: 'Salary Acme', amount: 1000000, balance: 1955000, postedDate: '2026-03-03', date: '2026-03-03' }),
    row({ description: 'POS Purchase Corner Cafe', amount: -8000, balance: 1947000, postedDate: '2026-03-04', date: '2026-03-04' }),
  ]

  it('previews without writing, commits 3 txs, and a Shell row is transport-fuel', async () => {
    const p = await previewImport(stmt(three))
    expect(p.accounts[0]).toMatchObject({ newRows: 3, duplicateRows: 0, existingAccountId: undefined })
    expect(await db.accounts.count()).toBe(0)
    expect(await db.transactions.count()).toBe(0)
    expect(await commitImport(p)).toEqual({ added: 3 })
    const acc = (await db.accounts.toArray())[0]
    expect(acc.name).toBe('Gold Cheque ••1234')
    const shell = (await db.transactions.toArray()).find((t) => t.description.includes('Shell'))
    expect(shell).toMatchObject({ groupId: 'transport-fuel', kind: 'expense', payee: 'Shell Garage' })
  })

  it('re-import is all duplicates and adds nothing', async () => {
    await commitImport(await previewImport(stmt(three)))
    const p = await previewImport(stmt(three))
    expect(p.accounts[0]).toMatchObject({ newRows: 0, duplicateRows: 3 })
    expect(p.accounts[0].existingAccountId).toBeTruthy()
    expect(await commitImport(p)).toEqual({ added: 0 })
    expect(await db.transactions.count()).toBe(3)
    expect(await db.accounts.count()).toBe(1)
  })

  it('imports identical same-day purchases that have different balances', async () => {
    const twins = [row({ balance: 100000 }), row({ balance: 95000 })]
    expect(await commitImport(await previewImport(stmt(twins)))).toEqual({ added: 2 })
  })

  it('identical no-balance rows: both import, re-import adds none, overlap adds only the extra', async () => {
    const twin = row({ description: 'POS Purchase Twin' })
    expect(await commitImport(await previewImport(stmt([twin, twin])))).toEqual({ added: 2 })
    const again = await previewImport(stmt([twin, twin]))
    expect(again.accounts[0]).toMatchObject({ newRows: 0, duplicateRows: 2 })
    expect(await commitImport(again)).toEqual({ added: 0 })

    const other = row({ description: 'POS Purchase Solo', amount: -700 })
    await commitImport(await previewImport(stmt([other])))
    const b = await previewImport(stmt([other, other]))
    expect(b.accounts[0]).toMatchObject({ newRows: 1, duplicateRows: 1 })
    expect(await commitImport(b)).toEqual({ added: 1 })
    expect(await db.transactions.count()).toBe(4)
  })

  it('partial overlap: only the new month is added', async () => {
    const march = three
    const april = [
      row({ description: 'POS Purchase April One', postedDate: '2026-04-02', date: '2026-04-02', balance: 1000 }),
      row({ description: 'POS Purchase April Two', postedDate: '2026-04-03', date: '2026-04-03', balance: 2000 }),
    ]
    await commitImport(await previewImport(stmt(march)))
    const p = await previewImport(stmt([...march, ...april]))
    expect(p.accounts[0]).toMatchObject({ newRows: 2, duplicateRows: 3 })
    expect(await commitImport(p)).toEqual({ added: 2 })
    expect(await db.transactions.count()).toBe(5)
  })

  it('reapplyRules picks up a new rule but leaves manual txs alone', async () => {
    await commitImport(await previewImport(stmt(three)))
    const cafe = (await db.transactions.toArray()).find((t) => t.description.includes('Cafe'))!
    expect(cafe.groupId).toBe('uncategorised')
    await db.rules.add({ id: 'r1', matchType: 'contains', pattern: 'corner cafe', groupId: 'eating-out', createdAt: 1 })
    await reapplyRules()
    expect((await db.transactions.get(cafe.id))?.groupId).toBe('eating-out')
    await db.transactions.update(cafe.id, { setManually: true, groupId: 'other' })
    await reapplyRules()
    expect((await db.transactions.get(cafe.id))?.groupId).toBe('other')
  })

  it('importHash format', () => {
    expect(importHash('a', row({ description: '  X   Y ', balance: 5 }))).toBe('a|2026-03-02|-5000|x y|5')
    expect(importHash('a', row({}))).toMatch(/\|$/)
  })
})
