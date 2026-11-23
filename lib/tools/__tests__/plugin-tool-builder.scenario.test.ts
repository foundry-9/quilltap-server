/**
 * Unit tests for the Scenario Builder's tool-slate options on `buildToolsForProvider`:
 *  - `docToolsMode: 'read'` builds exactly the five read-only doc_* tools
 *  - the Scenario Builder's `search` variant (`documentsOnlySearch`) omits
 *    both `memories` and `conversations` from its `sources` enum
 *  - `pluginToolAllowlist` filters which plugin (tool-registry) tools are built
 *
 * See docs/developer/features/complete/scenario-builder.md §5.3.
 */

import { buildToolsForProvider } from '@/lib/tools/plugin-tool-builder'
import { toolRegistry } from '@/lib/plugins/tool-registry'

jest.mock('@/lib/plugins/tool-registry', () => ({
  toolRegistry: {
    getConfiguredToolDefinitions: jest.fn(),
  },
}))

/** Extract the function name from a built tool object regardless of provider shape. */
function toolName(tool: unknown): string | undefined {
  const t = tool as { function?: { name?: string }; name?: string }
  return t.function?.name || t.name
}

const mockedGetConfiguredToolDefinitions =
  toolRegistry.getConfiguredToolDefinitions as jest.Mock

const CURL_TOOL = {
  type: 'function',
  function: {
    name: 'curl',
    description: 'Make an HTTP request',
    parameters: { type: 'object', properties: {}, required: [] },
  },
}

const OTHER_PLUGIN_TOOL = {
  type: 'function',
  function: {
    name: 'some_other_plugin_tool',
    description: 'Some other plugin tool',
    parameters: { type: 'object', properties: {}, required: [] },
  },
}

describe('buildToolsForProvider — Scenario Builder doc tools slate', () => {
  beforeEach(() => {
    mockedGetConfiguredToolDefinitions.mockReset()
    mockedGetConfiguredToolDefinitions.mockResolvedValue([])
  })

  it("docToolsMode: 'read' builds exactly the five read-only doc_* tools", async () => {
    const tools = await buildToolsForProvider('OPENAI', {
      agentMode: true,
      docToolsMode: 'read',
      includeWorkspaceTools: false,
      documentsOnlySearch: true,
      includePluginTools: false,
      rng: false,
      state: false,
    })
    const names = tools.map(toolName)
    const docNames = names.filter((n) => n?.startsWith('doc_')).sort()

    expect(docNames).toEqual(
      ['doc_grep', 'doc_list_files', 'doc_read_file', 'doc_read_frontmatter', 'doc_read_heading'].sort()
    )

    expect(names).not.toContain('doc_write_file')
    expect(names).not.toContain('doc_open_document')
    expect(names).not.toContain('keep_image')
  })

  it("the Scenario Builder search variant's sources enum excludes memories and conversations", async () => {
    const tools = await buildToolsForProvider('OPENAI', {
      agentMode: true,
      docToolsMode: 'read',
      includeWorkspaceTools: false,
      documentsOnlySearch: true,
      includePluginTools: false,
      rng: false,
      state: false,
    })

    const search = tools.find((t) => toolName(t) === 'search') as {
      function: { parameters: unknown }
    }
    expect(search).toBeDefined()

    const paramsJson = JSON.stringify(search.function.parameters)
    expect(paramsJson).not.toContain('memories')
    expect(paramsJson).not.toContain('conversations')
  })
})

describe('buildToolsForProvider — pluginToolAllowlist', () => {
  beforeEach(() => {
    mockedGetConfiguredToolDefinitions.mockReset()
    mockedGetConfiguredToolDefinitions.mockResolvedValue([CURL_TOOL, OTHER_PLUGIN_TOOL])
  })

  it('with an allowlist, admits only the named plugin tool', async () => {
    const tools = await buildToolsForProvider('OPENAI', {
      agentMode: true,
      docToolsMode: 'read',
      includeWorkspaceTools: false,
      documentsOnlySearch: true,
      rng: false,
      state: false,
      pluginToolAllowlist: ['curl'],
    })
    const names = tools.map(toolName)

    expect(names).toContain('curl')
    expect(names).not.toContain('some_other_plugin_tool')
  })

  it('with an empty allowlist, admits no plugin tools', async () => {
    const tools = await buildToolsForProvider('OPENAI', {
      agentMode: true,
      docToolsMode: 'read',
      includeWorkspaceTools: false,
      documentsOnlySearch: true,
      rng: false,
      state: false,
      pluginToolAllowlist: [],
    })
    const names = tools.map(toolName)

    expect(names).not.toContain('curl')
    expect(names).not.toContain('some_other_plugin_tool')
  })

  it('omitting pluginToolAllowlist preserves old default behaviour (all configured plugin tools included)', async () => {
    const tools = await buildToolsForProvider('OPENAI', {
      includePluginTools: true,
    })
    const names = tools.map(toolName)

    expect(names).toContain('curl')
    expect(names).toContain('some_other_plugin_tool')
  })
})

describe('buildToolsForProvider — the research kit (research-kit.md §5.2)', () => {
  beforeEach(() => {
    mockedGetConfiguredToolDefinitions.mockReset()
    mockedGetConfiguredToolDefinitions.mockResolvedValue([])
  })

  const base = {
    agentMode: true,
    includeWorkspaceTools: false,
    includePluginTools: false,
    rng: false,
    state: false,
  }
  const RECORD_TOOLS = [
    'lookup_character', 'lookup_memories', 'lookup_messages', 'read_messages',
    'lookup_conversations', 'lookup_group', 'lookup_project', 'lookup_wardrobe', 'lookup_atlas', 'lookup_chat_state',
  ]

  it("'documents' adds the document tools and withholds doc_grep / doc_list_files", async () => {
    const names = (await buildToolsForProvider('OPENAI', { ...base, docToolsMode: 'read', researchKit: 'documents' })).map(toolName)
    expect(names).toEqual(expect.arrayContaining(['find_documents', 'list_documents', 'doc_read_file']))
    expect(names).not.toContain('doc_grep')
    expect(names).not.toContain('doc_list_files')
    for (const record of RECORD_TOOLS) expect(names).not.toContain(record)
  })

  it("'full' adds the record tools too, and keeps the write tools under docToolsMode 'full'", async () => {
    const names = (await buildToolsForProvider('OPENAI', { ...base, docToolsMode: 'full', researchKit: 'full' })).map(toolName)
    expect(names).toEqual(expect.arrayContaining(['find_documents', 'list_documents', ...RECORD_TOOLS]))
    expect(names).toContain('doc_write_file')
    expect(names).not.toContain('doc_grep')
    expect(names).not.toContain('doc_list_files')
  })

  it('off leaves the slate as it was', async () => {
    const names = (await buildToolsForProvider('OPENAI', { ...base, docToolsMode: 'read' })).map(toolName)
    expect(names).toContain('doc_grep')
    expect(names).not.toContain('find_documents')
  })
})

describe('buildToolsForProvider — memoryEdit', () => {
  beforeEach(() => {
    mockedGetConfiguredToolDefinitions.mockReset()
    mockedGetConfiguredToolDefinitions.mockResolvedValue([])
  })

  const base = { includeWorkspaceTools: false, includePluginTools: false, rng: false, state: false }

  it('offers read_memory and edit_memory together, and only when asked', async () => {
    const on = (await buildToolsForProvider('OPENAI', { ...base, memoryEdit: true })).map(toolName)
    expect(on).toEqual(expect.arrayContaining(['read_memory', 'edit_memory']))
    const off = (await buildToolsForProvider('OPENAI', base)).map(toolName)
    expect(off).not.toContain('read_memory')
    expect(off).not.toContain('edit_memory')
  })
})
