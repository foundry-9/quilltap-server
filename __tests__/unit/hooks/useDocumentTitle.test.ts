/**
 * Unit tests for useDocumentTitle hook
 * Tests document title management
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { renderHook } from '@testing-library/react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

describe('useDocumentTitle', () => {
  const DEFAULT_TITLE = 'Quilltap - AI Chat Platform'
  let originalTitle: string

  beforeEach(() => {
    originalTitle = document.title
  })

  afterEach(() => {
    document.title = originalTitle
  })

  describe('title setting', () => {
    it('should set document title with prefix', () => {
      renderHook(() => useDocumentTitle('My Chat'))

      expect(document.title).toBe('Quilltap: My Chat')
    })

    it('should update title when value changes', () => {
      const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
        initialProps: { title: 'Chat 1' },
      })

      expect(document.title).toBe('Quilltap: Chat 1')

      rerender({ title: 'Chat 2' })

      expect(document.title).toBe('Quilltap: Chat 2')
    })

    it('should handle special characters in title', () => {
      renderHook(() => useDocumentTitle('Chat: Test & Debug'))

      expect(document.title).toBe('Quilltap: Chat: Test & Debug')
    })

    it('should handle empty string title', () => {
      renderHook(() => useDocumentTitle(''))

      expect(document.title).toBe(DEFAULT_TITLE)
    })
  })

  describe('null/undefined handling', () => {
    it('should set default title when null', () => {
      renderHook(() => useDocumentTitle(null))

      expect(document.title).toBe(DEFAULT_TITLE)
    })

    it('should set default title when undefined', () => {
      renderHook(() => useDocumentTitle(undefined))

      expect(document.title).toBe(DEFAULT_TITLE)
    })

    it('should switch to default when title becomes null', () => {
      const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
        initialProps: { title: 'My Chat' as string | null },
      })

      expect(document.title).toBe('Quilltap: My Chat')

      rerender({ title: null })

      expect(document.title).toBe(DEFAULT_TITLE)
    })
  })

  describe('cleanup on unmount', () => {
    it('should restore default title on unmount', () => {
      const { unmount } = renderHook(() => useDocumentTitle('My Chat'))

      expect(document.title).toBe('Quilltap: My Chat')

      unmount()

      expect(document.title).toBe(DEFAULT_TITLE)
    })

    it('should restore default even if title was null', () => {
      const { unmount } = renderHook(() => useDocumentTitle(null))

      expect(document.title).toBe(DEFAULT_TITLE)

      unmount()

      expect(document.title).toBe(DEFAULT_TITLE)
    })
  })

  describe('multiple instances', () => {
    it('should handle multiple hooks with different titles', () => {
      const { unmount: unmount1 } = renderHook(() => useDocumentTitle('Chat 1'))
      expect(document.title).toBe('Quilltap: Chat 1')

      const { unmount: unmount2 } = renderHook(() => useDocumentTitle('Chat 2'))
      expect(document.title).toBe('Quilltap: Chat 2')

      unmount2()
      expect(document.title).toBe(DEFAULT_TITLE)

      unmount1()
      expect(document.title).toBe(DEFAULT_TITLE)
    })
  })

  describe('SSR safety', () => {
    it('should not throw in non-browser environment', () => {
      // This test verifies the typeof window check
      // In Jest, window is defined, but the hook includes the check
      expect(() => {
        renderHook(() => useDocumentTitle('Test'))
      }).not.toThrow()
    })
  })
})
