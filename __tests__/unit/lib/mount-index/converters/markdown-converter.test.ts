/**
 * Unit tests for lib/mount-index/converters/markdown-converter.ts
 *
 * Tests for YAML frontmatter stripping, markdown syntax removal, and
 * file-read error handling.
 * Uses a real temp directory to avoid fs/promises mocking complexity.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
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

import { convertMarkdownToText } from '@/lib/mount-index/converters/markdown-converter'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quilltap-md-test-'))
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function write(name: string, content: string): Promise<string> {
  const filePath = path.join(tmpDir, name)
  await fs.writeFile(filePath, content, 'utf-8')
  return filePath
}

describe('convertMarkdownToText', () => {
  it('returns raw text for a plain markdown file with no special syntax', async () => {
    const f = await write('plain.md', 'Hello world.\nThis is plain text.')
    const result = await convertMarkdownToText(f)
    expect(result).toContain('Hello world.')
    expect(result).toContain('This is plain text.')
  })

  it('strips YAML frontmatter delimited by ---', async () => {
    const raw = '---\ntitle: My Document\ndate: 2026-01-01\n---\n\nActual content here.'
    const f = await write('frontmatter.md', raw)
    const result = await convertMarkdownToText(f)
    expect(result).not.toContain('title:')
    expect(result).not.toContain('date:')
    expect(result).toContain('Actual content here.')
  })

  it('leaves content intact when there is no frontmatter', async () => {
    const f = await write('nofm.md', 'No frontmatter at all.\n\nJust text.')
    const result = await convertMarkdownToText(f)
    expect(result).toContain('No frontmatter at all.')
    expect(result).toContain('Just text.')
  })

  it('removes # heading markers but keeps heading text', async () => {
    const f = await write('h1.md', '# My Great Title\n\nBody text.')
    const result = await convertMarkdownToText(f)
    expect(result).not.toContain('#')
    expect(result).toContain('My Great Title')
    expect(result).toContain('Body text.')
  })

  it('removes ## and deeper heading markers', async () => {
    const f = await write('h2.md', '## Section\n\n### Sub\n\nContent.')
    const result = await convertMarkdownToText(f)
    expect(result).not.toContain('#')
    expect(result).toContain('Section')
    expect(result).toContain('Sub')
    expect(result).toContain('Content.')
  })

  it('removes bold markers but keeps the text', async () => {
    const f = await write('bold.md', 'Some **bold** text.')
    const result = await convertMarkdownToText(f)
    expect(result).not.toContain('**')
    expect(result).toContain('bold')
  })

  it('removes italic markers but keeps the text', async () => {
    const f = await write('italic.md', 'Some *italic* text.')
    const result = await convertMarkdownToText(f)
    expect(result).not.toContain('*italic*')
    expect(result).toContain('italic')
  })

  it('removes link syntax but keeps the link text', async () => {
    const f = await write('link.md', 'See [the docs](https://example.com) for more.')
    const result = await convertMarkdownToText(f)
    expect(result).not.toContain('https://example.com')
    expect(result).toContain('the docs')
  })

  it('removes image syntax but keeps alt text', async () => {
    const f = await write('img.md', '![A cat](cat.png) is cute.')
    const result = await convertMarkdownToText(f)
    expect(result).not.toContain('cat.png')
    expect(result).toContain('A cat')
  })

  it('removes inline code backticks but keeps the code content', async () => {
    const f = await write('code.md', 'Use `npm install` to install.')
    const result = await convertMarkdownToText(f)
    expect(result).not.toContain('`')
    expect(result).toContain('npm install')
  })

  it('removes blockquote markers', async () => {
    const f = await write('blockquote.md', '> A quoted line.\n> Another line.')
    const result = await convertMarkdownToText(f)
    expect(result).not.toContain('>')
    expect(result).toContain('A quoted line.')
    expect(result).toContain('Another line.')
  })

  it('removes unordered list markers', async () => {
    const f = await write('ulist.md', '- Item one\n- Item two')
    const result = await convertMarkdownToText(f)
    expect(result).not.toMatch(/^- /m)
    expect(result).toContain('Item one')
    expect(result).toContain('Item two')
  })

  it('removes ordered list markers', async () => {
    const f = await write('olist.md', '1. First\n2. Second')
    const result = await convertMarkdownToText(f)
    expect(result).not.toMatch(/^\d+\. /m)
    expect(result).toContain('First')
    expect(result).toContain('Second')
  })

  it('returns empty string for an empty file', async () => {
    const f = await write('empty.md', '')
    expect(await convertMarkdownToText(f)).toBe('')
  })

  it('returns empty string for a whitespace-only file', async () => {
    const f = await write('whitespace.md', '   \n  \t  \n  ')
    expect(await convertMarkdownToText(f)).toBe('')
  })

  it('returns empty string when the file cannot be read', async () => {
    const result = await convertMarkdownToText(path.join(tmpDir, 'nonexistent.md'))
    expect(result).toBe('')
  })

  it('removes inline HTML tags but keeps the content between them', async () => {
    const f = await write('html.md', '<b>Bold</b> and <em>italic</em>.')
    const result = await convertMarkdownToText(f)
    expect(result).not.toContain('<b>')
    expect(result).not.toContain('</b>')
    expect(result).toContain('Bold')
    expect(result).toContain('italic')
  })
})
