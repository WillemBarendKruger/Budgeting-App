import type { Transaction } from '../domain/types';

let seq = 0;

export function makeTx(over: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `tx${seq}`,
    accountId: 'acc1',
    date: '2026-07-31',
    postedDate: '2026-07-31',
    description: 'Invented Grocer',
    payee: 'Invented Grocer',
    amount: -1000,
    groupId: null,
    kind: 'expense',
    unplanned: false,
    setManually: false,
    importHash: `hash${seq}`,
    ...over,
  };
}
