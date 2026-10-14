'use client'

/**
 * Avatar generation from the Outfit Builder's composition.
 *
 * In chat it queues a regeneration of the chat avatar with the composition as
 * a one-shot override (the chat's stored `equippedOutfit` is unaffected); out
 * of chat it draws a one-off preview the operator can download. Either path
 * may pick a non-default image profile for that one generation. The profile
 * list is the shared `queryKeys.imageProfiles.all` read.
 *
 * @module components/wardrobe/AvatarGenerationPane
 */

import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import { fetchJson } from '@/lib/fetch-helpers'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { triggerDownload } from '@/lib/download-utils'
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types'

interface ImageProfileSummary {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
}

export interface AvatarGenerationPaneProps {
  characterId: string
  characterName: string
  /** In chat: the avatar is regenerated there. Out of chat: a preview. */
  chatId: string | null
  /** The composition to dress the portrait in. */
  slots: EquippedSlots
}

export function AvatarGenerationPane({
  characterId,
  characterName,
  chatId,
  slots,
}: AvatarGenerationPaneProps) {
  const inChat = chatId !== null
  const { data: profilesData } = useQuery({
    queryKey: queryKeys.imageProfiles.all,
    queryFn: ({ signal }) =>
      apiFetch<{ profiles?: ImageProfileSummary[] }>('/api/v1/image-profiles', { signal }),
  })
  const imageProfiles = profilesData?.profiles ?? []
  // Null = "the system default" until the operator picks one.
  const [pickedProfileId, setPickedProfileId] = useState<string | null>(null)
  const selectedProfileId =
    pickedProfileId ?? (imageProfiles.find((p) => p.isDefault) ?? imageProfiles[0])?.id ?? null

  const [generating, setGenerating] = useState(false)
  const [preview, setPreview] = useState<{ url: string; filename: string } | null>(null)

  const handleGenerate = useCallback(async () => {
    setPreview(null)
    setGenerating(true)
    const body = JSON.stringify({
      characterId,
      equippedSlots: slots,
      ...(selectedProfileId ? { imageProfileId: selectedProfileId } : {}),
    })
    try {
      if (chatId) {
        const result = await fetchJson<{ queued: boolean }>(
          `/api/v1/chats/${chatId}?action=regenerate-avatar`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
        )
        if (!result.ok) {
          showErrorToast(result.error || 'Failed to queue avatar generation')
        } else {
          showSuccessToast('Avatar generation queued — the new portrait will appear shortly.')
        }
      } else {
        const result = await fetchJson<{ fileId: string; url: string }>(
          '/api/v1/wardrobe/preview-avatar',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
        )
        if (!result.ok || !result.data) {
          showErrorToast(result.error || 'Failed to generate preview')
        } else {
          setPreview({
            url: result.data.url,
            filename: `${characterName.replace(/[^a-zA-Z0-9]/g, '_') || 'avatar'}_preview.webp`,
          })
        }
      }
    } finally {
      setGenerating(false)
    }
  }, [characterId, characterName, chatId, slots, selectedProfileId])

  const handleDownload = useCallback(async () => {
    if (!preview) return
    try {
      const res = await fetch(preview.url)
      if (!res.ok) throw new Error(`Failed to fetch preview (${res.status})`)
      const blob = await res.blob()
      await triggerDownload(blob, preview.filename)
    } catch (error) {
      console.error('Failed to download avatar preview:', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast('Failed to download avatar preview')
    }
  }, [preview])

  return (
    <div className="qt-card py-3 px-3 qt-bg-muted/30">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="wardrobe-image-profile" className="text-sm qt-text-secondary">
          Image model
        </label>
        <select
          id="wardrobe-image-profile"
          className="qt-select flex-1 min-w-[12rem]"
          value={selectedProfileId ?? ''}
          onChange={(e) => setPickedProfileId(e.target.value || null)}
        >
          {imageProfiles.length === 0 && (
            <option value="" disabled>
              No image profiles configured
            </option>
          )}
          {imageProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? ' (default)' : ''} — {p.provider}/{p.modelName}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="qt-button-secondary qt-button-sm"
          onClick={handleGenerate}
          disabled={generating || imageProfiles.length === 0}
        >
          {generating ? 'Generating…' : inChat ? 'Generate avatar' : 'Preview'}
        </button>
      </div>

      <p className="mt-2 qt-text-xs qt-text-small">
        {inChat
          ? `Replaces this chat's avatar with the staged outfit.`
          : `Generates a one-off preview. Download to keep.`}
      </p>

      {!inChat && preview && (
        <div className="mt-3 flex flex-col sm:flex-row gap-3 items-start">
          <div className="relative">
            <img
              src={preview.url}
              alt={`Preview of ${characterName}`}
              className="qt-bg-muted rounded border qt-border-default max-h-[40vh]"
            />
            <button
              type="button"
              onClick={() => setPreview(null)}
              aria-label="Discard preview"
              title="Discard preview"
              className="absolute top-1 right-1 w-6 h-6 rounded-full qt-bg-default border qt-border-default flex items-center justify-center qt-text-secondary hover:text-foreground shadow-sm"
            >
              ×
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={handleDownload} className="qt-button-primary qt-button-sm">
              Download
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
