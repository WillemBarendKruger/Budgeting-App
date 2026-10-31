import type { Group, MatchType, Rule, Settings } from '../domain/types'
import { db } from './db'

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

const RULES: [string, string][] = [
  ['checkers|pick n pay|\\bpnp\\b|woolworths|\\bspar\\b', 'groceries'],
  ['shell|engen|sasol|\\bbp\\b|total |petroport', 'transport-fuel'],
  ['uber eats|\\bmcd|mcdonald|kfc|debonairs|romans|burger', 'eating-out'],
  ['liquor|\\bpub\\b|\\btops\\b', 'alcohol'],
  ['apple\\.com|steam|netflix|showmax|spotify', 'subscriptions'],
  ['^#?service fees|monthly account fee|monthly facility fee|payment fee|byc debit', 'bank-fees'],
  ['takealot|temu', 'shopping'],
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
    const now = Date.now()
    const rules: Rule[] = RULES.map(([pattern, groupId]) => ({
      id: crypto.randomUUID(),
      matchType: 'regex' as MatchType,
      pattern,
      groupId,
      createdAt: now,
    }))
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
