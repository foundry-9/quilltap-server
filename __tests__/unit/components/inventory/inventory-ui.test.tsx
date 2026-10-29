/**
 * The Inventory UI (spec §5.9):
 *
 *  - the browser's Items / Kits / Archetypes filter, Equipped only (in a
 *    chat), the glyph (SVG → emoji → default, never the picture) and the
 *    chips;
 *  - the instance editor's Inherit toggle (unticking makes the archetype's
 *    value an override; re-ticking clears it on save);
 *  - the warnings: detach, an archetype in use (Detach all and delete), a
 *    cap breach;
 *  - the Carrying now pane.
 */

import React, { useState } from 'react'
import { screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { renderWithQuery, createQueryWrapper } from '../../../helpers/renderWithQuery'
import { InventoryBrowser } from '@/components/inventory/InventoryBrowser'
import { InventoryItemEditor } from '@/components/inventory/inventory-item-editor'
import { CarryingNowPane } from '@/components/inventory/CarryingNowPane'
import { useInventoryItemActions, describeInventoryRefusal } from '@/components/inventory/hooks/useInventoryItemActions'
import { InventoryRequestError } from '@/lib/hooks/use-inventory'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import type { InventoryItemActions } from '@/components/inventory/hooks/useInventoryItemActions'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))

const T = '2026-10-18T00:00:00.000Z'
const OWN = { scope: 'character' as const, id: 'c-viv', name: 'Vivienne' }
const PROJECT = { scope: 'project' as const, id: 'p-1', name: 'The Quest' }

function obj(id: string, fields: Partial<ResolvedInventoryItem> = {}): ResolvedInventoryItem {
  return {
    id,
    kind: 'item',
    name: id,
    title: null,
    description: null,
    imageDescription: null,
    equippedByDefault: false,
    maxEquipped: 1,
    canCopy: false,
    isArchetype: false,
    parentId: null,
    itemIds: [],
    metadata: {},
    folder: '',
    archivedAt: null,
    createdAt: T,
    updatedAt: T,
    origin: OWN,
    ...fields,
  }
}

const SWORD = obj('sword', { title: 'Excalibur', svg: '<svg viewBox="0 0 1 1"><rect/></svg>', imageFileId: 'f0000000-0000-4000-8000-000000000001' })
const RING = obj('ring', { name: 'signet ring', emoji: '💍', equippedByDefault: true })
const LAMP = obj('lamp', { name: 'lantern' })
const BOW = obj('bow', { name: 'magic bow', isArchetype: true, origin: PROJECT, description: 'Never misses.' })
const KIT = obj('kit', { name: "ranger's loadout", kind: 'kit', itemIds: ['bow', 'lamp'] })

function makeActions(overrides: Partial<InventoryItemActions> = {}): InventoryItemActions {
  const noop = jest.fn()
  return {
    mutations: { createFolder: jest.fn(), renameFolder: jest.fn(), deleteFolder: jest.fn(), pending: false } as never,
    addressOf: () => ({ scope: 'character', id: 'c-viv' }),
    requestConfirmation: jest.fn(async () => true),
    requestAlert: jest.fn(async () => undefined),
    overlayOpen: false,
    editor: null,
    openCreate: noop,
    openEditor: noop,
    closeEditor: noop,
    folderPicker: null,
    openFolderPicker: noop,
    closeFolderPicker: noop,
    transfer: null,
    openTransfer: noop,
    closeTransfer: noop,
    instantiateFor: null,
    openInstantiateArchetype: noop,
    openInstantiateInto: noop,
    closeInstantiate: noop,
    detach: jest.fn(),
    remove: jest.fn(),
    toggleArchived: jest.fn(),
    duplicate: jest.fn(),
    ...overrides,
  } as unknown as InventoryItemActions
}

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ folders: [], items: [], images: [], current: null }),
    text: async () => '{}',
  })) as unknown as typeof fetch
})

describe('InventoryBrowser', () => {
  const data = {
    items: [SWORD, RING, LAMP, BOW, KIT],
    loading: false,
    canManage: (i: ResolvedInventoryItem) => i.origin?.scope === 'character',
  }
  const renderBrowser = (equip?: Parameters<typeof InventoryBrowser>[0]['equip']) =>
    renderWithQuery(
      <InventoryBrowser
        container={{ scope: 'character', id: 'c-viv' }}
        data={data}
        actions={makeActions()}
        showArchived={false}
        onShowArchivedChange={jest.fn()}
        equip={equip}
      />,
    )
  const rows = () => screen.queryAllByTestId('inventory-item-row')

  it('filters Items / Kits / Archetypes, and shows the glyph, never the picture', async () => {
    renderBrowser()
    expect(rows()).toHaveLength(3)
    expect(screen.getByText('Excalibur')).toBeInTheDocument()
    expect(screen.getByTestId('inventory-glyph-svg')).toBeInTheDocument()
    expect(screen.getByTestId('inventory-glyph-emoji')).toHaveTextContent('💍')
    expect(screen.getAllByTestId('inventory-glyph-default')).toHaveLength(1)
    expect(screen.queryByTestId('inventory-picture')).toBeNull()
    expect(screen.getByText('Default')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Kits' }))
    expect(rows()).toHaveLength(1)
    expect(screen.getByText(/Kit · 2/)).toBeInTheDocument()

    // The project archetype is borrowed: it sits behind its tier row.
    fireEvent.click(screen.getByRole('tab', { name: 'Archetypes' }))
    fireEvent.click(screen.getByTestId('inventory-tier-row'))
    expect(await screen.findByText('Archetype')).toBeInTheDocument()
  })

  it('in a chat: Equipped only, the Equipped chip and a kit\'s state', () => {
    renderBrowser({
      carried: { equipped: [RING], kits: { kit: 'some' } },
      onEquip: jest.fn(),
      onUnequip: jest.fn(),
    })
    fireEvent.click(screen.getByLabelText('Equipped only'))
    expect(rows()).toHaveLength(1)
    expect(within(rows()[0]).getByText('Equipped')).toBeInTheDocument()
    expect(within(rows()[0]).getByRole('button', { name: 'Unequip' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Kits' }))
    expect(screen.getByText('Kit · some')).toBeInTheDocument()
  })
})

describe('the instance editor', () => {
  it('shows the archetype value greyed under Inherit; unticking makes it an override, re-ticking clears it', async () => {
    const instance = obj('i-1', { parentId: 'bow', name: 'magic bow', description: 'Never misses.', overriddenFields: ['title'], title: 'Heartseeker', parentName: 'magic bow' })
    const update = jest.fn(async () => instance)
    const clearOverrides = jest.fn(async () => instance)
    const actions = makeActions({ mutations: { update, clearOverrides, pending: false } as never })
    renderWithQuery(
      <InventoryItemEditor
        container={{ scope: 'character', id: 'c-viv' }}
        containerLabel="Vivienne's inventory"
        item={instance}
        poolItems={[BOW]}
        actions={actions}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    )
    const description = screen.getByLabelText('What the characters know about it') as HTMLTextAreaElement
    expect(description.value).toBe('Never misses.')
    expect(screen.getByLabelText('Inherit description')).toBeChecked()
    expect(screen.getByLabelText('Inherit title')).not.toBeChecked()

    // Untick: the archetype's words become this instance's own, to edit.
    fireEvent.click(screen.getByLabelText('Inherit description'))
    fireEvent.change(description, { target: { value: 'Mine now.' } })
    // Re-tick the title: its override is cleared on save.
    fireEvent.click(screen.getByLabelText('Inherit title'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0][2]).toEqual({ folder: '', description: 'Mine now.' })
    expect(clearOverrides).toHaveBeenCalledWith({ scope: 'character', id: 'c-viv' }, 'i-1', ['title'])
  })
})

describe('the warnings', () => {
  function hook(remove: jest.Mock, detachMutation = jest.fn()) {
    const requestConfirmation = jest.fn(async () => true)
    const requestAlert = jest.fn(async () => 'Detach all and delete')
    const { result } = renderHook(
      () => useInventoryItemActions({ container: { scope: 'project', id: 'p-1' }, requestConfirmation, requestAlert }),
      { wrapper: createQueryWrapper().wrapper },
    )
    // Swap the network for the test's spies.
    Object.assign(result.current.mutations, { remove, detach: detachMutation })
    return { result, requestConfirmation, requestAlert }
  }

  it('detach warns that later archetype edits will not reach it', async () => {
    const detachMutation = jest.fn(async () => ({}))
    const { result, requestConfirmation } = hook(jest.fn(), detachMutation)
    await act(() => result.current.detach(obj('i-1', { parentId: 'bow', parentName: 'Magic bow' })))
    expect(requestConfirmation).toHaveBeenCalledWith(expect.stringContaining('stop following "Magic bow"'))
    expect(detachMutation).toHaveBeenCalled()
  })

  it('an archetype in use names the count and holders, then detaches all and deletes', async () => {
    const remove = jest
      .fn()
      .mockRejectedValueOnce(new InventoryRequestError('2 objects derive from it', 409, 'ARCHETYPE_IN_USE', {
        dependents: 2,
        holders: [{ ownerName: 'Vivienne' }, { ownerName: 'Bertie' }],
      }))
      .mockResolvedValueOnce({ success: true })
    const { result, requestAlert } = hook(remove)
    await act(() => result.current.remove(obj('bow', { isArchetype: true, origin: PROJECT })))
    expect(requestAlert).toHaveBeenCalledWith(expect.stringContaining('2 objects derive'), ['Detach all and delete', 'Cancel'])
    expect(requestAlert.mock.calls[0][0]).toContain('Vivienne, Bertie')
    expect(remove).toHaveBeenLastCalledWith({ scope: 'project', id: 'p-1' }, 'bow', true)
  })

  it('archived holders block the delete, by name', async () => {
    const remove = jest.fn().mockRejectedValueOnce(
      new InventoryRequestError('sealed', 409, 'ARCHIVED_DEPENDENTS', { characters: [{ name: 'Ghost' }] }),
    )
    const { result, requestAlert } = hook(remove)
    await act(() => result.current.remove(obj('bow', { isArchetype: true, origin: PROJECT })))
    expect(requestAlert).toHaveBeenCalledWith(expect.stringContaining('Ghost'), ['Understood'])
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('a cap breach names the object and the cap', () => {
    const error = new InventoryRequestError('x', 409, 'CAP_EXCEEDED', { itemName: 'ring', cap: 2 })
    expect(describeInventoryRefusal(error, '')).toBe('"ring" can be carried at most 2 at a time — set one down before taking up another.')
  })

  it('a copy refusal says why in words, never in ids', () => {
    const one = new InventoryRequestError('Cannot be copied: a1', 409, 'NOT_COPYABLE', { itemIds: ['a1'] })
    expect(describeInventoryRefusal(one, '')).toContain('one of a kind')
    expect(describeInventoryRefusal(one, '')).not.toContain('a1')
    const two = new InventoryRequestError('Cannot be copied: a1, b2', 409, 'NOT_COPYABLE', { itemIds: ['a1', 'b2'] })
    expect(describeInventoryRefusal(two, '')).toMatch(/^2 of those objects/)
  })
})

describe('Carrying now', () => {
  it('lists what is carried, the kits with their state, and offers Take up and Reset', () => {
    const onEquip = jest.fn()
    const onUnequip = jest.fn()
    const onReset = jest.fn()
    function Harness() {
      const [picking, setPicking] = useState(false)
      return (
        <CarryingNowPane
        characterName="Vivienne"
        carried={{ equipped: [RING], kits: { kit: 'some' } }}
        pool={[SWORD, RING, LAMP, BOW, KIT]}
        busy={false}
        onEquip={onEquip}
        onUnequip={onUnequip}
        onReset={onReset}
          picking={picking}
          onPickingChange={setPicking}
        />
      )
    }
    renderWithQuery(<Harness />)
    const carried = screen.getByRole('list', { name: 'Carried objects' })
    expect(within(carried).getByText('signet ring')).toBeInTheDocument()
    fireEvent.click(within(carried).getByRole('button', { name: 'Unequip' }))
    expect(onUnequip).toHaveBeenCalledWith(['ring'])

    const kits = screen.getByRole('list', { name: 'Kits' })
    expect(within(kits).getByText('some')).toBeInTheDocument()
    fireEvent.click(within(kits).getByRole('button', { name: 'Equip' }))
    expect(onEquip).toHaveBeenCalledWith(['kit'])

    fireEvent.click(screen.getByRole('button', { name: 'Take up…' }))
    const picker = screen.getByRole('listbox', { name: 'Objects within reach' })
    // Pictures show in the picker; archetypes, kits and what is carried do not.
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Excalibur (sword)', 'lantern'])
    expect(within(picker).getByTestId('inventory-picture')).toBeInTheDocument()
    // The picker can be dismissed without choosing.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('listbox', { name: 'Objects within reach' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(onReset).toHaveBeenCalled()
  })
})
