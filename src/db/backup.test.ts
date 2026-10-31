import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { exportBackup, importBackup, InvalidBackupError } from './backup'
import { seedIfEmpty } from './seed'
import { makeTx } from '../engine/testHelpers'

const file = (text: string) => new File([text], 'b.json', { type: 'application/json' })
const acc = { id: 'acc1', bank: 'fnb' as const, typeLabel: 'Cheque', last4: '1111', name: 'Everyday', role: 'everyday' as const }

async function snapshot() {
  return Promise.all(db.tables.map(async t => [t.name, await t.toArray()] as const))
}

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()))
  await seedIfEmpty()
  await db.accounts.add(acc)
  await db.transactions.bulkAdd([makeTx({ id: 't1', amount: -1000 }), makeTx({ id: 't2', amount: 5000 })])
})

describe('backup', () => {
  it('round-trips all tables', async () => {
    const before = await snapshot()
    const blob = await exportBackup()
    await Promise.all(db.tables.map(t => t.clear()))
    await importBackup(file(await blob.text()))
    expect(await snapshot()).toEqual(before)
  })

  it('export has the expected envelope', async () => {
    const data = JSON.parse(await (await exportBackup()).text())
    expect(data.app).toBe('budget-app')
    expect(data.version).toBe(1)
    expect(typeof data.exportedAt).toBe('string')
    expect(data.transactions).toHaveLength(2)
  })

  it.each([
    ['wrong shape', '{"foo":1}'],
    ['invalid JSON', 'not json'],
    ['wrong version', JSON.stringify({ app: 'budget-app', version: 2, accounts: [], transactions: [], groups: [], rules: [], settings: [] })],
    ['table not array', JSON.stringify({ app: 'budget-app', version: 1, accounts: [], transactions: {}, groups: [], rules: [], settings: [] })],
    ['row without id', JSON.stringify({ app: 'budget-app', version: 1, accounts: [], transactions: [{ amount: 1 }], groups: [], rules: [], settings: [] })],
  ])('rejects %s and leaves data untouched', async (_n, text) => {
    const before = await snapshot()
    await expect(importBackup(file(text))).rejects.toBeInstanceOf(InvalidBackupError)
    expect(await db.transactions.count()).toBe(2)
    expect(await snapshot()).toEqual(before)
  })
})

describe('backup settings row', () => {
  const base = { app: 'budget-app', version: 1, accounts: [], transactions: [], groups: [], rules: [] }
  it.each([
    ['empty settings', []],
    ['wrong settings id', [{ id: 'other' }]],
    ['two settings rows', [{ id: 'settings' }, { id: 'settings' }]],
  ])('rejects %s and leaves data unchanged', async (_n, settings) => {
    const before = await snapshot()
    await expect(importBackup(file(JSON.stringify({ ...base, settings })))).rejects.toBeInstanceOf(InvalidBackupError)
    expect(await snapshot()).toEqual(before)
  })
  it('a valid restore leaves a settings row present', async () => {
    const blob = await exportBackup()
    await importBackup(file(await blob.text()))
    expect((await db.settings.get('settings'))?.id).toBe('settings')
  })
})
