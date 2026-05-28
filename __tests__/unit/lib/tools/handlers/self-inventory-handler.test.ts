import { beforeEach, describe, expect, it } from '@jest/globals'

jest.mock('fs', () => ({
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

const mockRepos = {
  characters: {
    findById: jest.fn(),
  },
}

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => mockRepos),
}))

import fs from 'fs'
import {
  executeSelfInventoryTool,
  formatSelfInventoryResults,
} from '@/lib/tools/handlers/self-inventory-handler'

const mockFs = fs as unknown as {
  readdirSync: jest.Mock
  readFileSync: jest.Mock
}

const baseContext = {
  userId: 'user-1',
  chatId: 'chat-1',
  characterId: 'char-1',
}

describe('self-inventory quilltap sub-sections', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRepos.characters.findById.mockResolvedValue({
      id: 'char-1',
      name: 'Friday',
    })
    mockFs.readdirSync.mockReturnValue([])
    mockFs.readFileSync.mockReturnValue('# Quilltap Changelog\n\n## Recent Changes\n')
  })

  it('quilltap.version only does not read release notes/changelog files', async () => {
    const output = await executeSelfInventoryTool(
      { sections: ['quilltap.version'] },
      baseContext,
    )

    expect(output.success).toBe(true)
    expect(output.quilltap?.includedParts).toEqual({
      version: true,
      releaseNotes: false,
      changelog: false,
    })
    expect(mockFs.readFileSync).not.toHaveBeenCalled()
    expect(mockFs.readdirSync).not.toHaveBeenCalled()

    const formatted = formatSelfInventoryResults(output)
    expect(formatted).toContain('## Quilltap')
    expect(formatted).toContain('Version:')
    expect(formatted).not.toContain('### Release Notes')
    expect(formatted).not.toContain('### Changelog')
  })

  it('quilltap.changelog only reads changelog and omits release-notes boilerplate', async () => {
    const output = await executeSelfInventoryTool(
      { sections: ['quilltap.changelog'] },
      baseContext,
    )

    expect(output.success).toBe(true)
    expect(output.quilltap?.includedParts).toEqual({
      version: false,
      releaseNotes: false,
      changelog: true,
    })

    expect(mockFs.readFileSync).toHaveBeenCalledTimes(1)
    expect(mockFs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining('docs/CHANGELOG.md'),
      'utf-8',
    )
    expect(mockFs.readdirSync).not.toHaveBeenCalled()

    const formatted = formatSelfInventoryResults(output)
    expect(formatted).toContain('### Changelog')
    expect(formatted).not.toContain('### Release Notes')
    expect(formatted).not.toContain('(no release notes found for this version)')
  })

  it('top-level quilltap includes all three parts', async () => {
    mockFs.readdirSync.mockReturnValue(['4.6.0.md'])
    mockFs.readFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('docs/releases/4.6.0.md')) return '# Release Notes\n'
      if (filePath.includes('docs/CHANGELOG.md')) return '# Changelog\n'
      return ''
    })

    const output = await executeSelfInventoryTool(
      { sections: ['quilltap'] },
      baseContext,
    )

    expect(output.success).toBe(true)
    expect(output.quilltap?.includedParts).toEqual({
      version: true,
      releaseNotes: true,
      changelog: true,
    })

    const formatted = formatSelfInventoryResults(output)
    expect(formatted).toContain('### Release Notes')
    expect(formatted).toContain('### Changelog')
  })
})
