'use client'

/**
 * The Atlas dialog — the operator's register of the named things of a story
 * that are not characters: a vehicle, a house, a device, a place.
 *
 * A container select covers every tier an entry can live in (a character's
 * vault, Quilltap General, a project, a group); below it is the Atlas browser
 * for that tier. Opened from a Salon chat it browses the chat's project, or
 * General when the chat has none. It is browse-and-edit only: nothing here is
 * chat-scoped, and characters have no tools for it.
 *
 * Mounted once at the layout level by `AtlasDialogProvider`; also rendered
 * bare as the workspace `'atlas'` tab (`AtlasView`) and pinned to one tier as
 * a card (`AtlasPanel`, Prospero's project page).
 *
 * @module components/atlas/atlas-control-dialog
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useAtlasDialog } from '@/components/providers/atlas-dialog-provider'
import { useOnTabActivated } from '@/components/workspace/workspace-tab-context'
import { GENERAL_ATLAS_CONTAINER, containerOfAtlasOrigin, type AtlasContainer } from '@/lib/atlas/container'
import type { AtlasDialogContext } from '@/components/providers/item-dialog-provider'
import { ItemControlDialogShell, useItemControlState } from '@/components/item-browser/ItemControlDialogShell'
import { AtlasBrowser } from './AtlasBrowser'
import { AtlasEntryEditor } from './atlas-entry-editor'
import { AtlasTransferDialog } from './AtlasTransferDialog'
import { ItemImageViewer } from '@/components/item-browser/ItemImageViewer'
import { useAtlasListData } from './hooks/useAtlasListData'
import { useAtlasEntryActions } from './hooks/useAtlasEntryActions'

/**
 * The tier an opener names: a character, a group, a project — and with
 * nothing named (or a chat outside any project), Quilltap General, where most
 * of a world's things are kept.
 */
export function atlasContainerForContext(ctx: AtlasDialogContext | null | undefined): AtlasContainer {
  if (ctx?.characterId) return { scope: 'character', id: ctx.characterId }
  if (ctx?.groupId) return { scope: 'group', id: ctx.groupId }
  if (ctx?.projectId) return { scope: 'project', id: ctx.projectId }
  return GENERAL_ATLAS_CONTAINER
}

/** The layout-level dialog: renders the body only while open. */
export function AtlasControlDialog() {
  const dialog = useAtlasDialog()
  if (!dialog.isOpen) return null
  const ctx = dialog.context
  return (
    <AtlasControlDialogInner
      key={`${ctx?.characterId ?? ''}|${ctx?.chatId ?? ''}|${ctx?.projectId ?? ''}|${ctx?.groupId ?? ''}`}
      initialContainer={atlasContainerForContext(ctx)}
      onClose={dialog.close}
    />
  )
}

/** The Atlas as a workspace tab: browse and edit. */
export function AtlasView({ characterId, projectId }: { characterId?: string; projectId?: string }) {
  return (
    <AtlasControlDialogInner
      asTab
      initialContainer={atlasContainerForContext({ characterId, projectId })}
      onClose={() => {}}
    />
  )
}

/** The Atlas pinned to one tier, for a card (Prospero's project page). */
export function AtlasPanel({ container }: { container: AtlasContainer }) {
  return <AtlasControlDialogInner asTab fixedContainer initialContainer={container} onClose={() => {}} />
}

interface InnerProps {
  initialContainer: AtlasContainer
  onClose: () => void
  asTab?: boolean
  /** Hide the container select (a card shows one tier). */
  fixedContainer?: boolean
}

function AtlasControlDialogInner({ initialContainer, onClose, asTab = false, fixedContainer = false }: InnerProps) {
  const state = useItemControlState('atlas', initialContainer)
  const { catalogue, container, containerLabel, requestConfirmation, requestAlert } = state
  const queryClient = useQueryClient()
  const [showArchived, setShowArchived] = useState(false)
  const data = useAtlasListData(container, { includeArchived: showArchived })
  const actions = useAtlasEntryActions({ container, requestConfirmation, requestAlert })
  useOnTabActivated(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.atlas.all })
  })

  const { editor, imageView } = actions
  const overlays = (
    <>
      {/* A row's picture, full screen — above the dialog and the editor */}
      {imageView?.entry.imageFileId && (
        <ItemImageViewer
          kind="atlas"
          onClose={actions.closeImage}
          itemId={imageView.entry.id}
          itemTitle={imageView.entry.name}
          container={imageView.container}
          fileId={imageView.entry.imageFileId}
        />
      )}
      {editor && container && (
        <AtlasEntryEditor
          container={editor.kind === 'edit' ? containerOfAtlasOrigin(editor.entry.origin, container) : container}
          containerLabel={containerLabel}
          entry={editor.kind === 'edit' ? editor.entry : null}
          initialFolder={editor.kind === 'create' ? editor.folder : undefined}
          actions={actions}
          onClose={actions.closeEditor}
          onSaved={actions.closeEditor}
        />
      )}
      {actions.transfer && container && (
        <AtlasTransferDialog
          entry={actions.transfer.item}
          mode={actions.transfer.mode}
          from={actions.addressOf(actions.transfer.item)}
          catalogue={catalogue}
          actions={actions}
          onClose={actions.closeTransfer}
        />
      )}
    </>
  )

  return (
    <ItemControlDialogShell
      kind="atlas"
      state={state}
      asTab={asTab}
      fixedContainer={fixedContainer}
      onClose={onClose}
      overlayOpen={actions.overlayOpen}
      overlays={overlays}
    >
      <AtlasBrowser
        container={container}
        data={data}
        actions={actions}
        showArchived={showArchived}
        onShowArchivedChange={setShowArchived}
        scrollList={!fixedContainer}
      />
    </ItemControlDialogShell>
  )
}
