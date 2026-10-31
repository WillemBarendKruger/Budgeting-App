// Node-side text extraction (pdf.js legacy build) shared by dev scripts and the real-statement test.
// Produces the same TextItem shape as src/parsing/pdfText.ts: { str, x, y, width, page } (1-based page).
import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export async function extractNode(path, password) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), password }).promise
  const items = []
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent()
    for (const it of content.items) {
      if (!('str' in it) || it.str === '') continue
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, page: p })
    }
  }
  return items
}
