'use client'

/**
 * ProjectStoreBrowser — the Scriptorium's folder browser on a project's own
 * document store. The project names its store (`officialMountPointId`); a
 * project from before that column was filled falls back to the store the
 * startup heal would pick among its linked ones.
 *
 * @module components/document-browser/ProjectStoreBrowser
 */

import { useOwnerStoresQuery } from '@/lib/hooks/use-owner-store-links'
import { pickPrimaryProjectStore, type StoreLike } from '@/lib/mount-index/project-store-naming'
import { DocumentStoreBrowser, type DocumentStoreBrowserProps } from './DocumentStoreBrowser'

/** The id of a project's own store, once known (null when it has none). */
export function useProjectStoreId(projectId: string | null) {
  const query = useOwnerStoresQuery<StoreLike & { id: string }>({ kind: 'project', id: projectId ?? '' })
  const data = query.data
  const storeId = data ? (data.officialMountPointId ?? pickPrimaryProjectStore(data.mountPoints)?.id ?? null) : null
  return { storeId, isLoading: !!projectId && query.isLoading, isError: query.isError }
}

export interface ProjectStoreBrowserProps extends Omit<DocumentStoreBrowserProps, 'storeId'> {
  projectId: string
}

export function ProjectStoreBrowser({ projectId, ...props }: ProjectStoreBrowserProps) {
  const { storeId, isLoading, isError } = useProjectStoreId(projectId)

  if (isLoading) {
    return <p className="qt-text-small qt-text-muted p-4">Finding the project&apos;s shelves…</p>
  }
  if (isError || !storeId) {
    return (
      <p className="qt-text-small qt-text-muted p-4">
        {isError
          ? 'The project’s document store could not be reached just now.'
          : 'This project has no document store of its own.'}
      </p>
    )
  }
  return <DocumentStoreBrowser key={storeId} storeId={storeId} {...props} />
}
