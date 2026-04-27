/**
 * Unit Tests for Memory Search Tool Definitions
 */

import { describe, it, expect } from '@jest/globals'
import {
  memorySearchToolDefinition,
  validateMemorySearchInput,
} from '@/lib/tools/memory-search-tool'

describe('Memory Search Tool Definitions', () => {
  it('provides a universal tool definition with correct name', () => {
    expect(memorySearchToolDefinition.function.name).toBe('search')
    expect(memorySearchToolDefinition.function.parameters.properties.query).toBeDefined()
    expect(memorySearchToolDefinition.function.parameters.properties.limit.default).toBe(5)
  })
})

describe('validateMemorySearchInput', () => {
  it('accepts valid payloads', () => {
    expect(
      validateMemorySearchInput({
        query: 'favorite color',
        limit: 3,
        minImportance: 0.4,
      })
    ).toBe(true)
  })

  it('rejects payloads without a query', () => {
    expect(validateMemorySearchInput({ limit: 5 })).toBe(false)
  })

  it('rejects payloads with invalid limits or importance ranges', () => {
    expect(validateMemorySearchInput({ query: 'info', limit: 25 })).toBe(false)
    expect(validateMemorySearchInput({ query: 'info', minImportance: 2 })).toBe(false)
  })
})
