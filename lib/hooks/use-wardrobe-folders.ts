'use client'

/**
 * One wardrobe container's folders — the Wardrobe-bound face of the shared
 * folder hooks (`lib/hooks/use-item-folders.ts`), kept for its callers.
 *
 * The read is `GET …/wardrobe?action=folders` under `queryKeys.wardrobe.folders`;
 * the mutations (`create-folder`, `rename-folder`, `delete-folder`,
 * `move-items`, `copy-items`) land through a wardrobe location, which
 * publishes the `wardrobe` realtime topic and so refreshes every folder tree
 * and wardrobe list. A write refreshes them itself only while the socket is
 * down. A folder made in the Scriptorium publishes only `mountPoints`, so it
 * appears here on the next open (or the next `wardrobe` hint).
 *
 * @module lib/hooks/use-wardrobe-folders
 */

import { useCallback } from 'react'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'
import {
  useItemFolderMutations,
  useItemFolders,
  type UseItemFoldersResult,
  type WardrobeFolderComponentMode,
} from '@/lib/hooks/use-item-folders'

export type { WardrobeFolderComponentMode } from '@/lib/hooks/use-item-folders'

export type UseWardrobeFoldersResult = UseItemFoldersResult

/** The folder tree of one container. Pass null to skip the read. */
export function useWardrobeFolders(container: WardrobeContainer | null): UseWardrobeFoldersResult {
  return useItemFolders('wardrobe', container)
}

/**
 * The folder mutations, each against a container named per call (a row's
 * home may differ from the browsed container in a character's merged view).
 * Every call throws with the server's message on failure.
 */
export function useWardrobeFolderMutations() {
  const { createFolder, renameFolder, deleteFolder, fileItems, pending } = useItemFolderMutations('wardrobe')

  /**
   * Move items into a folder. `components` says what an outfit's
   * same-wardrobe components do: travel along, get copied, or stay put.
   */
  const moveItems = useCallback(
    (
      container: WardrobeContainer,
      itemIds: string[],
      folder: string,
      components?: WardrobeFolderComponentMode,
    ): Promise<WardrobeItem[]> => fileItems('move', container, itemIds, folder, components),
    [fileItems],
  )

  const copyItems = useCallback(
    (
      container: WardrobeContainer,
      itemIds: string[],
      folder: string,
      components?: 'copy' | 'none',
    ): Promise<WardrobeItem[]> => fileItems('copy', container, itemIds, folder, components),
    [fileItems],
  )

  return {
    createFolder,
    renameFolder,
    deleteFolder,
    moveItems,
    copyItems,
    pending,
  }
}
