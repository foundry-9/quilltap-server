/**
 * Unit Tests for Tool Registry
 * Tests lib/plugins/tool-registry.ts
 * v2.7-dev: TOOL_PROVIDER Plugin Capability with multi-tool pattern
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

// Mock dependencies
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}))

jest.mock('@/lib/errors', () => ({
  getErrorMessage: jest.fn((err: unknown) => err instanceof Error ? err.message : String(err)),
}))

// Define types inline to avoid module resolution issues
interface ToolMetadata {
  toolName: string
  displayName: string
  description: string
  category: string
  version: string
}

interface UniversalTool {
  type: string
  function: {
    name: string
    description: string
    parameters: {
      type: string
      properties: Record<string, { type: string; description: string }>
      required: string[]
    }
  }
}

interface ToolExecutionContext {
  userId: string
  chatId: string
  characterId: string
  toolConfig: Record<string, unknown>
}

interface ToolExecutionResult {
  success: boolean
  result?: unknown
  error?: string
}

// Updated interface for multi-tool pattern
interface ToolPlugin {
  metadata: ToolMetadata
  getToolDefinitions: (config: Record<string, unknown>) => Promise<UniversalTool[]>
  executeByName: (toolName: string, input: unknown, context: ToolExecutionContext) => Promise<ToolExecutionResult>
  validateInput: (input: unknown) => boolean
  formatResults: (result: ToolExecutionResult) => string
  isConfigured?: (config: Record<string, unknown>) => boolean
  getDefaultConfig?: () => Record<string, unknown>
  renderIcon?: () => string
}

interface ToolRegistryType {
  registerTool: (plugin: ToolPlugin) => void
  registerPlugin: (plugin: ToolPlugin) => void
  getTool: (name: string) => ToolPlugin | null
  getPlugin: (name: string) => ToolPlugin | null
  getAllTools: () => ToolPlugin[]
  getAllPlugins: () => ToolPlugin[]
  hasTool: (name: string) => boolean
  hasPlugin: (name: string) => boolean
  getToolNames: () => string[]
  getPluginNames: () => string[]
  getToolMetadata: (name: string) => ToolMetadata | null
  getPluginMetadata: (name: string) => ToolMetadata | null
  getAllToolMetadata: () => ToolMetadata[]
  getAllPluginMetadata: () => ToolMetadata[]
  getToolDefinitions: () => UniversalTool[]
  getConfiguredToolDefinitions: (configs: Map<string, Record<string, unknown>>) => Promise<UniversalTool[]>
  executeTool: (name: string, input: unknown, context: ToolExecutionContext) => Promise<ToolExecutionResult>
  formatToolResults: (name: string, result: ToolExecutionResult) => Promise<string>
  getDefaultConfig: (name: string) => Record<string, unknown>
  initialize: (tools: ToolPlugin[]) => Promise<void>
  isInitialized: () => boolean
  getErrors: () => Array<{ plugin: string; error: string }>
  getStats: () => { total: number; errors: number; initialized: boolean; plugins: string[]; lastInitTime: string | null }
  reset: () => void
  exportState: () => { initialized: boolean; plugins: Array<{ name: string; displayName: string; hasIcon: boolean; requiresConfiguration: boolean }> }
}

// Import using require after mocks
const {
  toolRegistry,
  registerTool,
} = require('@/lib/plugins/tool-registry') as {
  toolRegistry: ToolRegistryType
  registerTool: (plugin: ToolPlugin) => void
}

// Test fixtures
const makeToolMetadata = (overrides: Partial<ToolMetadata> = {}): ToolMetadata => ({
  toolName: 'test-tool',
  displayName: 'Test Tool',
  description: 'A test tool for unit tests',
  category: 'utility',
  version: '1.0.0',
  ...overrides,
})

const makeToolDefinition = (overrides: Partial<UniversalTool> = {}): UniversalTool => ({
  type: 'function',
  function: {
    name: 'test-tool',
    description: 'A test tool for unit tests',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'The input value' },
      },
      required: ['input'],
    },
  },
  ...overrides,
})

// Updated to use multi-tool pattern
const makeToolPlugin = (overrides: Partial<ToolPlugin> = {}): ToolPlugin => {
  const metadata = overrides.metadata || makeToolMetadata()
  const toolDef = makeToolDefinition({
    function: { ...makeToolDefinition().function, name: metadata.toolName },
  })

  return {
    metadata,
    getToolDefinitions: jest.fn(async () => [toolDef]),
    executeByName: jest.fn(async () => ({ success: true, result: 'executed' })),
    validateInput: jest.fn(() => true),
    formatResults: jest.fn((result: ToolExecutionResult) => JSON.stringify(result)),
    ...overrides,
  }
}

const makeExecutionContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
  userId: 'user-123',
  chatId: 'chat-456',
  characterId: 'char-789',
  toolConfig: {},
  ...overrides,
})

describe('Tool Registry', () => {
  beforeEach(() => {
    toolRegistry.reset()
    jest.clearAllMocks()
  })

  afterEach(() => {
    toolRegistry.reset()
  })

  describe('registerTool', () => {
    it('registers a tool plugin successfully', () => {
      const plugin = makeToolPlugin()

      toolRegistry.registerTool(plugin)

      expect(toolRegistry.hasTool('test-tool')).toBe(true)
    })

    it('throws error when registering duplicate tool', () => {
      const plugin1 = makeToolPlugin()
      const plugin2 = makeToolPlugin()

      toolRegistry.registerTool(plugin1)

      expect(() => toolRegistry.registerTool(plugin2)).toThrow("Plugin 'test-tool' is already registered")
    })

    it('registers multiple unique tools', () => {
      const plugin1 = makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'tool-1' }),
      })
      const plugin2 = makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'tool-2' }),
      })

      toolRegistry.registerTool(plugin1)
      toolRegistry.registerTool(plugin2)

      expect(toolRegistry.hasTool('tool-1')).toBe(true)
      expect(toolRegistry.hasTool('tool-2')).toBe(true)
    })
  })

  describe('getTool', () => {
    it('returns registered tool by name', () => {
      const plugin = makeToolPlugin()
      toolRegistry.registerTool(plugin)

      const result = toolRegistry.getTool('test-tool')

      expect(result).toBe(plugin)
    })

    it('returns null for non-existent tool', () => {
      const result = toolRegistry.getTool('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('getAllTools', () => {
    it('returns empty array when no tools registered', () => {
      const tools = toolRegistry.getAllTools()
      expect(tools).toEqual([])
    })

    it('returns all registered tools', () => {
      const plugin1 = makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'tool-1' }),
      })
      const plugin2 = makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'tool-2' }),
      })

      toolRegistry.registerTool(plugin1)
      toolRegistry.registerTool(plugin2)

      const tools = toolRegistry.getAllTools()

      expect(tools).toHaveLength(2)
      expect(tools).toContain(plugin1)
      expect(tools).toContain(plugin2)
    })
  })

  describe('hasTool', () => {
    it('returns true for registered tool', () => {
      toolRegistry.registerTool(makeToolPlugin())
      expect(toolRegistry.hasTool('test-tool')).toBe(true)
    })

    it('returns false for non-registered tool', () => {
      expect(toolRegistry.hasTool('nonexistent')).toBe(false)
    })
  })

  describe('getToolNames', () => {
    it('returns empty array when no tools registered', () => {
      const names = toolRegistry.getToolNames()
      expect(names).toEqual([])
    })

    it('returns all registered tool names', () => {
      toolRegistry.registerTool(makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'alpha' }),
      }))
      toolRegistry.registerTool(makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'beta' }),
      }))

      const names = toolRegistry.getToolNames()

      expect(names).toContain('alpha')
      expect(names).toContain('beta')
    })
  })

  describe('getToolMetadata', () => {
    it('returns metadata for registered tool', () => {
      const metadata = makeToolMetadata({
        toolName: 'my-tool',
        displayName: 'My Tool',
        description: 'Does something useful',
      })
      toolRegistry.registerTool(makeToolPlugin({ metadata }))

      const result = toolRegistry.getToolMetadata('my-tool')

      expect(result).toEqual(metadata)
    })

    it('returns null for non-existent tool', () => {
      const result = toolRegistry.getToolMetadata('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('getAllToolMetadata', () => {
    it('returns metadata for all tools', () => {
      const metadata1 = makeToolMetadata({ toolName: 'tool-1' })
      const metadata2 = makeToolMetadata({ toolName: 'tool-2' })

      toolRegistry.registerTool(makeToolPlugin({ metadata: metadata1 }))
      toolRegistry.registerTool(makeToolPlugin({ metadata: metadata2 }))

      const allMetadata = toolRegistry.getAllToolMetadata()

      expect(allMetadata).toHaveLength(2)
      expect(allMetadata).toContainEqual(metadata1)
      expect(allMetadata).toContainEqual(metadata2)
    })
  })

  describe('getConfiguredToolDefinitions', () => {
    it('includes tools without isConfigured method', async () => {
      toolRegistry.registerTool(makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'simple-tool' }),
        isConfigured: undefined,
      }))

      const definitions = await toolRegistry.getConfiguredToolDefinitions(new Map())

      expect(definitions).toHaveLength(1)
    })

    it('excludes unconfigured tools with isConfigured method', async () => {
      toolRegistry.registerTool(makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'configured-tool' }),
        isConfigured: (config: Record<string, unknown>) => !!config.apiKey,
      }))

      const definitions = await toolRegistry.getConfiguredToolDefinitions(new Map())

      expect(definitions).toHaveLength(0)
    })

    it('includes configured tools', async () => {
      toolRegistry.registerTool(makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'configured-tool' }),
        isConfigured: (config: Record<string, unknown>) => !!config.apiKey,
      }))

      const configs = new Map([['configured-tool', { apiKey: 'test-key' }]])
      const definitions = await toolRegistry.getConfiguredToolDefinitions(configs)

      expect(definitions).toHaveLength(1)
    })
  })

  describe('executeTool', () => {
    it('executes tool successfully', async () => {
      const executeByNameFn = jest.fn<(toolName: string, input: unknown, context: ToolExecutionContext) => Promise<ToolExecutionResult>>()
      executeByNameFn.mockResolvedValue({
        success: true,
        result: { answer: 42 },
      })

      toolRegistry.registerTool(makeToolPlugin({
        executeByName: executeByNameFn,
      }))

      const context = makeExecutionContext()
      const result = await toolRegistry.executeTool('test-tool', { input: 'test' }, context)

      expect(result.success).toBe(true)
      expect(result.result).toEqual({ answer: 42 })
      expect(executeByNameFn).toHaveBeenCalledWith('test-tool', { input: 'test' }, expect.any(Object))
    })

    it('returns error for non-existent tool', async () => {
      const context = makeExecutionContext()
      const result = await toolRegistry.executeTool('nonexistent', {}, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('returns error for invalid input', async () => {
      toolRegistry.registerTool(makeToolPlugin({
        validateInput: () => false,
      }))

      const context = makeExecutionContext()
      const result = await toolRegistry.executeTool('test-tool', { invalid: true }, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid input')
    })

    it('skips unconfigured tools when finding tool to execute', async () => {
      toolRegistry.registerTool(makeToolPlugin({
        isConfigured: (config: Record<string, unknown>) => !!config.apiKey,
      }))

      const context = makeExecutionContext({ toolConfig: {} })
      const result = await toolRegistry.executeTool('test-tool', { input: 'test' }, context)

      // Tool is skipped during search because it's not configured
      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('catches and reports execution errors', async () => {
      toolRegistry.registerTool(makeToolPlugin({
        executeByName: async () => { throw new Error('Execution failed') },
      }))

      const context = makeExecutionContext()
      const result = await toolRegistry.executeTool('test-tool', { input: 'test' }, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Execution failed')
    })
  })

  describe('formatToolResults', () => {
    it('formats results using tool formatter', async () => {
      toolRegistry.registerTool(makeToolPlugin({
        formatResults: (result: ToolExecutionResult) => `Formatted: ${JSON.stringify(result)}`,
      }))

      const result: ToolExecutionResult = { success: true, result: 'data' }
      const formatted = await toolRegistry.formatToolResults('test-tool', result)

      expect(formatted).toBe('Formatted: {"success":true,"result":"data"}')
    })

    it('returns JSON for non-existent tool', async () => {
      const result: ToolExecutionResult = { success: true, result: 'data' }
      const formatted = await toolRegistry.formatToolResults('nonexistent', result)

      expect(formatted).toBe(JSON.stringify(result))
    })
  })

  describe('getDefaultConfig', () => {
    it('returns default config from tool', () => {
      toolRegistry.registerTool(makeToolPlugin({
        getDefaultConfig: () => ({ timeout: 30000, retries: 3 }),
      }))

      const config = toolRegistry.getDefaultConfig('test-tool')

      expect(config).toEqual({ timeout: 30000, retries: 3 })
    })

    it('returns empty object when no getDefaultConfig', () => {
      toolRegistry.registerTool(makeToolPlugin({
        getDefaultConfig: undefined,
      }))

      const config = toolRegistry.getDefaultConfig('test-tool')

      expect(config).toEqual({})
    })

    it('returns empty object for non-existent tool', () => {
      const config = toolRegistry.getDefaultConfig('nonexistent')
      expect(config).toEqual({})
    })
  })

  describe('initialize', () => {
    it('registers all provided tools', async () => {
      const tools = [
        makeToolPlugin({ metadata: makeToolMetadata({ toolName: 'tool-1' }) }),
        makeToolPlugin({ metadata: makeToolMetadata({ toolName: 'tool-2' }) }),
        makeToolPlugin({ metadata: makeToolMetadata({ toolName: 'tool-3' }) }),
      ]

      await toolRegistry.initialize(tools)

      expect(toolRegistry.isInitialized()).toBe(true)
      expect(toolRegistry.getToolNames()).toHaveLength(3)
    })

    it('clears existing state before initialization', async () => {
      toolRegistry.registerTool(makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'old-tool' }),
      }))

      await toolRegistry.initialize([
        makeToolPlugin({ metadata: makeToolMetadata({ toolName: 'new-tool' }) }),
      ])

      expect(toolRegistry.hasTool('old-tool')).toBe(false)
      expect(toolRegistry.hasTool('new-tool')).toBe(true)
    })

    it('tracks registration errors', async () => {
      const tools = [
        makeToolPlugin({ metadata: makeToolMetadata({ toolName: 'tool-1' }) }),
        makeToolPlugin({ metadata: makeToolMetadata({ toolName: 'tool-1' }) }), // Duplicate
      ]

      await toolRegistry.initialize(tools)

      const errors = toolRegistry.getErrors()
      expect(errors).toHaveLength(1)
      expect(errors[0].plugin).toBe('tool-1')
    })

    it('sets initialization timestamp', async () => {
      await toolRegistry.initialize([])

      const stats = toolRegistry.getStats()
      expect(stats.lastInitTime).not.toBeNull()
    })
  })

  describe('getStats', () => {
    it('returns accurate statistics', async () => {
      await toolRegistry.initialize([
        makeToolPlugin({ metadata: makeToolMetadata({ toolName: 'tool-1' }) }),
        makeToolPlugin({ metadata: makeToolMetadata({ toolName: 'tool-2' }) }),
      ])

      const stats = toolRegistry.getStats()

      expect(stats.total).toBe(2)
      expect(stats.errors).toBe(0)
      expect(stats.initialized).toBe(true)
      expect(stats.plugins).toContain('tool-1')
      expect(stats.plugins).toContain('tool-2')
    })
  })

  describe('reset', () => {
    it('clears all state', async () => {
      await toolRegistry.initialize([
        makeToolPlugin({ metadata: makeToolMetadata({ toolName: 'tool-1' }) }),
      ])

      toolRegistry.reset()

      expect(toolRegistry.isInitialized()).toBe(false)
      expect(toolRegistry.getAllTools()).toHaveLength(0)
    })
  })

  describe('exportState', () => {
    it('exports complete registry state', async () => {
      const plugin = makeToolPlugin({
        metadata: makeToolMetadata({
          toolName: 'export-test',
          displayName: 'Export Test',
          description: 'Test tool',
          category: 'test',
        }),
        renderIcon: () => 'icon',
        isConfigured: () => true,
      })

      await toolRegistry.initialize([plugin])

      const state = toolRegistry.exportState()

      expect(state.initialized).toBe(true)
      expect(state.plugins).toHaveLength(1)
      expect(state.plugins[0].name).toBe('export-test')
      expect(state.plugins[0].displayName).toBe('Export Test')
      expect(state.plugins[0].hasIcon).toBe(true)
      expect(state.plugins[0].requiresConfiguration).toBe(true)
    })
  })

  describe('registerTool convenience function', () => {
    it('registers tool via module export', () => {
      const plugin = makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'convenience-test' }),
      })

      registerTool(plugin)

      expect(toolRegistry.hasTool('convenience-test')).toBe(true)
    })
  })
})
