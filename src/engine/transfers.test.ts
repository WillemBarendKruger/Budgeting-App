import { describe, expect, it } from 'vitest';
import { pairTransfers } from './transfers';
import { makeTx } from './testHelpers';

const patterns = ['payment to credit card', '^fnb card$'];

const out = (o = {}) =>
  makeTx({ id: 'out', accountId: 'fnb', date: '2026-07-31', amount: -465500, description: 'FNB App Payment To Credit Card', ...o });
const inn = (o = {}) =>
  makeTx({ id: 'in', accountId: 'disc', date: '2026-07-31', amount: 465500, description: 'FNB CARD', ...o });

describe('pairTransfers', () => {
  it('pairs both directions', () => {
    const m = pairTransfers([out(), inn()], patterns);
    expect(m.get('out')).toBe('in');
    expect(m.get('in')).toBe('out');
  });

  it('closest date wins and each tx pairs once', () => {
    const near = inn({ id: 'near', date: '2026-08-01' });
    const far = inn({ id: 'far', date: '2026-08-03' });
    const m = pairTransfers([out(), far, near], patterns);
    expect(m.get('out')).toBe('near');
    expect(m.has('far')).toBe(false);
  });

  it('same account is not paired', () => {
    expect(pairTransfers([out(), inn({ accountId: 'fnb' })], patterns).size).toBe(0);
  });

  it('4 days apart is not paired', () => {
    expect(pairTransfers([out(), inn({ date: '2026-08-04' })], patterns).size).toBe(0);
  });

  it('requires a pattern match on at least one side', () => {
    const m = pairTransfers([out({ description: 'Plain thing' }), inn({ description: 'Other thing' })], patterns);
    expect(m.size).toBe(0);
  });

  it('different amounts are not paired', () => {
    expect(pairTransfers([out(), inn({ amount: 465400 })], patterns).size).toBe(0);
  });

  it('invalid pattern does not throw', () => {
    expect(pairTransfers([out(), inn()], ['(', 'fnb card']).get('out')).toBe('in');
  });
});
