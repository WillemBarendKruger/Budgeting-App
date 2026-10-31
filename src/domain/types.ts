export type Cents = number;
export type Bank = 'fnb' | 'discovery';
export type AccountRole = 'everyday' | 'credit' | 'savings';
export type TxKind = 'expense' | 'income' | 'transfer' | 'savings' | 'reimbursement';

export interface TextItem { str: string; x: number; y: number; width: number; page: number }

export interface ParsedRow {
  postedDate: string; date: string; description: string;
  amount: Cents; balance?: Cents; warnings: string[];
}
export interface ParsedAccount {
  bank: Bank; typeLabel: string; last4: string; role: AccountRole;
  openingBalance?: Cents; closingBalance?: Cents; rows: ParsedRow[];
}
export interface ParsedStatement {
  bank: Bank; periodStart: string; periodEnd: string;
  accounts: ParsedAccount[]; warnings: string[];
}

export interface Account { id: string; bank: Bank; typeLabel: string; last4: string; name: string; role: AccountRole }
export interface Transaction {
  id: string; accountId: string; date: string; postedDate: string;
  description: string; payee: string; amount: Cents; balance?: Cents;
  groupId: string | null; kind: TxKind; reimbursesGroupId?: string;
  unplanned: boolean; unplannedTag?: string; notes?: string;
  setManually: boolean; importHash: string; transferPairId?: string;
}
export interface Group { id: string; name: string; budget?: Cents; colour: string; hidden: boolean }
export type MatchType = 'equals' | 'contains' | 'regex';
export interface Rule {
  id: string; matchType: MatchType; pattern: string;
  groupId?: string; kind?: TxKind; reimbursesGroupId?: string; createdAt: number;
}
export interface Settings {
  id: 'settings'; salaryPattern?: string; fallbackPayday: number;
  transferPatterns: string[]; dismissedSubscriptions: string[];
}
export interface PayMonth { start: string; end: string; label: string }
export const UNCATEGORISED = 'uncategorised';
