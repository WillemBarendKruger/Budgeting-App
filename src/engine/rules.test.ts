import { describe, expect, it } from 'vitest';
import { matchRule } from './rules';
import { makeTx } from './testHelpers';
import type { Rule } from '../domain/types';

const rule = (o: Partial<Rule> & Pick<Rule, 'id' | 'matchType' | 'pattern'>): Rule => ({ createdAt: 1, ...o });

describe('matchRule', () => {
  const tx = makeTx({ payee: 'Checkers Sixty60', description: 'Checkers Sixty60 Sandton' });

  it('equals beats contains', () => {
    const rules = [
      rule({ id: 'c', matchType: 'contains', pattern: 'checkers' }),
      rule({ id: 'e', matchType: 'equals', pattern: 'checkers sixty60' }),
    ];
    expect(matchRule(tx, rules)?.id).toBe('e');
  });

  it('longer contains wins', () => {
    const rules = [
      rule({ id: 'short', matchType: 'contains', pattern: 'check' }),
      rule({ id: 'long', matchType: 'contains', pattern: 'checkers six' }),
    ];
    expect(matchRule(tx, rules)?.id).toBe('long');
  });

  it('ties go to the newer rule', () => {
    const rules = [
      rule({ id: 'old', matchType: 'contains', pattern: 'checkers', createdAt: 1 }),
      rule({ id: 'new', matchType: 'contains', pattern: 'checkers', createdAt: 2 }),
    ];
    expect(matchRule(tx, rules)?.id).toBe('new');
  });

  it('regex matches description case-insensitively', () => {
    expect(matchRule(tx, [rule({ id: 'r', matchType: 'regex', pattern: 'SANDTON$' })])?.id).toBe('r');
  });

  it('contains does not look at description', () => {
    expect(matchRule(tx, [rule({ id: 'c', matchType: 'contains', pattern: 'sandton' })])).toBeUndefined();
  });

  it('invalid regex never throws or matches', () => {
    expect(matchRule(tx, [rule({ id: 'bad', matchType: 'regex', pattern: '(' })])).toBeUndefined();
  });

  it('returns undefined when nothing matches', () => {
    expect(matchRule(tx, [])).toBeUndefined();
  });
});
