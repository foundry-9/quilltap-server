/**
 * Unit Tests for PDF extraction in the File Content Extractor
 * Tests lib/services/file-content-extractor.ts
 *
 * Regression for bug 177: the extractor called `require('pdf-parse')` as the
 * v1 function, but pdf-parse 2.x exports a `PDFParse` class, so every PDF
 * failed and Summon From Lore dropped its PDF sources. PDF reads now go
 * through `convertPdfBufferToText`, with the regex fallback when it finds
 * no text. (pdf-parse has since been replaced by a direct pdfjs-dist reader;
 * that reader has its own tests in pdf-converter.test.ts.)
 */

import { extractFileContent } from '@/lib/services/file-content-extractor'
import { fileStorageManager } from '@/lib/file-storage/manager'
import type { FileEntry } from '@/lib/schemas/types'

// ============================================================================
// Mocks
// ============================================================================

jest.mock('@/lib/logger', () => {
  const log = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  log.child.mockReturnValue(log)
  return { logger: log }
})

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: {
    downloadFile: jest.fn(),
  },
}))

const mockConvert = jest.fn()

jest.mock('@/lib/mount-index/converters/pdf-converter', () => ({
  convertPdfBufferToText: (...args: unknown[]) => mockConvert(...args),
}))

// ============================================================================
// Helpers
// ============================================================================

function pdfFile(): FileEntry {
  return {
    id: 'file-1',
    userId: 'user-1',
    originalFilename: 'lore.pdf',
    mimeType: 'application/pdf',
    size: 1024,
    storageKey: 'mount-blob:mp:blob',
  } as unknown as FileEntry
}

const mockDownload = fileStorageManager.downloadFile as jest.Mock

// ============================================================================
// Tests
// ============================================================================

describe('extractFileContent — PDF', () => {
  beforeEach(() => {
    mockConvert.mockReset()
    mockDownload.mockReset()
    mockDownload.mockResolvedValue(Buffer.from('%PDF-1.4 not really parsed here'))
  })

  it('returns the text the PDF reader extracts', async () => {
    mockConvert.mockResolvedValue('Grandma keeps bees on the roof.')

    const result = await extractFileContent(pdfFile())

    expect(result.success).toBe(true)
    expect(result.contentType).toBe('text')
    expect(result.content).toBe('Grandma keeps bees on the roof.')
  })

  it('falls back to the regex extractor when the PDF reader finds no text', async () => {
    mockConvert.mockResolvedValue('   ')
    mockDownload.mockResolvedValue(Buffer.from('BT (Fallback lore line) Tj ET', 'latin1'))

    const result = await extractFileContent(pdfFile())

    expect(result.success).toBe(true)
    expect(result.content).toContain('Fallback lore line')
  })

  it('falls back when the PDF reader fails', async () => {
    // The reader logs and answers '' on any failure (e.g. DOMMatrix missing)
    mockConvert.mockResolvedValue('')
    mockDownload.mockResolvedValue(Buffer.from('BT (Recovered text) Tj ET', 'latin1'))

    const result = await extractFileContent(pdfFile())

    expect(result.success).toBe(true)
    expect(result.content).toContain('Recovered text')
  })

  it('reports failure when neither reader finds text', async () => {
    mockConvert.mockResolvedValue('')

    const result = await extractFileContent(pdfFile())

    expect(result.success).toBe(false)
    expect(result.contentType).toBe('error')
  })

  it('truncates very long PDF text', async () => {
    mockConvert.mockResolvedValue('x'.repeat(60000))

    const result = await extractFileContent(pdfFile())

    expect(result.success).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.content).toHaveLength(50000)
  })
})
