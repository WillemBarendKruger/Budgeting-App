import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { BudgetDB } from './db'

describe('BudgetDB schema upgrade (final review I5)', () => {
  it('v1 data survives the upgrade and accounts are indexed by [bank+last4]', async () => {
    const name = `upgrade-test-${Date.now()}`
    const v1 = new Dexie(name)
    v1.version(1).stores({
      accounts: 'id, [bank+last4+typeLabel]',
      transactions: 'id, accountId, date, importHash, kind, groupId',
      groups: 'id',
      rules: 'id',
      settings: 'id',
    })
    await v1.table('accounts').add({ id: 'a1', bank: 'fnb', typeLabel: 'Gold Cheque', last4: '1234', name: 'My cheque', role: 'everyday' })
    await v1.table('transactions').add({ id: 't1', accountId: 'a1', date: '2026-01-05', importHash: 'h', kind: 'expense', groupId: null })
    v1.close()

    const db = new BudgetDB(name)
    await db.open()
    expect(db.verno).toBeGreaterThanOrEqual(2)
    expect(await db.accounts.get('a1')).toMatchObject({ name: 'My cheque', typeLabel: 'Gold Cheque' })
    expect(await db.transactions.get('t1')).toMatchObject({ accountId: 'a1' })
    expect((await db.accounts.where('[bank+last4]').equals(['fnb', '1234']).first())?.id).toBe('a1')
    db.close()
    await Dexie.delete(name)
  })
})
