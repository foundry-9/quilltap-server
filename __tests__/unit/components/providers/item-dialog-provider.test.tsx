/**
 * The shared dialog open / close context (`item-dialog-provider`), for both
 * kinds, and the kind-bound wrappers the dialogs and their openers use: each
 * kind's context is its own, so opening one never opens the other.
 */

import React, { type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { ItemDialogProvider, useItemDialog, useItemDialogOptional } from '@/components/providers/item-dialog-provider'
import { useWardrobeDialog, useWardrobeDialogOptional, WardrobeDialogProvider } from '@/components/providers/wardrobe-dialog-provider'
import { InventoryDialogProvider, useInventoryDialog, useInventoryDialogOptional } from '@/components/providers/inventory-dialog-provider'

function BothProviders({ children }: { children: ReactNode }) {
  return (
    <WardrobeDialogProvider>
      <InventoryDialogProvider>{children}</InventoryDialogProvider>
    </WardrobeDialogProvider>
  )
}

describe.each(['wardrobe', 'inventory'] as const)('ItemDialogProvider (%s)', (kind) => {
  it('opens with a context, closes, and opens again with none', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <ItemDialogProvider kind={kind}>{children}</ItemDialogProvider>
    const { result } = renderHook(() => useItemDialog(kind), { wrapper })
    expect(result.current.isOpen).toBe(false)
    expect(result.current.context).toBeNull()

    act(() => result.current.open({ characterId: 'c-1', chatId: 'chat-1' }))
    expect(result.current.isOpen).toBe(true)
    expect(result.current.context).toEqual({ characterId: 'c-1', chatId: 'chat-1' })

    act(() => result.current.close())
    expect(result.current.isOpen).toBe(false)

    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)
    expect(result.current.context).toBeNull()
  })

  it('throws outside its provider, and the optional hook answers null', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => renderHook(() => useItemDialog(kind))).toThrow(/must be used inside/)
    expect(renderHook(() => useItemDialogOptional(kind)).result.current).toBeNull()
    ;(console.error as jest.Mock).mockRestore()
  })
})

describe('the kind-bound wrappers', () => {
  it('keep the two dialogs apart', () => {
    const { result } = renderHook(
      () => ({ wardrobe: useWardrobeDialog(), inventory: useInventoryDialog() }),
      { wrapper: BothProviders },
    )
    act(() => result.current.inventory.open({ projectId: 'p-1' }))
    expect(result.current.inventory.isOpen).toBe(true)
    expect(result.current.inventory.context).toEqual({ projectId: 'p-1' })
    expect(result.current.wardrobe.isOpen).toBe(false)
  })

  it('name their own provider when misused', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => renderHook(() => useWardrobeDialog())).toThrow('useWardrobeDialog must be used inside WardrobeDialogProvider')
    expect(() => renderHook(() => useInventoryDialog())).toThrow('useInventoryDialog must be used inside InventoryDialogProvider')
    expect(renderHook(() => useWardrobeDialogOptional()).result.current).toBeNull()
    expect(renderHook(() => useInventoryDialogOptional()).result.current).toBeNull()
    ;(console.error as jest.Mock).mockRestore()
  })
})
