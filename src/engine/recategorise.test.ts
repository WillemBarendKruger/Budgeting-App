import { describe, expect, it } from 'vitest';
import { recategorise } from './recategorise';
import { makeTx } from './testHelpers';
import { UNCATEGORISED, type Rule } from '../domain/types';

const patterns = ['payment to credit card', 'magtape debit discbank', '^fnb card$'];

describe('recategorise', () => {
  it('unpaired pattern match becomes transfer without a pair id', () => {
    const t = makeTx({ description: 'Magtape Debit Discbank 000000001-2', amount: -50000 });
    const [r] = recategorise([t], [], patterns);
    expect(r.kind).toBe('transfer');
    expect(r.groupId).toBeNull();
    expect(r.transferPairId).toBeUndefined();
  });

  it('paired txs get transferPairId', () => {
    const a = makeTx({ id: 'a', accountId: 'x', amount: -100, description: 'FNB App Payment To Credit Card' });
    const b = makeTx({ id: 'b', accountId: 'y', amount: 100, description: 'FNB CARD' });
    const [ra, rb] = recategorise([a, b], [], patterns);
    expect(ra.transferPairId).toBe('b');
    expect(rb.transferPairId).toBe('a');
    expect(ra.kind).toBe('transfer');
    expect(rb.kind).toBe('transfer');
  });

  it('manual txs are returned unchanged', () => {
    const t = makeTx({ setManually: true, description: 'Magtape Debit Discbank 1', kind: 'expense', groupId: 'g1' });
    const [r] = recategorise([t], [], patterns);
    expect(r).toBe(t);
  });

  it('rule can make a reimbursement', () => {
    const rule: Rule = { id: 'r', matchType: 'equals', pattern: 'Invented Payer', kind: 'reimbursement', reimbursesGroupId: 'groceries', createdAt: 1 };
    const t = makeTx({ payee: 'Invented Payer', description: 'Invented Payer', amount: 15000 });
    const [r] = recategorise([t], [rule], patterns);
    expect(r.kind).toBe('reimbursement');
    expect(r.groupId).toBeNull();
    expect(r.reimbursesGroupId).toBe('groceries');
  });

  it('rule assigns group to expense; no rule gives UNCATEGORISED', () => {
    const rule: Rule = { id: 'r', matchType: 'contains', pattern: 'grocer', groupId: 'groceries', createdAt: 1 };
    const a = makeTx({ payee: 'Invented Grocer' });
    const b = makeTx({ payee: 'Somewhere Else' });
    const [ra, rb] = recategorise([a, b], [rule], patterns);
    expect(ra.groupId).toBe('groceries');
    expect(rb.groupId).toBe(UNCATEGORISED);
  });

  it('positive amount without rule is income with no group', () => {
    const [r] = recategorise([makeTx({ amount: 500, groupId: 'old' })], [], patterns);
    expect(r.kind).toBe('income');
    expect(r.groupId).toBeNull();
  });

  it('a fee next to a transfer stays an expense', () => {
    const tr = makeTx({ description: 'Magtape Debit Discbank 000000001-2', amount: -50000 });
    const fee = makeTx({ description: 'Payment fee', payee: 'Payment fee', amount: -500 });
    const [, rf] = recategorise([tr, fee], [], patterns);
    expect(rf.kind).toBe('expense');
    expect(rf.groupId).toBe(UNCATEGORISED);
  });

  it('does not mutate inputs', () => {
    const t = makeTx({ description: 'Magtape Debit Discbank 1' });
    const snap = JSON.stringify(t);
    recategorise([t], [], patterns);
    expect(JSON.stringify(t)).toBe(snap);
  });
});

describe('recategorise fix round 1', () => {
  it('reimbursement never carries groupId', () => {
    const rule: Rule = { id: 'r', matchType: 'contains', pattern: 'payer', kind: 'reimbursement', groupId: 'x', reimbursesGroupId: 'y', createdAt: 1 };
    const [r] = recategorise([makeTx({ payee: 'Invented Payer', amount: 100 })], [rule], patterns);
    expect(r.groupId).toBeNull();
    expect(r.reimbursesGroupId).toBe('y');
  });

  it('reimbursesGroupId only emitted for reimbursement kind', () => {
    const rule: Rule = { id: 'r', matchType: 'contains', pattern: 'grocer', reimbursesGroupId: 'y', createdAt: 1 };
    const [r] = recategorise([makeTx()], [rule], patterns);
    expect(r.kind).toBe('expense');
    expect('reimbursesGroupId' in r).toBe(false);
  });

  it('rule kind excludes a tx from pairing', () => {
    const rule: Rule = { id: 'r', matchType: 'equals', pattern: 'Ruled Payee', kind: 'expense', createdAt: 1 };
    const a = makeTx({ id: 'a', accountId: 'x', payee: 'Ruled Payee', amount: -100, description: 'FNB App Payment To Credit Card' });
    const b = makeTx({ id: 'b', accountId: 'y', payee: 'Other', amount: 100, description: 'FNB CARD' });
    const [ra, rb] = recategorise([a, b], [rule], patterns);
    expect(ra.kind).toBe('expense');
    expect(ra.transferPairId).toBeUndefined();
    expect(rb.kind).toBe('transfer');
    expect(rb.transferPairId).toBeUndefined();
  });

  it('is idempotent', () => {
    const a = makeTx({ id: 'a', accountId: 'x', amount: -100, description: 'FNB App Payment To Credit Card' });
    const b = makeTx({ id: 'b', accountId: 'y', amount: 100, description: 'FNB CARD' });
    const c = makeTx({ id: 'c' });
    const once = recategorise([a, b, c], [], patterns);
    expect(recategorise(once, [], patterns)).toEqual(once);
  });
});

describe('recategorise transfer ranking (final review I1)', () => {
  it('an unrecognised payment to a person stays an expense when a recognised card payment exists', () => {
    const person = makeTx({ id: 'a-person', accountId: 'fnb', amount: -50000, payee: 'Invented Friend', description: 'FNB App Payment To Invented Friend' });
    const card = makeTx({ id: 'b-card', accountId: 'fnb', amount: -50000, payee: 'Credit Card', description: 'FNB App Payment To Credit Card' });
    const credit = makeTx({ id: 'c-credit', accountId: 'disc', amount: 50000, payee: 'FNB CARD', description: 'FNB CARD' });
    const [rp, rc, rcr] = recategorise([person, card, credit], [], patterns);
    expect(rp).toMatchObject({ kind: 'expense', groupId: UNCATEGORISED });
    expect(rp.transferPairId).toBeUndefined();
    expect(rc).toMatchObject({ kind: 'transfer', transferPairId: 'c-credit' });
    expect(rcr).toMatchObject({ kind: 'transfer', transferPairId: 'b-card' });
  });
});

describe('recategorise rule-transfer pairing (final review I2a)', () => {
  it("a rule with kind 'transfer' takes part in pairing, so the other leg becomes a transfer too", () => {
    const rule: Rule = { id: 'r', matchType: 'equals', pattern: 'Invented Savings Move', kind: 'transfer', createdAt: 1 };
    const out = makeTx({ id: 'o', accountId: 'fnb', date: '2026-07-30', amount: -200000, payee: 'Invented Savings Move', description: 'FNB App Transfer Invented Savings Move' });
    const inn = makeTx({ id: 'i', accountId: 'savings', date: '2026-08-01', amount: 200000, payee: 'Invented Deposit', description: 'Invented Deposit' });
    const [ro, ri] = recategorise([out, inn], [rule], patterns);
    expect(ro).toMatchObject({ kind: 'transfer', groupId: null, transferPairId: 'i' });
    expect(ri).toMatchObject({ kind: 'transfer', groupId: null, transferPairId: 'o' });
  });
});

describe('recategorise manual pair legs (final review I2d)', () => {
  const a = () => makeTx({ id: 'a', accountId: 'x', amount: -100, description: 'FNB App Payment To Credit Card' });
  const b = () => makeTx({ id: 'b', accountId: 'y', amount: 100, description: 'FNB CARD' });

  it('a manual transfer leg keeps its non-manual partner paired', () => {
    const ma = { ...a(), setManually: true, kind: 'transfer' as const, groupId: null, transferPairId: 'b' };
    const [ra, rb] = recategorise([ma, b()], [], patterns);
    expect(ra).toBe(ma);
    expect(rb).toMatchObject({ kind: 'transfer', transferPairId: 'a' });
  });

  it('a manual leg whose partner no longer points back loses its dangling transferPairId', () => {
    const ma = { ...a(), setManually: true, kind: 'transfer' as const, groupId: null, transferPairId: 'b' };
    const mb = { ...b(), setManually: true, kind: 'income' as const, groupId: null };
    const [ra, rb] = recategorise([ma, mb], [], patterns);
    expect(ra.kind).toBe('transfer');
    expect(ra.transferPairId).toBeUndefined();
    expect(rb).toBe(mb);
  });
});
