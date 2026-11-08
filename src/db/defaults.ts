import type { Rule, TxKind } from '../domain/types'

type DefaultRule = { pattern: string; groupId?: string; kind?: TxKind }

/** The regex rules seeded before v3, kept so an upgrade can tell an untouched default from a user's rule. */
export const PREVIOUS_DEFAULT_RULES: [pattern: string, groupId: string][] = [
  ['checkers|pick n pay|\\bpnp\\b|woolworths|\\bspar\\b', 'groceries'],
  ['shell|engen|sasol|\\bbp\\b|total |petroport', 'transport-fuel'],
  ['uber eats|\\bmcd|mcdonald|kfc|debonairs|romans|burger', 'eating-out'],
  ['liquor|\\bpub\\b|\\btops\\b', 'alcohol'],
  ['apple\\.com|steam|netflix|showmax|spotify', 'subscriptions'],
  ['^#?service fees|monthly account fee|monthly facility fee|payment fee|byc debit', 'bank-fees'],
  ['takealot|temu', 'shopping'],
]

/** Regex rules matched against payee and description (case-insensitive). Rules without a kind only group expenses. */
const DEFAULT_RULES: DefaultRule[] = [
  ...PREVIOUS_DEFAULT_RULES
    .filter(([, g]) => g !== 'bank-fees')
    .map(([pattern, groupId]) => ({ pattern, groupId })),
  { pattern: 'shoprite|superspar|\\bsupersp\\b|ok express|ok foods|savemor|food lover|\\bboxer\\b|usave|vleis|butcher|biltong', groupId: 'groceries' },
  { pattern: 'tap ?n ?go|\\btoll\\b', groupId: 'transport-fuel' },
  { pattern: 'fish n chip|take ?aways?|nando|wimpy|\\bspur\\b|steers|ocean basket|pizza|mugg (and|&) bea|yumbi|tuck ?sh', groupId: 'eating-out' },
  { pattern: 'youtube|dstv|disney|prime video', groupId: 'subscriptions' },
  { pattern: '^#?service fees|monthly account fee|monthly facility fee|payment fee|pymt fee|eft charge|withdrawal fees?|#non fnb', groupId: 'bank-fees' },
  { pattern: 'miway|outsurance|discovery health|momentum|old mutual|clicks|dis-?chem|pharm|\\bmeds\\b', groupId: 'insurance-medical' },
  { pattern: '\\bmtn\\b|vodacom|telkom|cell ?c\\b|afrihost|\\brain\\b|prepaid electricity|eskom', groupId: 'utilities' },
  { pattern: 'tracker|netstar|wesbank|vehicle finance', groupId: 'vehicle-finance' },
  { pattern: 'betway|playabets|hollywoodbets|supabets|sportingbet|lottostar', groupId: 'gaming' },
  { pattern: '\\brent\\b|\\bhuur\\b', groupId: 'home-rent' },
  // Afrikaans: leen = loan, skuld = debt, geskenk = gift.
  { pattern: '\\b(leen|skuld|geskenk)\\b', groupId: 'family-people' },
  // FNB "Bank Your Change" sweeps card round-ups into a savings account.
  { pattern: 'byc debit', kind: 'savings' },
]

export function defaultRules(createdAt: number): Rule[] {
  return DEFAULT_RULES.map((d) => ({ id: crypto.randomUUID(), matchType: 'regex', createdAt, ...d }))
}

const sameAs = (r: Rule, d: DefaultRule) =>
  r.matchType === 'regex' && r.pattern === d.pattern && r.groupId === d.groupId && r.kind === d.kind

/**
 * Bring a seeded database's rules up to the current defaults: drop previous defaults the user never
 * edited (unless still current), and add current defaults whose pattern isn't already a regex rule.
 */
export function upgradeDefaultRules(rules: Rule[], createdAt: number): { add: Rule[]; remove: string[] } {
  const untouchedPrevious = (r: Rule) =>
    r.reimbursesGroupId === undefined && PREVIOUS_DEFAULT_RULES.some(([pattern, groupId]) => sameAs(r, { pattern, groupId }))
  const remove = rules.filter((r) => untouchedPrevious(r) && !DEFAULT_RULES.some((d) => sameAs(r, d))).map((r) => r.id)
  const remaining = rules.filter((r) => !remove.includes(r.id))
  const add = defaultRules(createdAt).filter((d) => !remaining.some((r) => r.matchType === 'regex' && r.pattern === d.pattern))
  return { add, remove }
}
