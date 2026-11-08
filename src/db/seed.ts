import type { Group, Settings } from '../domain/types'
import { db } from './db'
import { defaultRules } from './defaults'

const GROUPS: [string, string, string][] = [
  ['home-rent', 'Home & rent', '#4e79a7'],
  ['utilities', 'Utilities', '#f28e2b'],
  ['groceries', 'Groceries', '#59a14f'],
  ['eating-out', 'Eating out', '#e15759'],
  ['alcohol', 'Alcohol', '#b07aa1'],
  ['transport-fuel', 'Transport & fuel', '#76b7b2'],
  ['vehicle-finance', 'Vehicle finance', '#edc948'],
  ['insurance-medical', 'Insurance & medical', '#ff9da7'],
  ['subscriptions', 'Subscriptions', '#9c755f'],
  ['shopping', 'Shopping', '#bab0ab'],
  ['gaming', 'Gaming', '#1f77b4'],
  ['personal-care', 'Personal care', '#d37295'],
  ['family-people', 'Family & people', '#8cd17d'],
  ['education', 'Education', '#a0cbe8'],
  ['bank-fees', 'Bank fees', '#ffbe7d'],
  ['other', 'Other', '#86bcb6'],
  ['uncategorised', 'Uncategorised', '#999999'],
]

export const DEFAULT_TRANSFER_PATTERNS = [
  'payment to credit card',
  'payment to discovery',
  'magtape debit discbank',
  '^discbank',
  '^fnb card$',
  'inter account transfer',
]

export async function seedIfEmpty(): Promise<void> {
  await db.transaction('rw', db.groups, db.rules, db.settings, async () => {
    if ((await db.groups.count()) > 0) return
    const groups: Group[] = GROUPS.map(([id, name, colour]) => ({ id, name, colour, hidden: false }))
    const rules = defaultRules(Date.now())
    const settings: Settings = {
      id: 'settings',
      fallbackPayday: 25,
      transferPatterns: DEFAULT_TRANSFER_PATTERNS,
      dismissedSubscriptions: [],
    }
    await db.groups.bulkAdd(groups)
    await db.rules.bulkAdd(rules)
    if (!(await db.settings.get('settings'))) await db.settings.add(settings)
  })
}
