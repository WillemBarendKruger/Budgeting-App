import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { TextItem } from '../domain/types'

GlobalWorkerOptions.workerSrc = workerUrl

export class PasswordRequiredError extends Error {
  constructor() {
    super('This PDF is password protected')
    this.name = 'PasswordRequiredError'
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Incorrect PDF password')
    this.name = 'WrongPasswordError'
  }
}

export async function extractTextItems(data: ArrayBuffer, password?: string): Promise<TextItem[]> {
  let doc
  try {
    // Copy: pdf.js transfers the buffer to its worker, which would detach the caller's.
    doc = await getDocument({ data: new Uint8Array(data.slice(0)), password }).promise
  } catch (e) {
    const err = e as { name?: string; code?: number }
    if (err?.name === 'PasswordException') {
      throw err.code === 2 ? new WrongPasswordError() : new PasswordRequiredError()
    }
    throw e
  }

  const items: TextItem[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent()
    for (const it of content.items) {
      if (!('str' in it) || it.str === '') continue
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, page: p })
    }
  }
  return items
}
