'use client'

/**
 * useProposalImport — the one routine that turns a reviewed wardrobe proposal
 * into wardrobe items.
 *
 * The pieces are created first, one ordinary create each, in the container's
 * own collection; their returned ids (with any existing pieces the operator
 * kept) become the outfit's `componentItemIds`, and the outfit's coverage is
 * their slot union — exactly what the item editor computes for a hand-built
 * bundle. A piece that fails to create is left out and the rest stand.
 *
 * It says nothing to the operator: the calling wizard words its own toasts
 * from the result.
 *
 * @module components/wardrobe/proposal-review/useProposalImport
 */

import { useCallback, useState } from 'react'
import { fetchJson } from '@/lib/fetch-helpers'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { unionTypes } from '@/lib/wardrobe/composite-types'
import { MIN_OUTFIT_PIECES } from '@/lib/wardrobe/proposal/types'
import { wardrobeCollectionUrl, type WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'

/** A piece as reviewed, ready to create. */
export interface ProposalImportPiece {
  title: string
  description: string
  imagePrompt: string
  types: WardrobeItemType[]
  appropriateness: string
}

/** The outfit as reviewed. */
export interface ProposalImportOutfit {
  title: string
  description: string
  appropriateness: string
  replace: boolean
}

export interface ProposalImportRequest {
  pieces: readonly ProposalImportPiece[]
  /** Null when no outfit is wanted. */
  outfit: ProposalImportOutfit | null
  /** Existing pieces of this container the outfit should also include. */
  reusedItems?: readonly Pick<WardrobeItem, 'id' | 'types'>[]
  /** Called after each created item (pieces, then the outfit); must not throw. */
  afterCreate?: (item: WardrobeItem, title: string) => Promise<void>
}

export type ProposalOutfitOutcome =
  /** No outfit was asked for. */
  | 'none'
  | 'created'
  /** Too few pieces landed to bundle. */
  | 'too-few'
  | 'failed'

export interface ProposalImportResult {
  created: WardrobeItem[]
  /** Titles of the pieces that could not be created. */
  failedTitles: string[]
  outfit: WardrobeItem | null
  outfitOutcome: ProposalOutfitOutcome
  /** How many pieces the outfit bundles (created and reused together). */
  outfitPieceCount: number
}

export interface UseProposalImportOptions {
  /** The wardrobe the pieces and the outfit are created in. */
  container: WardrobeContainer
  /** Folder under `Wardrobe/` to file them in; absent = the root. */
  folder?: string
  /** A label for console warnings. */
  logLabel: string
}

export function useProposalImport({ container, folder, logLabel }: UseProposalImportOptions) {
  const [importing, setImporting] = useState(false)

  const run = useCallback(
    async (request: ProposalImportRequest): Promise<ProposalImportResult> => {
      const url = wardrobeCollectionUrl(container)
      const filed = folder ? { folder } : {}
      const post = (body: Record<string, unknown>) =>
        fetchJson<{ wardrobeItem: WardrobeItem }>(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

      setImporting(true)
      try {
        const created: WardrobeItem[] = []
        const failedTitles: string[] = []

        for (const piece of request.pieces) {
          const result = await post({
            title: piece.title,
            description: piece.description || null,
            imagePrompt: piece.imagePrompt.trim() || null,
            types: piece.types,
            appropriateness: piece.appropriateness || null,
            isDefault: false,
            ...filed,
          })
          if (result.ok && result.data?.wardrobeItem) {
            created.push(result.data.wardrobeItem)
            await request.afterCreate?.(result.data.wardrobeItem, piece.title)
          } else {
            failedTitles.push(piece.title)
            console.warn(`[${logLabel}] Failed to create item:`, piece.title, result.error)
          }
        }

        const components: Pick<WardrobeItem, 'id' | 'types'>[] = [...created, ...(request.reusedItems ?? [])]
        const base = { created, failedTitles, outfitPieceCount: components.length }

        if (!request.outfit) return { ...base, outfit: null, outfitOutcome: 'none' }
        // Nothing new landed: an outfit of old pieces alone is not what was asked for.
        if (created.length === 0 || components.length < MIN_OUTFIT_PIECES) {
          return { ...base, outfit: null, outfitOutcome: 'too-few' }
        }

        const title = request.outfit.title.trim()
        const outfitResult = await post({
          title,
          description: request.outfit.description.trim() || null,
          types: unionTypes(components),
          appropriateness: request.outfit.appropriateness.trim() || null,
          componentItemIds: components.map((c) => c.id),
          replace: request.outfit.replace,
          isDefault: false,
          ...filed,
        })
        if (!outfitResult.ok) {
          console.warn(`[${logLabel}] Failed to create outfit:`, title, outfitResult.error)
          return { ...base, outfit: null, outfitOutcome: 'failed' }
        }
        const outfit = outfitResult.data?.wardrobeItem ?? null
        if (outfit) await request.afterCreate?.(outfit, title)
        return { ...base, outfit, outfitOutcome: 'created' }
      } finally {
        setImporting(false)
      }
    },
    [container, folder, logLabel],
  )

  return { importing, run }
}
