import Dexie, { type EntityTable } from 'dexie'
import type { Account, Group, Rule, Settings, Transaction } from '../domain/types'

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
  }
}

export const db = new BudgetDB()
