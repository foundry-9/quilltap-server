/**
 * Unit Tests for PDF extraction in the File Content Extractor
 * Tests lib/services/file-content-extractor.ts
 *
 * Regression for bug 177: the extractor called `require('pdf-parse')` as the
 * v1 function, but pdf-parse 2.x exports a `PDFParse` class, so every PDF
 * failed and Summon From Lore dropped its PDF sources. PDF reads now go
 * through `convertPdfBufferToText`, with the regex fallback when it finds
 * no text.
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

const mockGetText = jest.fn()

// pdf-parse 2.x shape: a class, not a callable module
jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: mockGetText,
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
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
    mockGetText.mockReset()
    mockDownload.mockReset()
    mockDownload.mockResolvedValue(Buffer.from('%PDF-1.4 not really parsed here'))
  })

  it('returns the text pdf-parse 2.x extracts', async () => {
    mockGetText.mockResolvedValue({ text: 'Grandma keeps bees on the roof.', total: 1 })

    const result = await extractFileContent(pdfFile())

    expect(result.success).toBe(true)
    expect(result.contentType).toBe('text')
    expect(result.content).toBe('Grandma keeps bees on the roof.')
  })

  it('falls back to the regex extractor when pdf-parse finds no text', async () => {
    mockGetText.mockResolvedValue({ text: '   ', total: 1 })
    mockDownload.mockResolvedValue(Buffer.from('BT (Fallback lore line) Tj ET', 'latin1'))

    const result = await extractFileContent(pdfFile())

    expect(result.success).toBe(true)
    expect(result.content).toContain('Fallback lore line')
  })

  it('falls back when pdf-parse throws', async () => {
    mockGetText.mockRejectedValue(new ReferenceError('DOMMatrix is not defined'))
    mockDownload.mockResolvedValue(Buffer.from('BT (Recovered text) Tj ET', 'latin1'))

    const result = await extractFileContent(pdfFile())

    expect(result.success).toBe(true)
    expect(result.content).toContain('Recovered text')
  })

  it('reports failure when neither reader finds text', async () => {
    mockGetText.mockResolvedValue({ text: '', total: 1 })

    const result = await extractFileContent(pdfFile())

    expect(result.success).toBe(false)
    expect(result.contentType).toBe('error')
  })

  it('truncates very long PDF text', async () => {
    mockGetText.mockResolvedValue({ text: 'x'.repeat(60000), total: 1 })

    const result = await extractFileContent(pdfFile())

    expect(result.success).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.content).toHaveLength(50000)
  })
})
