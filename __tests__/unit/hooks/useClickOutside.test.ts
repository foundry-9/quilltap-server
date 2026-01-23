/**
 * Unit tests for useClickOutside hook
 * Tests click outside detection and escape key handling
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { renderHook } from '@testing-library/react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { createRef } from 'react'

describe('useClickOutside', () => {
  let container: HTMLDivElement
  let element: HTMLDivElement
  let mockCallback: jest.Mock

  beforeEach(() => {
    // Create DOM elements for testing
    container = document.createElement('div')
    element = document.createElement('div')
    container.appendChild(element)
    document.body.appendChild(container)

    mockCallback = jest.fn()
  })

  afterEach(() => {
    document.body.removeChild(container)
    jest.clearAllMocks()
  })

  describe('click outside detection', () => {
    it('should call callback when clicking outside', () => {
      const ref = createRef<HTMLDivElement>()
      Object.defineProperty(ref, 'current', { writable: true, value: element })

      renderHook(() => useClickOutside(ref, mockCallback))

      // Click outside
      const event = new MouseEvent('mousedown', { bubbles: true })
      document.body.dispatchEvent(event)

      expect(mockCallback).toHaveBeenCalledTimes(1)
    })

    it('should not call callback when clicking inside', () => {
      const ref = createRef<HTMLDivElement>()
      Object.defineProperty(ref, 'current', { writable: true, value: element })

      renderHook(() => useClickOutside(ref, mockCallback))

      // Click inside
      const event = new MouseEvent('mousedown', { bubbles: true })
      element.dispatchEvent(event)

      expect(mockCallback).not.toHaveBeenCalled()
    })

    it('should handle null ref gracefully', () => {
      const ref = createRef<HTMLDivElement>()
      // ref.current is null by default

      // Should not throw
      expect(() => {
        renderHook(() => useClickOutside(ref, mockCallback))
      }).not.toThrow()
    })
  })

  describe('enabled option', () => {
    it('should not detect clicks when disabled', () => {
      const ref = createRef<HTMLDivElement>()
      Object.defineProperty(ref, 'current', { writable: true, value: element })

      renderHook(() => useClickOutside(ref, mockCallback, { enabled: false }))

      const event = new MouseEvent('mousedown', { bubbles: true })
      document.body.dispatchEvent(event)

      expect(mockCallback).not.toHaveBeenCalled()
    })

    it('should detect clicks when enabled is true', () => {
      const ref = createRef<HTMLDivElement>()
      Object.defineProperty(ref, 'current', { writable: true, value: element })

      renderHook(() => useClickOutside(ref, mockCallback, { enabled: true }))

      const event = new MouseEvent('mousedown', { bubbles: true })
      document.body.dispatchEvent(event)

      expect(mockCallback).toHaveBeenCalledTimes(1)
    })

    it('should toggle detection when enabled changes', () => {
      const ref = createRef<HTMLDivElement>()
      Object.defineProperty(ref, 'current', { writable: true, value: element })

      const { rerender } = renderHook(
        ({ enabled }) => useClickOutside(ref, mockCallback, { enabled }),
        { initialProps: { enabled: false } }
      )

      // Click while disabled
      let event = new MouseEvent('mousedown', { bubbles: true })
      document.body.dispatchEvent(event)
      expect(mockCallback).not.toHaveBeenCalled()

      // Enable and click
      rerender({ enabled: true })
      event = new MouseEvent('mousedown', { bubbles: true })
      document.body.dispatchEvent(event)
      expect(mockCallback).toHaveBeenCalledTimes(1)
    })
  })

  describe('excludeRefs option', () => {
    it('should not call callback when clicking excluded element', () => {
      const ref = createRef<HTMLDivElement>()
      const excludeElement = document.createElement('button')
      document.body.appendChild(excludeElement)
      const excludeRef = createRef<HTMLButtonElement>()
      Object.defineProperty(ref, 'current', { writable: true, value: element })
      Object.defineProperty(excludeRef, 'current', { writable: true, value: excludeElement })

      renderHook(() => useClickOutside(ref, mockCallback, { excludeRefs: [excludeRef] }))

      const event = new MouseEvent('mousedown', { bubbles: true })
      excludeElement.dispatchEvent(event)

      expect(mockCallback).not.toHaveBeenCalled()

      document.body.removeChild(excludeElement)
    })

    it('should call callback when clicking outside excluded elements', () => {
      const ref = createRef<HTMLDivElement>()
      const excludeElement = document.createElement('button')
      document.body.appendChild(excludeElement)
      const excludeRef = createRef<HTMLButtonElement>()
      Object.defineProperty(ref, 'current', { writable: true, value: element })
      Object.defineProperty(excludeRef, 'current', { writable: true, value: excludeElement })

      renderHook(() => useClickOutside(ref, mockCallback, { excludeRefs: [excludeRef] }))

      const event = new MouseEvent('mousedown', { bubbles: true })
      document.body.dispatchEvent(event)

      expect(mockCallback).toHaveBeenCalledTimes(1)

      document.body.removeChild(excludeElement)
    })

    it('should handle multiple excluded refs', () => {
      const ref = createRef<HTMLDivElement>()
      const exclude1 = document.createElement('button')
      const exclude2 = document.createElement('button')
      document.body.appendChild(exclude1)
      document.body.appendChild(exclude2)

      const excludeRef1 = createRef<HTMLButtonElement>()
      const excludeRef2 = createRef<HTMLButtonElement>()
      Object.defineProperty(ref, 'current', { writable: true, value: element })
      Object.defineProperty(excludeRef1, 'current', { writable: true, value: exclude1 })
      Object.defineProperty(excludeRef2, 'current', { writable: true, value: exclude2 })

      renderHook(() =>
        useClickOutside(ref, mockCallback, { excludeRefs: [excludeRef1, excludeRef2] })
      )

      // Click on first excluded element
      let event = new MouseEvent('mousedown', { bubbles: true })
      exclude1.dispatchEvent(event)
      expect(mockCallback).not.toHaveBeenCalled()

      // Click on second excluded element
      event = new MouseEvent('mousedown', { bubbles: true })
      exclude2.dispatchEvent(event)
      expect(mockCallback).not.toHaveBeenCalled()

      document.body.removeChild(exclude1)
      document.body.removeChild(exclude2)
    })
  })

  describe('escape key handling', () => {
    it('should call onEscape when Escape key is pressed', () => {
      const ref = createRef<HTMLDivElement>()
      const onEscape = jest.fn()
      Object.defineProperty(ref, 'current', { writable: true, value: element })

      renderHook(() => useClickOutside(ref, mockCallback, { onEscape }))

      const event = new KeyboardEvent('keydown', { key: 'Escape' })
      document.dispatchEvent(event)

      expect(onEscape).toHaveBeenCalledTimes(1)
      expect(mockCallback).not.toHaveBeenCalled()
    })

    it('should not add keydown listener when onEscape is not provided', () => {
      const ref = createRef<HTMLDivElement>()
      Object.defineProperty(ref, 'current', { writable: true, value: element })

      renderHook(() => useClickOutside(ref, mockCallback))

      const event = new KeyboardEvent('keydown', { key: 'Escape' })
      document.dispatchEvent(event)

      // Should not throw and callback should not be called
      expect(mockCallback).not.toHaveBeenCalled()
    })

    it('should not call onEscape for other keys', () => {
      const ref = createRef<HTMLDivElement>()
      const onEscape = jest.fn()
      Object.defineProperty(ref, 'current', { writable: true, value: element })

      renderHook(() => useClickOutside(ref, mockCallback, { onEscape }))

      const event = new KeyboardEvent('keydown', { key: 'Enter' })
      document.dispatchEvent(event)

      expect(onEscape).not.toHaveBeenCalled()
    })

    it('should not call onEscape when disabled', () => {
      const ref = createRef<HTMLDivElement>()
      const onEscape = jest.fn()
      Object.defineProperty(ref, 'current', { writable: true, value: element })

      renderHook(() => useClickOutside(ref, mockCallback, { enabled: false, onEscape }))

      const event = new KeyboardEvent('keydown', { key: 'Escape' })
      document.dispatchEvent(event)

      expect(onEscape).not.toHaveBeenCalled()
    })
  })

  describe('cleanup', () => {
    it('should remove event listeners on unmount', () => {
      const ref = createRef<HTMLDivElement>()
      const onEscape = jest.fn()
      Object.defineProperty(ref, 'current', { writable: true, value: element })

      const { unmount } = renderHook(() => useClickOutside(ref, mockCallback, { onEscape }))

      unmount()

      const mouseEvent = new MouseEvent('mousedown', { bubbles: true })
      document.body.dispatchEvent(mouseEvent)

      const keyEvent = new KeyboardEvent('keydown', { key: 'Escape' })
      document.dispatchEvent(keyEvent)

      expect(mockCallback).not.toHaveBeenCalled()
      expect(onEscape).not.toHaveBeenCalled()
    })
  })
})
