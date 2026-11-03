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

import { useCallback, useState } from 'react'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useInventoryDialog } from '@/components/providers/inventory-dialog-provider'
import { useOnTabActivated } from '@/components/workspace/workspace-tab-context'
import { useQueryClient } from '@tanstack/react-query'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import { containerOfOrigin, type InventoryContainer } from '@/lib/inventory/container'
import { InventoryRequestError, useChatInventory } from '@/lib/hooks/use-inventory'
import { InventoryBrowser } from './InventoryBrowser'
import { CarryingNowPane } from './CarryingNowPane'
import { InventoryItemEditor } from './inventory-item-editor'
import { InventoryTransferDialog } from './InventoryTransferDialog'
import { ItemControlDialogShell, useItemControlState } from '@/components/item-browser/ItemControlDialogShell'
import { InventoryInstantiateDialog } from './InventoryInstantiateDialog'
import { useInventoryListData } from './hooks/useInventoryListData'
import { describeInventoryRefusal, useInventoryItemActions } from './hooks/useInventoryItemActions'

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
  const state = useItemControlState('inventory', initialContainer)
  const { catalogue, container, containerLabel, requestConfirmation, requestAlert } = state
  const queryClient = useQueryClient()
  const characterId = container?.scope === 'character' ? container.id : null
  const [showArchived, setShowArchived] = useState(false)
  const chat = useChatInventory(chatId)
  // A chat names its own project tier; otherwise the opener's.
  const effectiveProjectId = chat.projectId ?? projectId
  const data = useInventoryListData(container, { includeArchived: showArchived, projectId: effectiveProjectId })

  const [picking, setPicking] = useState(false)
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

  const editorContainer = (item: ResolvedInventoryItem | null) =>
    item && container ? containerOfOrigin(item.origin, container) : container
  const inChat = chatId !== null && characterId !== null
  const overlayOpen = actions.overlayOpen || picking

  const body = (
    <>
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
            picking={picking}
            onPickingChange={setPicking}
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

  return (
    <ItemControlDialogShell
      kind="inventory"
      state={state}
      asTab={asTab}
      fixedContainer={fixedContainer}
      onClose={onClose}
      overlayOpen={overlayOpen}
      overlays={overlays}
    >
      {body}
    </ItemControlDialogShell>
  )
}
