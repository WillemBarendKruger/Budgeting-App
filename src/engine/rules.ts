import type { Rule, Transaction } from '../domain/types';

export function safeRegex(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return undefined;
  }
}

function matches(tx: Transaction, rule: Rule): boolean {
  const payee = tx.payee.toLowerCase();
  const pattern = rule.pattern.toLowerCase();
  switch (rule.matchType) {
    case 'equals':
      return payee === pattern;
    case 'contains':
      return pattern !== '' && payee.includes(pattern);
    case 'regex': {
      const re = safeRegex(rule.pattern);
      return !!re && (re.test(tx.payee) || re.test(tx.description));
    }
  }
}

/** Best matching rule: equals first, then longer pattern, then newer. */
export function matchRule(tx: Transaction, rules: Rule[]): Rule | undefined {
  let best: Rule | undefined;
  for (const rule of rules) {
    if (!matches(tx, rule)) continue;
    if (!best || compare(rule, best) > 0) best = rule;
  }
  return best;
}

function compare(a: Rule, b: Rule): number {
  const ea = a.matchType === 'equals' ? 1 : 0;
  const eb = b.matchType === 'equals' ? 1 : 0;
  if (ea !== eb) return ea - eb;
  if (a.pattern.length !== b.pattern.length) return a.pattern.length - b.pattern.length;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0; // smaller id wins, for determinism
}
