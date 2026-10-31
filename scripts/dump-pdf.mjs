// Dev tool: dump positioned text items from a statement PDF for layout inspection.
// Usage: node scripts/dump-pdf.mjs <in.pdf> [password]
// Writes statements/dumps/<name>.json and <name>.lines.txt (gitignored).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const [file, password] = process.argv.slice(2)
if (!file) {
  console.error('Usage: node scripts/dump-pdf.mjs <in.pdf> [password]')
  process.exit(1)
}

const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), password }).promise
const items = []
for (let p = 1; p <= doc.numPages; p++) {
  const content = await (await doc.getPage(p)).getTextContent()
  for (const it of content.items) {
    if (!('str' in it) || it.str === '') continue
    items.push({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, page: p })
  }
}

const lines = []
let current = null
for (const it of [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)) {
  if (current && current.page === it.page && Math.abs(current.y - it.y) <= 2) current.items.push(it)
  else lines.push((current = { page: it.page, y: it.y, items: [it] }))
}
const text = lines
  .map((l) => `p${l.page} y=${l.y.toFixed(1)}  ` +
    l.items.sort((a, b) => a.x - b.x).map((i) => `${Math.round(i.x)}:${i.str}`).join(' | '))
  .join('\n')

const name = basename(file, extname(file))
mkdirSync('statements/dumps', { recursive: true })
writeFileSync(`statements/dumps/${name}.json`, JSON.stringify(items, null, 1))
writeFileSync(`statements/dumps/${name}.lines.txt`, text + '\n')
console.log(`${items.length} items, ${lines.length} lines -> statements/dumps/${name}.*`)
