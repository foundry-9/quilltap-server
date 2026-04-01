/**
 * Unit tests for useImageNavigation hook
 * Tests keyboard navigation in image modals
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { renderHook } from '@testing-library/react'
import { useImageNavigation } from '@/hooks/useImageNavigation'

describe('useImageNavigation', () => {
  let originalOverflow: string

  beforeEach(() => {
    originalOverflow = document.body.style.overflow
  })

  afterEach(() => {
    document.body.style.overflow = originalOverflow
    jest.clearAllMocks()
  })

  describe('escape key handling', () => {
    it('should call onClose when Escape is pressed and modal is open', () => {
      const onClose = jest.fn()

      renderHook(() =>
        useImageNavigation({
          isOpen: true,
          onClose,
        })
      )

      const event = new KeyboardEvent('keydown', { key: 'Escape' })
      document.dispatchEvent(event)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should not call onClose when modal is closed', () => {
      const onClose = jest.fn()

      renderHook(() =>
        useImageNavigation({
          isOpen: false,
          onClose,
        })
      )

      const event = new KeyboardEvent('keydown', { key: 'Escape' })
      document.dispatchEvent(event)

      expect(onClose).not.toHaveBeenCalled()
    })

    it('should not handle Escape when handleEscape is false', () => {
      const onClose = jest.fn()

      renderHook(() =>
        useImageNavigation({
          isOpen: true,
          onClose,
          handleEscape: false,
        })
      )

      const event = new KeyboardEvent('keydown', { key: 'Escape' })
      document.dispatchEvent(event)

      expect(onClose).not.toHaveBeenCalled()
    })

    it('should handle Escape when handleEscape is explicitly true', () => {
      const onClose = jest.fn()

      renderHook(() =>
        useImageNavigation({
          isOpen: true,
          onClose,
          handleEscape: true,
        })
      )

      const event = new KeyboardEvent('keydown', { key: 'Escape' })
      document.dispatchEvent(event)

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('arrow key navigation', () => {
    it('should call onPrev when ArrowLeft is pressed', () => {
      const onPrev = jest.fn()
      const onClose = jest.fn()

      renderHook(() =>
        useImageNavigation({
          isOpen: true,
          onClose,
          onPrev,
        })
      )

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft' })
      document.dispatchEvent(event)

      expect(onPrev).toHaveBeenCalledTimes(1)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('should call onNext when ArrowRight is pressed', () => {
      const onNext = jest.fn()
      const onClose = jest.fn()

      renderHook(() =>
        useImageNavigation({
          isOpen: true,
          onClose,
          onNext,
        })
      )

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight' })
      document.dispatchEvent(event)

      expect(onNext).toHaveBeenCalledTimes(1)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('should not call onPrev when not provided', () => {
      const onClose = jest.fn()

      renderHook(() =>
        useImageNavigation({
          isOpen: true,
          onClose,
        })
      )

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft' })
      document.dispatchEvent(event)

      // Should not throw
      expect(onClose).not.toHaveBeenCalled()
    })

    it('should not call onNext when not provided', () => {
      const onClose = jest.fn()

      renderHook(() =>
        useImageNavigation({
          isOpen: true,
          onClose,
        })
      )

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight' })
      document.dispatchEvent(event)

      // Should not throw
      expect(onClose).not.toHaveBeenCalled()
    })

    it('should handle both navigation and escape', () => {
      const onClose = jest.fn()
      const onPrev = jest.fn()
      const onNext = jest.fn()

      renderHook(() =>
        useImageNavigation({
          isOpen: true,
          onClose,
          onPrev,
          onNext,
        })
      )

      // Test all three keys
      let event = new KeyboardEvent('keydown', { key: 'ArrowLeft' })
      document.dispatchEvent(event)
      expect(onPrev).toHaveBeenCalledTimes(1)

      event = new KeyboardEvent('keydown', { key: 'ArrowRight' })
      document.dispatchEvent(event)
      expect(onNext).toHaveBeenCalledTimes(1)

      event = new KeyboardEvent('keydown', { key: 'Escape' })
      document.dispatchEvent(event)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should not handle arrow keys when modal is closed', () => {
      const onPrev = jest.fn()
      const onNext = jest.fn()
      const onClose = jest.fn()

      renderHook(() =>
        useImageNavigation({
          isOpen: false,
          onClose,
          onPrev,
          onNext,
        })
      )

      const leftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft' })
      document.dispatchEvent(leftEvent)

      const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight' })
      document.dispatchEvent(rightEvent)

      expect(onPrev).not.toHaveBeenCalled()
      expect(onNext).not.toHaveBeenCalled()
    })
  })

  describe('body scroll prevention', () => {
    it('should prevent body scroll when modal is open', () => {
      renderHook(() =>
        useImageNavigation({
          isOpen: true,
          onClose: jest.fn(),
        })
      )

      expect(document.body.style.overflow).toBe('hidden')
    })

    it('should restore body scroll when modal closes', () => {
      const { rerender } = renderHook(
        ({ isOpen }) =>
          useImageNavigation({
            isOpen,
            onClose: jest.fn(),
          }),
        { initialProps: { isOpen: true } }
      )

      expect(document.body.style.overflow).toBe('hidden')

      rerender({ isOpen: false })

      expect(document.body.style.overflow).toBe('')
    })

    it('should restore body scroll on unmount', () => {
      const { unmount } = renderHook(() =>
        useImageNavigation({
          isOpen: true,
          onClose: jest.fn(),
        })
      )

      expect(document.body.style.overflow).toBe('hidden')

      unmount()

      expect(document.body.style.overflow).toBe('')
    })

    it('should not prevent scroll when preventBodyScroll is false', () => {
      renderHook(() =>
        useImageNavigation({
          isOpen: true,
          onClose: jest.fn(),
          preventBodyScroll: false,
        })
      )

      expect(document.body.style.overflow).toBe('')
    })

    it('should handle preventBodyScroll option correctly', () => {
      const { rerender } = renderHook(
        ({ preventBodyScroll }) =>
          useImageNavigation({
            isOpen: true,
            onClose: jest.fn(),
            preventBodyScroll,
          }),
        { initialProps: { preventBodyScroll: true } }
      )

      expect(document.body.style.overflow).toBe('hidden')

      rerender({ preventBodyScroll: false })

      expect(document.body.style.overflow).toBe('')
    })
  })

  describe('cleanup', () => {
    it('should remove event listeners on unmount', () => {
      const onClose = jest.fn()
      const onPrev = jest.fn()
      const onNext = jest.fn()

      const { unmount } = renderHook(() =>
        useImageNavigation({
          isOpen: true,
          onClose,
          onPrev,
          onNext,
        })
      )

      unmount()

      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' })
      document.dispatchEvent(escapeEvent)

      const leftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft' })
      document.dispatchEvent(leftEvent)

      const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight' })
      document.dispatchEvent(rightEvent)

      expect(onClose).not.toHaveBeenCalled()
      expect(onPrev).not.toHaveBeenCalled()
      expect(onNext).not.toHaveBeenCalled()
    })
  })

  describe('callback updates', () => {
    it('should use updated callbacks', () => {
      const onClose1 = jest.fn()
      const onClose2 = jest.fn()

      const { rerender } = renderHook(
        ({ onClose }) =>
          useImageNavigation({
            isOpen: true,
            onClose,
          }),
        { initialProps: { onClose: onClose1 } }
      )

      let event = new KeyboardEvent('keydown', { key: 'Escape' })
      document.dispatchEvent(event)
      expect(onClose1).toHaveBeenCalledTimes(1)
      expect(onClose2).not.toHaveBeenCalled()

      rerender({ onClose: onClose2 })

      event = new KeyboardEvent('keydown', { key: 'Escape' })
      document.dispatchEvent(event)
      expect(onClose1).toHaveBeenCalledTimes(1)
      expect(onClose2).toHaveBeenCalledTimes(1)
    })
  })
})
