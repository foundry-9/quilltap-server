'use client'

/**
 * useProjectWardrobe — fetch and mutate the project's `Wardrobe/*.md` files via
 * `/api/v1/projects/[id]/wardrobe/...`.
 *
 * Project wardrobe is the project tier of the tri-tier wardrobe model: items
 * stored here are wearable by every character in chats belonging to this
 * project, alongside the character's own vault items and the Quilltap General
 * archetypes.
 *
 * @module app/prospero/[id]/hooks/useProjectWardrobe
 */

import { useCallback, useEffect, useState } from 'react'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'

export interface CreateProjectWardrobeInput {
  title: string
  description?: string | null
  /** Plain-text image-generation cue; preferred over the title in image prompts. */
  imagePrompt?: string | null
  types: WardrobeItemType[]
  appropriateness?: string | null
  isDefault?: boolean
  componentItemIds?: string[]
  replace?: boolean
}

export type UpdateProjectWardrobeInput = Partial<CreateProjectWardrobeInput>

export interface UseProjectWardrobeReturn {
  items: WardrobeItem[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  createItem: (
    input: CreateProjectWardrobeInput,
  ) => Promise<{ ok: true; item: WardrobeItem } | { ok: false; error: string }>
  updateItem: (
    id: string,
    patch: UpdateProjectWardrobeInput,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  deleteItem: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

export function useProjectWardrobe(projectId: string): UseProjectWardrobeReturn {
  const [items, setItems] = useState<WardrobeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/wardrobe`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Failed to load project wardrobe (${res.status})`)
      }
      const data = (await res.json()) as { wardrobeItems: WardrobeItem[] }
      setItems(data.wardrobeItems || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount; setState lands inside async refresh()
    void refresh()
  }, [refresh])

  const createItem = useCallback<UseProjectWardrobeReturn['createItem']>(
    async (input) => {
      try {
        const res = await fetch(`/api/v1/projects/${projectId}/wardrobe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { ok: false, error: body?.error || `Failed to create (${res.status})` }
        }
        if (Array.isArray(body.wardrobeItems)) setItems(body.wardrobeItems as WardrobeItem[])
        return { ok: true, item: body.wardrobeItem as WardrobeItem }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [projectId],
  )

  const updateItem = useCallback<UseProjectWardrobeReturn['updateItem']>(
    async (id, patch) => {
      try {
        const res = await fetch(`/api/v1/projects/${projectId}/wardrobe/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { ok: false, error: body?.error || `Failed to update (${res.status})` }
        }
        await refresh()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [projectId, refresh],
  )

  const deleteItem = useCallback<UseProjectWardrobeReturn['deleteItem']>(
    async (id) => {
      try {
        const res = await fetch(`/api/v1/projects/${projectId}/wardrobe/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { ok: false, error: body?.error || `Failed to delete (${res.status})` }
        }
        await refresh()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [projectId, refresh],
  )

  return { items, loading, error, refresh, createItem, updateItem, deleteItem }
}
