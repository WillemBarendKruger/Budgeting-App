import { describe, expect, it } from 'vitest'
import { cleanPayee } from '../domain/payee'
import type { Rule, Transaction } from '../domain/types'
import { recategorise } from '../engine/recategorise'
import { defaultRules, PREVIOUS_DEFAULT_RULES, upgradeDefaultRules } from './defaults'

const tx = (description: string, amount = -10000): Transaction => ({
  id: description, accountId: 'a1', date: '2026-10-01', postedDate: '2026-10-01', description,
  payee: cleanPayee(description), amount, groupId: null, kind: 'expense', unplanned: false, setManually: false, importHash: description,
})

const categorise = (description: string) => recategorise([tx(description)], defaultRules(1), [])[0]

describe('default rules', () => {
  it.each([
    ['TOWN SUPERSPAR', 'groceries'],
    ['Shoprite Smalltown', 'groceries'],
    ['OK EXPRESS TOWN', 'groceries'],
    ['Savemor Town', 'groceries'],
    ['VLEIS', 'groceries'],
    ['Yoco *Fish n Chip', 'eating-out'],
    ['QUALITY TAKE AWAYS8', 'eating-out'],
    ['Zambezi Tap n Go', 'transport-fuel'],
    ['NKOMAZI TAP N GO', 'transport-fuel'],
    ['MIWAYCOLLE00000123456 135261102', 'insurance-medical'],
    ['CLICKS TOWN', 'insurance-medical'],
    ['Dis-Chem Town', 'insurance-medical'],
    ['MTN SP 1234567890', 'utilities'],
    ['Afrihost', 'utilities'],
    ['TRACKER 00ABC1234567 X12345', 'vehicle-finance'],
    ['BETWAY', 'gaming'],
    ['PLAYABETS MP', 'gaming'],
    ['YOUTUBE', 'subscriptions'],
    ['#INT PYMT FEE-20.99 APPLE', 'bank-fees'],
    ['#EFT CHARGE-FNB TO OTHER', 'bank-fees'],
    ['#NON FNB ATM CASH WITHDRAWAL FEES', 'bank-fees'],
    ['#MONTHLY ACCOUNT FEE', 'bank-fees'],
    ['ABCD.0012.03 RENT', 'home-rent'],
    ['Ruben leen', 'family-people'],
    ['PA SKULD', 'family-people'],
    ['JOHN GESKENK', 'family-people'],
  ])('%s → %s', (description, group) => {
    expect(categorise(description)).toMatchObject({ kind: 'expense', groupId: group })
  })

  it('treats Bank Your Change round-ups as savings, not bank fees', () => {
    expect(categorise('BYC DEBIT 12345678901')).toMatchObject({ kind: 'savings', groupId: null })
  })

  it('does not turn incoming money into an expense', () => {
    expect(recategorise([tx('FNB APP PAYMENT FROM JANE HUUR', 400000)], defaultRules(1), [])[0].kind).toBe('income')
  })
})

describe('upgradeDefaultRules', () => {
  const old = (pattern: string, groupId: string, id = pattern): Rule => ({ id, matchType: 'regex', pattern, groupId, createdAt: 1 })

  it('replaces untouched previous defaults and adds the new ones', () => {
    const previous = PREVIOUS_DEFAULT_RULES.map(([p, g]) => old(p, g))
    const { add, remove } = upgradeDefaultRules(previous, 5)
    expect(remove.sort()).toEqual(previous.map((r) => r.id).filter((id) => !defaultRules(5).some((d) => d.pattern === id)).sort())
    const after = [...previous.filter((r) => !remove.includes(r.id)), ...add]
    expect(after.map((r) => [r.pattern, r.groupId, r.kind]).sort()).toEqual(defaultRules(5).map((r) => [r.pattern, r.groupId, r.kind]).sort())
  })

  it('keeps a previous default the user edited and never duplicates an existing pattern', () => {
    const [p] = PREVIOUS_DEFAULT_RULES.find(([, g]) => g === 'bank-fees')!
    const edited = old(p, 'other')
    const existing = old(defaultRules(1)[0].pattern, 'other', 'mine')
    const { add, remove } = upgradeDefaultRules([edited, existing], 5)
    expect(remove).toEqual([])
    expect(add.some((r) => r.pattern === existing.pattern)).toBe(false)
  })

  it('is idempotent', () => {
    const { add } = upgradeDefaultRules(defaultRules(1), 5)
    expect(add).toEqual([])
  })
})
