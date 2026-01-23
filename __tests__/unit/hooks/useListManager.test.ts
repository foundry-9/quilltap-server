/**
 * Tests for useListManager hook
 */

import { renderHook, act, waitFor } from '@testing-library/react'
import { useListManager } from '@/hooks/useListManager'


jest.mock('@/lib/alert', () => ({
  showConfirmation: jest.fn(),
}))

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

import { showConfirmation } from '@/lib/alert'
import { showSuccessToast, showErrorToast } from '@/lib/toast'

const mockShowConfirmation = showConfirmation as jest.MockedFunction<typeof showConfirmation>
const mockShowSuccessToast = showSuccessToast as jest.MockedFunction<typeof showSuccessToast>
const mockShowErrorToast = showErrorToast as jest.MockedFunction<typeof showErrorToast>

interface TestItem {
  id: string
  name: string
  value: number
}

describe('useListManager', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockShowConfirmation.mockResolvedValue(true)
  })

  describe('Initial state', () => {
    it('should start with loading true when autoFetch is enabled', () => {
      const fetchFn = jest.fn().mockResolvedValue([])
      const { result } = renderHook(() => useListManager({ fetchFn }))

      expect(result.current.loading).toBe(true)
      expect(result.current.items).toEqual([])
      expect(result.current.error).toBeNull()
      expect(result.current.deletingId).toBeNull()
      expect(result.current.editingItem).toBeNull()
      expect(result.current.showEditor).toBe(false)
    })

    it('should not fetch when autoFetch is false', async () => {
      const fetchFn = jest.fn().mockResolvedValue([])
      renderHook(() => useListManager({ fetchFn, autoFetch: false }))

      await new Promise(resolve => setTimeout(resolve, 100))
      expect(fetchFn).not.toHaveBeenCalled()
    })
  })

  describe('Fetching data', () => {
    it('should fetch items on mount', async () => {
      const items: TestItem[] = [
        { id: '1', name: 'Item 1', value: 100 },
        { id: '2', name: 'Item 2', value: 200 },
      ]
      const fetchFn = jest.fn().mockResolvedValue(items)

      const { result } = renderHook(() => useListManager({ fetchFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(fetchFn).toHaveBeenCalledTimes(1)
      expect(result.current.items).toEqual(items)
      expect(result.current.error).toBeNull()
    })

    it('should handle fetch errors', async () => {
      const fetchFn = jest.fn().mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useListManager({ fetchFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.error).toBe('Network error')
      expect(result.current.items).toEqual([])
    })

    it('should refetch when refetch is called', async () => {
      const items: TestItem[] = [{ id: '1', name: 'Item 1', value: 100 }]
      const fetchFn = jest.fn().mockResolvedValue(items)

      const { result } = renderHook(() => useListManager({ fetchFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(fetchFn).toHaveBeenCalledTimes(1)

      await act(async () => {
        await result.current.refetch()
      })

      expect(fetchFn).toHaveBeenCalledTimes(2)
    })
  })

  describe('Delete operations', () => {
    it('should delete item after confirmation', async () => {
      const items: TestItem[] = [
        { id: '1', name: 'Item 1', value: 100 },
        { id: '2', name: 'Item 2', value: 200 },
      ]
      const fetchFn = jest.fn().mockResolvedValue(items)
      const deleteFn = jest.fn().mockResolvedValue(undefined)
      mockShowConfirmation.mockResolvedValue(true)

      const { result } = renderHook(() => useListManager({ fetchFn, deleteFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.handleDelete('1')
      })

      expect(mockShowConfirmation).toHaveBeenCalled()
      expect(deleteFn).toHaveBeenCalledWith('1')
      expect(result.current.items).toHaveLength(1)
      expect(result.current.items[0].id).toBe('2')
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Item deleted')
    })

    it('should not delete when user cancels confirmation', async () => {
      const items: TestItem[] = [{ id: '1', name: 'Item 1', value: 100 }]
      const fetchFn = jest.fn().mockResolvedValue(items)
      const deleteFn = jest.fn().mockResolvedValue(undefined)
      mockShowConfirmation.mockResolvedValue(false)

      const { result } = renderHook(() => useListManager({ fetchFn, deleteFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.handleDelete('1')
      })

      expect(mockShowConfirmation).toHaveBeenCalled()
      expect(deleteFn).not.toHaveBeenCalled()
      expect(result.current.items).toHaveLength(1)
    })

    it('should handle delete errors', async () => {
      const items: TestItem[] = [{ id: '1', name: 'Item 1', value: 100 }]
      const fetchFn = jest.fn().mockResolvedValue(items)
      const deleteFn = jest.fn().mockRejectedValue(new Error('Delete failed'))
      mockShowConfirmation.mockResolvedValue(true)

      const { result } = renderHook(() => useListManager({ fetchFn, deleteFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.handleDelete('1')
      })

      expect(mockShowErrorToast).toHaveBeenCalledWith('Delete failed')
      expect(result.current.items).toHaveLength(1) // Item should not be removed
    })

    it('should set deletingId during delete operation', async () => {
      const items: TestItem[] = [{ id: '1', name: 'Item 1', value: 100 }]
      const fetchFn = jest.fn().mockResolvedValue(items)

      let resolveDelete: () => void
      const deleteFn = jest.fn().mockImplementation(() => {
        return new Promise<void>(resolve => {
          resolveDelete = resolve
        })
      })
      mockShowConfirmation.mockResolvedValue(true)

      const { result } = renderHook(() => useListManager({ fetchFn, deleteFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // Start delete but don't await
      let deletePromise: Promise<void>
      act(() => {
        deletePromise = result.current.handleDelete('1')
      })

      // Check deletingId is set
      await waitFor(() => {
        expect(result.current.deletingId).toBe('1')
      })

      // Complete the delete
      act(() => {
        resolveDelete!()
      })

      await act(async () => {
        await deletePromise!
      })

      expect(result.current.deletingId).toBeNull()
    })

    it('should skip delete when no deleteFn provided', async () => {
      const fetchFn = jest.fn().mockResolvedValue([{ id: '1', name: 'Item 1' }])

      const { result } = renderHook(() => useListManager({ fetchFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.handleDelete('1')
      })

      expect(mockShowConfirmation).not.toHaveBeenCalled()
    })

    it('should use custom delete messages', async () => {
      const items: TestItem[] = [{ id: '1', name: 'Item 1', value: 100 }]
      const fetchFn = jest.fn().mockResolvedValue(items)
      const deleteFn = jest.fn().mockResolvedValue(undefined)
      mockShowConfirmation.mockResolvedValue(true)

      const { result } = renderHook(() =>
        useListManager({
          fetchFn,
          deleteFn,
          deleteConfirmMessage: 'Custom confirm?',
          deleteSuccessMessage: 'Custom success!',
        })
      )

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.handleDelete('1')
      })

      expect(mockShowConfirmation).toHaveBeenCalledWith('Custom confirm?')
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Custom success!')
    })
  })

  describe('Editor operations', () => {
    it('should open editor for creating new item', async () => {
      const fetchFn = jest.fn().mockResolvedValue([])

      const { result } = renderHook(() => useListManager({ fetchFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      act(() => {
        result.current.handleCreate()
      })

      expect(result.current.showEditor).toBe(true)
      expect(result.current.editingItem).toBeNull()
    })

    it('should open editor for editing existing item', async () => {
      const item: TestItem = { id: '1', name: 'Item 1', value: 100 }
      const fetchFn = jest.fn().mockResolvedValue([item])

      const { result } = renderHook(() => useListManager({ fetchFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      act(() => {
        result.current.handleEdit(item)
      })

      expect(result.current.showEditor).toBe(true)
      expect(result.current.editingItem).toEqual(item)
    })

    it('should close editor and clear editing item', async () => {
      const item: TestItem = { id: '1', name: 'Item 1', value: 100 }
      const fetchFn = jest.fn().mockResolvedValue([item])

      const { result } = renderHook(() => useListManager({ fetchFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      act(() => {
        result.current.handleEdit(item)
      })

      expect(result.current.showEditor).toBe(true)
      expect(result.current.editingItem).toEqual(item)

      act(() => {
        result.current.handleEditorClose()
      })

      expect(result.current.showEditor).toBe(false)
      expect(result.current.editingItem).toBeNull()
    })

    it('should close editor and refetch on save', async () => {
      const item: TestItem = { id: '1', name: 'Item 1', value: 100 }
      const fetchFn = jest.fn().mockResolvedValue([item])

      const { result } = renderHook(() => useListManager({ fetchFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      act(() => {
        result.current.handleEdit(item)
      })

      expect(fetchFn).toHaveBeenCalledTimes(1)

      await act(async () => {
        result.current.handleEditorSave()
      })

      expect(result.current.showEditor).toBe(false)
      expect(result.current.editingItem).toBeNull()
      // Should have refetched
      await waitFor(() => {
        expect(fetchFn).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe('Error handling', () => {
    it('should set error manually', async () => {
      const fetchFn = jest.fn().mockResolvedValue([])

      const { result } = renderHook(() => useListManager({ fetchFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      act(() => {
        result.current.setError('Custom error')
      })

      expect(result.current.error).toBe('Custom error')

      act(() => {
        result.current.setError(null)
      })

      expect(result.current.error).toBeNull()
    })
  })

  describe('Custom idField', () => {
    interface CustomIdItem {
      customId: string
      name: string
    }

    it('should use custom idField for delete', async () => {
      const items: CustomIdItem[] = [
        { customId: 'c1', name: 'Item 1' },
        { customId: 'c2', name: 'Item 2' },
      ]
      const fetchFn = jest.fn().mockResolvedValue(items)
      const deleteFn = jest.fn().mockResolvedValue(undefined)
      mockShowConfirmation.mockResolvedValue(true)

      const { result } = renderHook(() =>
        useListManager<CustomIdItem>({
          fetchFn,
          deleteFn,
          idField: 'customId',
        })
      )

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.handleDelete('c1')
      })

      expect(result.current.items).toHaveLength(1)
      expect(result.current.items[0].customId).toBe('c2')
    })
  })

  describe('setItems', () => {
    it('should allow direct manipulation of items', async () => {
      const items: TestItem[] = [{ id: '1', name: 'Item 1', value: 100 }]
      const fetchFn = jest.fn().mockResolvedValue(items)

      const { result } = renderHook(() => useListManager({ fetchFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      act(() => {
        result.current.setItems([
          { id: '1', name: 'Updated Item', value: 200 },
          { id: '2', name: 'New Item', value: 300 },
        ])
      })

      expect(result.current.items).toHaveLength(2)
      expect(result.current.items[0].name).toBe('Updated Item')
      expect(result.current.items[1].id).toBe('2')
    })

    it('should support functional updates', async () => {
      const items: TestItem[] = [{ id: '1', name: 'Item 1', value: 100 }]
      const fetchFn = jest.fn().mockResolvedValue(items)

      const { result } = renderHook(() => useListManager({ fetchFn }))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      act(() => {
        result.current.setItems(prev => [
          ...prev,
          { id: '2', name: 'Item 2', value: 200 },
        ])
      })

      expect(result.current.items).toHaveLength(2)
    })
  })
})
