/**
 * The wardrobe browser as a small file manager.
 *
 *  - the root lists subfolders first, then the root's items; entering a
 *    folder lists only its items, with a breadcrumb back;
 *  - a search ignores folders and shows each hit's folder;
 *  - tier rows appear only in a character's container;
 *  - select mode puts checkboxes only on manageable rows;
 *  - the Move-to-folder picker disables the folder the item is already in;
 *  - a click inside that picker does not close the dialog around the browser
 *    (bug 229: the picker must count as one of the actions' overlays).
 */

import React from 'react'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { WardrobeBrowser } from '@/components/wardrobe/WardrobeBrowser'
import { BaseModal } from '@/components/ui/BaseModal'
import type { WardrobeListData } from '@/components/wardrobe/hooks/useWardrobeListData'
import type { WardrobeItemActions } from '@/components/wardrobe/hooks/useWardrobeItemActions'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

const CHAR = 'char-1'
const OWN_ORIGIN = { scope: 'character' as const, id: CHAR, name: 'Alice' }
const PROJECT_ORIGIN = { scope: 'project' as const, id: 'proj-1', name: 'Blackwood' }

function item(id: string, title: string, folder: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    folder,
    types: ['top'],
    componentItemIds: [],
    isDefault: false,
    replace: false,
    characterId: CHAR,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    origin: OWN_ORIGIN,
    ...extra,
  }
}

const COAT = item('coat', 'Greatcoat', '')
const GOWN = item('gown', 'Evening Gown', 'Formal/Evening')
const GLOVES = item('gloves', 'Opera Gloves', 'Formal')
const BORROWED = item('cape', 'Project Cape', 'Capes', { characterId: null, origin: PROJECT_ORIGIN })

function makeData(items: ReturnType<typeof item>[], manage: (i: { characterId?: string | null }) => boolean): WardrobeListData {
  return {
    listItems: items as never,
    resolutionPool: items as never,
    characterItems: [],
    loading: false,
    projectId: null,
    canManage: manage as never,
  }
}

function makeActions(): WardrobeItemActions {
  const noop = jest.fn()
  return {
    editor: null,
    transfer: null,
    imageView: null,
    overlayOpen: false,
    updatingDefaultId: null,
    generatingImageIds: new Set(),
    toggleDefault: noop,
    toggleArchived: noop,
    remove: noop,
    duplicate: noop,
    generateImage: noop,
    openImage: noop,
    openEditor: noop,
    openCreate: jest.fn(),
    closeEditor: noop,
    move: noop,
    copy: noop,
    closeTransfer: noop,
    closeImage: noop,
    folderPicker: null,
    openFolderPicker: noop,
    closeFolderPicker: noop,
    addressOf: (i: { characterId?: string | null }) =>
      i.characterId ? { scope: 'character', id: i.characterId } : { scope: 'project', id: 'proj-1' },
    refresh: jest.fn(async () => {}),
    confirm: jest.fn(async () => true),
  } as unknown as WardrobeItemActions
}

function routeFetch(folders: Array<{ path: string; name: string; itemCount: number }>) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ folders }),
    text: async () => JSON.stringify({ folders }),
  })) as unknown as typeof fetch
}

/**
 * The browser inside a modal wired the way the Wardrobe dialog wires it
 * (`closeOnClickOutside={!actions.overlayOpen}`), with the picker state held
 * the way `useWardrobeItemActions` holds it.
 */
function Harness({
  container,
  data,
  base,
  onDialogClose,
}: {
  container: WardrobeContainer
  data: WardrobeListData
  base: WardrobeItemActions
  onDialogClose: () => void
}) {
  const [folderPicker, setFolderPicker] = React.useState<WardrobeItemActions['folderPicker']>(null)
  const actions = {
    ...base,
    folderPicker,
    overlayOpen: folderPicker !== null,
    openFolderPicker: (items: NonNullable<WardrobeItemActions['folderPicker']>['items']) => {
      if (items.length > 0) setFolderPicker({ items })
    },
    closeFolderPicker: () => setFolderPicker(null),
  } as WardrobeItemActions
  return (
    <BaseModal isOpen onClose={onDialogClose} title="Wardrobe" closeOnClickOutside={!actions.overlayOpen}>
      <WardrobeBrowser
        container={container}
        data={data}
        actions={actions}
        showArchived={false}
        onShowArchivedChange={jest.fn()}
      />
    </BaseModal>
  )
}

function renderBrowser(
  container: WardrobeContainer,
  data: WardrobeListData,
  actions = makeActions(),
  onDialogClose: () => void = jest.fn(),
) {
  renderWithQuery(<Harness container={container} data={data} base={actions} onDialogClose={onDialogClose} />)
  return actions
}

const characterContainer: WardrobeContainer = { scope: 'character', id: CHAR }
const projectContainer: WardrobeContainer = { scope: 'project', id: 'proj-1' }
const ownOnly = (i: { characterId?: string | null }) => Boolean(i.characterId)

const folderRows = () => screen.queryAllByTestId('wardrobe-folder-row')
const tierRowsShown = () => screen.queryAllByTestId('wardrobe-tier-row')

beforeEach(() => {
  routeFetch([
    { path: 'Formal', name: 'Formal', itemCount: 1 },
    { path: 'Formal/Evening', name: 'Evening', itemCount: 1 },
    { path: 'Rainy days', name: 'Rainy days', itemCount: 0 },
  ])
})

describe('WardrobeBrowser — folders', () => {
  it('lists the root’s subfolders (empty ones included) first, then the root’s items only', async () => {
    renderBrowser(characterContainer, makeData([COAT, GOWN, GLOVES], ownOnly))

    await waitFor(() => expect(folderRows()).toHaveLength(2))
    expect(folderRows().map((r) => r.textContent)).toEqual([
      expect.stringContaining('Formal'),
      expect.stringContaining('Rainy days'),
    ])
    expect(within(folderRows()[0]).getByText('1 item')).toBeInTheDocument()
    expect(screen.getByTitle('Greatcoat')).toBeInTheDocument()
    expect(screen.queryByTitle('Evening Gown')).toBeNull()
    expect(screen.queryByTitle('Opera Gloves')).toBeNull()
  })

  it('entering a folder lists its subfolders and its own items; the breadcrumb goes back', async () => {
    renderBrowser(characterContainer, makeData([COAT, GOWN, GLOVES], ownOnly))
    await waitFor(() => expect(folderRows()).toHaveLength(2))

    fireEvent.click(within(folderRows()[0]).getByText('Formal'))

    expect(await screen.findByTitle('Opera Gloves')).toBeInTheDocument()
    expect(screen.queryByTitle('Greatcoat')).toBeNull()
    expect(screen.queryByTitle('Evening Gown')).toBeNull()
    expect(folderRows().map((r) => r.textContent)).toEqual([expect.stringContaining('Evening')])

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Wardrobe folders' })).getByText('Wardrobe'))
    expect(await screen.findByTitle('Greatcoat')).toBeInTheDocument()
  })

  it('an empty folder says so', async () => {
    renderBrowser(characterContainer, makeData([COAT], ownOnly))
    await waitFor(() => expect(folderRows().length).toBeGreaterThan(0))
    fireEvent.click(screen.getByText('Rainy days'))
    expect(await screen.findByText('Nothing hangs here yet.')).toBeInTheDocument()
  })

  it('a search ignores folders and shows each hit’s folder', async () => {
    renderBrowser(characterContainer, makeData([COAT, GOWN, GLOVES], ownOnly))
    await waitFor(() => expect(folderRows()).toHaveLength(2))

    fireEvent.change(screen.getByLabelText('Search wardrobe by title'), { target: { value: 'o' } })

    expect(await screen.findByTitle('Evening Gown')).toBeInTheDocument()
    expect(screen.getByTitle('Opera Gloves')).toBeInTheDocument()
    expect(screen.getByTitle('Greatcoat')).toBeInTheDocument()
    expect(folderRows()).toHaveLength(0)
    expect(screen.getByText('Searching everywhere')).toBeInTheDocument()
    expect(screen.getAllByTestId('wardrobe-folder-crumb').map((c) => c.textContent).sort()).toEqual([
      'Formal',
      'Formal › Evening',
    ])
  })

  it('shows tier rows in a character’s container, never in a shared one', async () => {
    renderBrowser(characterContainer, makeData([COAT, BORROWED], ownOnly))
    await waitFor(() => expect(tierRowsShown()).toHaveLength(1))
    expect(tierRowsShown()[0].textContent).toContain('Project: Blackwood')
    // The borrowed item is in its tier, not at the closet's root.
    expect(screen.queryByTitle('Project Cape')).toBeNull()

    fireEvent.click(tierRowsShown()[0])
    // Inside the tier: its own folders, no filing controls.
    await waitFor(() => expect(folderRows()).toHaveLength(1))
    expect(folderRows()[0].textContent).toContain('Capes')
    expect(screen.queryByText('New folder')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull()
  })

  it('a shared container lists no tier rows', async () => {
    const shared = { ...BORROWED, folder: '' }
    renderBrowser(projectContainer, makeData([shared], () => true))
    expect(await screen.findByTitle('Project Cape')).toBeInTheDocument()
    expect(tierRowsShown()).toHaveLength(0)
  })

  it('select mode puts checkboxes only on manageable rows and shows the bar', async () => {
    const borrowedAtRoot = item('hat', 'Borrowed Hat', '', { characterId: null, origin: PROJECT_ORIGIN })
    // A view where a borrowed row sits beside an own one (a search).
    renderBrowser(characterContainer, makeData([COAT, borrowedAtRoot], ownOnly))
    await screen.findByTitle('Greatcoat')

    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    fireEvent.change(screen.getByLabelText('Search wardrobe by title'), { target: { value: 'a' } })

    expect(await screen.findByTitle('Borrowed Hat')).toBeInTheDocument()
    expect(screen.getByLabelText('Select Greatcoat')).toBeInTheDocument()
    expect(screen.queryByLabelText('Select Borrowed Hat')).toBeNull()

    fireEvent.click(screen.getByLabelText('Select Greatcoat'))
    expect(within(screen.getByTestId('wardrobe-select-bar')).getByText('1 selected')).toBeInTheDocument()
  })

  it('the picker disables the folder the item is already in', async () => {
    renderBrowser(characterContainer, makeData([COAT, GLOVES], ownOnly))
    await waitFor(() => expect(folderRows()).toHaveLength(2))
    fireEvent.click(within(folderRows()[0]).getByText('Formal'))
    await screen.findByTitle('Opera Gloves')

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to folder…' }))

    const list = await screen.findByRole('listbox', { name: 'Folders' })
    const formal = within(list).getByRole('option', { name: /Formal/ })
    expect(formal).toBeDisabled()
    expect(within(list).getByRole('option', { name: /top level/ })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled()
  })

  it('a click inside the picker does not close the dialog around the browser (bug 229)', async () => {
    const onDialogClose = jest.fn()
    renderBrowser(characterContainer, makeData([COAT, GLOVES], ownOnly), makeActions(), onDialogClose)
    await waitFor(() => expect(folderRows()).toHaveLength(2))
    fireEvent.click(within(folderRows()[0]).getByText('Formal'))
    await screen.findByTitle('Opera Gloves')

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to folder…' }))
    const list = await screen.findByRole('listbox', { name: 'Folders' })

    // A real click starts with mousedown, which is what the click-outside
    // handler listens for; fireEvent.click alone would never reach it.
    const topLevel = within(list).getByRole('option', { name: /top level/ })
    fireEvent.mouseDown(topLevel)
    fireEvent.click(topLevel)

    expect(onDialogClose).not.toHaveBeenCalled()
    expect(screen.getByRole('listbox', { name: 'Folders' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move' })).not.toBeDisabled()
  })
})
