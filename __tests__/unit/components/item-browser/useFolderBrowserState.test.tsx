/**
 * useFolderBrowserState / useItemFolderHandlers — the state shared by the
 * wardrobe, Inventory and Scriptorium folder browsers.
 *
 * The design under test: view state is keyed to the container (and the view),
 * so a new container opens at its root with nothing selected, and leaving a
 * folder or starting a search drops the selection — all without a reset
 * effect. Folders are managed only in the own tier; deleting the folder being
 * browsed steps up to its parent.
 */

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

import { act, renderHook } from '@testing-library/react'
import {
  pluralize,
  useFolderBrowserState,
  useItemFolderHandlers,
  type FolderBrowserStateOptions,
  type ItemFolderOps,
} from '@/components/item-browser/useFolderBrowserState'
import { OWN_TIER } from '@/lib/folder-browser/view'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

type Row = { id: string; folder?: string | null; origin?: { scope: 'group'; id: string; name: string } | null }

const items: Row[] = [
  { id: 'hat', folder: 'Hats' },
  { id: 'cap', folder: 'Hats/Caps' },
  { id: 'coat', folder: '' },
  { id: 'cloak', folder: '', origin: { scope: 'group', id: 'g1', name: 'Crew' } },
]
const tierOf = (i: Row) => (i.origin ? `group:${i.origin.id}` : OWN_TIER)

function options(overrides: Partial<FolderBrowserStateOptions<Row>> = {}): FolderBrowserStateOptions<Row> {
  return {
    containerKey: 'character:c1',
    items,
    filtered: items,
    tree: [],
    tierOf,
    characterView: true,
    showShared: true,
    searching: false,
    ...overrides,
  }
}

const render = (initial: FolderBrowserStateOptions<Row>) =>
  renderHook((props: FolderBrowserStateOptions<Row>) => useFolderBrowserState(props), { initialProps: initial })

beforeEach(() => {
  jest.clearAllMocks()
})

describe('useFolderBrowserState', () => {
  it('opens at the own tier root, showing root items, folder rows and shared tiers', () => {
    const { result } = render(options())
    expect(result.current.currentTier).toBe(OWN_TIER)
    expect(result.current.currentFolder).toBe('')
    expect(result.current.managed).toBe(true)
    expect(result.current.visible.map((i) => i.id)).toEqual(['coat'])
    expect(result.current.folderRows.map((r) => r.path)).toEqual(['Hats'])
    expect(result.current.sharedTierRows).toHaveLength(1)
    expect(result.current.folderIsEmpty).toBe(false)
  })

  it('navigates into a folder and shows only what sits there', () => {
    const { result } = render(options())
    act(() => result.current.navigate(OWN_TIER, 'Hats'))
    expect(result.current.visible.map((i) => i.id)).toEqual(['hat'])
    expect(result.current.folderRows.map((r) => r.path)).toEqual(['Hats/Caps'])
    expect(result.current.sharedTierRows).toEqual([])
  })

  it('a borrowed tier is labelled and never managed', () => {
    const { result } = render(options())
    act(() => result.current.navigate('group:g1', ''))
    expect(result.current.inOwnTier).toBe(false)
    expect(result.current.managed).toBe(false)
    expect(result.current.currentTierLabel).toBe('Group: Crew')
    expect(result.current.visible.map((i) => i.id)).toEqual(['cloak'])
  })

  it('hiding shared tiers while inside one reads as the root', () => {
    const { result, rerender } = render(options())
    act(() => result.current.navigate('group:g1', ''))
    rerender(options({ showShared: false }))
    expect(result.current.currentTier).toBe(OWN_TIER)
  })

  it('a new container opens at its root with select mode off and nothing selected', () => {
    const { result, rerender } = render(options())
    act(() => {
      result.current.navigate(OWN_TIER, 'Hats')
      result.current.setSelectMode(true)
    })
    act(() => result.current.toggleSelected(items[0]))
    expect(result.current.selectedItems.map((i) => i.id)).toEqual(['hat'])

    rerender(options({ containerKey: 'character:c2' }))

    expect(result.current.currentFolder).toBe('')
    expect(result.current.selectMode).toBe(false)
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('leaving a folder or starting a search drops the selection', () => {
    const { result, rerender } = render(options())
    act(() => result.current.navigate(OWN_TIER, 'Hats'))
    act(() => result.current.toggleSelected(items[0]))
    expect(result.current.selectedIds.has('hat')).toBe(true)

    rerender(options({ searching: true }))
    expect(result.current.selectedIds.size).toBe(0)
    expect(result.current.folderRows).toEqual([])

    rerender(options())
    act(() => result.current.toggleSelected(items[0]))
    act(() => result.current.navigate(OWN_TIER, ''))
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('toggling an item twice deselects it', () => {
    const { result } = render(options())
    act(() => result.current.toggleSelected(items[2]))
    act(() => result.current.toggleSelected(items[2]))
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('the new-folder draft belongs to the view it was opened in', () => {
    const { result } = render(options())
    act(() => result.current.newFolder.setName('Scarves'))
    expect(result.current.newFolder.open).toBe(true)
    act(() => result.current.navigate(OWN_TIER, 'Hats'))
    expect(result.current.newFolder.open).toBe(false)
    expect(result.current.newFolder.name).toBe('')
  })

  it('reports an empty folder as empty', () => {
    const { result } = render(options({ tree: [{ path: 'Empty', itemCount: 0 }] }))
    act(() => result.current.navigate(OWN_TIER, 'Empty'))
    expect(result.current.folderIsEmpty).toBe(true)
  })
})

describe('useItemFolderHandlers', () => {
  const wording = {
    noun: 'item',
    rootPhrase: 'the top of the wardrobe',
    created: (name: string) => `Made "${name}"`,
    movedUp: (count: string) => `${count} moved up`,
  }

  function setup(ops: ItemFolderOps | null, confirmed = true) {
    const confirm = jest.fn(async () => confirmed)
    const hook = renderHook(() => {
      const state = useFolderBrowserState(options())
      const handlers = useItemFolderHandlers({
        state,
        ops,
        wording,
        confirm,
        describeError: (_e, fallback) => fallback,
      })
      return { state, handlers }
    })
    return { ...hook, confirm }
  }

  const ops = (): jest.Mocked<ItemFolderOps> => ({
    create: jest.fn(async (path: string) => ({ name: path.split('/').pop()! })),
    rename: jest.fn(async (_path: string, name: string) => ({ name })),
    remove: jest.fn(async () => ({ movedItems: 2 })),
  })

  it('creates the draft folder inside the current folder and closes the draft', async () => {
    const o = ops()
    const { result } = setup(o)
    act(() => result.current.state.navigate(OWN_TIER, 'Hats'))
    act(() => result.current.state.newFolder.setName('  Berets  '))
    await act(() => result.current.handlers.submitNewFolder())
    expect(o.create).toHaveBeenCalledWith('Hats/Berets')
    expect(showSuccessToast).toHaveBeenCalledWith('Made "Berets"')
    expect(result.current.state.newFolder.open).toBe(false)
  })

  it('counts what a delete will move up, and steps out of the deleted folder', async () => {
    const o = ops()
    const { result, confirm } = setup(o)
    act(() => result.current.state.navigate(OWN_TIER, 'Hats/Caps'))
    await act(() => result.current.handlers.deleteFolder('Hats'))
    expect(confirm).toHaveBeenCalledWith(
      'Send its 2 items up to the top of the wardrobe? Only the folder itself goes.',
    )
    expect(o.remove).toHaveBeenCalledWith('Hats')
    expect(showSuccessToast).toHaveBeenCalledWith('2 items moved up')
    expect(result.current.state.currentFolder).toBe('')
  })

  it('does nothing when the delete is not confirmed', async () => {
    const o = ops()
    const { result } = setup(o, false)
    await act(() => result.current.handlers.deleteFolder('Hats'))
    expect(o.remove).not.toHaveBeenCalled()
  })

  it('toasts a refusal and reports a failed rename', async () => {
    const o = ops()
    o.rename.mockRejectedValue(new Error('taken'))
    const { result } = setup(o)
    let ok = true
    await act(async () => {
      ok = await result.current.handlers.renameFolder('Hats', 'Caps')
    })
    expect(ok).toBe(false)
    expect(showErrorToast).toHaveBeenCalledWith('The folder would not be renamed')
  })

  it('is a no-op with no container chosen', async () => {
    const { result } = setup(null)
    let ok = true
    await act(async () => {
      ok = await result.current.handlers.renameFolder('Hats', 'Caps')
    })
    expect(ok).toBe(false)
    expect(showSuccessToast).not.toHaveBeenCalled()
  })

  it('pluralizes counts', () => {
    expect(pluralize(1, 'object')).toBe('1 object')
    expect(pluralize(3, 'object')).toBe('3 objects')
  })
})
