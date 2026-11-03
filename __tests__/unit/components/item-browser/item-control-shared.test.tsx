/**
 * The pieces the wardrobe and the Inventory share, each exercised for both
 * kinds:
 *
 *  - `useItemControlState` picks the opener's container, else the first
 *    character once the catalogue settles, else Quilltap General, and labels
 *    it in the kind's words;
 *  - `ItemControlDialogShell` lays out the container select with the shared
 *    note, as a modal with Done or bare as a tab, overlays beside it;
 *  - `ItemFolderPickerDialog` files through the kind's port, toasts in the
 *    kind's words, and hands a kind's extra choice to `file`;
 *  - `useItemOverlays` counts every overlay (and the kind's extra) as open.
 */

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))
jest.mock('@/lib/alert', () => ({ showAlert: jest.fn(), showConfirmation: jest.fn() }))

const catalogue = {
  characters: [{ id: 'c1', name: 'Bertie' }],
  projects: [{ id: 'p1', name: 'Blandings' }],
  groups: [] as Array<{ id: string; name: string }>,
  charactersSettled: true,
  loading: false,
}
jest.mock('@/lib/hooks/use-container-catalogue', () => ({ useContainerCatalogue: () => catalogue }))

import React from 'react'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import {
  ItemControlDialogShell,
  itemContainerLabel,
  useItemControlState,
  type ItemControlKind,
} from '@/components/item-browser/ItemControlDialogShell'
import { ItemFolderPickerDialog, type ItemFolderPickerWording } from '@/components/item-browser/ItemFolderPickerDialog'
import { useItemOverlays } from '@/components/item-browser/useItemOverlays'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

const KINDS: ItemControlKind[] = ['wardrobe', 'inventory']

describe.each(KINDS)('useItemControlState (%s)', (kind) => {
  it('starts on the opener’s container, else the first character', () => {
    const opened = renderHook(() => useItemControlState(kind, { scope: 'project', id: 'p1' }))
    expect(opened.result.current.container).toEqual({ scope: 'project', id: 'p1' })
    expect(opened.result.current.containerLabel).toBe('Blandings')

    const auto = renderHook(() => useItemControlState(kind, null))
    expect(auto.result.current.container).toEqual({ scope: 'character', id: 'c1' })
    expect(auto.result.current.containerLabel).toBe(kind === 'wardrobe' ? 'Bertie' : "Bertie's inventory")
  })

  it('holds the dialog open while a confirmation is up', async () => {
    let answer: (value: boolean) => void = () => undefined
    ;(showConfirmation as jest.Mock).mockReturnValue(new Promise<boolean>((resolve) => (answer = resolve)))
    const { result } = renderHook(() => useItemControlState(kind, null))
    let pending: Promise<boolean> = Promise.resolve(false)
    act(() => {
      pending = result.current.requestConfirmation('Sure?')
    })
    expect(result.current.confirming).toBe(true)
    await act(async () => {
      answer(true)
      await pending
    })
    expect(result.current.confirming).toBe(false)
  })
})

describe('itemContainerLabel', () => {
  it('falls back per kind for an unknown project or group', () => {
    expect(itemContainerLabel('wardrobe', { scope: 'group', id: 'gone' }, catalogue)).toBe('This group')
    expect(itemContainerLabel('inventory', { scope: 'group', id: 'gone' }, catalogue)).toBe('this group')
    expect(itemContainerLabel('inventory', { scope: 'general', id: null }, catalogue)).toBe('Quilltap General')
  })
})

function Shell({ kind, asTab, onClose }: { kind: ItemControlKind; asTab?: boolean; onClose?: () => void }) {
  const state = useItemControlState(kind, { scope: 'general', id: null })
  return (
    <ItemControlDialogShell kind={kind} state={state} asTab={asTab} onClose={onClose ?? jest.fn()} overlays={<div>overlay</div>}>
      <div>body</div>
    </ItemControlDialogShell>
  )
}

describe.each(KINDS)('ItemControlDialogShell (%s)', (kind) => {
  it('renders the container select, the shared note and Done in a modal', () => {
    const onClose = jest.fn()
    render(<Shell kind={kind} onClose={onClose} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    const select = screen.getByLabelText(kind === 'wardrobe' ? 'Wardrobe:' : 'Inventory:')
    expect(select).toHaveValue('general:')
    expect(screen.getByText(/can reach this library/)).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
    expect(screen.getByText('overlay')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders bare as a tab, and switching to a character drops the shared note', () => {
    render(<Shell kind={kind} asTab />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.change(screen.getByLabelText(kind === 'wardrobe' ? 'Wardrobe:' : 'Inventory:'), {
      target: { value: 'character:c1' },
    })
    expect(screen.queryByText(/can reach this/)).toBeNull()
  })
})

const WORDING: Record<ItemControlKind, ItemFolderPickerWording> = {
  wardrobe: {
    rootLabel: 'Wardrobe (top level)',
    noun: 'item',
    rootPhrase: 'the top of the wardrobe',
    rests: ['hangs', 'hang'],
    moveNote: 'move note',
    copyNote: 'copy note',
    describeError: (e, f) => (e instanceof Error ? e.message : f),
  },
  inventory: {
    rootLabel: 'Inventory (top level)',
    noun: 'object',
    rootPhrase: 'the top of the inventory',
    rests: ['sits', 'sit'],
    moveNote: 'move note',
    copyNote: 'copy note',
    describeError: (e, f) => (e instanceof Error ? e.message : f),
  },
}

const useFolders = () => ({ folders: [{ path: 'Hats' }], loading: false })

describe.each(KINDS)('ItemFolderPickerDialog (%s)', (kind) => {
  beforeEach(() => jest.clearAllMocks())

  it('files the items through the port and toasts in the kind’s words', async () => {
    const file = jest.fn().mockResolvedValue([{ folder: 'Hats' }, { folder: 'Hats' }])
    const onFiled = jest.fn()
    const onClose = jest.fn()
    render(
      <ItemFolderPickerDialog
        mode="move"
        items={[
          { id: 'a', title: 'Topper', folder: '' },
          { id: 'b', title: 'Bowler', folder: '' },
        ]}
        container={{ scope: 'general', id: null }}
        port={{ useFolders, createFolder: jest.fn(), creating: false }}
        wording={WORDING[kind]}
        file={file}
        onFiled={onFiled}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByText('Hats'))
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(file).toHaveBeenCalledWith('Hats', undefined)
    expect(onFiled).toHaveBeenCalled()
    const noun = kind === 'wardrobe' ? 'items' : 'objects'
    const rest = kind === 'wardrobe' ? 'hang' : 'sit'
    expect(showSuccessToast).toHaveBeenCalledWith(`2 ${noun} now ${rest} in "Hats"`)
  })

  it('hands the extra choice to file, and toasts a refusal without closing', async () => {
    const file = jest.fn().mockRejectedValue(new Error('Refused'))
    const onClose = jest.fn()
    render(
      <ItemFolderPickerDialog<{ id: string; title: string; folder: string }, string>
        mode="copy"
        items={[{ id: 'a', title: 'Topper', folder: 'Hats' }]}
        container={{ scope: 'general', id: null }}
        port={{ useFolders, createFolder: jest.fn(), creating: false }}
        wording={WORDING[kind]}
        choice={{
          initial: 'none',
          render: (value, onChange) => (
            <button type="button" onClick={() => onChange('copy')}>
              choice:{value}
            </button>
          ),
        }}
        file={file}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'choice:none' }))
    fireEvent.click(screen.getByText(WORDING[kind].rootLabel))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('Refused'))
    expect(file).toHaveBeenCalledWith('', 'copy')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('useItemOverlays', () => {
  it('opens and closes each overlay, ignores an empty selection, and counts the extra', () => {
    const { result, rerender } = renderHook(({ extra }) => useItemOverlays<{ id: string }, { kind: 'edit' }>(extra), {
      initialProps: { extra: false },
    })
    expect(result.current.overlayOpen).toBe(false)
    act(() => result.current.openFolderPicker([]))
    expect(result.current.folderPicker).toBeNull()
    act(() => result.current.openFolderPicker([{ id: 'a' }], 'copy'))
    expect(result.current.folderPicker).toEqual({ items: [{ id: 'a' }], mode: 'copy' })
    expect(result.current.overlayOpen).toBe(true)
    act(() => result.current.closeFolderPicker())
    act(() => result.current.openTransfer({ id: 'a' }, 'move'))
    expect(result.current.transfer).toEqual({ item: { id: 'a' }, mode: 'move' })
    act(() => result.current.closeTransfer())
    act(() => result.current.openEditorWith({ kind: 'edit' }))
    expect(result.current.editor).toEqual({ kind: 'edit' })
    act(() => result.current.closeEditor())
    expect(result.current.overlayOpen).toBe(false)
    rerender({ extra: true })
    expect(result.current.overlayOpen).toBe(true)
  })
})
