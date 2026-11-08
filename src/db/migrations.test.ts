import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import type { Rule, Transaction } from '../domain/types'
import { BudgetDB } from './db'
import { PREVIOUS_DEFAULT_RULES } from './defaults'
import { migratePayees } from './migrations'

const tx = (id: string, description: string, payee: string): Transaction => ({
  id, accountId: 'a1', date: '2026-10-01', postedDate: '2026-10-01', description, payee,
  amount: -5000, groupId: 'uncategorised', kind: 'expense', unplanned: false, setManually: false, importHash: id,
})
const equals = (id: string, pattern: string, groupId: string, createdAt: number): Rule =>
  ({ id, matchType: 'equals', pattern, groupId, createdAt })

describe('migratePayees', () => {
  it('re-cleans stored payees and moves their equals rules to the new payee', () => {
    const { txs, rules } = migratePayees(
      [tx('t1', 'TRACKER 00ABC1234567 X12345', 'Tracker 00abc1234567 X12345')],
      [equals('r1', 'Tracker 00abc1234567 X12345', 'transport-fuel', 1)],
    )
    expect(txs[0].payee).toBe('Tracker')
    expect(rules).toEqual([equals('r1', 'Tracker', 'transport-fuel', 1)])
  })

  it('merges rules for payees that now share a name, keeping the newest', () => {
    const { rules } = migratePayees(
      [
        tx('t1', 'TRACKER 00ABC1234567 X12345', 'Tracker 00abc1234567 X12345'),
        tx('t2', 'TRACKER 00ABC1234567 Y54321', 'Tracker 00abc1234567 Y54321'),
      ],
      [equals('r1', 'Tracker 00abc1234567 X12345', 'other', 1), equals('r2', 'tracker 00abc1234567 y54321', 'transport-fuel', 2)],
    )
    expect(rules).toEqual([equals('r2', 'Tracker', 'transport-fuel', 2)])
  })

  it('leaves regex rules, unrelated equals rules and unchanged payees alone', () => {
    const regex: Rule = { id: 'r9', matchType: 'regex', pattern: 'tracker', groupId: 'other', createdAt: 5 }
    const input = [tx('t1', 'SPOTIFY', 'Spotify')]
    const { txs, rules } = migratePayees(input, [regex, equals('r1', 'Spotify', 'subscriptions', 1), equals('r2', 'Gone', 'other', 1)])
    expect(txs).toEqual(input)
    expect(rules).toEqual([regex, equals('r1', 'Spotify', 'subscriptions', 1), equals('r2', 'Gone', 'other', 1)])
  })
})

describe('BudgetDB v3 upgrade', () => {
  it('migrates payees and rules, then re-applies rules', async () => {
    const name = `upgrade-v3-${Date.now()}`
    const v2 = new Dexie(name)
    v2.version(1).stores({ accounts: 'id, [bank+last4+typeLabel]', transactions: 'id, accountId, date, importHash, kind, groupId', groups: 'id', rules: 'id', settings: 'id' })
    v2.version(2).stores({ accounts: 'id, [bank+last4]' })
    await v2.table('transactions').bulkAdd([
      tx('t1', 'SOMECLUB _111111111_222222223', 'Someclub _111111111_222222223'),
      { ...tx('t2', 'SOMECLUB _111111112_222222223', 'Someclub _111111112_222222223'), groupId: 'uncategorised' },
    ])
    await v2.table('rules').add(equals('r1', 'Someclub _111111111_222222223', 'personal-care', 1))
    await v2.table('settings').add({ id: 'settings', fallbackPayday: 25, transferPatterns: [], dismissedSubscriptions: [] })
    v2.close()

    const db = new BudgetDB(name)
    await db.open()
    expect(db.verno).toBe(3)
    const txs = await db.transactions.toArray()
    expect(txs.map((t) => [t.payee, t.groupId])).toEqual([['Someclub', 'personal-care'], ['Someclub', 'personal-care']])
    expect((await db.rules.toArray()).map((r) => r.pattern)).toEqual(['Someclub'])
    db.close()
    await Dexie.delete(name)
  })

  it('brings a seeded database up to the current default rules', async () => {
    const name = `upgrade-v3-defaults-${Date.now()}`
    const v2 = new Dexie(name)
    v2.version(1).stores({ accounts: 'id, [bank+last4+typeLabel]', transactions: 'id, accountId, date, importHash, kind, groupId', groups: 'id', rules: 'id', settings: 'id' })
    v2.version(2).stores({ accounts: 'id, [bank+last4]' })
    await v2.table('groups').add({ id: 'bank-fees', name: 'Bank fees', colour: '#000', hidden: false })
    await v2.table('rules').bulkAdd(PREVIOUS_DEFAULT_RULES.map(([pattern, groupId], i) => ({ id: `old${i}`, matchType: 'regex', pattern, groupId, createdAt: 1 })))
    await v2.table('settings').add({ id: 'settings', fallbackPayday: 25, transferPatterns: [], dismissedSubscriptions: [] })
    await v2.table('transactions').bulkAdd([
      { ...tx('t1', 'BYC DEBIT 12345678901', 'Byc Debit'), groupId: 'bank-fees' },
      tx('t2', 'Zambezi Tap n Go', 'Zambezi Tap N Go'),
    ])
    v2.close()

    const db = new BudgetDB(name)
    await db.open()
    const byId = Object.fromEntries((await db.transactions.toArray()).map((t) => [t.id, t]))
    expect(byId.t1).toMatchObject({ kind: 'savings', groupId: null })
    expect(byId.t2).toMatchObject({ kind: 'expense', groupId: 'transport-fuel' })
    db.close()
    await Dexie.delete(name)
  })
})
