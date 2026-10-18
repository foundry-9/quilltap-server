'use client'

/**
 * The Inventory dialog — Pascal the Croupier's table of things to carry.
 *
 * A container select covers every tier an object can live in (a character's
 * vault, Quilltap General, a project, a group); the left column is the
 * Inventory browser for it. Opened from a chat with a character chosen, rows
 * gain Equip / Unequip and a right-hand *Carrying now* pane shows what that
 * cast member carries there, with the kits' states and *Reset to defaults*.
 * Out of a chat (the workspace tab, the Prospero card) it is browse-and-edit
 * only.
 *
 * Mounted once at the layout level by `InventoryDialogProvider`; also
 * rendered bare as the workspace `'inventory'` tab (`InventoryView`).
 *
 * @module components/inventory/inventory-control-dialog
 */

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import { BaseModal } from '@/components/ui/BaseModal'
import { showAlert, showConfirmation } from '@/lib/alert'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useInventoryDialog } from '@/components/providers/inventory-dialog-provider'
import { useOnTabActivated } from '@/components/workspace/workspace-tab-context'
import { useQueryClient } from '@tanstack/react-query'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import {
  GENERAL_INVENTORY_CONTAINER,
  GENERAL_INVENTORY_NAME,
  containerOfOrigin,
  decodeInventoryContainer,
  encodeInventoryContainer,
  type InventoryContainer,
} from '@/lib/inventory/container'
import { InventoryRequestError, useChatInventory } from '@/lib/hooks/use-inventory'
import { InventoryBrowser } from './InventoryBrowser'
import { CarryingNowPane } from './CarryingNowPane'
import { InventoryItemEditor } from './inventory-item-editor'
import { InventoryTransferDialog, type InventoryCatalogue } from './InventoryTransferDialog'
import { InventoryInstantiateDialog } from './InventoryInstantiateDialog'
import { InventoryFolderPickerDialog } from './InventoryFolderPickerDialog'
import { useInventoryListData } from './hooks/useInventoryListData'
import { describeInventoryRefusal, useInventoryItemActions } from './hooks/useInventoryItemActions'

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name)

/** Every place an object can live, for the container select. */
function useInventoryCatalogue(): InventoryCatalogue & { charactersSettled: boolean } {
  const characters = useQuery({
    queryKey: queryKeys.characters.list(),
    queryFn: ({ signal }) => apiFetch<{ characters?: Array<{ id: string; name: string }> }>('/api/v1/characters', { signal }),
  })
  const projects = useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: ({ signal }) => apiFetch<{ projects?: Array<{ id: string; name: string }> }>('/api/v1/projects', { signal }),
  })
  const groups = useQuery({
    queryKey: queryKeys.groups.list(),
    queryFn: ({ signal }) => apiFetch<{ groups?: Array<{ id: string; name: string }> }>('/api/v1/groups', { signal }),
  })
  return {
    characters: useMemo(() => [...(characters.data?.characters ?? [])].sort(byName), [characters.data]),
    charactersSettled: characters.isFetched,
    projects: useMemo(
      () => (projects.data?.projects ?? []).map((p) => ({ id: p.id, name: p.name || 'Untitled project' })).sort(byName),
      [projects.data],
    ),
    groups: useMemo(
      () => (groups.data?.groups ?? []).map((g) => ({ id: g.id, name: g.name || 'Untitled group' })).sort(byName),
      [groups.data],
    ),
  }
}

/** The layout-level dialog: renders the body only while open. */
export function InventoryControlDialog() {
  const dialog = useInventoryDialog()
  if (!dialog.isOpen) return null
  const ctx = dialog.context
  return (
    <InventoryControlDialogInner
      key={`${ctx?.characterId ?? ''}|${ctx?.chatId ?? ''}|${ctx?.projectId ?? ''}|${ctx?.groupId ?? ''}`}
      initialContainer={
        ctx?.characterId
          ? { scope: 'character', id: ctx.characterId }
          : ctx?.groupId
            ? { scope: 'group', id: ctx.groupId }
            : ctx?.projectId && !ctx.chatId
              ? { scope: 'project', id: ctx.projectId }
              : null
      }
      chatId={ctx?.chatId ?? null}
      projectId={ctx?.projectId ?? null}
      onClose={dialog.close}
    />
  )
}

/** The Inventory as a workspace tab: browse and edit, no chat. */
export function InventoryView({ characterId, projectId }: { characterId?: string; projectId?: string }) {
  return (
    <InventoryControlDialogInner
      asTab
      initialContainer={
        characterId ? { scope: 'character', id: characterId } : projectId ? { scope: 'project', id: projectId } : null
      }
      chatId={null}
      projectId={projectId ?? null}
      onClose={() => {}}
    />
  )
}

/** The Inventory pinned to one tier, for a card (Prospero's project page). */
export function InventoryPanel({ container, projectId }: { container: InventoryContainer; projectId?: string | null }) {
  return (
    <InventoryControlDialogInner
      asTab
      fixedContainer
      initialContainer={container}
      chatId={null}
      projectId={projectId ?? null}
      onClose={() => {}}
    />
  )
}

interface InnerProps {
  initialContainer: InventoryContainer | null
  chatId: string | null
  /** The project tier for a character's pool (a chat's project, or the card's). */
  projectId: string | null
  onClose: () => void
  asTab?: boolean
  /** Hide the container select (a card shows one tier). */
  fixedContainer?: boolean
}

function InventoryControlDialogInner({ initialContainer, chatId, projectId, onClose, asTab = false, fixedContainer = false }: InnerProps) {
  const catalogue = useInventoryCatalogue()
  const queryClient = useQueryClient()
  const [chosen, setChosen] = useState<InventoryContainer | null>(initialContainer)
  const firstCharacterId = catalogue.characters[0]?.id ?? null
  const container = useMemo<InventoryContainer | null>(
    () =>
      chosen ??
      (catalogue.charactersSettled ? (firstCharacterId ? { scope: 'character', id: firstCharacterId } : GENERAL_INVENTORY_CONTAINER) : null),
    [chosen, catalogue.charactersSettled, firstCharacterId],
  )
  const characterId = container?.scope === 'character' ? container.id : null
  const [showArchived, setShowArchived] = useState(false)
  const chat = useChatInventory(chatId)
  // A chat names its own project tier; otherwise the opener's.
  const effectiveProjectId = chat.projectId ?? projectId
  const data = useInventoryListData(container, { includeArchived: showArchived, projectId: effectiveProjectId })

  const [confirming, setConfirming] = useState(false)
  const requestConfirmation = useCallback(async (message: string) => {
    setConfirming(true)
    try {
      return await showConfirmation(message)
    } finally {
      setConfirming(false)
    }
  }, [])
  const requestAlert = useCallback(async (message: string, buttons?: string[]) => {
    setConfirming(true)
    try {
      return await showAlert(message, buttons)
    } finally {
      setConfirming(false)
    }
  }, [])
  const actions = useInventoryItemActions({ container, requestConfirmation, requestAlert })
  useOnTabActivated(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
  })

  const characterName = catalogue.characters.find((c) => c.id === characterId)?.name ?? 'this character'
  const carried = chat.carriedBy(characterId)

  const gesture = useCallback(
    async (kind: 'equip' | 'unequip', ids: string[]) => {
      if (!characterId) return
      try {
        const result = (kind === 'equip' ? await chat.equip(characterId, ids) : await chat.unequip(characterId, ids)) as {
          skipped?: Array<{ reason: string }>
          created?: unknown[]
        }
        if (result.skipped && result.skipped.length > 0) {
          showSuccessToast(`Done — ${result.skipped.length} kit member${result.skipped.length === 1 ? '' : 's'} could not be carried and stayed behind`)
        }
      } catch (error) {
        const message = describeInventoryRefusal(error, `The object would not ${kind}`)
        if (error instanceof InventoryRequestError && error.code === 'CAP_EXCEEDED') await requestAlert(message, ['Understood'])
        else showErrorToast(message)
      }
    },
    [characterId, chat, requestAlert],
  )

  const reset = useCallback(async () => {
    if (!characterId) return
    if (!(await requestConfirmation(`Put back everything ${characterName} carries here and start again from their equipped-by-default objects?`))) return
    try {
      await chat.resetToDefaults(characterId)
      showSuccessToast(`${characterName} is carrying their defaults again`)
    } catch (error) {
      showErrorToast(describeInventoryRefusal(error, 'The inventory would not reset'))
    }
  }, [characterId, characterName, chat, requestConfirmation])

  const containerLabel = useMemo(() => {
    if (!container) return ''
    switch (container.scope) {
      case 'character':
        return `${catalogue.characters.find((c) => c.id === container.id)?.name ?? 'this character'}'s inventory`
      case 'general':
        return GENERAL_INVENTORY_NAME
      case 'project':
        return catalogue.projects.find((p) => p.id === container.id)?.name ?? 'this project'
      case 'group':
        return catalogue.groups.find((g) => g.id === container.id)?.name ?? 'this group'
    }
  }, [container, catalogue])

  const editorContainer = (item: ResolvedInventoryItem | null) =>
    item && container ? containerOfOrigin(item.origin, container) : container
  const inChat = chatId !== null && characterId !== null
  const overlayOpen = actions.overlayOpen

  const body = (
    <>
      {!fixedContainer && (
        <div className="flex flex-col gap-2 mb-3">
          <div className="flex items-center gap-2">
            <label htmlFor="inventory-container-select" className="text-sm qt-text-secondary">Inventory:</label>
            <select
              id="inventory-container-select"
              className="qt-select flex-1 max-w-md"
              value={container ? encodeInventoryContainer(container) : ''}
              onChange={(e) => setChosen(decodeInventoryContainer(e.target.value))}
            >
              {!container && <option value="" disabled>Select an inventory</option>}
              {catalogue.characters.length > 0 && (
                <optgroup label="Characters">
                  {catalogue.characters.map((c) => (
                    <option key={c.id} value={encodeInventoryContainer({ scope: 'character', id: c.id })}>{c.name}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="General">
                <option value={encodeInventoryContainer(GENERAL_INVENTORY_CONTAINER)}>{GENERAL_INVENTORY_NAME}</option>
              </optgroup>
              {catalogue.projects.length > 0 && (
                <optgroup label="Projects">
                  {catalogue.projects.map((p) => (
                    <option key={p.id} value={encodeInventoryContainer({ scope: 'project', id: p.id })}>{p.name}</option>
                  ))}
                </optgroup>
              )}
              {catalogue.groups.length > 0 && (
                <optgroup label="Groups">
                  {catalogue.groups.map((g) => (
                    <option key={g.id} value={encodeInventoryContainer({ scope: 'group', id: g.id })}>{g.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {container && container.scope !== 'character' && (
            <p className="qt-text-xs qt-text-secondary px-1">
              A shared inventory — every character who can reach this {container.scope === 'general' ? 'library' : container.scope} can carry
              what is here, and its archetypes can be instantiated by any of them.
            </p>
          )}
        </div>
      )}
      <div className={`grid gap-4 ${inChat ? 'md:grid-cols-2' : ''}`}>
        <InventoryBrowser
          container={container}
          data={data}
          actions={actions}
          showArchived={showArchived}
          onShowArchivedChange={setShowArchived}
          scrollList={!fixedContainer}
          equip={
            inChat
              ? {
                  carried,
                  onEquip: (item) => void gesture('equip', [item.id]),
                  onUnequip: (item) => void gesture('unequip', [item.id]),
                }
              : undefined
          }
        />
        {inChat && (
          <CarryingNowPane
            characterName={characterName}
            carried={carried}
            pool={data.items}
            busy={chat.pending}
            onEquip={(ids) => void gesture('equip', ids)}
            onUnequip={(ids) => void gesture('unequip', ids)}
            onReset={() => void reset()}
          />
        )}
      </div>
    </>
  )

  const editor = actions.editor
  const overlays = (
    <>
      {editor && container && (
        <InventoryItemEditor
          container={editorContainer(editor.kind === 'edit' ? editor.item : null) as InventoryContainer}
          containerLabel={containerLabel}
          item={editor.kind === 'edit' ? editor.item : null}
          createMode={editor.kind === 'create' ? editor.mode : undefined}
          initialFolder={editor.kind === 'create' ? editor.folder : undefined}
          poolItems={data.items}
          projectId={effectiveProjectId}
          actions={actions}
          onClose={actions.closeEditor}
          onSaved={actions.closeEditor}
        />
      )}
      {actions.folderPicker && container && (
        <InventoryFolderPickerDialog
          container={actions.addressOf(actions.folderPicker.items[0])}
          items={actions.folderPicker.items}
          actions={actions}
          onClose={actions.closeFolderPicker}
        />
      )}
      {actions.transfer && container && (
        <InventoryTransferDialog
          item={actions.transfer.item}
          mode={actions.transfer.mode}
          from={actions.addressOf(actions.transfer.item)}
          catalogue={catalogue}
          actions={actions}
          onClose={actions.closeTransfer}
        />
      )}
      {actions.instantiateFor && (
        <InventoryInstantiateDialog
          {...('archetype' in actions.instantiateFor
            ? { archetype: actions.instantiateFor.archetype }
            : { destination: { container: actions.instantiateFor.destination, folder: actions.instantiateFor.folder } })}
          projectId={effectiveProjectId}
          catalogue={catalogue}
          actions={actions}
          onClose={actions.closeInstantiate}
        />
      )}
    </>
  )

  if (asTab) {
    return (
      <div className={fixedContainer ? 'flex flex-col min-h-0' : 'qt-inventory-tab flex flex-col h-full min-h-0 overflow-y-auto p-4'}>
        {body}
        {overlays}
      </div>
    )
  }
  return (
    <>
      <BaseModal
        isOpen
        onClose={onClose}
        title="Inventory"
        maxWidth="4xl"
        showCloseButton
        closeOnClickOutside={!overlayOpen && !confirming}
        closeOnEscape={!overlayOpen && !confirming}
        footer={(
          <div className="flex items-center justify-end gap-2 w-full">
            <button type="button" onClick={onClose} className="qt-button-secondary qt-button-sm">Done</button>
          </div>
        )}
      >
        {body}
      </BaseModal>
      {overlays}
    </>
  )
}
