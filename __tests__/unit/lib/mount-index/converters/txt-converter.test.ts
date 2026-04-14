/**
 * Unit tests for lib/mount-index/converters/txt-converter.ts
 *
 * Tests for plain-text file reading and error handling.
 * Uses a real temp directory to avoid fs/promises mocking complexity.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import { convertTxtToText } from '@/lib/mount-index/converters/txt-converter'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quilltap-txt-test-'))
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('convertTxtToText', () => {
  it('returns the file contents verbatim', async () => {
    const content = 'Hello, world!\nLine two.'
    const filePath = path.join(tmpDir, 'file.txt')
    await fs.writeFile(filePath, content, 'utf-8')
    expect(await convertTxtToText(filePath)).toBe(content)
  })

  it('returns an empty string for an empty file', async () => {
    const filePath = path.join(tmpDir, 'empty.txt')
    await fs.writeFile(filePath, '', 'utf-8')
    expect(await convertTxtToText(filePath)).toBe('')
  })

  it('returns an empty string when the file does not exist', async () => {
    const result = await convertTxtToText(path.join(tmpDir, 'nonexistent.txt'))
    expect(result).toBe('')
  })

  it('preserves multi-line text including blank lines', async () => {
    const content = 'Line one.\n\nLine three after blank.'
    const filePath = path.join(tmpDir, 'multiline.txt')
    await fs.writeFile(filePath, content, 'utf-8')
    expect(await convertTxtToText(filePath)).toBe(content)
  })

  it('preserves leading and trailing whitespace', async () => {
    const content = '  indented content  '
    const filePath = path.join(tmpDir, 'spaced.txt')
    await fs.writeFile(filePath, content, 'utf-8')
    expect(await convertTxtToText(filePath)).toBe(content)
  })

  it('handles a file with only whitespace', async () => {
    const content = '   \n\n   '
    const filePath = path.join(tmpDir, 'whitespace.txt')
    await fs.writeFile(filePath, content, 'utf-8')
    expect(await convertTxtToText(filePath)).toBe(content)
  })
})
