/**
 * Unit tests for useDialogState hook
 * Tests dialog state management with automatic reset
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { renderHook, act } from '@testing-library/react'
import { useDialogState, useDialogStateWithFileInput } from '@/hooks/useDialogState'

describe('useDialogState', () => {
  describe('initialization', () => {
    it('should initialize with provided state', () => {
      const initialState = { step: 'start', error: null, loading: false }

      const { result } = renderHook(() =>
        useDialogState({
          isOpen: false,
          initialState,
        })
      )

      expect(result.current.state).toEqual(initialState)
    })

    it('should work with complex state objects', () => {
      const initialState = {
        step: 'file',
        selectedFile: null,
        importing: false,
        error: null,
        data: { count: 0, items: [] },
      }

      const { result } = renderHook(() =>
        useDialogState({
          isOpen: false,
          initialState,
        })
      )

      expect(result.current.state).toEqual(initialState)
    })
  })

  describe('state management', () => {
    it('should update state with setState', () => {
      const initialState = { count: 0, name: '' }

      const { result } = renderHook(() =>
        useDialogState({
          isOpen: true,
          initialState,
        })
      )

      act(() => {
        result.current.setState({ count: 5, name: 'test' })
      })

      expect(result.current.state).toEqual({ count: 5, name: 'test' })
    })

    it('should support functional setState', () => {
      const initialState = { count: 0 }

      const { result } = renderHook(() =>
        useDialogState({
          isOpen: true,
          initialState,
        })
      )

      act(() => {
        result.current.setState((prev) => ({ count: prev.count + 1 }))
      })

      expect(result.current.state.count).toBe(1)
    })

    it('should update single field with setField', () => {
      const initialState = { step: 'start', error: null }

      const { result } = renderHook(() =>
        useDialogState({
          isOpen: true,
          initialState,
        })
      )

      act(() => {
        result.current.setField('step', 'processing')
      })

      expect(result.current.state.step).toBe('processing')
      expect(result.current.state.error).toBe(null)
    })

    it('should update multiple fields with setFields', () => {
      const initialState = { step: 'start', error: null, loading: false }

      const { result } = renderHook(() =>
        useDialogState({
          isOpen: true,
          initialState,
        })
      )

      act(() => {
        result.current.setFields({ step: 'processing', loading: true })
      })

      expect(result.current.state).toEqual({ step: 'processing', error: null, loading: true })
    })
  })

  describe('error handling', () => {
    it('should clear error with clearError', () => {
      const initialState = { step: 'start', error: 'Something went wrong' }

      const { result } = renderHook(() =>
        useDialogState({
          isOpen: true,
          initialState,
        })
      )

      act(() => {
        result.current.clearError()
      })

      expect(result.current.state.error).toBe(null)
    })

    it('should handle state without error field gracefully', () => {
      const initialState = { step: 'start', loading: false }

      const { result } = renderHook(() =>
        useDialogState({
          isOpen: true,
          initialState,
        })
      )

      act(() => {
        result.current.clearError()
      })

      // Should not throw and state should remain unchanged
      expect(result.current.state).toEqual(initialState)
    })
  })

  describe('reset functionality', () => {
    it('should reset to initial state when reset is called', () => {
      const initialState = { step: 'start', error: null }

      const { result } = renderHook(() =>
        useDialogState({
          isOpen: true,
          initialState,
        })
      )

      act(() => {
        result.current.setField('step', 'processing')
        result.current.setField('error', 'Error occurred')
      })

      act(() => {
        result.current.reset()
      })

      expect(result.current.state).toEqual(initialState)
    })

    it('should call onReset when reset is triggered', () => {
      const onReset = jest.fn()
      const initialState = { step: 'start' }

      const { result } = renderHook(() =>
        useDialogState({
          isOpen: true,
          initialState,
          onReset,
        })
      )

      act(() => {
        result.current.reset()
      })

      expect(onReset).toHaveBeenCalledTimes(1)
    })

    it('should reset state when dialog closes', () => {
      const initialState = { step: 'start', error: null }

      const { result, rerender } = renderHook(
        ({ isOpen }) =>
          useDialogState({
            isOpen,
            initialState,
          }),
        { initialProps: { isOpen: true } }
      )

      act(() => {
        result.current.setField('step', 'processing')
      })

      expect(result.current.state.step).toBe('processing')

      // Close dialog
      rerender({ isOpen: false })

      expect(result.current.state).toEqual(initialState)
    })

    it('should not reset when dialog remains open', () => {
      const initialState = { step: 'start' }

      const { result, rerender } = renderHook(
        ({ isOpen }) =>
          useDialogState({
            isOpen,
            initialState,
          }),
        { initialProps: { isOpen: true } }
      )

      act(() => {
        result.current.setField('step', 'processing')
      })

      rerender({ isOpen: true })

      expect(result.current.state.step).toBe('processing')
    })

    it('should call onReset when dialog closes', () => {
      const onReset = jest.fn()
      const initialState = { step: 'start' }

      const { rerender } = renderHook(
        ({ isOpen }) =>
          useDialogState({
            isOpen,
            initialState,
            onReset,
          }),
        { initialProps: { isOpen: true } }
      )

      // Close dialog
      rerender({ isOpen: false })

      expect(onReset).toHaveBeenCalledTimes(1)
    })
  })
})

describe('useDialogStateWithFileInput', () => {
  describe('initialization', () => {
    it('should return fileInputRef', () => {
      const initialState = { step: 'file', selectedFile: null }

      const { result } = renderHook(() =>
        useDialogStateWithFileInput({
          isOpen: false,
          initialState,
        })
      )

      expect(result.current.fileInputRef).toBeDefined()
      expect(result.current.fileInputRef.current).toBe(null)
    })

    it('should include all base dialog state methods', () => {
      const initialState = { step: 'file' }

      const { result } = renderHook(() =>
        useDialogStateWithFileInput({
          isOpen: false,
          initialState,
        })
      )

      expect(result.current.state).toBeDefined()
      expect(result.current.setState).toBeDefined()
      expect(result.current.reset).toBeDefined()
      expect(result.current.setField).toBeDefined()
      expect(result.current.setFields).toBeDefined()
      expect(result.current.clearError).toBeDefined()
      expect(result.current.fileInputRef).toBeDefined()
    })
  })

  describe('file input clearing', () => {
    it('should clear file input value on reset', () => {
      const initialState = { step: 'file' }
      const mockInput = document.createElement('input')
      mockInput.type = 'file'

      const { result } = renderHook(() =>
        useDialogStateWithFileInput({
          isOpen: true,
          initialState,
        })
      )

      // Manually set the ref
      Object.defineProperty(result.current.fileInputRef, 'current', {
        writable: true,
        value: mockInput,
      })

      // Mock the value property to avoid JSDOM restrictions
      const valueSetter = jest.fn()
      Object.defineProperty(mockInput, 'value', {
        get: () => '',
        set: valueSetter,
      })

      act(() => {
        result.current.reset()
      })

      expect(valueSetter).toHaveBeenCalledWith('')
    })

    it('should call additional onReset callback', () => {
      const onReset = jest.fn()
      const initialState = { step: 'file' }

      const { result } = renderHook(() =>
        useDialogStateWithFileInput({
          isOpen: true,
          initialState,
          onReset,
        })
      )

      act(() => {
        result.current.reset()
      })

      expect(onReset).toHaveBeenCalledTimes(1)
    })

    it('should clear file input when dialog closes', () => {
      const initialState = { step: 'file' }
      const mockInput = document.createElement('input')
      mockInput.type = 'file'

      const { result, rerender } = renderHook(
        ({ isOpen }) =>
          useDialogStateWithFileInput({
            isOpen,
            initialState,
          }),
        { initialProps: { isOpen: true } }
      )

      Object.defineProperty(result.current.fileInputRef, 'current', {
        writable: true,
        value: mockInput,
      })

      // Mock the value property
      const valueSetter = jest.fn()
      Object.defineProperty(mockInput, 'value', {
        get: () => '',
        set: valueSetter,
      })

      rerender({ isOpen: false })

      expect(valueSetter).toHaveBeenCalledWith('')
    })

    it('should handle missing file input ref gracefully', () => {
      const initialState = { step: 'file' }

      const { result } = renderHook(() =>
        useDialogStateWithFileInput({
          isOpen: true,
          initialState,
        })
      )

      // Should not throw when ref is null
      expect(() => {
        act(() => {
          result.current.reset()
        })
      }).not.toThrow()
    })
  })
})
