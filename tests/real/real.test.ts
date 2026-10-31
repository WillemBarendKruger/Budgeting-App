// @vitest-environment node
// Local smoke test against real statements in ./statements (gitignored). Skipped when the folder is absent.
// Prints only counts and warnings, never row contents.
import { existsSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkBalances } from '../../src/parsing/check'
import { parseStatement } from '../../src/parsing/detect'
// @ts-expect-error plain .mjs helper without types
import { extractNode } from '../../scripts/pdf-node.mjs'
import type { TextItem } from '../../src/domain/types'

const dir = 'statements'
const pdfs = existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')) : []

describe.skipIf(!existsSync(dir))('real statements', () => {
  it.each(pdfs.map((f, i) => [i + 1, f]))('statement %i parses and balances', async (n, file) => {
    const items = (await extractNode(`${dir}/${file}`)) as TextItem[]
    const st = parseStatement(items)
    let missingDesc = 0
    for (const acc of st.accounts) {
      const chk = checkBalances(acc)
      missingDesc += acc.rows.filter((r) => r.warnings.includes('missing-description')).length
      console.log(`#${n} ${st.bank} ${acc.role} ****${acc.last4}: ${acc.rows.length} rows, ok=${chk.ok}, bad=${chk.badRows.length}, checked=${chk.checked}`)
      expect(acc.rows.length).toBeGreaterThan(0)
      expect(chk.ok).toBe(true)
    }
    console.log(`#${n} warnings: ${JSON.stringify(st.warnings)}; missing-description rows: ${missingDesc}`)
    expect(st.warnings.some((w) => w.startsWith('turnover-mismatch'))).toBe(false)
  })
})
