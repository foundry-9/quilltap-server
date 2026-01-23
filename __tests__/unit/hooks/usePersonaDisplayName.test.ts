/**
 * Unit tests for usePersonaDisplayName hook
 * Tests character display name formatting with disambiguation
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { renderHook, waitFor } from '@testing-library/react'
import { useUserCharacterDisplayName } from '@/hooks/usePersonaDisplayName'

// Mock fetch
global.fetch = jest.fn()

describe('useUserCharacterDisplayName', () => {
  const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('initialization', () => {
    it('should start in loading state', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      expect(result.current.loading).toBe(true)
    })

    it('should fetch user-controlled characters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response)

      renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/v1/characters?controlledBy=user')
      })
    })

    it('should set loading to false after fetch', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })
    })
  })

  describe('formatCharacterName', () => {
    it('should format name without title when no duplicates', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          { id: '1', name: 'Alice', title: 'Warrior' },
          { id: '2', name: 'Bob', title: 'Mage' },
        ],
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      const formatted = result.current.formatCharacterName({
        id: '1',
        name: 'Alice',
        title: 'Warrior',
      })

      expect(formatted).toBe('Alice')
    })

    it('should format name with title when duplicates exist', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          { id: '1', name: 'Alice', title: 'Warrior' },
          { id: '2', name: 'Alice', title: 'Mage' },
        ],
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      const formatted = result.current.formatCharacterName({
        id: '1',
        name: 'Alice',
        title: 'Warrior',
      })

      expect(formatted).toBe('Alice (Warrior)')
    })

    it('should return empty string for null character', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      const formatted = result.current.formatCharacterName(null)

      expect(formatted).toBe('')
    })

    it('should return empty string for undefined character', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      const formatted = result.current.formatCharacterName(undefined)

      expect(formatted).toBe('')
    })

    it('should not add title when character has no title', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          { id: '1', name: 'Alice' },
          { id: '2', name: 'Alice' },
        ],
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      const formatted = result.current.formatCharacterName({
        id: '1',
        name: 'Alice',
      })

      expect(formatted).toBe('Alice')
    })

    it('should handle null title', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          { id: '1', name: 'Alice', title: null },
          { id: '2', name: 'Alice', title: null },
        ],
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      const formatted = result.current.formatCharacterName({
        id: '1',
        name: 'Alice',
        title: null,
      })

      expect(formatted).toBe('Alice')
    })
  })

  describe('needsDisambiguation', () => {
    it('should return true for duplicate names', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          { id: '1', name: 'Alice', title: 'Warrior' },
          { id: '2', name: 'Alice', title: 'Mage' },
        ],
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.needsDisambiguation('Alice')).toBe(true)
    })

    it('should return false for unique names', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          { id: '1', name: 'Alice', title: 'Warrior' },
          { id: '2', name: 'Bob', title: 'Mage' },
        ],
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.needsDisambiguation('Alice')).toBe(false)
      expect(result.current.needsDisambiguation('Bob')).toBe(false)
    })

    it('should return false for non-existent names', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [{ id: '1', name: 'Alice', title: 'Warrior' }],
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.needsDisambiguation('Charlie')).toBe(false)
    })
  })

  describe('error handling', () => {
    it('should handle 401 unauthorized gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // Should not throw and return empty formatting
      const formatted = result.current.formatCharacterName({
        id: '1',
        name: 'Alice',
        title: 'Warrior',
      })
      expect(formatted).toBe('Alice')
    })

    it('should handle network errors', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      mockFetch.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(consoleWarnSpy).toHaveBeenCalled()
      consoleWarnSpy.mockRestore()
    })

    it('should handle non-200 responses', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(consoleWarnSpy).toHaveBeenCalled()
      consoleWarnSpy.mockRestore()
    })
  })

  describe('data format handling', () => {
    it('should handle array response format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          { id: '1', name: 'Alice', title: 'Warrior' },
          { id: '2', name: 'Bob', title: 'Mage' },
        ],
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.needsDisambiguation('Alice')).toBe(false)
    })

    it('should handle wrapped response format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          characters: [
            { id: '1', name: 'Alice', title: 'Warrior' },
            { id: '2', name: 'Bob', title: 'Mage' },
          ],
        }),
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.needsDisambiguation('Alice')).toBe(false)
    })

    it('should handle empty response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.needsDisambiguation('Anyone')).toBe(false)
    })
  })

  describe('multiple duplicates', () => {
    it('should handle three characters with same name', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          { id: '1', name: 'Alice', title: 'Warrior' },
          { id: '2', name: 'Alice', title: 'Mage' },
          { id: '3', name: 'Alice', title: 'Thief' },
        ],
      } as Response)

      const { result } = renderHook(() => useUserCharacterDisplayName())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.needsDisambiguation('Alice')).toBe(true)

      const formatted1 = result.current.formatCharacterName({
        id: '1',
        name: 'Alice',
        title: 'Warrior',
      })
      const formatted2 = result.current.formatCharacterName({
        id: '2',
        name: 'Alice',
        title: 'Mage',
      })

      expect(formatted1).toBe('Alice (Warrior)')
      expect(formatted2).toBe('Alice (Mage)')
    })
  })
})
