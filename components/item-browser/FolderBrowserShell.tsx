'use client'

/**
 * The layout every folder-of-items browser shares: the browser's own filter
 * strip, the folder bar (breadcrumb, New folder, Select) and the inline
 * new-folder input, then the list — folder rows, a character's borrowed tier
 * rows, the empty / no-match states, the item rows — the select bar with the
 * browser's filing buttons, and the sticky footer of create buttons.
 *
 * The state is `useFolderBrowserState`'s and the folder writes
 * `useItemFolderHandlers`'; this component only lays them out. Each browser
 * supplies its filters, its row renderer, its select-bar buttons and its
 * footer, plus the wording and test ids that make it its own.
 *
 * @module components/item-browser/FolderBrowserShell
 */

import type { ReactNode } from 'react'
import { OWN_TIER, type BrowserViewItem, type FolderRowView } from '@/lib/folder-browser/view'
import { ItemFolderBar, NewFolderInput } from './ItemFolderBar'
import { ItemFolderRow } from './ItemFolderRow'
import { ItemSelectBar } from './ItemSelectBar'
import { ItemTierRow } from './ItemTierRow'
import type { MenuEntryLike } from './ItemActionMenu'
import type { FolderBrowserState } from './useFolderBrowserState'

type Item = BrowserViewItem & { id: string }

export interface FolderBrowserShellProps<T extends Item> {
  state: FolderBrowserState<T>
  /** Null while no container is chosen. */
  hasContainer: boolean
  loading: boolean
  /** Prefix of every `data-testid`, e.g. `wardrobe` → `wardrobe-folder-row`. */
  testIdPrefix: string
  /** The root crumb, e.g. `Wardrobe`. */
  rootLabel: string
  /** The noun folder and tier rows count, e.g. `item`. */
  countNoun?: string
  text: {
    noContainer: string
    folderEmpty: string
    noMatch: string
  }
  /** The search box and filters above the folder bar. */
  filters: ReactNode
  renderItem: (item: T) => ReactNode
  /** The select bar's filing buttons. */
  selectActions: ReactNode
  /** The sticky footer's create buttons. */
  footer: ReactNode
  /** Folder handlers from `useItemFolderHandlers`. */
  folderHandlers: {
    submitNewFolder: () => Promise<void>
    renameFolder: (path: string, name: string) => Promise<boolean>
    deleteFolder: (path: string) => Promise<void>
  }
  /** More ⋮ entries on a folder row (Move to…, Copy to…). */
  folderEntries?: (row: FolderRowView) => readonly MenuEntryLike[]
  /** Cap the list's height (a dialog) instead of letting it grow (a card). */
  scrollList?: boolean
  /** Anything else inside the section (dialogs the browser mounts). */
  children?: ReactNode
}

export function FolderBrowserShell<T extends Item>({
  state,
  hasContainer,
  loading,
  testIdPrefix,
  rootLabel,
  countNoun = 'item',
  text,
  filters,
  renderItem,
  selectActions,
  footer,
  folderHandlers,
  folderEntries,
  scrollList = true,
  children,
}: FolderBrowserShellProps<T>) {
  const {
    currentTier,
    currentFolder,
    inOwnTier,
    managed,
    navigate,
    currentTierLabel,
    selectMode,
    setSelectMode,
    selectedIds,
    newFolder,
    folderRows,
    sharedTierRows,
    visible,
    folderIsEmpty,
    searching,
  } = state

  return (
    <section className="flex flex-col min-h-0 relative">
      <div className="flex flex-col gap-2 mb-2">
        {filters}
        {hasContainer && (
          <ItemFolderBar
            rootLabel={rootLabel}
            navLabel={`${rootLabel} folders`}
            searching={searching}
            tierLabel={inOwnTier ? null : currentTierLabel}
            currentFolder={currentFolder}
            onNavigateRoot={() => navigate(OWN_TIER, '')}
            onNavigateTier={() => navigate(currentTier, '')}
            onNavigateFolder={(path) => navigate(currentTier, path)}
            managed={managed}
            newFolderOpen={newFolder.open}
            onNewFolder={() => newFolder.setName('')}
            selectMode={selectMode}
            onToggleSelect={() => setSelectMode(!selectMode)}
            testId={`${testIdPrefix}-folder-bar`}
          />
        )}
        {newFolder.open && managed && !searching && (
          <NewFolderInput
            name={newFolder.name}
            onChange={newFolder.setName}
            onSubmit={() => void folderHandlers.submitNewFolder()}
            onCancel={newFolder.close}
          />
        )}
      </div>

      <div className={`flex-1 space-y-1 pb-12 ${scrollList ? 'overflow-y-auto max-h-[55vh]' : ''}`}>
        {!hasContainer ? (
          <div className="text-sm qt-text-secondary px-3 py-4">{text.noContainer}</div>
        ) : loading ? (
          <div className="text-sm qt-text-secondary px-3 py-4">Loading…</div>
        ) : (
          <>
            {folderRows.map((row) => (
              <ItemFolderRow
                key={row.path}
                row={row}
                manageable={managed}
                onOpen={() => navigate(currentTier, row.path)}
                onRename={(name) => folderHandlers.renameFolder(row.path, name)}
                onDelete={() => void folderHandlers.deleteFolder(row.path)}
                extraEntries={folderEntries?.(row)}
                testId={`${testIdPrefix}-folder-row`}
                countNoun={countNoun}
              />
            ))}
            {sharedTierRows.map((row) => (
              <ItemTierRow
                key={row.key}
                label={row.label}
                scope={row.scope}
                itemCount={row.itemCount}
                onOpen={() => navigate(row.key, '')}
                testId={`${testIdPrefix}-tier-row`}
                countNoun={countNoun}
              />
            ))}
            {folderIsEmpty ? (
              <div className="text-sm qt-text-secondary px-3 py-4">{text.folderEmpty}</div>
            ) : visible.length === 0 && folderRows.length === 0 && sharedTierRows.length === 0 ? (
              <div className="text-sm qt-text-secondary px-3 py-4">{text.noMatch}</div>
            ) : (
              visible.map((item) => renderItem(item))
            )}
            {selectMode && (
              <ItemSelectBar
                count={selectedIds.size}
                sticky={scrollList}
                testId={`${testIdPrefix}-select-bar`}
                onCancel={() => setSelectMode(false)}
              >
                {selectActions}
              </ItemSelectBar>
            )}
          </>
        )}
      </div>

      <div className="sticky bottom-0 -mx-1 px-1 pt-2 pb-1 qt-bg-default border-t qt-border-default flex flex-wrap items-center gap-2 justify-end">
        {footer}
      </div>

      {children}
    </section>
  )
}
