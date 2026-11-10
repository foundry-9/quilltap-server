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
 * footer, plus the wording and test ids that make it its own. The pieces the
 * tiered item browsers (the wardrobe's, the Inventory's) share are props:
 * the *Show archived* / *Show shared* toggles and the select bar's *Move to
 * folder…* / *Copy to folder…* pair.
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

/** A labelled checkbox in the toggles row. */
export interface BrowserToggle {
  checked: boolean
  onChange: (next: boolean) => void
}

/** The toggles row under the filters. */
export interface BrowserToggles {
  /** Before the shared toggles (the Inventory's *Equipped only*). */
  before?: ReactNode
  /** *Show archived* — re-reads with archived rows rather than filtering. */
  archived?: BrowserToggle
  /**
   * *Show shared* — a character's merged view only. Turning it off from
   * inside a borrowed tier goes back to the character's own root.
   */
  shared?: BrowserToggle
  /** After the shared toggles (the wardrobe's *Never worn*, pronoun filter). */
  after?: ReactNode
}

/** The select bar's *Move to folder…* / *Copy to folder…* pair. */
export interface BrowserFolderFiling<T> {
  open: (items: T[], mode: 'move' | 'copy') => void
  /** Why the selection cannot be copied, or undefined when it can. */
  copyBlocked?: (items: T[]) => string | undefined
}

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
  /** The toggles row after the filters. */
  toggles?: BrowserToggles
  renderItem: (item: T) => ReactNode
  /** The select bar's folder-filing pair, ahead of `selectActions`. */
  folderFiling?: BrowserFolderFiling<T>
  /** The select bar's other filing buttons. */
  selectActions?: ReactNode
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
  /**
   * Whether folders here can be made, renamed and deleted; defaults to the
   * state's `managed` (a read-only document store turns it off).
   */
  manageFolders?: boolean
  /** Cap the list's height (a dialog) instead of letting it grow (a card). */
  scrollList?: boolean
  /**
   * `list` (default) stacks folder and item rows; `grid` lays folders and
   * items out as square tiles (a picture view). In `grid`, `renderItem`
   * should draw a tile.
   */
  layout?: 'list' | 'grid'
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
  toggles,
  renderItem,
  folderFiling,
  selectActions,
  footer,
  folderHandlers,
  folderEntries,
  manageFolders,
  scrollList = true,
  layout = 'list',
  children,
}: FolderBrowserShellProps<T>) {
  const {
    currentTier,
    currentFolder,
    inOwnTier,
    managed: stateManaged,
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
    selectedItems,
  } = state
  const managed = stateManaged && (manageFolders ?? true)
  const copyBlocked = folderFiling?.copyBlocked?.(selectedItems)
  const grid = layout === 'grid'

  const folderNodes = folderRows.map((row) => (
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
      tile={grid}
    />
  ))
  const tierNodes = sharedTierRows.map((row) => {
    const node = (
      <ItemTierRow
        key={row.key}
        label={row.label}
        scope={row.scope}
        itemCount={row.itemCount}
        onOpen={() => navigate(row.key, '')}
        testId={`${testIdPrefix}-tier-row`}
        countNoun={countNoun}
      />
    )
    return grid ? <div key={row.key} className="col-span-full">{node}</div> : node
  })
  const emptyNode = folderIsEmpty ? (
    <div className="text-sm qt-text-secondary px-3 py-4">{text.folderEmpty}</div>
  ) : visible.length === 0 && folderRows.length === 0 && sharedTierRows.length === 0 ? (
    <div className="text-sm qt-text-secondary px-3 py-4">{text.noMatch}</div>
  ) : null
  const itemNodes = emptyNode ? null : visible.map((item) => renderItem(item))

  return (
    <section className="flex flex-col min-h-0 relative">
      <div className="flex flex-col gap-2 mb-2">
        {filters}
        {toggles && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {toggles.before}
            {toggles.archived && (
              <label className="flex items-center gap-2 qt-text-xs qt-text-secondary">
                <input
                  type="checkbox"
                  checked={toggles.archived.checked}
                  onChange={(e) => toggles.archived?.onChange(e.target.checked)}
                  className="qt-checkbox"
                />
                Show archived
              </label>
            )}
            {toggles.shared && (
              <label className="flex items-center gap-2 qt-text-xs qt-text-secondary">
                <input
                  type="checkbox"
                  checked={toggles.shared.checked}
                  onChange={(e) => {
                    toggles.shared?.onChange(e.target.checked)
                    if (!e.target.checked && !inOwnTier) navigate(OWN_TIER, '')
                  }}
                  className="qt-checkbox"
                />
                Show shared
              </label>
            )}
            {toggles.after}
          </div>
        )}
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
            {grid ? (
              <>
                {(folderNodes.length > 0 || tierNodes.length > 0 || (itemNodes?.length ?? 0) > 0) && (
                  <div
                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
                    data-testid={`${testIdPrefix}-grid`}
                  >
                    {folderNodes}
                    {tierNodes}
                    {itemNodes}
                  </div>
                )}
                {emptyNode}
              </>
            ) : (
              <>
                {folderNodes}
                {tierNodes}
                {emptyNode ?? itemNodes}
              </>
            )}
            {selectMode && (
              <ItemSelectBar
                count={selectedIds.size}
                sticky={scrollList}
                testId={`${testIdPrefix}-select-bar`}
                onCancel={() => setSelectMode(false)}
              >
                {folderFiling && (
                  <>
                    <button
                      type="button"
                      className="qt-button-secondary qt-button-sm"
                      disabled={selectedItems.length === 0}
                      onClick={() => folderFiling.open(selectedItems, 'move')}
                    >
                      Move to folder…
                    </button>
                    <button
                      type="button"
                      className="qt-button-secondary qt-button-sm"
                      disabled={selectedItems.length === 0 || copyBlocked !== undefined}
                      title={copyBlocked}
                      onClick={() => folderFiling.open(selectedItems, 'copy')}
                    >
                      Copy to folder…
                    </button>
                  </>
                )}
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
