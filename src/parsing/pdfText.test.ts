import { beforeEach, describe, expect, it, vi } from 'vitest'

const getDocument = vi.hoisted(() => vi.fn())
vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker-url' }))

import { extractTextItems, PasswordRequiredError, WrongPasswordError } from './pdfText'

const buf = new ArrayBuffer(8)
const destroy = vi.fn(async () => {})

describe('extractTextItems', () => {
  beforeEach(() => {
    getDocument.mockReset()
    destroy.mockClear()
  })

  it('maps PasswordException code 1 to PasswordRequiredError', async () => {
    getDocument.mockReturnValue({ promise: Promise.reject({ name: 'PasswordException', code: 1 }), destroy })
    await expect(extractTextItems(buf)).rejects.toBeInstanceOf(PasswordRequiredError)
  })

  it('maps PasswordException code 2 to WrongPasswordError', async () => {
    getDocument.mockReturnValue({ promise: Promise.reject({ name: 'PasswordException', code: 2 }), destroy })
    await expect(extractTextItems(buf, 'x')).rejects.toBeInstanceOf(WrongPasswordError)
  })

  it('rethrows other errors unchanged', async () => {
    const err = new Error('boom')
    getDocument.mockReturnValue({ promise: Promise.reject(err), destroy })
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
    getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: async () => page }), destroy })
    expect(await extractTextItems(buf)).toEqual([{ str: 'Date', x: 30, y: 700, width: 20, page: 1 }])
  })

  it('destroys the loading task on success and on password failure', async () => {
    const page = { getTextContent: async () => ({ items: [] }) }
    getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: async () => page }), destroy })
    await extractTextItems(buf, 'pw')
    expect(destroy).toHaveBeenCalledTimes(1)

    getDocument.mockReturnValue({ promise: Promise.reject({ name: 'PasswordException', code: 2 }), destroy })
    await expect(extractTextItems(buf, 'pw')).rejects.toBeInstanceOf(WrongPasswordError)
    expect(destroy).toHaveBeenCalledTimes(2)
  })

  it('destroys the loading task when reading a page throws', async () => {
    getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: async () => { throw new Error('bad page') } }),
      destroy,
    })
    await expect(extractTextItems(buf)).rejects.toThrow('bad page')
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
