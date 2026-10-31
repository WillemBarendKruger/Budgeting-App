# Budgeting App — Design

Date: 2026-10-31
Status: Draft, awaiting approval

## 1. Intent

The owner's savings have been getting worse, and the transaction history in the banking apps doesn't show why. This app reads the owner's South African bank statements (FNB and Discovery Bank, as PDFs), sorts every transaction into spending groups, and shows where the money actually goes each month. It should make leaks obvious, such as eating out creeping up, forgotten subscriptions and unplanned spending, so the owner can act on them.

It is a personal tool for one person, inspired by [Actual Budget](https://github.com/actualbudget/actual) (local-first, rules-based categorisation, envelope-style budgets) but much smaller and built around SA bank PDF statements.

## 2. Goals (v1)

1. **Import** FNB and Discovery Bank PDF statements in the browser, including password-protected ones.
2. **Overview screen** (the main screen): income, spent and saved for the selected month, a donut of spending by group, and a ranked list of groups with the change versus the previous month. Groups that grew are highlighted.
3. **Payday-to-payday months**: a "month" runs from one salary deposit to the next, not from the 1st to the 31st.
4. **Learned grouping (rules)**: assigning a merchant to a group creates a rule that applies to future imports. Any single transaction can still be changed.
5. **Budget per group**: a monthly limit per group with a progress bar (normal, then amber from 80%, then red above 100%).
6. **Subscription finder**: detects debits that repeat monthly and shows the monthly and yearly cost.
7. **Unplanned spending**: any expense can be flagged "unplanned" with an optional free-text tag (e.g. "weekend drinks"). The overview shows the month's unplanned total, and the unplanned list can be filtered by tag.
8. **Transfers between own accounts are not spending**: they are detected and excluded from income and spending totals.
9. **Refunds/reimbursements**: incoming money is income by default. The owner can mark it as a reimbursement against a group, which reduces that group's spending. Rules can learn this.

## 3. Non-goals (v1)

- Savings goals, savings-rate trend chart, bank-fee tracker, debt payoff planner (candidates for v2).
- Sync across devices or a mobile app. Data lives in one browser.
- Any bank other than FNB and Discovery.
- Live bank connections or scraping. Import is from statement files only.
- Multiple users, logins, sharing.
- Multi-currency. Everything is ZAR.

## 4. Anti-goals (would make it a failure even if it "works")

- **Statements or transactions leaving the device.** No server, no analytics, no third-party API calls with financial data.
- **Personal financial data or statement PDFs committed to the Git repo.** The repo is expected to be public.
- **Storing the PDF password.** It is used once to open the file and then discarded.
- **Wrong totals that look right.** Double-counted transfers, duplicate imports or silently dropped rows would destroy trust. Import must show what it found and flag anything it couldn't read.
- **Tedious categorising.** If every import needs dozens of manual clicks, it won't get used.

## 5. Constraints

- **Hosting: GitHub Pages**, so a static site with no backend. All parsing and storage happen client-side.
- **Storage: browser IndexedDB.** It is per-browser and can be lost if site data is cleared. See backup in §7.8.
- Statements arrive as text-based PDFs (not scans). OCR is out of scope.

## 6. Tech choices (builder's call, recorded here)

The owner handed these choices over. They are the builder's calls, not requirements:

| Concern | Choice | Why |
|---|---|---|
| Language/UI | React + TypeScript, built with Vite | The owner knows React/TS; Vite builds static output for Pages |
| PDF reading | `pdfjs-dist` | Mature, runs in the browser, supports passwords, gives text with x/y positions |
| Storage | IndexedDB via Dexie | Simple typed wrapper, supports schema versioning and migrations |
| Charts | Recharts (or similar light React chart lib) | Donut and bars are all v1 needs |
| Tests | Vitest | Same toolchain as Vite |
| Deploy | GitHub Actions to GitHub Pages | Push to `main` deploys |

Exact library versions are chosen at build time (pin exact versions).

## 7. Behaviour

### 7.1 Import flow

1. The owner drops one or more PDFs onto the Import screen (or picks files).
2. The app detects the bank from the text (FNB vs Discovery markers). An unknown format gives a clear "not supported" message.
3. If the PDF is encrypted, the app prompts for the password and retries. Wrong password → re-prompt. The password is never stored.
4. A parser extracts **accounts** and **transactions**.
5. A **preview** shows, per account: the period, the number of rows found, and new rows vs duplicates. It also runs a **balance check**: opening balance + sum of transactions = closing balance (using the statement's own balance column). A mismatch is shown as a warning with the offending rows, never hidden.
6. The owner confirms. Transactions are saved, then rules, transfer matching and subscription detection run.

### 7.2 Statement formats (observed from real samples, Oct 2026)

**Discovery Bank** (combined "certified statement" PDF):
- One PDF contains several accounts (e.g. credit card, tax-free savings, Vitality savings). Each section starts with `Account type: … Account number: …`, and a section can continue onto the next page without repeating the header.
- Columns: `Date | Description | Debit | Credit | Balance`. Dates are `YYYY-MM-DD`. Amounts look like `R 1,234.56`. A negative balance has a trailing `-` (`R 188.01-`).
- First page is an account summary table, which is not transactions.

**FNB** (transaction account statement):
- Header has `Statement Period : 6 June 2026 to 7 September 2026` and opening/closing balances. One statement covers about 3 months.
- Columns: `Date | Description | (reference / card + txn date) | Amount | Balance | Accrued Bank Charges`.
- Dates are `08 Jun` **without a year**. The year comes from the statement period, and periods can span December to January.
- Single amount column: a `Cr` suffix means money in, no suffix means money out. Balance uses `Cr` for positive and no suffix for overdrawn.
- The middle column holds card-number fragments and the original transaction date (`123456*7890 05 Jun`). Don't treat it as part of the merchant name. **Builder's call:** the stored transaction date is this purchase date when present, otherwise the posting date. The posting date is kept as a separate field. The duplicate key (§7.4) uses the posting date, because that is what the statement's running balance follows.
- "Accrued Bank Charges" is a separate small number on some rows. It is **not** the transaction amount and must not be confused with it.
- A "Verified Statement" stamp overlaps the top of some pages.
- **Known risk:** in one text extraction, rows whose description starts with `#` (fee lines such as `#Service Fees #Int Pymt Fee-…`) and a few card purchases came out with **empty descriptions**. Verify with pdf.js against the real file first. If descriptions are truly missing from the text layer, fall back to: keep the row (amount and balance are intact), label it "Unknown (FNB)", and flag it in the preview.

Parsers should use pdf.js text items **with x positions** to assign text to columns, not just split lines on spaces.

### 7.3 Data model (sketch)

- **Account**: id, bank (`fnb` | `discovery`), type label, masked account number (last 4 digits only), display name, role (`everyday` | `credit` | `savings`).
- **Transaction**: id, accountId, date (purchase date), postedDate, description (raw), payee (cleaned), amount (signed integer cents, negative = money out), balance after (cents, if present), groupId, kind (`expense` | `income` | `transfer` | `savings` | `reimbursement`), reimbursesGroupId?, unplanned (bool), unplannedTag?, notes?, setManually (bool), importHash, transferPairId?.
- **Group**: id, name, monthly budget (cents, optional), colour, hidden flag.
- **Rule**: id, match (payee contains / equals / regex), sets groupId and/or kind (and reimbursesGroupId), created from a manual action or by hand, createdAt.
- **Settings**: payday detection (salary payee pattern, fallback day of month), own-account identifiers for transfer matching.

Money is stored as integer cents throughout, never as floats.

### 7.3a How In, Out and Saved are counted (builder's call)

The app exists because savings are dropping, so saving must never look like spending.

- **In** = transactions of kind `income` (salary, other incoming money, and interest earned on any account, including savings accounts).
- **Out** = kind `expense`, minus kind `reimbursement` amounts (reimbursements reduce the group they pay back, see §2.9).
- **Saved** = In − Out.
- `transfer` (between own accounts, including into/out of own savings accounts) and `savings` (money going to an outside investment, e.g. a unit-trust debit order) are **excluded from Out**. The overview also shows a small "Moved to savings this month" figure: net transfers into `savings`-role accounts plus kind `savings` outflows.
- Withdrawing from savings to cover spending is a transfer, so it doesn't count as In. The spending it pays for still counts as Out, which is correct.
- Because of this, "Savings & investments" is not an expense group. See §7.10.

### 7.3b Rules behaviour (builder's call)

- When the owner changes a transaction's group or kind, the app offers "Apply to all from *payee*", ticked by default. Ticked → create or update a rule. Unticked → change this one only.
- A new or edited rule is applied to **all existing transactions** that match, except ones with `setManually = true`. A one-off manual change sets `setManually`. Rules never overwrite it.
- When several rules match, the most specific wins: `equals` beats `contains`, then the longer pattern, then the newest rule.
- Transactions no rule matches go to "Uncategorised". The overview shows a count of uncategorised transactions linking to a quick-sort list, so the first import can be grouped merchant by merchant instead of row by row.

### 7.4 Duplicates

Statements overlap (e.g. FNB's 3-month statements). The duplicate key is account + posted date + amount + normalised description + running balance. The balance makes identical same-day purchases distinct. Re-importing the same file must add zero rows.

### 7.5 Transfers between own accounts

Both sides of a move between the owner's own accounts appear as transactions. Detection:
- Match an outflow in account A with an inflow of the same amount in account B within ±3 days, where the description hints at a transfer (e.g. FNB `Payment To Credit Card`, `Magtape Debit Discbank …`, `Payment To Discovery Tax Save`; Discovery `FNB CARD`, `DISCBANK …`, `Inter account transfer …`).
- Matched pairs get kind `transfer` and are excluded from income and spending.
- An unmatched transfer-looking row (because the other account's statement wasn't imported) is still marked `transfer` if it matches a known own-account pattern. The owner can override it.
- Fees charged on a transfer (e.g. "Payment fee", "PayShap payment fee") remain expenses (group: Bank fees).

### 7.6 Pay months

A pay month starts on the date of the salary deposit (a payee pattern set in Settings, pre-filled from the largest regular monthly credit) and runs until the day before the next one. If no salary is found for a month, fall back to a configured day of month. All overview and budget figures use pay months.

### 7.7 Overview screen

Layout is the owner's pick: a combination of mockups A and B.
- Top: month selector and three tiles: **In**, **Out**, **Saved** (In − Out; red if negative).
- **Unplanned this month** tile with the total.
- Donut of spending by group (top ~6 groups, the rest as "Other").
- Ranked list of groups: amount, budget bar (if a budget is set), and change vs the previous pay month (highlighted when up noticeably, e.g. > 15%).
- Clicking a group opens its transactions.

Other screens: Transactions (filter, search, edit group/kind/unplanned), Import, Budgets, Subscriptions, Rules, Settings (including backup).

### 7.8 Backup

Since data lives in one browser, Settings offers **Export backup** (a JSON file of all data) and **Import backup** (replace). This is the builder's call, added because losing site data would otherwise wipe everything. It is not sync.

### 7.9 Subscription finder

Group debits by cleaned payee. Flag as a subscription when the payee appears in ≥ 3 consecutive pay months at a similar amount (±10%) and on a similar day of month. Show the monthly cost, the yearly cost (× 12) and the last charge date. The owner can dismiss false positives. Debit orders (e.g. vehicle finance, insurance) show up here too, which is fine.

### 7.10 Default groups

Expense groups, seeded and editable: Home & rent, Utilities & electricity, Groceries, Eating out & takeaways, Alcohol & going out, Transport & fuel, Vehicle finance, Insurance & medical, Subscriptions & apps, Shopping, Gaming & entertainment, Personal care, Family & people, Education, Bank fees, Other, Uncategorised.

Income and savings are tracked by transaction **kind** (`income`, `savings`, `transfer`), not by expense groups. Income may optionally carry a sub-label (Salary, Interest, Other income) for display.

Starter rules for obvious SA merchants are a nice-to-have (e.g. Checkers, Pick n Pay, Woolworths → Groceries; Shell, Engen, Sasol → Fuel; Uber Eats, McDonald's, KFC → Eating out; FNB/Discovery fee lines → Bank fees).

## 8. Privacy and repo hygiene

- `statements/` (local sample PDFs for development) and any `*.pdf` are in `.gitignore` from the first commit.
- Parser tests use **synthetic fixtures**: hand-written text-item arrays that mimic the layout with invented merchants and amounts, never real statement content.
- No personal names, account numbers or ID numbers in code, tests, docs or commit messages.

## 9. Open items for the builder

- Confirm pdf.js extraction of FNB `#…` fee rows (§7.2 risk) against the real PDFs in `statements/` before finalising the FNB parser. The owner is placing one FNB and one Discovery sample there (gitignored). Plan the parser work as: first a small throwaway script that dumps pdf.js text items with x/y positions from each real PDF, then build the parsers and synthetic fixtures from that output. If the samples aren't available yet, put the parser tasks after the app shell and storage tasks.
- A weekday/weekend spending view is **not** in v1. It can be added later, since stored dates are purchase dates.
- Find out whether the owner's PDFs are actually password-protected (the samples seen were not). The password flow should be built either way.
- FNB online banking may offer CSV/OFX transaction downloads. A CSV importer is a possible later addition, not v1.
