/**
 * @jest-environment node
 */

/**
 * Help Doc Size Guard
 *
 * Every help document is embedded section by section, and a document's own
 * vector is the average of its sections' (bug 168: `chat-settings.md` once
 * outgrew OpenAI's 8,192-token embedding input and vanished from
 * `help_search`). The one size that can still break indexing is therefore a
 * single section's, so this reads every file in `help/`, slices it exactly as
 * the sync does, and counts real `cl100k_base` tokens of the text that would
 * be sent to the provider.
 *
 * A failure here names the file and section. The fix is usually a heading:
 * the chunker splits on headings, so a long stretch of prose with none is what
 * produces an oversize section.
 */

jest.mock('@/lib/logger', () => {
  const base: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  base.child = jest.fn(() => base)
  return { __esModule: true, logger: base }
})

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getEncoding } from 'js-tiktoken'
import { extractTitle, parseFrontmatter } from '@/lib/help/help-doc-sync'
import {
  HELP_SECTION_EMBEDDING_MAX_TOKENS,
  buildHelpDocChunks,
  helpChunkEmbeddingText,
} from '@/lib/help/help-doc-chunking'

const HELP_DIR = join(process.cwd(), 'help')

interface MeasuredSection {
  file: string
  chunkIndex: number
  heading: string | null
  tokens: number
}

function measureHelpSections(): MeasuredSection[] {
  const encoder = getEncoding('cl100k_base')
  const sections: MeasuredSection[] = []

  const files = readdirSync(HELP_DIR).filter(name => name.endsWith('.md')).sort()
  for (const file of files) {
    const raw = readFileSync(join(HELP_DIR, file), 'utf-8').trim()
    if (!raw) continue

    const { body } = parseFrontmatter(raw)
    const title = extractTitle(body, `help/${file}`)

    for (const chunk of buildHelpDocChunks(body)) {
      const text = helpChunkEmbeddingText(title, chunk.heading, chunk.content)
      sections.push({
        file,
        chunkIndex: chunk.chunkIndex,
        heading: chunk.heading,
        tokens: encoder.encode(text).length,
      })
    }
  }

  return sections
}

describe('help doc sizes', () => {
  const sections = measureHelpSections()

  it('finds the help documents to measure', () => {
    expect(new Set(sections.map(s => s.file)).size).toBeGreaterThan(50)
  })

  it(`keeps every help section within ${HELP_SECTION_EMBEDDING_MAX_TOKENS} embedding tokens`, () => {
    const oversize = sections
      .filter(s => s.tokens > HELP_SECTION_EMBEDDING_MAX_TOKENS)
      .map(s => `help/${s.file} section ${s.chunkIndex} (${s.heading ?? 'no heading'}): ${s.tokens} tokens`)

    expect(oversize).toEqual([])
  })
})
