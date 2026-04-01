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
  registerPlugin: (plugin: ToolPlugin) => void
  getPlugin: (name: string) => ToolPlugin | null
  getAllPlugins: () => ToolPlugin[]
  hasPlugin: (name: string) => boolean
  getPluginNames: () => string[]
  getPluginMetadata: (name: string) => ToolMetadata | null
  getAllPluginMetadata: () => ToolMetadata[]
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
  registerPlugin,
} = require('@/lib/plugins/tool-registry') as {
  toolRegistry: ToolRegistryType
  registerPlugin: (plugin: ToolPlugin) => void
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

  describe('registerPlugin', () => {
    it('registers a tool plugin successfully', () => {
      const plugin = makeToolPlugin()

      toolRegistry.registerPlugin(plugin)

      expect(toolRegistry.hasPlugin('test-tool')).toBe(true)
    })

    it('throws error when registering duplicate plugin', () => {
      const plugin1 = makeToolPlugin()
      const plugin2 = makeToolPlugin()

      toolRegistry.registerPlugin(plugin1)

      expect(() => toolRegistry.registerPlugin(plugin2)).toThrow("Plugin 'test-tool' is already registered")
    })

    it('registers multiple unique plugins', () => {
      const plugin1 = makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'tool-1' }),
      })
      const plugin2 = makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'tool-2' }),
      })

      toolRegistry.registerPlugin(plugin1)
      toolRegistry.registerPlugin(plugin2)

      expect(toolRegistry.hasPlugin('tool-1')).toBe(true)
      expect(toolRegistry.hasPlugin('tool-2')).toBe(true)
    })
  })

  describe('getPlugin', () => {
    it('returns registered plugin by name', () => {
      const plugin = makeToolPlugin()
      toolRegistry.registerPlugin(plugin)

      const result = toolRegistry.getPlugin('test-tool')

      expect(result).toBe(plugin)
    })

    it('returns null for non-existent plugin', () => {
      const result = toolRegistry.getPlugin('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('getAllPlugins', () => {
    it('returns empty array when no plugins registered', () => {
      const plugins = toolRegistry.getAllPlugins()
      expect(plugins).toEqual([])
    })

    it('returns all registered plugins', () => {
      const plugin1 = makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'tool-1' }),
      })
      const plugin2 = makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'tool-2' }),
      })

      toolRegistry.registerPlugin(plugin1)
      toolRegistry.registerPlugin(plugin2)

      const plugins = toolRegistry.getAllPlugins()

      expect(plugins).toHaveLength(2)
      expect(plugins).toContain(plugin1)
      expect(plugins).toContain(plugin2)
    })
  })

  describe('hasPlugin', () => {
    it('returns true for registered plugin', () => {
      toolRegistry.registerPlugin(makeToolPlugin())
      expect(toolRegistry.hasPlugin('test-tool')).toBe(true)
    })

    it('returns false for non-registered plugin', () => {
      expect(toolRegistry.hasPlugin('nonexistent')).toBe(false)
    })
  })

  describe('getPluginNames', () => {
    it('returns empty array when no plugins registered', () => {
      const names = toolRegistry.getPluginNames()
      expect(names).toEqual([])
    })

    it('returns all registered plugin names', () => {
      toolRegistry.registerPlugin(makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'alpha' }),
      }))
      toolRegistry.registerPlugin(makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'beta' }),
      }))

      const names = toolRegistry.getPluginNames()

      expect(names).toContain('alpha')
      expect(names).toContain('beta')
    })
  })

  describe('getPluginMetadata', () => {
    it('returns metadata for registered plugin', () => {
      const metadata = makeToolMetadata({
        toolName: 'my-tool',
        displayName: 'My Tool',
        description: 'Does something useful',
      })
      toolRegistry.registerPlugin(makeToolPlugin({ metadata }))

      const result = toolRegistry.getPluginMetadata('my-tool')

      expect(result).toEqual(metadata)
    })

    it('returns null for non-existent plugin', () => {
      const result = toolRegistry.getPluginMetadata('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('getAllPluginMetadata', () => {
    it('returns metadata for all plugins', () => {
      const metadata1 = makeToolMetadata({ toolName: 'tool-1' })
      const metadata2 = makeToolMetadata({ toolName: 'tool-2' })

      toolRegistry.registerPlugin(makeToolPlugin({ metadata: metadata1 }))
      toolRegistry.registerPlugin(makeToolPlugin({ metadata: metadata2 }))

      const allMetadata = toolRegistry.getAllPluginMetadata()

      expect(allMetadata).toHaveLength(2)
      expect(allMetadata).toContainEqual(metadata1)
      expect(allMetadata).toContainEqual(metadata2)
    })
  })

  describe('getConfiguredToolDefinitions', () => {
    it('includes plugins without isConfigured method', async () => {
      toolRegistry.registerPlugin(makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'simple-tool' }),
        isConfigured: undefined,
      }))

      const definitions = await toolRegistry.getConfiguredToolDefinitions(new Map())

      expect(definitions).toHaveLength(1)
    })

    it('excludes unconfigured plugins with isConfigured method', async () => {
      toolRegistry.registerPlugin(makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'configured-tool' }),
        isConfigured: (config: Record<string, unknown>) => !!config.apiKey,
      }))

      const definitions = await toolRegistry.getConfiguredToolDefinitions(new Map())

      expect(definitions).toHaveLength(0)
    })

    it('includes configured plugins', async () => {
      toolRegistry.registerPlugin(makeToolPlugin({
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

      toolRegistry.registerPlugin(makeToolPlugin({
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
      toolRegistry.registerPlugin(makeToolPlugin({
        validateInput: () => false,
      }))

      const context = makeExecutionContext()
      const result = await toolRegistry.executeTool('test-tool', { invalid: true }, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid input')
    })

    it('skips unconfigured plugins when finding tool to execute', async () => {
      toolRegistry.registerPlugin(makeToolPlugin({
        isConfigured: (config: Record<string, unknown>) => !!config.apiKey,
      }))

      const context = makeExecutionContext({ toolConfig: {} })
      const result = await toolRegistry.executeTool('test-tool', { input: 'test' }, context)

      // Plugin is skipped during search because it's not configured
      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('catches and reports execution errors', async () => {
      toolRegistry.registerPlugin(makeToolPlugin({
        executeByName: async () => { throw new Error('Execution failed') },
      }))

      const context = makeExecutionContext()
      const result = await toolRegistry.executeTool('test-tool', { input: 'test' }, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Execution failed')
    })
  })

  describe('formatToolResults', () => {
    it('formats results using plugin formatter', async () => {
      toolRegistry.registerPlugin(makeToolPlugin({
        formatResults: (result: ToolExecutionResult) => `Formatted: ${JSON.stringify(result)}`,
      }))

      const result: ToolExecutionResult = { success: true, result: 'data' }
      const formatted = await toolRegistry.formatToolResults('test-tool', result)

      expect(formatted).toBe('Formatted: {"success":true,"result":"data"}')
    })

    it('returns JSON for non-existent plugin', async () => {
      const result: ToolExecutionResult = { success: true, result: 'data' }
      const formatted = await toolRegistry.formatToolResults('nonexistent', result)

      expect(formatted).toBe(JSON.stringify(result))
    })
  })

  describe('getDefaultConfig', () => {
    it('returns default config from plugin', () => {
      toolRegistry.registerPlugin(makeToolPlugin({
        getDefaultConfig: () => ({ timeout: 30000, retries: 3 }),
      }))

      const config = toolRegistry.getDefaultConfig('test-tool')

      expect(config).toEqual({ timeout: 30000, retries: 3 })
    })

    it('returns empty object when no getDefaultConfig', () => {
      toolRegistry.registerPlugin(makeToolPlugin({
        getDefaultConfig: undefined,
      }))

      const config = toolRegistry.getDefaultConfig('test-tool')

      expect(config).toEqual({})
    })

    it('returns empty object for non-existent plugin', () => {
      const config = toolRegistry.getDefaultConfig('nonexistent')
      expect(config).toEqual({})
    })
  })

  describe('initialize', () => {
    it('registers all provided plugins', async () => {
      const tools = [
        makeToolPlugin({ metadata: makeToolMetadata({ toolName: 'tool-1' }) }),
        makeToolPlugin({ metadata: makeToolMetadata({ toolName: 'tool-2' }) }),
        makeToolPlugin({ metadata: makeToolMetadata({ toolName: 'tool-3' }) }),
      ]

      await toolRegistry.initialize(tools)

      expect(toolRegistry.isInitialized()).toBe(true)
      expect(toolRegistry.getPluginNames()).toHaveLength(3)
    })

    it('clears existing state before initialization', async () => {
      toolRegistry.registerPlugin(makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'old-tool' }),
      }))

      await toolRegistry.initialize([
        makeToolPlugin({ metadata: makeToolMetadata({ toolName: 'new-tool' }) }),
      ])

      expect(toolRegistry.hasPlugin('old-tool')).toBe(false)
      expect(toolRegistry.hasPlugin('new-tool')).toBe(true)
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
      expect(toolRegistry.getAllPlugins()).toHaveLength(0)
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

  describe('registerPlugin convenience function', () => {
    it('registers plugin via module export', () => {
      const plugin = makeToolPlugin({
        metadata: makeToolMetadata({ toolName: 'convenience-test' }),
      })

      registerPlugin(plugin)

      expect(toolRegistry.hasPlugin('convenience-test')).toBe(true)
    })
  })
})
