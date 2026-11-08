import Dexie, { type EntityTable } from 'dexie'
import type { Account, Group, Rule, Settings, Transaction } from '../domain/types'
import { recategorise } from '../engine/recategorise'
import { upgradeDefaultRules } from './defaults'
import { migratePayees } from './migrations'

export class BudgetDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>
  transactions!: EntityTable<Transaction, 'id'>
  groups!: EntityTable<Group, 'id'>
  rules!: EntityTable<Rule, 'id'>
  settings!: EntityTable<Settings, 'id'>

  constructor(name = 'budget') {
    super(name)
    this.version(1).stores({
      accounts: 'id, [bank+last4+typeLabel]',
      transactions: 'id, accountId, date, importHash, kind, groupId',
      groups: 'id',
      rules: 'id',
      settings: 'id',
    })
    // v2: account identity is bank + last4 only (typeLabel is parsed free text and display-only).
    // Index-only change: Dexie drops/creates the index during the upgrade, rows are kept as-is.
    this.version(2).stores({
      accounts: 'id, [bank+last4]',
    })
    // v3: payee cleaning drops monthly-changing references, so stored payees are re-derived, payee
    // rules follow their payee to its new name, and rules are re-applied. Data-only, no index change.
    this.version(3).stores({}).upgrade(async (tx) => {
      const txs = await tx.table<Transaction, string>('transactions').toArray()
      let rules = await tx.table<Rule, string>('rules').toArray()
      const settings = await tx.table<Settings, string>('settings').get('settings')
      // A seeded database also gets the current default rules (untouched old defaults are replaced).
      if ((await tx.table('groups').count()) > 0) {
        const { add, remove } = upgradeDefaultRules(rules, Date.now())
        await tx.table('rules').bulkDelete(remove)
        rules = [...rules.filter((r) => !remove.includes(r.id)), ...add]
      }
      const migrated = migratePayees(txs, rules)
      const final = settings ? recategorise(migrated.txs, migrated.rules, settings.transferPatterns) : migrated.txs
      const keep = new Set(migrated.rules.map((r) => r.id))
      await tx.table('rules').bulkDelete(rules.filter((r) => !keep.has(r.id)).map((r) => r.id))
      await tx.table('rules').bulkPut(migrated.rules)
      await tx.table('transactions').bulkPut(final)
    })
  }
}

export const db = new BudgetDB()
