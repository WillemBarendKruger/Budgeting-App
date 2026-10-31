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

describe('pairTransfers determinism', () => {
  it('shuffled input yields the same pairing', () => {
    const o1 = out({ id: 'o1' });
    const o2 = out({ id: 'o2' });
    const i1 = inn({ id: 'i1' });
    const i2 = inn({ id: 'i2' });
    const orders = [[o1, o2, i1, i2], [i2, i1, o2, o1], [o2, i1, o1, i2]];
    const results = orders.map((o) => [...pairTransfers(o, patterns).entries()].sort());
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[0].length).toBe(4);
  });
});

describe('pairTransfers ranking (final review I1)', () => {
  it('prefers a both-sides-flagged pair over an unflagged same-day payment to a person', () => {
    // Same day, same amount; the person payment's id sorts first so the old tie-break picked it.
    const person = makeTx({ id: 'a-person', accountId: 'fnb', date: '2026-07-31', amount: -50000, description: 'FNB App Payment To Invented Friend' });
    const card = makeTx({ id: 'b-card', accountId: 'fnb', date: '2026-07-31', amount: -50000, description: 'FNB App Payment To Credit Card' });
    const credit = makeTx({ id: 'c-credit', accountId: 'disc', date: '2026-07-31', amount: 50000, description: 'FNB CARD' });
    const m = pairTransfers([person, card, credit], patterns);
    expect(m.get('c-credit')).toBe('b-card');
    expect(m.get('b-card')).toBe('c-credit');
    expect(m.has('a-person')).toBe(false);
  });

  it('a both-flagged pair beats an unflagged partner even when the unflagged one is closer in date', () => {
    const person = makeTx({ id: 'a-person', accountId: 'fnb', date: '2026-07-31', amount: -50000, description: 'FNB App Payment To Invented Friend' });
    const card = makeTx({ id: 'b-card', accountId: 'fnb', date: '2026-07-29', amount: -50000, description: 'FNB App Payment To Credit Card' });
    const credit = makeTx({ id: 'c-credit', accountId: 'disc', date: '2026-07-31', amount: 50000, description: 'FNB CARD' });
    expect(pairTransfers([person, card, credit], patterns).get('c-credit')).toBe('b-card');
  });
});
