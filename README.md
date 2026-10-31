# Budgeting App

A local-first budgeting app. Import your bank PDF statements, categorise transactions, and track budgets, subscriptions and rules, all in the browser. No backend.

## Privacy

- Statements are parsed in your browser. Nothing is uploaded anywhere.
- Data is stored in this browser's IndexedDB only.
- Never commit statements. `statements/` and `*.pdf` are gitignored.
- Export a backup from Settings regularly. Clearing site data deletes everything.

## Supported banks

FNB and Discovery Bank PDF statements. Password-protected PDFs prompt for the password, which is never stored.

## Run locally

```
npm i
npm run dev
npm test
npm run build
```

## Verify parsers against your own statements

Put PDFs in `statements/`, then:

```
npx vitest run tests/real
```

Set the optional `STATEMENT_PASSWORD` env var for protected PDFs. The real-statement tests skip when `statements/` is absent (as in CI).

For debugging, `node scripts/dump-pdf.mjs statements/x.pdf` writes text-item dumps to `statements/dumps/`. Never share or commit those outputs.

## Deploy

1. Create a GitHub repo and push `main`.
2. Settings → Pages → Source: GitHub Actions.

The workflow (`.github/workflows/deploy.yml`) tests, builds with `VITE_BASE=/<repo>/`, and publishes. The app is served at `https://<user>.github.io/<repo>/`.
