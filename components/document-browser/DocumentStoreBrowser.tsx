'use client'

/**
 * A document store's files and folders, browsed the way the wardrobe and
 * the Inventory are: the shared `FolderBrowserShell` (breadcrumb, folder
 * rows, select mode, New folder) over `useDocumentStoreSource`, with a
 * `DocumentRow` per file and a ⋮ menu on every file and folder.
 *
 * Files open read-only in `DocumentViewerModal`; Move / Copy / Hard link go
 * through `DocumentDestinationDialog`, to any folder of this store or
 * another that can take them. What each row offers comes from
 * `documentFileActions` / `documentFolderActions`, gated by the store's
 * capabilities. Deleting a folder deletes what is inside it (each file
 * through the per-file delete), after a confirmation that says so.
 *
 * @module components/document-browser/DocumentStoreBrowser
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { FolderBrowserShell } from '@/components/item-browser/FolderBrowserShell'
import { pluralize, useFolderBrowserState, useItemFolderHandlers, type ItemFolderOps } from '@/components/item-browser/useFolderBrowserState'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { OWN_TIER, type FolderRowView } from '@/lib/folder-browser/view'
import {
  canLinkBetween,
  capabilitiesOf,
  documentFileActions,
  documentFolderActions,
  type BrowserAction,
} from '@/lib/folder-browser/document-actions'
import { folderName, joinFolder, parentFolder } from '@/lib/mount-index/item-folders'
import { apiErrorMessage } from '@/lib/query/fetcher'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { formatBytes } from '@/lib/utils/format-bytes'
import type { DocMountLinkLocation } from '@/lib/schemas/mount-index.types'
import type { DestinationMode } from '@/components/item-browser/DestinationPickerDialog'
import { useDocumentStoreSource, type DocumentEntry } from './useDocumentStoreSource'
import { DocumentRow } from './DocumentRow'
import { DocumentViewerModal, downloadDocument } from './DocumentViewer'
import { DocumentDestinationDialog, useStoreCatalogue, type DocumentDestination } from './DocumentDestinationDialog'
import { DocumentDescriptionDialog, DocumentLinksDialog } from './DocumentFileDialogs'

export interface DocumentStoreBrowserProps {
  storeId: string
  /** Open another store (a "where else" location there). Absent, those locations are named only. */
  onOpenStore?: (mountPointId: string) => void
  /** Cap the list's height (a dialog) instead of letting it grow with the page. */
  scrollList?: boolean
  /**
   * Pick mode (Document Mode's picker): opening a file hands it here instead
   * of showing it in the viewer. The ⋮ menus stay, so housekeeping can be
   * done without leaving the picker.
   */
  onPickFile?: (entry: DocumentEntry) => void
  /** More footer buttons, given the folder being browsed (the picker's New document here). */
  footerActions?: (currentFolder: string) => ReactNode
}

type Transfer =
  | { kind: 'files'; mode: DestinationMode; entries: DocumentEntry[] }
  | { kind: 'folder'; mode: Exclude<DestinationMode, 'link'>; path: string }

const tierOf = () => OWN_TIER

export function DocumentStoreBrowser({
  storeId,
  onOpenStore,
  scrollList = false,
  onPickFile,
  footerActions,
}: DocumentStoreBrowserProps) {
  const router = useRouter()
  const workspace = useWorkspaceOptional()
  const { store, storeLoading, entries, tree, listingLoading, ops } = useDocumentStoreSource(storeId)
  const catalogue = useStoreCatalogue(true)
  const caps = capabilitiesOf(store)

  const [query, setQuery] = useState('')
  const [viewing, setViewing] = useState<DocumentEntry | null>(null)
  const [linksPath, setLinksPath] = useState<string | null>(null)
  const [describing, setDescribing] = useState<DocumentEntry | null>(null)
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [working, setWorking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const searching = query.trim() !== ''
  const sorted = useMemo(
    () => [...entries].sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { sensitivity: 'base' })),
    [entries],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? sorted.filter((e) => e.relativePath.toLowerCase().includes(q)) : sorted
  }, [sorted, query])

  const state = useFolderBrowserState({
    containerKey: storeId,
    items: sorted,
    filtered,
    tree,
    tierOf,
    characterView: false,
    showShared: false,
    searching,
  })
  const { currentFolder, navigate, selectedItems, setSelectMode } = state

  const folderOps = useMemo<ItemFolderOps>(
    () => ({
      create: (path) => ops.createFolder(path),
      rename: (path, name) => ops.renameFolder(path, name),
      remove: async (path) => {
        await ops.deleteFolder(path)
        return { movedItems: 0 }
      },
    }),
    [ops],
  )
  const folderHandlers = useItemFolderHandlers({
    state,
    ops: store ? folderOps : null,
    wording: {
      noun: 'file',
      rootPhrase: 'the top of the store',
      created: (name) => `Folder "${name}" made`,
      movedUp: (count) => `${count} removed`,
      deleteMessage: ({ name, count }) =>
        count > 0
          ? `Delete the folder "${name}" and the ${pluralize(count, 'file')} inside it? They go for good.`
          : `Remove the folder "${name}"?`,
    },
    confirm: showConfirmation,
    describeError: apiErrorMessage,
  })

  const linkTargets = useMemo(
    () => Boolean(store) && (catalogue.data ?? []).some((s) => canLinkBetween(store!, s)),
    [store, catalogue.data],
  )

  const openInWorkbench = useCallback(
    (relativePath: string) => {
      if (workspace) {
        workspace.openTab('custom-tools', { mountPointId: storeId, path: relativePath })
        return
      }
      const search = new URLSearchParams({ mount: storeId, path: relativePath })
      router.push(`/custom-tools?${search.toString()}`)
    },
    [workspace, router, storeId],
  )

  const renameFile = async (entry: DocumentEntry, name: string): Promise<boolean> => {
    try {
      await ops.renameFile(entry.relativePath, joinFolder(entry.folder, name))
      showSuccessToast(`Renamed to "${name}"`)
      return true
    } catch (error) {
      showErrorToast(apiErrorMessage(error, 'The file would not be renamed'))
      return false
    }
  }

  const deleteFiles = async (targets: DocumentEntry[]): Promise<void> => {
    const message =
      targets.length === 1
        ? `Delete "${targets[0].fileName}"? It goes for good, and links to it elsewhere will find nothing.`
        : `Delete ${pluralize(targets.length, 'file')}? They go for good.`
    if (!(await showConfirmation(message))) return
    let done = 0
    for (const entry of targets) {
      try {
        await ops.deleteFile(entry.relativePath)
        done++
      } catch (error) {
        showErrorToast(`${entry.fileName}: ${apiErrorMessage(error, 'would not be deleted')}`)
      }
    }
    if (done > 0) showSuccessToast(`${pluralize(done, 'file')} deleted`)
    setSelectMode(false)
  }

  const onAction = (action: BrowserAction, entry: DocumentEntry): void => {
    switch (action) {
      case 'open':
        if (onPickFile) onPickFile(entry)
        else setViewing(entry)
        return
      case 'move':
      case 'copy':
      case 'link':
        setTransfer({ kind: 'files', mode: action, entries: [entry] })
        return
      case 'show-links':
        setLinksPath(entry.relativePath)
        return
      case 'unlink':
        void ops
          .unlinkFile(entry.relativePath)
          .then(() => showSuccessToast(`"${entry.fileName}" goes its own way now`))
          .catch((error) => showErrorToast(apiErrorMessage(error, 'The file would not be unlinked')))
        return
      case 'describe':
        setDescribing(entry)
        return
      case 'workbench':
        openInWorkbench(entry.relativePath)
        return
      case 'download':
        void downloadDocument(entry)
        return
      case 'delete':
        void deleteFiles([entry])
        return
      default:
        return
    }
  }

  const submitTransfer = async (dest: DocumentDestination): Promise<void> => {
    if (!transfer) return
    setWorking(true)
    try {
      if (transfer.kind === 'folder') {
        const target = { mountPointId: dest.mountPointId, path: joinFolder(dest.folder, folderName(transfer.path)) }
        try {
          await (transfer.mode === 'move' ? ops.moveFolder : ops.copyFolder)(transfer.path, target)
          showSuccessToast(`Folder "${folderName(transfer.path)}" ${transfer.mode === 'move' ? 'moved' : 'copied'}`)
          setTransfer(null)
        } catch (error) {
          showErrorToast(apiErrorMessage(error, `The folder would not be ${transfer.mode === 'move' ? 'moved' : 'copied'}`))
        }
        return
      }
      const run = transfer.mode === 'move' ? ops.moveFile : transfer.mode === 'copy' ? ops.copyFile : ops.linkFile
      const past = transfer.mode === 'move' ? 'moved' : transfer.mode === 'copy' ? 'copied' : 'linked'
      let done = 0
      for (const entry of transfer.entries) {
        try {
          await run(entry.relativePath, { mountPointId: dest.mountPointId, path: joinFolder(dest.folder, entry.fileName) })
          done++
        } catch (error) {
          showErrorToast(`${entry.fileName}: ${apiErrorMessage(error, `would not be ${past}`)}`)
        }
      }
      if (done > 0) {
        showSuccessToast(`${pluralize(done, 'file')} ${past}`)
        setTransfer(null)
        setSelectMode(false)
      }
    } finally {
      setWorking(false)
    }
  }

  const upload = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return
    setUploading(true)
    let done = 0
    try {
      for (const file of Array.from(files)) {
        try {
          await ops.uploadFile(joinFolder(currentFolder, file.name), file)
          done++
        } catch (error) {
          showErrorToast(`${file.name}: ${apiErrorMessage(error, 'would not upload')}`)
        }
      }
      if (done > 0) showSuccessToast(`${pluralize(done, 'file')} filed`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const revealLocation = (loc: DocMountLinkLocation): void => {
    if (loc.mountPointId === storeId) {
      navigate(OWN_TIER, parentFolder(loc.relativePath))
    } else if (onOpenStore) {
      onOpenStore(loc.mountPointId)
    } else {
      showSuccessToast(`It lives in ${loc.mountPointName}, at ${loc.relativePath}`)
    }
  }

  const folderEntries = (row: FolderRowView) => {
    if (!store) return []
    const allowed = documentFolderActions(store)
    return [
      allowed.includes('move') && {
        key: 'move',
        label: 'Move to…',
        onSelect: () => setTransfer({ kind: 'folder', mode: 'move', path: row.path }),
      },
      allowed.includes('copy') && {
        key: 'copy',
        label: 'Copy to…',
        onSelect: () => setTransfer({ kind: 'folder', mode: 'copy', path: row.path }),
      },
    ]
  }

  const totalSize = useMemo(() => entries.reduce((sum, e) => sum + e.fileSizeBytes, 0), [entries])
  const selectedCount = selectedItems.length

  const transferSubject =
    transfer?.kind === 'folder'
      ? `folder "${folderName(transfer.path)}"`
      : transfer && transfer.entries.length === 1
        ? `"${transfer.entries[0].fileName}"`
        : transfer
          ? pluralize(transfer.entries.length, 'file')
          : ''
  const transferFolder =
    transfer?.kind === 'folder'
      ? parentFolder(transfer.path)
      : transfer && transfer.entries.every((e) => e.folder === transfer.entries[0].folder)
        ? (transfer.entries[0]?.folder ?? null)
        : null

  return (
    <FolderBrowserShell
      state={state}
      hasContainer
      loading={storeLoading || listingLoading}
      testIdPrefix="documents"
      rootLabel={store?.name ?? 'Store'}
      countNoun="file"
      text={{
        noContainer: '',
        folderEmpty: caps.canWrite
          ? 'Nothing filed here yet. Upload something, or make a folder.'
          : 'Nothing filed here yet.',
        noMatch: 'Nothing by that name.',
      }}
      filters={
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            aria-label="Search this store"
            placeholder="Search this store…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="qt-input qt-input-sm flex-1 min-w-[12rem]"
          />
          <span className="qt-text-xs qt-text-secondary">
            {pluralize(entries.length, 'file')} · {formatBytes(totalSize)}
          </span>
        </div>
      }
      renderItem={(entry) => (
        <DocumentRow
          key={entry.id}
          entry={entry}
          actions={store ? documentFileActions(store, entry, { linkTargets }) : ['open', 'download']}
          onAction={onAction}
          onRename={renameFile}
          selectMode={state.selectMode}
          selected={state.selectedIds.has(entry.id)}
          onToggle={() => state.toggleSelected(entry)}
          showFolder={searching}
        />
      )}
      selectActions={
        <>
          {caps.canWrite && caps.canMoveOut && (
            <button
              type="button"
              className="qt-button-secondary qt-button-sm"
              disabled={selectedCount === 0}
              onClick={() => setTransfer({ kind: 'files', mode: 'move', entries: selectedItems })}
            >
              Move…
            </button>
          )}
          {caps.canMoveOut && (
            <button
              type="button"
              className="qt-button-secondary qt-button-sm"
              disabled={selectedCount === 0}
              onClick={() => setTransfer({ kind: 'files', mode: 'copy', entries: selectedItems })}
            >
              Copy…
            </button>
          )}
          {caps.canDelete && (
            <button
              type="button"
              className="qt-button-destructive qt-button-sm"
              disabled={selectedCount === 0}
              onClick={() => void deleteFiles(selectedItems)}
            >
              Delete
            </button>
          )}
        </>
      }
      footer={
        <>
          {footerActions?.(currentFolder)}
          {caps.canWrite && (
            <label className={`qt-button-primary qt-button-sm cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="sr-only"
                aria-label="Upload files into this folder"
                disabled={uploading}
                onChange={(e) => void upload(e.target.files)}
              />
              {uploading ? 'Uploading…' : 'Upload here'}
            </label>
          )}
        </>
      }
      folderHandlers={folderHandlers}
      folderEntries={folderEntries}
      manageFolders={caps.canWrite}
      scrollList={scrollList}
    >
      <DocumentViewerModal entry={viewing} onClose={() => setViewing(null)} />
      <DocumentLinksDialog storeId={storeId} path={linksPath} onClose={() => setLinksPath(null)} onReveal={revealLocation} />
      <DocumentDescriptionDialog
        file={describing}
        onClose={() => setDescribing(null)}
        onSave={async (description) => {
          if (!describing) return false
          try {
            await ops.describeFile(describing.relativePath, description)
            showSuccessToast('Description saved')
            return true
          } catch (error) {
            showErrorToast(apiErrorMessage(error, 'The description would not be saved'))
            return false
          }
        }}
      />
      {store && transfer && (
        <DocumentDestinationDialog
          isOpen
          mode={transfer.mode}
          source={store}
          subject={transferSubject}
          currentFolder={transferFolder}
          working={working}
          onClose={() => !working && setTransfer(null)}
          onSubmit={submitTransfer}
        />
      )}
    </FolderBrowserShell>
  )
}
