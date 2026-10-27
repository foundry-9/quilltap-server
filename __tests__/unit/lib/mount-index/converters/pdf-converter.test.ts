/**
 * @jest-environment node
 *
 * Unit tests for lib/mount-index/converters/pdf-converter.ts — the direct
 * pdfjs-dist text reader that replaced pdf-parse (pdfjs-dist 6 removed the
 * PDFDocumentProxy.destroy() pdf-parse relied on). pdfjs itself is faked:
 * these tests pin the line/cell assembly, the page markers, and that the
 * loading task is always destroyed.
 */

import { convertPdfBufferToText } from '@/lib/mount-index/converters/pdf-converter'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

interface FakeItem {
  str: string
  x: number
  y: number
  width?: number
  height?: number
  hasEOL?: boolean
}

const mockGetDocument = jest.fn()

jest.mock(
  'pdfjs-dist/legacy/build/pdf.mjs',
  () => ({
    getDocument: (...args: unknown[]) => mockGetDocument(...args),
    VerbosityLevel: { ERRORS: 0 },
  }),
  { virtual: true }
)

const PAGE_HEIGHT = 800

function fakePage(items: FakeItem[]) {
  return {
    getViewport: () => ({
      // PDF space is bottom-up; the viewport flips y like pdfjs does
      convertToViewportPoint: (x: number, y: number) => [x, PAGE_HEIGHT - y],
    }),
    getTextContent: async () => ({
      items: items.map((i) => ({
        str: i.str,
        transform: [1, 0, 0, 1, i.x, PAGE_HEIGHT - i.y],
        width: i.width ?? i.str.length * 5,
        height: i.height ?? 10,
        hasEOL: i.hasEOL ?? false,
      })),
    }),
    cleanup: jest.fn(),
  }
}

function fakeLoadingTask(pages: FakeItem[][], opts: { fail?: Error } = {}) {
  const task = {
    promise: opts.fail
      ? Promise.reject(opts.fail)
      : Promise.resolve({
          numPages: pages.length,
          getPage: async (n: number) => fakePage(pages[n - 1]),
        }),
    destroy: jest.fn().mockResolvedValue(undefined),
  }
  // Keep a rejected promise from tripping the unhandled-rejection guard
  task.promise.catch(() => {})
  mockGetDocument.mockReturnValue(task)
  return task
}

describe('convertPdfBufferToText', () => {
  beforeEach(() => {
    mockGetDocument.mockReset()
  })

  it('returns empty for an empty buffer without loading pdfjs', async () => {
    expect(await convertPdfBufferToText(Buffer.alloc(0))).toBe('')
    expect(mockGetDocument).not.toHaveBeenCalled()
  })

  it('joins items into lines, tabs between cells, and marks each page', async () => {
    const task = fakeLoadingTask([
      [
        { str: 'The Bee', x: 10, y: 100 },
        { str: 'Keeper', x: 50, y: 100 }, // same line, 5pt gap: no tab
        { str: 'Name', x: 10, y: 130 }, // next line
        { str: 'Hives', x: 100, y: 130 }, // same line, wide gap: tab
      ],
      [{ str: 'Second page.', x: 10, y: 100, hasEOL: true }],
    ])

    const text = await convertPdfBufferToText(Buffer.from('%PDF-1.7'))

    expect(text).toBe(
      'The BeeKeeper\nName\tHives\n\n-- 1 of 2 --\n\n' +
        'Second page.\n\n\n-- 2 of 2 --\n\n'
    )
    expect(task.destroy).toHaveBeenCalledTimes(1)
  })

  it('does not double a newline the item already ends with', async () => {
    fakeLoadingTask([
      [
        { str: 'Line one', x: 10, y: 100, hasEOL: true },
        { str: 'Line two', x: 10, y: 130 },
      ],
    ])

    const text = await convertPdfBufferToText(Buffer.from('%PDF-1.7'))

    expect(text.startsWith('Line one\nLine two\n\n-- 1 of 1 --')).toBe(true)
  })

  it('passes the hardened, text-only load options', async () => {
    fakeLoadingTask([[]])
    const buffer = Buffer.from('%PDF-1.7')

    await convertPdfBufferToText(buffer)

    const params = mockGetDocument.mock.calls[0][0]
    expect(params.enableXfa).toBe(false)
    expect(params.data).toBeInstanceOf(Uint8Array)
    // a copy, so pdfjs detaching it cannot touch the caller's Buffer
    expect(params.data.buffer).not.toBe(buffer.buffer)
  })

  it('answers empty and still destroys the task when loading fails', async () => {
    const task = fakeLoadingTask([], { fail: new Error('Invalid PDF structure') })

    expect(await convertPdfBufferToText(Buffer.from('not a pdf'))).toBe('')
    expect(task.destroy).toHaveBeenCalledTimes(1)
  })
})
