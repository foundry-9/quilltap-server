/**
 * Unit tests for lib/mount-index/converters/index.ts
 *
 * Tests that convertToPlainText correctly routes to the appropriate
 * converter for each supported file type, using actual temp files for
 * txt/markdown and verifying routing logic.
 */

import { describe, it, expect } from '@jest/globals'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

// Mock pdf-parse dependency so pdf converter doesn't crash in test environment
jest.mock(
  'pdf-parse',
  () => ({ PDFParse: jest.fn().mockImplementation(() => ({ getText: jest.fn().mockResolvedValue({ text: 'pdf content', total: 1 }), destroy: jest.fn().mockResolvedValue(undefined) })) }),
  { virtual: true }
)
// Mock docx converter's dependency (mammoth) so it doesn't crash
jest.mock(
  'mammoth',
  () => ({ extractRawText: jest.fn().mockResolvedValue({ value: 'docx content' }) }),
  { virtual: true }
)

import { convertToPlainText } from '@/lib/mount-index/converters/index'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quilltap-idx-test-'))
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('convertToPlainText', () => {
  it('converts a txt file by reading it verbatim', async () => {
    const filePath = path.join(tmpDir, 'test.txt')
    await fs.writeFile(filePath, 'Plain text content.', 'utf-8')
    const result = await convertToPlainText(filePath, 'txt')
    expect(result).toBe('Plain text content.')
  })

  it('converts a markdown file by stripping syntax', async () => {
    const filePath = path.join(tmpDir, 'test.md')
    await fs.writeFile(filePath, '# Title\n\nBody text.', 'utf-8')
    const result = await convertToPlainText(filePath, 'markdown')
    expect(result).toContain('Title')
    expect(result).toContain('Body text.')
    expect(result).not.toContain('#')
  })

  it('returns empty string for a nonexistent txt file', async () => {
    const result = await convertToPlainText(path.join(tmpDir, 'nonexistent.txt'), 'txt')
    expect(result).toBe('')
  })

  it('returns empty string for a nonexistent markdown file', async () => {
    const result = await convertToPlainText(path.join(tmpDir, 'nonexistent.md'), 'markdown')
    expect(result).toBe('')
  })
})
