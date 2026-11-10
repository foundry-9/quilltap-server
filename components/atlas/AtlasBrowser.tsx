'use client'

/**
 * The Atlas browser — one tier's entries as a small file manager, laid out
 * like the Inventory's (and built from the same `components/item-browser`
 * pieces): a search box that looks everywhere (names, aliases and graphic
 * prompts), *Show archived*, the breadcrumb and folder rows, select mode with
 * *Move / Copy to folder…*, and the rows themselves. The view state and
 * layout are the shared `useFolderBrowserState` / `FolderBrowserShell`; this
 * file adds the Atlas's rows and wording.
 *
 * Folders are the operator's filing (an entry's folder is its path under
 * `Atlas/`); they never change who is told what.
 *
 * @module components/atlas/AtlasBrowser
 */

import { useCallback, useMemo, useState } from 'react'
import type { AtlasEntryWithOrigin } from '@/lib/schemas/atlas.types'
import { encodeAtlasContainer, type AtlasContainer } from '@/lib/atlas/container'
import { folderCrumb } from '@/lib/atlas/folders'
import { OWN_TIER } from '@/lib/folder-browser/view'
import { useAtlasFolders } from '@/lib/hooks/use-atlas'
import { ItemFolderPickerDialog, type ItemFolderPickerWording } from '@/components/item-browser/ItemFolderPickerDialog'
import { FolderBrowserShell } from '@/components/item-browser/FolderBrowserShell'
import { useFolderBrowserState, useItemFolderHandlers } from '@/components/item-browser/useFolderBrowserState'
import type { AtlasListData } from './hooks/useAtlasListData'
import type { AtlasEntryActions } from './hooks/useAtlasEntryActions'
import { describeAtlasRefusal } from './hooks/useAtlasEntryActions'
import { AtlasEntryRow } from './atlas-entry-row'

export interface AtlasBrowserProps {
  container: AtlasContainer | null
  data: AtlasListData
  actions: AtlasEntryActions
  showArchived: boolean
  onShowArchivedChange: (next: boolean) => void
  /** Cap the list's height (the dialog) instead of letting it grow (a card). */
  scrollList?: boolean
}

const ATLAS_PICKER_WORDING: ItemFolderPickerWording = {
  rootLabel: 'Atlas (top level)',
  noun: 'entry',
  rootPhrase: 'the front of the atlas',
  rests: ['rests', 'rest'],
  moveNote: 'Folders are for your browsing; who is told of an entry stays exactly as it was.',
  copyNote: 'Each copy is a new entry of its own, under a fresh name.',
  describeError: describeAtlasRefusal,
}

/** Every term an entry answers to, and how it looks, for the search box. */
function haystackOf(entry: AtlasEntryWithOrigin): string {
  return [entry.name, ...(entry.aliases ?? []), entry.graphicPrompt ?? ''].join(' ').toLowerCase()
}

export function AtlasBrowser({
  container,
  data,
  actions,
  showArchived,
  onShowArchivedChange,
  scrollList = true,
}: AtlasBrowserProps) {
  const { entries, loading, canManage } = data
  const [search, setSearch] = useState('')
  const searching = search.trim().length > 0

  const { folders: tree } = useAtlasFolders(container)
  const tierOf = useCallback(() => OWN_TIER, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return entries
      .filter((entry) => !term || haystackOf(entry).includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [entries, search])

  const state = useFolderBrowserState({
    containerKey: container ? encodeAtlasContainer(container) : '',
    items: entries,
    filtered,
    tree,
    tierOf,
    characterView: false,
    showShared: false,
    searching,
  })
  const { inOwnTier, currentFolder, selectMode, selectedIds, setSelectMode } = state
  const picker = actions.folderPicker

  const folderHandlers = useItemFolderHandlers({
    state,
    ops: container
      ? {
          create: (path) => actions.mutations.createFolder(container, path),
          rename: (path, name) => actions.mutations.renameFolder(container, path, name),
          remove: (path) => actions.mutations.deleteFolder(container, path),
        }
      : null,
    wording: {
      noun: 'entry',
      rootPhrase: 'the front of the atlas',
      created: (name) => `The folder "${name}" is bound into the atlas`,
      movedUp: (count) => `Folder removed; ${count} moved up`,
    },
    confirm: actions.requestConfirmation,
    describeError: describeAtlasRefusal,
  })

  const rowActions = {
    onEdit: actions.openEditor,
    onDuplicate: (entry: AtlasEntryWithOrigin) => void actions.duplicate(entry),
    onMoveToFolder: (entry: AtlasEntryWithOrigin) => actions.openFolderPicker([entry], 'move'),
    onCopyToFolder: (entry: AtlasEntryWithOrigin) => actions.openFolderPicker([entry], 'copy'),
    onTransfer: actions.openTransfer,
    onToggleArchived: (entry: AtlasEntryWithOrigin) => void actions.toggleArchived(entry),
    onDelete: (entry: AtlasEntryWithOrigin) => void actions.remove(entry),
  }

  const createFolder = inOwnTier ? currentFolder : ''

  return (
    <FolderBrowserShell
      state={state}
      hasContainer={container !== null}
      loading={loading}
      testIdPrefix="atlas"
      rootLabel="Atlas"
      countNoun="entry"
      scrollList={scrollList}
      folderHandlers={folderHandlers}
      text={{
        noContainer: 'Select an atlas to browse.',
        folderEmpty: 'Terra incognita — nothing charted here yet.',
        noMatch: 'Nothing in the atlas answers to that.',
      }}
      filters={(
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the atlas…"
          className="qt-input qt-input-sm"
          aria-label="Search the atlas by name, alias or look"
        />
      )}
      toggles={{
        archived: { checked: showArchived, onChange: onShowArchivedChange },
      }}
      renderItem={(entry) => (
        <AtlasEntryRow
          key={entry.id}
          entry={entry}
          manageable={canManage(entry)}
          actions={rowActions}
          selection={selectMode ? { selected: selectedIds.has(entry.id), onToggle: state.toggleSelected } : undefined}
          folderCrumb={searching && entry.folder ? folderCrumb(entry.folder) : null}
        />
      )}
      folderFiling={{ open: actions.openFolderPicker }}
      footer={(
        <button type="button" className="qt-button-primary qt-button-sm" disabled={!container} onClick={() => actions.openCreate(createFolder)}>
          + New Entry
        </button>
      )}
    >
      {picker && (
        <ItemFolderPickerDialog
          mode={picker.mode}
          items={picker.items}
          container={actions.addressOf(picker.items[0])}
          port={{ useFolders: useAtlasFolders, createFolder: actions.mutations.createFolder, creating: actions.mutations.pending }}
          wording={ATLAS_PICKER_WORDING}
          file={(folder) =>
            actions.mutations.fileItems(picker.mode, actions.addressOf(picker.items[0]), picker.items.map((i) => i.id), folder)
          }
          onFiled={() => setSelectMode(false)}
          onClose={actions.closeFolderPicker}
        />
      )}
    </FolderBrowserShell>
  )
}
