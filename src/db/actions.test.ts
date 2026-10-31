import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeTx } from '../engine/testHelpers'
import { db } from './db'
import { setGroup, setKind, setUnplanned } from './actions'
import { seedIfEmpty } from './seed'
import { reapplyRules } from './importService'

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()))
  await seedIfEmpty()
  await db.rules.clear()
})

const three = () => [
  makeTx({ id: 'a', payee: 'Invented Cafe', amount: -500 }),
  makeTx({ id: 'b', payee: 'invented cafe', amount: -600 }),
  makeTx({ id: 'c', payee: 'Invented Cafe', amount: -700 }),
]

describe('setGroup', () => {
  it('applyToAll creates one rule and regroups non-manual txs of that payee', async () => {
    await db.transactions.bulkAdd([...three(), makeTx({ id: 'm', payee: 'Invented Cafe', setManually: true, groupId: 'shopping' })])
    await setGroup('a', 'eating-out', true)
    const rules = await db.rules.toArray()
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ matchType: 'equals', groupId: 'eating-out' })
    expect((await db.transactions.get('a'))!.groupId).toBe('eating-out')
    expect((await db.transactions.get('b'))!.groupId).toBe('eating-out')
    expect((await db.transactions.get('c'))!.groupId).toBe('eating-out')
    expect((await db.transactions.get('m'))!.groupId).toBe('shopping')
  })

  it('grouping a purchase leaves the payee refunds and transfers alone', async () => {
    await db.transactions.bulkAdd([
      makeTx({ id: 'p', payee: 'Invented Shop', amount: -500 }),
      makeTx({ id: 'rf', payee: 'Invented Shop', amount: 200 }),
      makeTx({ id: 'tr', payee: 'Invented Shop', description: 'Inter Account Transfer', amount: -300 }),
    ])
    await setGroup('p', 'groceries', true)
    const rule = (await db.rules.toArray())[0]
    expect(rule.kind).toBeUndefined()
    expect(await db.transactions.get('p')).toMatchObject({ kind: 'expense', groupId: 'groceries' })
    expect(await db.transactions.get('rf')).toMatchObject({ kind: 'income', groupId: null })
    expect(await db.transactions.get('tr')).toMatchObject({ kind: 'transfer', groupId: null })
  })

  it('explicitly grouping a non-expense converts it with a kind rule', async () => {
    await db.transactions.bulkAdd([makeTx({ id: 'i', payee: 'Invented Friend', amount: 900, kind: 'income' })])
    await setGroup('i', 'groceries', true)
    expect((await db.rules.toArray())[0].kind).toBe('expense')
    expect(await db.transactions.get('i')).toMatchObject({ kind: 'expense', groupId: 'groceries' })
  })

  it('applyToAll clears setManually on the chosen tx so the rule applies', async () => {
    await db.transactions.bulkAdd([makeTx({ id: 'a', payee: 'Invented Cafe', setManually: true, groupId: 'shopping' })])
    await setGroup('a', 'eating-out', true)
    const t = (await db.transactions.get('a'))!
    expect(t.groupId).toBe('eating-out')
    expect(t.setManually).toBe(false)
  })

  it('applyToAll=false changes only that tx and marks it manual', async () => {
    await db.transactions.bulkAdd(three())
    await setGroup('a', 'eating-out', false)
    expect(await db.rules.count()).toBe(0)
    const a = (await db.transactions.get('a'))!
    expect(a).toMatchObject({ groupId: 'eating-out', kind: 'expense', setManually: true })
    // b is only re-derived by rules (no rule exists), never given a's group.
    expect(await db.transactions.get('b')).toMatchObject({ groupId: 'uncategorised', setManually: false })
  })

  it('applying again with another group replaces the rule', async () => {
    await db.transactions.bulkAdd(three())
    await setGroup('a', 'eating-out', true)
    await setGroup('b', 'alcohol', true)
    const rules = await db.rules.toArray()
    expect(rules).toHaveLength(1)
    expect(rules[0].groupId).toBe('alcohol')
    expect((await db.transactions.get('c'))!.groupId).toBe('alcohol')
  })
})

describe('setKind', () => {
  it('reimbursement manual sets reimbursesGroupId', async () => {
    await db.transactions.bulkAdd([makeTx({ id: 'r', payee: 'Invented Friend', amount: 900, kind: 'income' })])
    await setKind('r', 'reimbursement', { reimbursesGroupId: 'eating-out', applyToAll: false })
    expect(await db.transactions.get('r')).toMatchObject({ kind: 'reimbursement', reimbursesGroupId: 'eating-out', groupId: null, setManually: true })
  })

  it('reimbursement applyToAll creates a rule and applies it', async () => {
    await db.transactions.bulkAdd([
      makeTx({ id: 'r1', payee: 'Invented Friend', amount: 900, kind: 'income' }),
      makeTx({ id: 'r2', payee: 'Invented Friend', amount: 400, kind: 'income' }),
    ])
    await setKind('r1', 'reimbursement', { reimbursesGroupId: 'eating-out', applyToAll: true })
    const rules = await db.rules.toArray()
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ kind: 'reimbursement', reimbursesGroupId: 'eating-out' })
    expect(rules[0].groupId).toBeUndefined()
    expect(await db.transactions.get('r2')).toMatchObject({ kind: 'reimbursement', reimbursesGroupId: 'eating-out' })
  })

  it('requires a group for reimbursement', async () => {
    await db.transactions.bulkAdd([makeTx({ id: 'r', amount: 900, kind: 'income' })])
    await expect(setKind('r', 'reimbursement', { applyToAll: false })).rejects.toThrow()
  })

  it('expense with applyToAll throws', async () => {
    await db.transactions.bulkAdd([makeTx({ id: 'x' })])
    await expect(setKind('x', 'expense', { applyToAll: true })).rejects.toThrow()
    expect(await db.rules.count()).toBe(0)
  })

  it('non-expense kind drops the group', async () => {
    await db.transactions.bulkAdd([makeTx({ id: 'x', groupId: 'shopping' })])
    await setKind('x', 'savings', { applyToAll: false })
    expect(await db.transactions.get('x')).toMatchObject({ kind: 'savings', groupId: null })
  })
})

describe('setUnplanned', () => {
  it('sets a trimmed tag, clears it when unplanned is false, leaves setManually alone', async () => {
    await db.transactions.bulkAdd([makeTx({ id: 'u' })])
    await setUnplanned('u', true, '  weekend drinks ')
    expect(await db.transactions.get('u')).toMatchObject({ unplanned: true, unplannedTag: 'weekend drinks', setManually: false })
    await setUnplanned('u', true, '   ')
    expect((await db.transactions.get('u'))!.unplannedTag).toBeUndefined()
    await setUnplanned('u', true, 'x')
    await setUnplanned('u', false, 'x')
    expect(await db.transactions.get('u')).toMatchObject({ unplanned: false })
    expect((await db.transactions.get('u'))!.unplannedTag).toBeUndefined()
  })
})

describe('manual edit of a paired transfer leg (final review I2d)', () => {
  const pair = () => [
    makeTx({ id: 'out', accountId: 'fnb', payee: 'Credit Card', description: 'FNB App Payment To Credit Card', amount: -50000 }),
    makeTx({ id: 'in', accountId: 'disc', payee: 'FNB CARD', description: 'FNB CARD', amount: 50000 }),
  ]

  it('changing one leg to an expense leaves no dangling pair on the non-manual partner', async () => {
    await db.transactions.bulkAdd(pair())
    await reapplyRules()
    expect((await db.transactions.get('in'))!.transferPairId).toBe('out')
    await setGroup('out', 'shopping', false)
    expect(await db.transactions.get('out')).toMatchObject({ kind: 'expense', groupId: 'shopping', setManually: true })
    expect((await db.transactions.get('out'))!.transferPairId).toBeUndefined()
    const partner = (await db.transactions.get('in'))!
    expect(partner.transferPairId).toBeUndefined()
  })

  it('changing one leg clears transferPairId on a manual partner too', async () => {
    await db.transactions.bulkAdd(pair())
    await reapplyRules()
    await setKind('in', 'transfer', { applyToAll: false })
    expect(await db.transactions.get('in')).toMatchObject({ setManually: true, transferPairId: 'out' })
    expect((await db.transactions.get('out'))!.transferPairId).toBe('in')
    await setKind('out', 'savings', { applyToAll: false })
    const partner = (await db.transactions.get('in'))!
    expect(partner).toMatchObject({ kind: 'transfer', setManually: true })
    expect(partner.transferPairId).toBeUndefined()
  })
})

describe('setGroup apply-to-all on manual / previously-converted txs (final review I3)', () => {
  it('a manually-set expense that a pattern would make a transfer stays an expense in the new group', async () => {
    await db.transactions.bulkAdd([
      makeTx({ id: 'm', payee: 'Invented Store', description: 'Inter Account Transfer Invented Store', amount: -40000, kind: 'expense', groupId: 'shopping', setManually: true }),
    ])
    await setGroup('m', 'eating-out', true)
    const rules = await db.rules.toArray()
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ kind: 'expense', groupId: 'eating-out' })
    expect(await db.transactions.get('m')).toMatchObject({ kind: 'expense', groupId: 'eating-out', setManually: false })
  })

  it("re-grouping keeps the existing equals rule's kind when the new rule doesn't set one", async () => {
    await db.transactions.bulkAdd([
      makeTx({ id: 'd', payee: 'Invented Friend', amount: -30000 }),
      makeTx({ id: 'c', payee: 'Invented Friend', amount: 12000, kind: 'income' }),
    ])
    await setGroup('c', 'groceries', true) // converts the credit: rule {kind:'expense', groupId:'groceries'}
    expect(await db.transactions.get('c')).toMatchObject({ kind: 'expense', groupId: 'groceries' })
    await setGroup('d', 'shopping', true) // d is a plain expense -> groupId-only, but kind must be kept
    const rules = await db.rules.toArray()
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ kind: 'expense', groupId: 'shopping' })
    expect(await db.transactions.get('c')).toMatchObject({ kind: 'expense', groupId: 'shopping' })
  })
})
