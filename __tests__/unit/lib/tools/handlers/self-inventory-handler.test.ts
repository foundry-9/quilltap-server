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
  docMountPoints: {
    findById: jest.fn(),
  },
  docMountFiles: {
    findByMountPointId: jest.fn(),
  },
  groupCharacterMembers: {
    findByCharacterId: jest.fn(),
    findByGroupId: jest.fn(),
  },
  groups: {
    findById: jest.fn(),
  },
  groupDocMountLinks: {
    findByGroupId: jest.fn(),
  },
  chats: {
    findById: jest.fn(),
  },
  chatDocuments: {
    findByChatId: jest.fn(),
  },
  projects: {
    findById: jest.fn(),
  },
  projectDocMountLinks: {
    findByProjectId: jest.fn(),
  },
}

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => mockRepos),
}))

jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({
  isMountIndexDegraded: jest.fn(() => false),
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

function fileRow(relativePath: string, fileType = 'markdown') {
  return {
    relativePath,
    fileName: relativePath.split('/').pop() ?? relativePath,
    fileType,
    fileSizeBytes: 100,
    lastModified: '2026-01-01T00:00:00.000Z',
  }
}

describe('self-inventory vault / vaultAccess sub-sections', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRepos.characters.findById.mockResolvedValue({
      id: 'char-1',
      name: 'Friday',
      characterDocumentMountPointId: 'mp-char-1',
    })
    mockRepos.docMountPoints.findById.mockImplementation((id: string) =>
      Promise.resolve({ id, name: id === 'mp-char-1' ? 'Friday Vault' : `Store ${id}` }),
    )
    mockRepos.docMountFiles.findByMountPointId.mockResolvedValue([])
    mockRepos.groupCharacterMembers.findByCharacterId.mockResolvedValue([])
    mockRepos.groupCharacterMembers.findByGroupId.mockResolvedValue([])
    mockRepos.groups.findById.mockResolvedValue(null)
    mockRepos.groupDocMountLinks.findByGroupId.mockResolvedValue([])
    mockRepos.chats.findById.mockResolvedValue({
      id: 'chat-1',
      title: 'Test Chat',
      projectId: null,
      participants: [],
      allowCrossCharacterVaultReads: false,
    })
  })

  it('vault.character hides auto-generated images and OS cruft by default', async () => {
    mockRepos.docMountFiles.findByMountPointId.mockResolvedValue([
      fileRow('manifesto.md'),
      fileRow('identity.md'),
      fileRow('images/avatar.webp', 'blob'),
      fileRow('images/history/portrait-1.webp', 'blob'),
      fileRow('.DS_Store', 'blob'),
    ])

    const output = await executeSelfInventoryTool({ sections: ['vault.character'] }, baseContext)
    expect(output.success).toBe(true)
    expect(output.vault?.includedParts).toEqual({ character: true, groups: false })

    const character = output.vault?.character
    if (!character || !character.available) throw new Error('expected available character vault')
    expect(character.files.map(f => f.relativePath)).toEqual(['identity.md', 'manifesto.md'])
  })

  it('vault.character includes auto-generated images when includeAutomaticImages is true', async () => {
    mockRepos.docMountFiles.findByMountPointId.mockResolvedValue([
      fileRow('manifesto.md'),
      fileRow('images/avatar.webp', 'blob'),
      fileRow('.DS_Store', 'blob'),
    ])

    const output = await executeSelfInventoryTool(
      { sections: ['vault.character'], includeAutomaticImages: true },
      baseContext,
    )
    const character = output.vault?.character
    if (!character || !character.available) throw new Error('expected available character vault')
    // Auto-image now kept; OS cruft still hidden regardless of the flag.
    expect(character.files.map(f => f.relativePath)).toEqual(['images/avatar.webp', 'manifesto.md'])
  })

  it('bare vault returns both character and groups parts', async () => {
    mockRepos.groupCharacterMembers.findByCharacterId.mockResolvedValue([
      { groupId: 'g1', characterId: 'char-1' },
    ])
    mockRepos.groups.findById.mockResolvedValue({
      id: 'g1',
      name: 'The Council',
      officialMountPointId: 'mp-g1',
    })
    mockRepos.docMountFiles.findByMountPointId.mockImplementation((mpId: string) =>
      Promise.resolve(
        mpId === 'mp-g1' ? [fileRow('charter.md')] : [fileRow('manifesto.md')],
      ),
    )

    const output = await executeSelfInventoryTool({ sections: ['vault'] }, baseContext)
    expect(output.vault?.includedParts).toEqual({ character: true, groups: true })
    expect(output.vault?.character).toBeDefined()

    const groupsSection = output.vault?.groups
    if (!groupsSection || !groupsSection.available) throw new Error('expected available group vaults')
    expect(groupsSection.groups[0]?.groupName).toBe('The Council')
    expect(groupsSection.groups[0]?.files.map(f => f.relativePath)).toEqual(['charter.md'])
  })

  it('vaultAccess.groups lists members chat-independently, all read/write', async () => {
    mockRepos.groupCharacterMembers.findByCharacterId.mockResolvedValue([
      { groupId: 'g1', characterId: 'char-1' },
    ])
    mockRepos.groups.findById.mockResolvedValue({
      id: 'g1',
      name: 'The Council',
      officialMountPointId: 'mp-g1',
    })
    mockRepos.groupCharacterMembers.findByGroupId.mockResolvedValue([
      { characterId: 'char-1' },
      { characterId: 'char-2' },
    ])
    mockRepos.characters.findById.mockImplementation((id: string) => {
      if (id === 'char-1') return Promise.resolve({ id: 'char-1', name: 'Friday' })
      if (id === 'char-2') return Promise.resolve({ id: 'char-2', name: 'Jeeves' })
      return Promise.resolve(null)
    })

    const output = await executeSelfInventoryTool({ sections: ['vaultAccess.groups'] }, baseContext)
    expect(output.vaultAccess?.includedParts).toEqual({ character: false, groups: true })
    // Group access never consults the chat — it is membership-based.
    expect(mockRepos.chats.findById).not.toHaveBeenCalled()

    const groupsSection = output.vaultAccess?.groups
    if (!groupsSection || !groupsSection.available) throw new Error('expected available group access')
    expect(groupsSection.groups[0]?.members.map(m => m.characterName)).toContain('Jeeves')
    expect(groupsSection.groups[0]?.members.every(m => m.access === 'read_write')).toBe(true)
  })

  it('bare vaultAccess returns both character and groups parts', async () => {
    const output = await executeSelfInventoryTool({ sections: ['vaultAccess'] }, baseContext)
    expect(output.vaultAccess?.includedParts).toEqual({ character: true, groups: true })
    expect(output.vaultAccess?.character).toBeDefined()
    expect(output.vaultAccess?.groups).toBeDefined()
  })
})

describe('self-inventory context section', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRepos.characters.findById.mockResolvedValue({
      id: 'char-1',
      name: 'Friday',
      characterDocumentMountPointId: 'mp-char-1',
    })
    mockRepos.chats.findById.mockResolvedValue({
      id: 'chat-1',
      title: 'Grand Adventure',
      projectId: null,
      participants: [],
    })
    mockRepos.groupCharacterMembers.findByCharacterId.mockResolvedValue([])
    mockRepos.docMountPoints.findById.mockImplementation((id: string) =>
      Promise.resolve({ id, name: `Store ${id}` }),
    )
    mockRepos.projects.findById.mockResolvedValue(null)
    mockRepos.projectDocMountLinks.findByProjectId.mockResolvedValue([])
    mockRepos.chatDocuments.findByChatId.mockResolvedValue([])
  })

  it('context.chat returns id and title', async () => {
    const output = await executeSelfInventoryTool({ sections: ['context.chat'] }, baseContext)
    expect(output.context?.includedParts).toEqual({
      chat: true,
      project: false,
      groups: false,
      characters: false,
      files: false,
    })
    expect(output.context?.chat?.title).toBe('Grand Adventure')
    expect(output.context?.chat?.chatId).toBe('chat-1')
  })

  it('context.project reports id, name and linked mount points', async () => {
    mockRepos.projects.findById.mockResolvedValue({
      id: 'proj-1',
      name: 'My Novel',
      officialMountPointId: 'mp-proj',
    })
    mockRepos.projectDocMountLinks.findByProjectId.mockResolvedValue([{ mountPointId: 'mp-extra' }])

    const output = await executeSelfInventoryTool(
      { sections: ['context.project'] },
      { ...baseContext, projectId: 'proj-1' },
    )
    const project = output.context?.project
    if (!project || !project.available || !project.present) {
      throw new Error('expected a present project')
    }
    expect(project.name).toBe('My Novel')
    expect(project.mountPoints.map(m => m.mountPointId).sort()).toEqual(['mp-extra', 'mp-proj'])
  })

  it('context.project reports absent when the chat has no project', async () => {
    const output = await executeSelfInventoryTool({ sections: ['context.project'] }, baseContext)
    const project = output.context?.project
    expect(project?.available).toBe(true)
    expect(project && project.available && project.present).toBe(false)
  })

  it('context.characters lists present peers and flags the user persona', async () => {
    mockRepos.chats.findById.mockResolvedValue({
      id: 'chat-1',
      title: 'X',
      projectId: null,
      participants: [
        { id: 'p0', type: 'CHARACTER', characterId: 'char-1', controlledBy: 'llm', status: 'active' },
        { id: 'p1', type: 'CHARACTER', characterId: 'char-2', controlledBy: 'llm', status: 'active' },
        { id: 'p2', type: 'CHARACTER', characterId: 'char-3', controlledBy: 'user', status: 'active' },
        { id: 'p3', type: 'CHARACTER', characterId: 'char-4', controlledBy: 'llm', status: 'absent' },
      ],
    })
    mockRepos.characters.findById.mockImplementation((id: string) => {
      const map: Record<string, unknown> = {
        'char-1': { id: 'char-1', name: 'Friday', characterDocumentMountPointId: 'mp-char-1' },
        'char-2': { id: 'char-2', name: 'Jeeves', aliases: ['J'], identity: 'A valet' },
        'char-3': { id: 'char-3', name: 'Bertie', aliases: [], identity: 'A gentleman' },
        'char-4': { id: 'char-4', name: 'Ghost', aliases: [], identity: null },
      }
      return Promise.resolve(map[id] ?? null)
    })

    const output = await executeSelfInventoryTool({ sections: ['context.characters'] }, baseContext)
    const charactersSection = output.context?.characters
    if (!charactersSection || !charactersSection.available) {
      throw new Error('expected available characters section')
    }
    // Self excluded, absent excluded, sorted by name.
    expect(charactersSection.characters.map(c => c.name)).toEqual(['Bertie', 'Jeeves'])
    expect(charactersSection.characters.find(c => c.name === 'Bertie')?.isUserPersona).toBe(true)
    const jeeves = charactersSection.characters.find(c => c.name === 'Jeeves')
    expect(jeeves?.isUserPersona).toBe(false)
    expect(jeeves?.aliases).toEqual(['J'])
  })

  it('context.files emits a doc_read_file how-to-reach per attached file', async () => {
    mockRepos.chatDocuments.findByChatId.mockResolvedValue([
      { scope: 'document_store', mountPoint: 'My Vault', filePath: 'Notes/plot.md', displayTitle: 'Plot' },
      { scope: 'project', mountPoint: null, filePath: 'outline.md', displayTitle: null },
    ])

    const output = await executeSelfInventoryTool({ sections: ['context.files'] }, baseContext)
    const filesSection = output.context?.files
    if (!filesSection || !filesSection.available) throw new Error('expected available files section')

    const docStore = filesSection.files.find(f => f.filePath === 'Notes/plot.md')
    expect(docStore?.howToReach).toBe(
      "doc_read_file(scope='document_store', mount_point='My Vault', path='Notes/plot.md')",
    )
    const projectFile = filesSection.files.find(f => f.filePath === 'outline.md')
    expect(projectFile?.howToReach).toBe("doc_read_file(scope='project', path='outline.md')")
  })

  it('bare context resolves all five parts', async () => {
    const output = await executeSelfInventoryTool({ sections: ['context'] }, baseContext)
    expect(output.context?.includedParts).toEqual({
      chat: true,
      project: true,
      groups: true,
      characters: true,
      files: true,
    })
  })
})
