# Budgeting App v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, local-first web app on GitHub Pages that imports FNB and Discovery Bank PDF statements in the browser, groups transactions, and shows where the money goes per pay month.

**Architecture:** Pure TypeScript domain/engine modules (parsing, rules, transfers, pay months, reports, subscriptions) with no I/O, unit-tested with Vitest. A thin Dexie (IndexedDB) layer persists data, and an import service orchestrates parse → preview → save → recategorise. React screens read through `dexie-react-hooks`. A HashRouter avoids 404s on GitHub Pages.

**Tech Stack:** Vite, React, TypeScript, pdfjs-dist, Dexie + dexie-react-hooks, react-router-dom (HashRouter), Recharts, Vitest + @testing-library/react + fake-indexeddb + jsdom. Pin exact versions at install time (`npm i -E`).

**Spec:** [docs/superpowers/specs/2026-10-31-budget-app-design.md](../specs/2026-10-31-budget-app-design.md)

## Global Constraints

- No network calls with financial data. No analytics. No backend. (spec §4)
- Money is integer cents (`number`), never floats in storage or arithmetic. Negative = money out. (spec §7.3)
- Dates are ISO `YYYY-MM-DD` strings.
- Never store a PDF password, not even in memory beyond the single `extractTextItems` call. (spec §4)
- Store only the **last 4 digits** of account numbers. (spec §7.3)
- `statements/`, `*.pdf` and `.superpowers/` are gitignored from the first commit. Test fixtures are synthetic: no real names, merchants-with-people, account or ID numbers. (spec §8)
- Repo is public. No personal data in code, tests, docs or commit messages.
- Work on branch `feature/budget-app-v1`. Each task ends in one commit.
- Kinds: `'expense' | 'income' | 'transfer' | 'savings' | 'reimbursement'`. Account roles: `'everyday' | 'credit' | 'savings'`.
- Budget bar thresholds: normal < 80%, amber 80–100%, red > 100%. "Grew noticeably" = > 15% vs previous pay month. (spec §2.5, §7.7)
- Subscription: same payee in ≥ 3 consecutive pay months, amount within ±10% of median, day-of-month within ±5 days. (spec §7.9)
- Transfer pair: same absolute amount, opposite sign, different accounts, ≤ 3 days apart, at least one side matches a transfer pattern. (spec §7.5)

## Review Focus

1. **Re-importing an overlapping statement, including two identical same-day purchases** → overlap adds zero rows, but the two identical purchases (different running balances) both survive. Test in Task 9.
2. **FNB statement spanning December → January** → `"28 Dec"` gets the start year and `"03 Jan"` the end year. A purchase date of `"31 Dec"` on a row posted `"02 Jan"` gets the previous year. Test in Task 2.
3. **Overdrawn balances**: FNB balance without `Cr` is negative, Discovery `R 325.13-` is negative → balance continuity check passes on such rows. Tests in Tasks 5 and 6.
4. **Encrypted PDF, then wrong password** → the Import screen re-prompts with "Incorrect password", doesn't crash, and keeps no password. Test in Task 13.
5. **Restoring a corrupt or foreign backup file** → refused with a message, existing data untouched. Test in Task 16.

---

## File Structure

```
.gitignore                      statements/, *.pdf, .superpowers/, node_modules, dist
vite.config.ts                  base: '/<repo-name>/', vitest config (jsdom)
.github/workflows/deploy.yml    build + deploy to Pages on push to main
scripts/dump-pdf.mjs            dev-only: dump pdf.js text items of a local PDF to JSON
src/
  domain/types.ts               all shared types (below)
  domain/money.ts               parse/format rand amounts
  domain/dates.ts               FNB date + year inference, date math
  domain/payee.ts               cleanPayee, normaliseDescription
  parsing/pdfText.ts            pdf.js wrapper (browser), password errors
  parsing/layout.ts             group text items into lines, header/column assignment
  parsing/discovery.ts          Discovery statement parser
  parsing/fnb.ts                FNB statement parser
  parsing/detect.ts             bank detection + parseStatement dispatcher
  parsing/check.ts              balance continuity check
  engine/rules.ts               rule matching + specificity
  engine/transfers.ts           transfer pairing
  engine/recategorise.ts        kind/group pipeline for non-manual txs
  engine/payMonths.ts           salary detection + pay-month ranges
  engine/reports.ts             month summary, group change
  engine/subscriptions.ts       recurring debit detection
  db/db.ts                      Dexie schema
  db/seed.ts                    default groups, starter rules, default settings
  db/importService.ts           preview + commit import, dedupe
  db/backup.ts                  export/import JSON
  ui/App.tsx, ui/Layout.tsx     shell + nav (HashRouter)
  ui/screens/*.tsx              Overview, Import, Transactions, Sort, Budgets, Subscriptions, Rules, Settings
  ui/components/*.tsx           MoneyText, BudgetBar, GroupPicker, Donut
tests/fixtures/textItems.ts     helpers to build synthetic TextItem rows
tests/real/real.test.ts         runs only if statements/*.pdf exist locally
```

### Shared types (`src/domain/types.ts`, created in Task 1)

```ts
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
```

---

### Task 1: Project scaffold, types, money utils

**Files:**
- Create: Vite React-TS project in repo root, `.gitignore`, `vite.config.ts`, `src/domain/types.ts`, `src/domain/money.ts`
- Test: `src/domain/money.test.ts`

**Interfaces:**
- Produces: all types above; `parseRand(s: string): Cents` (accepts `"R 1,234.56"`, `"1,234.56"`, `"R 188.01-"` → negative, `"23,553.75Cr"` → positive, `"3,811.37"` → positive; sign rules for FNB `Cr` live in the FNB parser, not here); `formatRand(c: Cents): string` → `"R 1 234,56"`-style per `Intl.NumberFormat('en-ZA', {style:'currency', currency:'ZAR'})`.

- [ ] **Step 1:** `git checkout -b feature/budget-app-v1`. Scaffold with `npm create vite@latest . -- --template react-ts` (keep LICENSE/README), install `-E` deps: `dexie dexie-react-hooks react-router-dom recharts pdfjs-dist`; dev: `vitest @testing-library/react @testing-library/jest-dom jsdom fake-indexeddb`. Add `"test": "vitest run"`.
- [ ] **Step 2:** Write `.gitignore` with `node_modules/ dist/ statements/ *.pdf .superpowers/`. Run `git check-ignore -v statements/x.pdf .superpowers/a` → both ignored.
- [ ] **Step 3: Write failing tests** in `money.test.ts`:
```ts
expect(parseRand('R 1,234.56')).toBe(123456);
expect(parseRand('R 188.01-')).toBe(-18801);
expect(parseRand('23,553.75Cr')).toBe(2355375);
expect(parseRand('0.37')).toBe(37);
expect(parseRand('R 13,000.00')).toBe(1300000);
expect(() => parseRand('abc')).toThrow();
expect(formatRand(-18801)).toMatch(/188[,.]01/);
```
- [ ] **Step 4:** Run `npm test` → FAIL (not defined). Implement with integer math on the digit string (no `parseFloat * 100`). Run → PASS.
- [ ] **Step 5:** Commit `chore: scaffold vite react-ts app with domain types and money utils`.

### Task 2: Dates and payee cleaning

**Files:** Create `src/domain/dates.ts`, `src/domain/payee.ts`; Test `src/domain/dates.test.ts`, `src/domain/payee.test.ts`

**Interfaces:**
- Produces: `parseFnbPeriod(text: string): {start: string; end: string}` (from `"6 June 2026 to 7 September 2026"`); `resolveDayMonth(dm: string, period: {start;end}): string` (`"08 Jun"` → ISO, year chosen so the date falls in the period ±7 days); `resolvePurchaseDate(dm: string, postedDate: string): string` (same year as posted, minus one year if that would be after posted); `addDays(iso: string, n: number): string`; `daysBetween(a: string, b: string): number`.
- `cleanPayee(description: string): string`: strips prefixes `POS Purchase`, `Fuel Purchase`, `Magtape Debit`, `Magtape Credit`, `DebiCheck`, `FNB App Payment To`, `FNB App Payment From`, `Payshap Account Off-Us`, `Scheduled Payment To`; removes card refs matching `/\d{6}\*\d{4}(\s+\d{2}\s\w{3})?/`, digit runs ≥ 5 and trailing branch/store codes like `(0218`; collapses whitespace; title-cases. `normaliseDescription(s)`: lowercase, single spaces, trimmed.

- [ ] **Step 1: Failing tests:**
```ts
expect(parseFnbPeriod('Statement Period : 6 June 2026 to 7 September 2026')).toEqual({start:'2026-06-06', end:'2026-09-07'});
const p = {start:'2026-11-20', end:'2027-02-19'};
expect(resolveDayMonth('28 Dec', p)).toBe('2026-12-28');
expect(resolveDayMonth('03 Jan', p)).toBe('2027-01-03');
expect(resolvePurchaseDate('31 Dec', '2027-01-02')).toBe('2026-12-31');
expect(resolvePurchaseDate('05 Jun', '2026-06-08')).toBe('2026-06-05');
expect(cleanPayee('POS Purchase Checkers Sixty60 123456*7890 05 Jun')).toBe('Checkers Sixty60');
expect(cleanPayee('Magtape Debit Tracker 00Abc1234567 998877')).toBe('Tracker 00abc1234567'); // implementer may tune; must not contain '998877'
expect(cleanPayee('SHELL SAMRAND Midrand')).toBe('Shell Samrand Midrand');
```
(For the Tracker case assert `not.toContain('998877')` and `toMatch(/^Tracker/)` rather than the exact string.)
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Commit `feat: date resolution and payee cleaning`.

### Task 3: PDF text extraction + dev dump script

**Files:** Create `src/parsing/pdfText.ts`, `scripts/dump-pdf.mjs`; Test `src/parsing/pdfText.test.ts`

**Interfaces:**
- Produces: `extractTextItems(data: ArrayBuffer, password?: string): Promise<TextItem[]>`. Throws `PasswordRequiredError` or `WrongPasswordError` (exported classes) mapped from pdf.js `PasswordException` codes 1 and 2. `x` = `transform[4]`, `y` = `transform[5]`, `width` = item width, `page` 1-based. Skip empty-string items.
- Worker: `GlobalWorkerOptions.workerSrc` set from `pdfjs-dist/build/pdf.worker.min.mjs?url`.
- `scripts/dump-pdf.mjs <in.pdf> [password]` uses `pdfjs-dist/legacy/build/pdf.mjs` in Node and writes `statements/dumps/<name>.json` (gitignored) plus `<name>.lines.txt`, with each line's items as `x:str` sorted by x.

- [ ] **Step 1: Failing test:** mock `pdfjs-dist` with `vi.mock` so `getDocument().promise` rejects with `{name:'PasswordException', code:1}` → expect `PasswordRequiredError`; code 2 → `WrongPasswordError`; and a fake one-page doc with items `[{str:'Date', transform:[1,0,0,1,30,700], width:20}]` → `[{str:'Date', x:30, y:700, width:20, page:1}]`.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3 (needs owner's PDFs in `statements/`):** Run `node scripts/dump-pdf.mjs statements/<fnb>.pdf` and the same for Discovery. Read the `.lines.txt` files and record in the task report: (a) header item x positions per column for each bank, (b) **whether FNB `#Service Fees…` descriptions appear as text items**, (c) whether `Cr` is a separate item. Don't paste real content into the repo. If the PDFs aren't there, skip this step, note it, and carry on with Tasks 4–5 using the column order from spec §7.2.
- [ ] **Step 4:** Commit `feat: pdf.js text extraction with password errors, dev dump script`.

### Task 4: Layout helpers + synthetic fixtures

**Files:** Create `src/parsing/layout.ts`, `tests/fixtures/textItems.ts`; Test `src/parsing/layout.test.ts`

**Interfaces:**
- Produces: `interface Line { page: number; y: number; items: TextItem[] }` (items sorted by x); `groupLines(items: TextItem[], yTolerance = 2): Line[]` sorted by page, then y descending (pdf y grows upward); `lineText(l: Line): string` (items joined by single space); `findHeader(lines: Line[], labels: string[], from = 0): {index: number; columns: {label: string; x0: number; x1: number}[]} | undefined` (a line containing all labels as items); `assignColumns(line: Line, columns): Record<string, string>`. Assign each item to the column whose `[x0, x1]` span overlaps it most. With no overlap, use the column with the smallest horizontal gap, and treat numbers as right-aligned (compare right edges). Join multiple items in the same column with a space.
- Fixtures: `row(page: number, y: number, cells: [x: number, str: string][]): TextItem[]` and `header(...)`. Use coordinates recorded in Task 3 step 3 if available, otherwise plausible A4 values.

- [ ] **Step 1: Failing tests:** two items with y 700.4 and 699.1 → one line; header `Date|Description|Amount|Balance` found; a row with `'08 Jun'` at x 20, `'POS Purchase Shop'` at 60, `'123456*7890 05 Jun'` at 300, `'245.39'` at 480 (width 30), `'5,071.04Cr'` at 560 → assignColumns maps amount and balance correctly, and the card-ref text lands in Description (no header of its own) or a `Ref` pseudo-column. Pick one and assert it.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Commit `feat: text layout line grouping and column assignment`.

### Task 5: Discovery parser

**Files:** Create `src/parsing/discovery.ts`, `src/parsing/check.ts`; Test `src/parsing/discovery.test.ts`, `src/parsing/check.test.ts`

**Interfaces:**
- Consumes: Task 4 layout helpers, `parseRand`, `cleanPayee` (not needed here, used later).
- Produces: `parseDiscovery(items: TextItem[]): ParsedStatement`; `checkBalances(acc: ParsedAccount): {ok: boolean; badRows: number[]}`. Starting from `openingBalance` (or, if absent, `rows[0].balance - rows[0].amount`), each `prev + amount === balance`. If `closingBalance` is set, it must equal the last balance.
- Behaviour: period from `From: YYYY-MM-DD To: YYYY-MM-DD`. Summary table (page 1): `Account Type | Account Number | Balance` gives each account's `closingBalance`. Each `Account type: X Account number: N` starts an account section, and following pages without that header continue the current account. Rows: `Debit` → negative amount, `Credit` → positive. `postedDate = date`. `last4` = last 4 digits. Role: type contains `Credit Card` → `credit`, contains `Savings` → `savings`, else `everyday`. Skip footer/address lines (anything that isn't a row starting with `YYYY-MM-DD`).

- [ ] **Step 1: Failing tests** with synthetic fixture: summary page with 2 accounts (credit card closing `R 50.00-`, savings `R 100.00`); page 2 credit card header + 3 rows (one credit `R 800.00`, balance `R 325.13-` → amount +80000, balance −32513); page 3 continuation with **no** header + 1 row ending at `R 50.00-`; page 4 savings with an interest row. Assert: 2 accounts, credit card has 4 rows, roles `credit`/`savings`, `last4` correct, `checkBalances` ok for both; a tampered row amount → `ok:false`, `badRows` has that index.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Commit `feat: discovery bank statement parser with balance check`.

### Task 6: FNB parser

**Files:** Create `src/parsing/fnb.ts`; Test `src/parsing/fnb.test.ts`

**Interfaces:**
- Consumes: layout helpers, `parseRand`, `parseFnbPeriod`, `resolveDayMonth`, `resolvePurchaseDate`.
- Produces: `parseFnb(items: TextItem[]): ParsedStatement` with exactly one account.
- Behaviour:
  - Account: `FNB… Account : <number>` → typeLabel = text before the colon, `last4`, role `everyday`.
  - `Opening Balance` / `Closing Balance` → `openingBalance` / `closingBalance` (`Cr` → positive, no suffix → negative).
  - Rows: a line whose first item matches `/^\d{2} [A-Z][a-z]{2}$/` inside a transactions table (after a `Date…Amount…Balance` header).
  - Amount: `Cr` (as suffix or separate item) → positive, else negative. Balance: `Cr` → positive, else negative (overdrawn).
  - The `Accrued Bank Charges` column is ignored (never the amount).
  - Ref column `\d{6}\*\d{4} DD Mon` → `date = resolvePurchaseDate`, else `date = postedDate`.
  - Empty description → `description = 'Unknown (FNB)'`, `warnings: ['missing-description']`.
  - Turnover block `No. Credit Transactions N X Cr` / `No. Debit Transactions M Y Dr`: if present and the counts or totals differ from the parsed rows, push a statement warning `turnover-mismatch: …`.

- [ ] **Step 1: Failing tests** (synthetic fixture over 2 pages, period `20 November 2026 to 19 February 2027`, opening `100.00Cr`):
  - row `28 Dec` debit `50.00`, balance `50.00Cr` → `postedDate '2026-12-28'`, amount −5000.
  - row `02 Jan` with ref `654321*0987 31 Dec`, debit `80.00`, balance `30.00` (no Cr) → `date '2026-12-31'`, `postedDate '2027-01-02'`, balance −3000.
  - row `03 Jan` credit `200.00Cr`, balance `170.00Cr`, plus an accrued-charge item `3.50` in the charges column → amount +20000, not 350.
  - row `04 Jan` with no description item, amount `0.37`, balance `169.63Cr` → description `'Unknown (FNB)'`, warning present.
  - turnover `No. Credit Transactions 1 200.00Cr`, `No. Debit Transactions 3 130.37Dr` → no warning; change the count to 4 → warning.
  - `checkBalances` ok; closing `169.63Cr` matches.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Commit `feat: fnb statement parser`.

### Task 7: Bank detection + real-statement smoke test

**Files:** Create `src/parsing/detect.ts`, `tests/real/real.test.ts`; Test `src/parsing/detect.test.ts`

**Interfaces:**
- Produces: `detectBank(items: TextItem[]): Bank | null` (`Discovery Bank Limited` → discovery; `First National Bank` or `fnb.co.za` → fnb); `parseStatement(items: TextItem[]): ParsedStatement` (throws `UnsupportedStatementError` when null).
- `tests/real/real.test.ts`: `describe.skipIf(!existsSync('statements'))`. For each `statements/*.pdf`, extract via the legacy pdf.js build, `parseStatement`, then assert every account has `rows.length > 0`, `checkBalances(...).ok === true`, and no `turnover-mismatch` warning. Print counts and warnings only, never row content.

- [ ] **Step 1:** Failing detect tests with tiny fixtures → implement → PASS.
- [ ] **Step 2:** If statements exist: `npx vitest run tests/real` → PASS. If it fails, fix the parsers (Tasks 5/6) and add a synthetic fixture reproducing the layout case before fixing. Report how many FNB rows carry `missing-description`.
- [ ] **Step 3:** Commit `feat: bank detection and local real-statement smoke test`.

### Task 8: Rules, transfers, recategorise

**Files:** Create `src/engine/rules.ts`, `src/engine/transfers.ts`, `src/engine/recategorise.ts`; Tests alongside.

**Interfaces:**
- `matchRule(tx: Transaction, rules: Rule[]): Rule | undefined`: case-insensitive. `equals`/`contains` match `tx.payee`; `regex` matches `tx.payee` or `tx.description`. Specificity: `equals` > `contains`/`regex`, then longer `pattern`, then newer `createdAt`. An invalid regex never matches (no throw).
- `pairTransfers(txs: Transaction[], patterns: string[]): Map<string, string>` (txId → partner txId). Rules from Global Constraints. A pattern is a case-insensitive regex tested against `description`. Pick the closest date first and pair each tx at most once.
- `recategorise(txs: Transaction[], rules: Rule[], patterns: string[]): Transaction[]`: returns updated copies; txs with `setManually` are returned unchanged. Pipeline per non-manual tx: base kind (`amount < 0` → expense, else income) → paired or pattern-matching unpaired → `transfer` with `transferPairId` → matched rule overrides `kind`/`groupId`/`reimbursesGroupId` when set → expense without a group → `UNCATEGORISED`; non-expense kinds get `groupId = null` unless reimbursement.
- Default transfer patterns (seeded in Task 9): `payment to credit card`, `magtape debit discbank`, `^discbank`, `^fnb card$`, `inter account transfer`.

- [ ] **Step 1: Failing tests:**
  - rules: `equals 'Checkers Sixty60'` beats `contains 'checkers'`; between two `contains`, the longer wins; ties → newer; regex `'('` doesn't throw.
  - transfers: FNB −465500 "FNB App Payment To Credit Card" on 07-31 + Discovery +465500 "FNB CARD" on 07-31 → paired; two candidates 1 and 3 days apart → closest wins; same account → not paired; 4 days apart → not paired.
  - recategorise: an unpaired FNB "Magtape Debit Discbank …" → `transfer`; manual tx untouched; rule `{kind:'reimbursement', reimbursesGroupId:'groceries'}` applied to a +15000 "Kos Geld"-style payee (use an invented payee) → kind reimbursement, groupId null, reimbursesGroupId set; a "Payment fee" debit → expense (stays an expense even next to a transfer).
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Commit `feat: rules engine, transfer pairing, recategorise pipeline`.

### Task 9: Database, seed, import service

**Files:** Create `src/db/db.ts`, `src/db/seed.ts`, `src/db/importService.ts`; Test `src/db/importService.test.ts` (with `import 'fake-indexeddb/auto'`)

**Interfaces:**
- `db` (Dexie `BudgetDB`): tables `accounts` (`id, [bank+last4+typeLabel]`), `transactions` (`id, accountId, date, importHash, kind, groupId`), `groups` (`id`), `rules` (`id`), `settings` (`id`). Version 1.
- `seedIfEmpty(): Promise<void>`: the 17 groups from spec §7.10 with these exact ids: `home-rent, utilities, groceries, eating-out, alcohol, transport-fuel, vehicle-finance, insurance-medical, subscriptions, shopping, gaming, personal-care, family-people, education, bank-fees, other, uncategorised`, each with a distinct colour. Settings `{fallbackPayday: 25, transferPatterns: <Task 8 defaults>, dismissedSubscriptions: []}`. Starter **regex** rules (case-insensitive, matched against payee **or** description so fee lines without a clean payee still match): `checkers|pick n pay|\bpnp\b|woolworths|\bspar\b` → groceries; `shell|engen|sasol|\bbp\b|total |petroport` → transport-fuel; `uber eats|\bmcd|mcdonald|kfc|debonairs|romans|burger` → eating-out; `liquor|\bpub\b|\btops\b` → alcohol; `apple\.com|steam|netflix|showmax|spotify` → subscriptions; `^#?service fees|monthly account fee|monthly facility fee|payment fee|byc debit` → bank-fees; `takealot|temu` → shopping. (Task 8's `matchRule` therefore tests `regex` rules against both `payee` and `description`; `equals`/`contains` use `payee` only.)
- `importHash(accountId: string, r: ParsedRow): string` = `${accountId}|${r.postedDate}|${r.amount}|${normaliseDescription(r.description)}|${r.balance ?? ''}`.
- `previewImport(s: ParsedStatement): Promise<ImportPreview>` where `ImportPreview = { statement: ParsedStatement; accounts: {parsed: ParsedAccount; existingAccountId?: string; newRows: number; duplicateRows: number; balance: {ok: boolean; badRows: number[]}}[] }`.
- `commitImport(p: ImportPreview): Promise<{added: number}>`: create missing accounts (name = `${typeLabel} ••${last4}`), insert new txs (`payee = cleanPayee`, defaults `unplanned:false, setManually:false`), then load **all** txs + rules + settings, run `recategorise`, and bulkPut the changed ones. All in one Dexie transaction.
- `reapplyRules(): Promise<void>`: same recategorise pass (used by later UI tasks).

- [ ] **Step 1: Failing tests:** seed creates 17 groups including `uncategorised`; `commitImport` of a 3-row statement → 3 txs; importing the same statement again → preview `newRows 0, duplicateRows 3`, commit adds 0; **two identical same-day 5000 purchases with different balances both import** (Review Focus 1); a Shell row ends up in `transport-fuel`.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Commit `feat: dexie schema, seed data, import service with dedupe`.

### Task 10: Pay months

**Files:** Create `src/engine/payMonths.ts`; Test alongside.

**Interfaces:**
- `suggestSalaryPattern(txs: Transaction[]): string | undefined`: the payee of the largest income tx whose payee occurs as income in ≥ 2 different calendar months.
- `payMonths(txs: Transaction[], s: Settings, today: string): PayMonth[]`: salary dates = income txs whose payee contains `s.salaryPattern` (case-insensitive). Collapse dates < 10 days apart (keep earliest). Fill any gap > 40 days, and the span from the earliest tx date to the first salary, with dates on `s.fallbackPayday` (clamped to the month's last day). Each start runs to the day before the next start; the last runs to `today` or beyond. Label: `"29 Aug – 28 Sep"` (en-ZA short month). Newest first.
- `payMonthFor(date: string, months: PayMonth[]): PayMonth | undefined`.

- [ ] **Step 1: Failing tests:** salary on 06-30, 07-31, 08-29 → months `[08-29..]`, `[07-31..08-28]`, `[06-30..07-30]`; a tx on 06-10 gets a fallback month starting 05-25 (fallbackPayday 25); with no salary pattern, all months are fallback-based; `suggestSalaryPattern` picks the recurring large credit over a one-off larger one.
- [ ] **Step 2:** FAIL → implement → PASS. **Step 3:** Commit `feat: pay month detection`.

### Task 11: Reports + subscriptions

**Files:** Create `src/engine/reports.ts`, `src/engine/subscriptions.ts`; Tests alongside.

**Interfaces:**
- `monthSummary(txs: Transaction[], accounts: Account[], m: PayMonth): MonthSummary` where
  `MonthSummary = { in: Cents; out: Cents; saved: Cents; unplanned: Cents; movedToSavings: Cents; uncategorisedCount: number; byGroup: {groupId: string; amount: Cents}[] }`.
  Formulas from spec §7.3a: `in` = Σ income; `byGroup[g]` = Σ(−amount of expenses in g) − Σ(amount of reimbursements for g); `out` = Σ byGroup; `saved = in − out`; `unplanned` = Σ −amount of unplanned expenses; `movedToSavings` = Σ amount of transfers in `savings`-role accounts + Σ −amount of kind `savings`. `byGroup` is sorted desc. Values are positive cents.
- `groupChange(curr: MonthSummary, prev: MonthSummary | undefined, groupId: string): {pct: number | null; grew: boolean}`: `grew` when pct > 15.
- `detectSubscriptions(txs: Transaction[], months: PayMonth[], dismissed: string[]): Subscription[]` where `Subscription = { payee: string; monthly: Cents; yearly: Cents; lastDate: string; months: number }`. Rules from Global Constraints. `monthly` = median, `yearly = monthly * 12`. Excludes dismissed payees and non-expense kinds.

- [ ] **Step 1: Failing tests:** salary 30000 + groceries −5000 + transfer −3000 into savings account + reimbursement +1000 for groceries → `in 30000, out 4000, saved 26000, movedToSavings 3000`, groceries 4000; unplanned flag counted; growth 1000 → 1200 → `grew true` (20%), 1000 → 1100 → false. Subscriptions: a payee at 14.99 in 3 consecutive months → detected with yearly 17988; amounts 100/100/200 → not detected; in only 2 months → not; dismissed → not.
- [ ] **Step 2:** FAIL → implement → PASS. **Step 3:** Commit `feat: month summary and subscription detection`.

### Task 12: App shell and navigation

**Files:** Create `src/ui/App.tsx`, `src/ui/Layout.tsx`, `src/ui/components/MoneyText.tsx`, `src/ui/components/GroupPicker.tsx`, `src/ui/hooks.ts`; Modify `src/main.tsx`; Test `src/ui/App.test.tsx`

**Interfaces:**
- `HashRouter` routes: `/` Overview, `/import`, `/transactions`, `/sort`, `/budgets`, `/subscriptions`, `/rules`, `/settings`. `seedIfEmpty()` runs on startup.
- `hooks.ts`: `useAll()` → `{txs, accounts, groups, rules, settings, months}` via `useLiveQuery` (months computed with `payMonths`); `useSelectedMonth()` → state defaulting to the newest month.
- `MoneyText({cents, colourBySign?})`; `GroupPicker({value, onChange, includeHidden?})`.
- Styling: plain CSS with tokens on `:root`, light and dark via `prefers-color-scheme`, mobile-first (works at 375px), nav collapses to a bottom bar on narrow screens.

- [ ] **Step 1:** Failing test: render `<App/>` → the nav shows links "Overview", "Import", "Transactions"; an empty DB shows an "Import your first statement" call to action.
- [ ] **Step 2:** FAIL → implement → PASS. `npm run dev` loads with no console errors.
- [ ] **Step 3:** Commit `feat: app shell, routing, shared hooks`.

### Task 13: Import screen

**Files:** Create `src/ui/screens/ImportScreen.tsx`; Test `src/ui/screens/ImportScreen.test.tsx`

**Interfaces:**
- Consumes: `extractTextItems`, `PasswordRequiredError`, `WrongPasswordError`, `parseStatement`, `previewImport`, `commitImport`.
- Behaviour: drag-and-drop or file picker, multiple files processed one at a time. On `PasswordRequiredError`, show a password field ("This PDF is password protected"); on `WrongPasswordError`, show "Incorrect password, try again". The password lives only in component state for that call and is cleared right after. Preview table per account: name, period, new rows, duplicates, balance check (✓ or ⚠ with bad row dates), statement warnings (e.g. "12 rows had no description"). Buttons: "Import" and "Skip". After commit, show "Added N transactions" and a link to Sort if anything is uncategorised.

- [ ] **Step 1: Failing tests** (mock `extractTextItems`): first call throws `PasswordRequiredError` → password field shown; submitting calls again with the password; second call throws `WrongPasswordError` → "Incorrect password" shown; third resolves → preview shows "3 new"; after Import the success message shows and the password input is empty/unmounted.
- [ ] **Step 2:** FAIL → implement → PASS. **Step 3:** Commit `feat: import screen with password prompt and preview`.

### Task 14: Overview screen

**Files:** Create `src/ui/screens/OverviewScreen.tsx`, `src/ui/components/Donut.tsx`, `src/ui/components/BudgetBar.tsx`; Test `src/ui/screens/OverviewScreen.test.tsx`

**Interfaces:**
- Consumes: `useAll`, `useSelectedMonth`, `monthSummary`, `groupChange`.
- Layout (spec §7.7, mockup A+B): month selector (prev/next and label); tiles In / Out / Saved (Saved red when negative); tiles Unplanned and Moved to savings; donut (top 6 groups + "Other") with legend; ranked group list with amount, `BudgetBar` when a budget is set (`BudgetBar({spent, budget})`, states normal/amber/red per Global Constraints), and a change badge ("▲ 38% vs last month", highlighted when `grew`). A row click → `/transactions?group=<id>&month=<start>`. When `uncategorisedCount > 0`: a banner "N transactions need a group" → `/sort`.

- [ ] **Step 1: Failing tests:** seed DB with the Task 11 scenario → tiles show In R 300,00 / Out R 40,00 / Saved R 260,00 (use `formatRand` output); groceries budget 3000 vs spent 4000 → BudgetBar has `data-state="red"`; unit-test `BudgetBar` directly: spent 2000/3000 → `normal`, 2500/3000 (83%) → `amber`, 3000/3000 → `amber`, 3001/3000 → `red`.
- [ ] **Step 2:** FAIL → implement → PASS. **Step 3:** Commit `feat: overview screen`.

### Task 15: Transactions and Sort screens

**Files:** Create `src/ui/screens/TransactionsScreen.tsx`, `src/ui/screens/SortScreen.tsx`, `src/db/actions.ts`; Tests `src/db/actions.test.ts`, `src/ui/screens/TransactionsScreen.test.tsx`

**Interfaces:**
- `actions.ts`:
  - `setGroup(txId: string, groupId: string, applyToAll: boolean): Promise<void>`. `applyToAll` → upsert an `equals` rule on the tx payee (replacing an existing `equals` rule for the same payee), then `reapplyRules()`. Otherwise set `groupId`, `kind:'expense'`, `setManually:true`.
  - `setKind(txId: string, kind: TxKind, opts: {reimbursesGroupId?: string; applyToAll: boolean}): Promise<void>`: same rule/manual semantics.
  - `setUnplanned(txId: string, unplanned: boolean, tag?: string): Promise<void>`: doesn't touch `setManually`, since unplanned isn't overwritten by rules anyway.
- Transactions screen: filters by month (URL `month`), group (URL `group`), kind, text search, and unplanned only/tag. Rows: date, payee, account, amount, group/kind chip. Edit drawer: GroupPicker, kind select (with a reimbursed-group picker when reimbursement), "Apply to all from <payee>" checkbox (default checked), unplanned toggle + tag input with autocomplete from existing tags.
- Sort screen: uncategorised expenses grouped by payee (count, total, sorted by total desc), with a GroupPicker per payee that calls `setGroup(anyTxId, g, true)`.

- [ ] **Step 1: Failing tests (actions):** `setGroup(..., true)` creates one rule and re-groups the other two txs of the same payee, but not a tx of that payee with `setManually`; `setGroup(..., false)` changes only one tx and sets `setManually`; calling `setGroup(..., true)` again with another group replaces the rule (still one rule); `setKind(reimbursement)` sets `reimbursesGroupId`.
- [ ] **Step 2 (UI):** Failing test: filtering by `?group=groceries` shows only grocery rows; toggling unplanned with the tag "weekend drinks" persists.
- [ ] **Step 3:** FAIL → implement → PASS. **Step 4:** Commit `feat: transactions editing, sort screen, rule-creating actions`.

### Task 16: Budgets, Subscriptions, Rules, Settings (backup)

**Files:** Create `src/ui/screens/BudgetsScreen.tsx`, `SubscriptionsScreen.tsx`, `RulesScreen.tsx`, `SettingsScreen.tsx`, `src/db/backup.ts`; Test `src/db/backup.test.ts`

**Interfaces:**
- Budgets: a list of expense groups with a budget input (rands → cents), spent this month and a BudgetBar; add, rename, hide group.
- Subscriptions: `detectSubscriptions` output, a total yearly cost at the top, and a "Not a subscription" button → append to `settings.dismissedSubscriptions`.
- Rules: list (pattern, type, result), edit, delete, add; each change → `reapplyRules()`.
- Settings: salary pattern (pre-filled from `suggestSalaryPattern` with an "Use suggestion" button), fallback payday (1–31), transfer patterns (one per line), account names and roles (editable; role change affects movedToSavings), Export backup, Import backup.
- `backup.ts`: `exportBackup(): Promise<Blob>` → JSON `{app: 'budget-app', version: 1, exportedAt, accounts, transactions, groups, rules, settings}`. `importBackup(file: File): Promise<void>` validates `app === 'budget-app'`, `version === 1` and that every table is an array, **before** touching the DB; it throws `InvalidBackupError` otherwise; on success it clears and bulk-adds all tables in one transaction.

- [ ] **Step 1: Failing tests (backup):** export → import into a cleared DB gives identical tables; importing `{"foo":1}` or invalid JSON throws `InvalidBackupError` and the existing transactions count is unchanged (Review Focus 5).
- [ ] **Step 2:** FAIL → implement → PASS. Run `npm run dev` and click through all screens with no console errors.
- [ ] **Step 3:** Commit `feat: budgets, subscriptions, rules and settings screens with backup`.

### Task 17: GitHub Pages deploy + README

**Files:** Create `.github/workflows/deploy.yml`; Modify `vite.config.ts` (`base: '/Budgeting-App/'`, or whatever the GitHub repo name is: check `git remote -v`, and if there is no remote, read it from an env var `VITE_BASE` defaulting to `/`), `README.md`

- [ ] **Step 1:** Workflow: on push to `main` and `workflow_dispatch`: checkout → setup-node (LTS) → `npm ci` → `npm test` → `npm run build` → `actions/upload-pages-artifact` (dist) → `actions/deploy-pages`. Permissions `pages: write, id-token: write`.
- [ ] **Step 2:** README: what it is, the privacy model (data stays in the browser, never commit statements), how to run (`npm i`, `npm run dev`, `npm test`), how to enable Pages (Settings → Pages → Source: GitHub Actions), and the dev dump script.
- [ ] **Step 3:** `npm run build && npx vite preview` → app loads under the base path and a hash route refresh works.
- [ ] **Step 4:** Commit `ci: deploy to github pages`.
