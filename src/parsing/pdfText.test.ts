import { beforeEach, describe, expect, it, vi } from 'vitest'

const getDocument = vi.hoisted(() => vi.fn())
vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker-url' }))

import { extractTextItems, PasswordRequiredError, WrongPasswordError } from './pdfText'

const buf = new ArrayBuffer(8)

describe('extractTextItems', () => {
  beforeEach(() => getDocument.mockReset())

  it('maps PasswordException code 1 to PasswordRequiredError', async () => {
    getDocument.mockReturnValue({ promise: Promise.reject({ name: 'PasswordException', code: 1 }) })
    await expect(extractTextItems(buf)).rejects.toBeInstanceOf(PasswordRequiredError)
  })

  it('maps PasswordException code 2 to WrongPasswordError', async () => {
    getDocument.mockReturnValue({ promise: Promise.reject({ name: 'PasswordException', code: 2 }) })
    await expect(extractTextItems(buf, 'x')).rejects.toBeInstanceOf(WrongPasswordError)
  })

  it('rethrows other errors unchanged', async () => {
    const err = new Error('boom')
    getDocument.mockReturnValue({ promise: Promise.reject(err) })
    await expect(extractTextItems(buf)).rejects.toBe(err)
  })

  it('returns items with x, y, width and 1-based page, skipping empty strings', async () => {
    const page = {
      getTextContent: async () => ({
        items: [
          { str: 'Date', transform: [1, 0, 0, 1, 30, 700], width: 20 },
          { str: '', transform: [1, 0, 0, 1, 50, 700], width: 0 },
        ],
      }),
    }
    getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: async () => page }) })
    expect(await extractTextItems(buf)).toEqual([{ str: 'Date', x: 30, y: 700, width: 20, page: 1 }])
  })
})
