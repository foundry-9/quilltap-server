'use client'

import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { triggerDownload } from '@/lib/download-utils'
import type { AvatarRoll, GalleryImage } from '../types'

interface AvatarRollEntry {
  fileId: string
  rollLinkId: string | null
  albumLinkId: string | null
  fileName: string
  url: string
  mimeType: string | null
  fileSizeBytes: number
  width: number | null
  height: number | null
  createdAt: string
  generationPrompt: string | null
  generationModel: string | null
  sha256: string
  isPortrait: boolean
  usedInChatCount: number
}

interface AvatarRollsListResponse {
  entries: AvatarRollEntry[]
  total: number
  hasMore: boolean
}

function toAvatarRoll(entry: AvatarRollEntry): AvatarRoll {
  return {
    id: entry.fileId,
    filename: entry.fileName,
    filepath: entry.url,
    mimeType: entry.mimeType,
    size: entry.fileSizeBytes,
    width: entry.width ?? undefined,
    height: entry.height ?? undefined,
    createdAt: entry.createdAt,
    caption: null,
    tags: [],
    albumLinkId: entry.albumLinkId,
    isPortrait: entry.isPortrait,
    usedInChatCount: entry.usedInChatCount,
    generationPrompt: entry.generationPrompt,
    generationModel: entry.generationModel,
  }
}

/**
 * Read and act on a character's avatar rolls — the plates the configuration
 * cache has already developed.
 *
 * Everything here talks to `/api/v1/characters/[id]/avatar-rolls`; the one
 * exception is the download, which fetches the bytes the same way the album
 * grid does so Electron's native save dialog gets a blob rather than a link.
 *
 * Every mutation invalidates the album query too: promoting a roll to the
 * portrait, and keeping one, both add a photo to `photos/`.
 */
export function useAvatarRolls(characterId: string) {
  const queryClient = useQueryClient()
  const [missingRolls, setMissingRolls] = useState<Set<string>>(new Set())
  const [busyRollId, setBusyRollId] = useState<string | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.characters.avatarRolls(characterId),
    queryFn: ({ signal }) =>
      apiFetch<AvatarRollsListResponse>(
        `/api/v1/characters/${characterId}/avatar-rolls?limit=200`,
        { signal }
      ),
  })

  const rolls: AvatarRoll[] = (data?.entries ?? []).map(toAvatarRoll)

  const invalidateAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.characters.avatarRolls(characterId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.characters.photos(characterId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.characters.detail(characterId) }),
    ])
  }, [queryClient, characterId])

  const handleRollError = useCallback((rollId: string) => {
    setMissingRolls(prev => new Set(prev).add(rollId))
    console.warn('Avatar roll failed to load', { rollId })
  }, [])

  const runAction = useCallback(
    async (rollId: string, action: 'save-to-album' | 'set-avatar'): Promise<unknown | null> => {
      setBusyRollId(rollId)
      try {
        const res = await fetch(
          `/api/v1/characters/${characterId}/avatar-rolls/${rollId}?action=${action}`,
          { method: 'POST' }
        )
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(body?.error || `Request failed (${res.status})`)
        }
        await invalidateAll()
        // `successResponse` answers with the payload bare, not wrapped in `data`.
        return body
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        showErrorToast(message)
        console.error('Avatar roll action failed', { action, characterId, rollId, error: message })
        return null
      } finally {
        setBusyRollId(null)
      }
    },
    [characterId, invalidateAll]
  )

  const saveRollToAlbum = useCallback(
    async (roll: AvatarRoll) => {
      const result = (await runAction(roll.id, 'save-to-album')) as
        | { alreadyInAlbum?: boolean }
        | null
      if (!result) return
      showSuccessToast(
        result.alreadyInAlbum ? 'Already in the album' : 'Kept in the photo album'
      )
    },
    [runAction]
  )

  const setRollAsAvatar = useCallback(
    async (roll: AvatarRoll, onAvatarChange?: (imageId: string | null) => void) => {
      const result = (await runAction(roll.id, 'set-avatar')) as
        | { linkId?: string }
        | null
      if (!result?.linkId) return
      onAvatarChange?.(result.linkId)
      showSuccessToast('Avatar updated!')
    },
    [runAction]
  )

  const deleteRoll = useCallback(
    async (roll: AvatarRoll) => {
      setBusyRollId(roll.id)
      try {
        const res = await fetch(
          `/api/v1/characters/${characterId}/avatar-rolls/${roll.id}`,
          { method: 'DELETE' }
        )
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(body?.error || 'Failed to delete the avatar roll')
        }
        await invalidateAll()
        const kept = body?.keptInAlbum
        showSuccessToast(kept ? 'Roll discarded; the album copy stays' : 'Roll discarded')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        showErrorToast(message)
        console.error('Avatar roll delete failed', { characterId, rollId: roll.id, error: message })
      } finally {
        setBusyRollId(null)
      }
    },
    [characterId, invalidateAll]
  )

  /** Same bytes-then-blob dance the album grid uses; see `useGalleryData`. */
  const downloadRoll = useCallback(
    async (roll: GalleryImage) => {
      const src = roll.url || (roll.filepath.startsWith('/') ? roll.filepath : `/${roll.filepath}`)
      try {
        const res = await fetch(src)
        if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`)
        const blob = await res.blob()
        await triggerDownload(blob, roll.filename)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        showErrorToast('Failed to download image')
        console.error('Error downloading avatar roll', { characterId, rollId: roll.id, error: message })
      }
    },
    [characterId]
  )

  return {
    rolls,
    total: data?.total ?? 0,
    loading: isLoading,
    missingRolls,
    busyRollId,
    refetchRolls: refetch,
    handleRollError,
    saveRollToAlbum,
    setRollAsAvatar,
    deleteRoll,
    downloadRoll,
  }
}
