/**
 * Unit tests for useNavbarCollapse hook
 * Tests navbar overflow detection and collapse behavior
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { renderHook, waitFor } from '@testing-library/react'
import { useNavbarCollapse } from '@/hooks/useNavbarCollapse'

// Mock ResizeObserver
class MockResizeObserver {
  callback: ResizeObserverCallback
  elements: Set<Element>

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    this.elements = new Set()
  }

  observe(element: Element) {
    this.elements.add(element)
  }

  unobserve(element: Element) {
    this.elements.delete(element)
  }

  disconnect() {
    this.elements.clear()
  }

  trigger() {
    this.callback([], this)
  }
}

describe('useNavbarCollapse', () => {
  let mockResizeObserver: MockResizeObserver
  let originalResizeObserver: typeof ResizeObserver

  beforeEach(() => {
    jest.clearAllMocks()
    originalResizeObserver = global.ResizeObserver

    global.ResizeObserver = jest.fn((callback) => {
      mockResizeObserver = new MockResizeObserver(callback)
      return mockResizeObserver as any
    }) as any
  })

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver
  })

  describe('initialization', () => {
    it('should return refs and collapsed state', () => {
      const { result } = renderHook(() => useNavbarCollapse())

      expect(result.current.containerRef).toBeDefined()
      expect(result.current.menuRef).toBeDefined()
      expect(result.current.rightRef).toBeDefined()
      expect(typeof result.current.isCollapsed).toBe('boolean')
    })

    it('should initialize as not collapsed (SSR safe)', () => {
      const { result } = renderHook(() => useNavbarCollapse())

      expect(result.current.isCollapsed).toBe(false)
    })

    it('should accept custom options', () => {
      const { result } = renderHook(() =>
        useNavbarCollapse({ logoWidth: 200, bufferWidth: 30 })
      )

      expect(result.current).toBeDefined()
    })
  })

  describe('overflow detection', () => {
    it('should collapse when menu overflows', async () => {
      const { result } = renderHook(() => useNavbarCollapse())

      // Create mock elements
      const container = document.createElement('div')
      const menu = document.createElement('div')
      const right = document.createElement('div')

      // Mock dimensions - menu overflow
      Object.defineProperty(container, 'offsetWidth', { value: 1000, configurable: true })
      Object.defineProperty(menu, 'scrollWidth', { value: 700, configurable: true })
      Object.defineProperty(right, 'offsetWidth', { value: 150, configurable: true })

      // Assign to refs
      Object.defineProperty(result.current.containerRef, 'current', {
        writable: true,
        value: container,
      })
      Object.defineProperty(result.current.menuRef, 'current', {
        writable: true,
        value: menu,
      })
      Object.defineProperty(result.current.rightRef, 'current', {
        writable: true,
        value: right,
      })

      // Wait for initial check and trigger resize
      await waitFor(() => {
        mockResizeObserver?.trigger()
      })

      await waitFor(() => {
        expect(result.current.isCollapsed).toBe(true)
      })
    })

    it('should not collapse when menu fits', async () => {
      const { result } = renderHook(() => useNavbarCollapse())

      const container = document.createElement('div')
      const menu = document.createElement('div')
      const right = document.createElement('div')

      // Mock dimensions - menu fits
      Object.defineProperty(container, 'offsetWidth', { value: 1200, configurable: true })
      Object.defineProperty(menu, 'scrollWidth', { value: 400, configurable: true })
      Object.defineProperty(right, 'offsetWidth', { value: 150, configurable: true })

      Object.defineProperty(result.current.containerRef, 'current', {
        writable: true,
        value: container,
      })
      Object.defineProperty(result.current.menuRef, 'current', {
        writable: true,
        value: menu,
      })
      Object.defineProperty(result.current.rightRef, 'current', {
        writable: true,
        value: right,
      })

      await waitFor(() => {
        mockResizeObserver?.trigger()
      })

      await waitFor(() => {
        expect(result.current.isCollapsed).toBe(false)
      })
    })

    it('should handle null refs gracefully', async () => {
      const { result } = renderHook(() => useNavbarCollapse())

      // Refs are null by default
      expect(() => {
        mockResizeObserver?.trigger()
      }).not.toThrow()

      expect(result.current.isCollapsed).toBe(false)
    })
  })

  describe('custom options', () => {
    it('should use custom logoWidth in calculations', async () => {
      const { result } = renderHook(() => useNavbarCollapse({ logoWidth: 200 }))

      const container = document.createElement('div')
      const menu = document.createElement('div')
      const right = document.createElement('div')

      // With custom logoWidth of 200, less space for menu
      Object.defineProperty(container, 'offsetWidth', { value: 1000, configurable: true })
      Object.defineProperty(menu, 'scrollWidth', { value: 600, configurable: true })
      Object.defineProperty(right, 'offsetWidth', { value: 150, configurable: true })

      Object.defineProperty(result.current.containerRef, 'current', {
        writable: true,
        value: container,
      })
      Object.defineProperty(result.current.menuRef, 'current', {
        writable: true,
        value: menu,
      })
      Object.defineProperty(result.current.rightRef, 'current', {
        writable: true,
        value: right,
      })

      await waitFor(() => {
        mockResizeObserver?.trigger()
      })

      // Should collapse with larger logo width
      await waitFor(() => {
        expect(result.current.isCollapsed).toBe(true)
      })
    })

    it('should use custom bufferWidth', async () => {
      const { result } = renderHook(() => useNavbarCollapse({ bufferWidth: 50 }))

      const container = document.createElement('div')
      const menu = document.createElement('div')
      const right = document.createElement('div')

      // With larger buffer, less space available for menu
      Object.defineProperty(container, 'offsetWidth', { value: 800, configurable: true })
      Object.defineProperty(menu, 'scrollWidth', { value: 500, configurable: true })
      Object.defineProperty(right, 'offsetWidth', { value: 150, configurable: true })

      Object.defineProperty(result.current.containerRef, 'current', {
        writable: true,
        value: container,
      })
      Object.defineProperty(result.current.menuRef, 'current', {
        writable: true,
        value: menu,
      })
      Object.defineProperty(result.current.rightRef, 'current', {
        writable: true,
        value: right,
      })

      await waitFor(() => {
        mockResizeObserver?.trigger()
      })

      // Larger buffer means more likely to collapse
      await waitFor(() => {
        expect(result.current.isCollapsed).toBe(true)
      })
    })
  })

  describe('ResizeObserver integration', () => {
    it('should observe container element', () => {
      const { result } = renderHook(() => useNavbarCollapse())

      const container = document.createElement('div')
      Object.defineProperty(result.current.containerRef, 'current', {
        writable: true,
        value: container,
      })

      // Trigger effect
      result.current.containerRef.current = container

      expect(global.ResizeObserver).toHaveBeenCalled()
    })

    it('should disconnect observer on unmount', () => {
      const { result, unmount } = renderHook(() => useNavbarCollapse())

      const container = document.createElement('div')
      Object.defineProperty(result.current.containerRef, 'current', {
        writable: true,
        value: container,
      })

      const disconnectSpy = jest.spyOn(mockResizeObserver, 'disconnect')

      unmount()

      expect(disconnectSpy).toHaveBeenCalled()
    })
  })

  describe('window resize handling', () => {
    it('should add window resize listener', () => {
      const addEventListenerSpy = jest.spyOn(window, 'addEventListener')

      renderHook(() => useNavbarCollapse())

      expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))

      addEventListenerSpy.mockRestore()
    })

    it('should remove window resize listener on unmount', () => {
      const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener')

      const { unmount } = renderHook(() => useNavbarCollapse())

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))

      removeEventListenerSpy.mockRestore()
    })
  })

  describe('edge cases', () => {
    it('should handle zero-width elements', async () => {
      const { result } = renderHook(() => useNavbarCollapse())

      const container = document.createElement('div')
      const menu = document.createElement('div')
      const right = document.createElement('div')

      Object.defineProperty(container, 'offsetWidth', { value: 0, configurable: true })
      Object.defineProperty(menu, 'scrollWidth', { value: 0, configurable: true })
      Object.defineProperty(right, 'offsetWidth', { value: 0, configurable: true })

      Object.defineProperty(result.current.containerRef, 'current', {
        writable: true,
        value: container,
      })
      Object.defineProperty(result.current.menuRef, 'current', {
        writable: true,
        value: menu,
      })
      Object.defineProperty(result.current.rightRef, 'current', {
        writable: true,
        value: right,
      })

      await waitFor(() => {
        mockResizeObserver?.trigger()
      })

      // Should not throw
      expect(result.current.isCollapsed).toBeDefined()
    })

    it('should handle very large dimensions', async () => {
      const { result } = renderHook(() => useNavbarCollapse())

      const container = document.createElement('div')
      const menu = document.createElement('div')
      const right = document.createElement('div')

      Object.defineProperty(container, 'offsetWidth', { value: 9999, configurable: true })
      Object.defineProperty(menu, 'scrollWidth', { value: 5000, configurable: true })
      Object.defineProperty(right, 'offsetWidth', { value: 500, configurable: true })

      Object.defineProperty(result.current.containerRef, 'current', {
        writable: true,
        value: container,
      })
      Object.defineProperty(result.current.menuRef, 'current', {
        writable: true,
        value: menu,
      })
      Object.defineProperty(result.current.rightRef, 'current', {
        writable: true,
        value: right,
      })

      await waitFor(() => {
        mockResizeObserver?.trigger()
      })

      expect(result.current.isCollapsed).toBeDefined()
    })
  })
})
