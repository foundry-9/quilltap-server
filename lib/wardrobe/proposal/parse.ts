/**
 * The one reader of a model's wardrobe proposal.
 *
 * The answer is a JSON object — `{ items: [...], outfit: {...} | null }`, plus
 * `outfit.reuse` and `notes` where the caller asked for them — and this is
 * deliberately forgiving about everything but its outline: a code fence is
 * unwrapped, a piece without a title or description is dropped, unknown slot
 * types are dropped (with `accessories` standing in when none survive), a
 * missing image prompt is filled from the title, and a malformed outfit is
 * dropped rather than failing the whole proposal.
 *
 * Throws an `Error` with an operator-readable message when the answer is not
 * JSON or has no `items` array.
 *
 * @module wardrobe/proposal/parse
 */

import { logger } from '@/lib/logger'
import { WardrobeItemTypeEnum } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { clampWardrobeImagePrompt } from '@/lib/wardrobe/image-prompt-limit'
import {
  MIN_OUTFIT_PIECES,
  WARDROBE_PROPOSAL_NOTES_MAX,
  type ParsedWardrobeProposal,
  type ProposedOutfit,
  type ProposedWardrobeItem,
} from './types'

const moduleLogger = logger.child({ module: 'wardrobe-proposal' })

const VALID_TYPES = new Set<string>(WardrobeItemTypeEnum.options)

export interface ParseWardrobeProposalOptions {
  /**
   * How many existing pieces the model was shown, numbered from 1. Given, the
   * proposal's `outfit.reuse` and `notes` are read; absent, both are ignored
   * (a picture analysis is shown no list and asked for no notes).
   */
  reuseCount?: number
  /** At most this many pieces are kept, in the order given. */
  maxItems?: number
}

/** The JSON text inside an answer: a fence unwrapped, or the outermost object of a chatty one. */
function extractJson(content: string): string {
  let text = content.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  if (!text.startsWith('{')) {
    const first = text.indexOf('{')
    const last = text.lastIndexOf('}')
    if (first !== -1 && last > first) text = text.slice(first, last + 1)
  }
  return text
}

/** Parse and normalise a model's proposal. */
export function parseWardrobeProposal(
  content: string,
  opts: ParseWardrobeProposalOptions = {},
): ParsedWardrobeProposal {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(content))
  } catch {
    moduleLogger.error('[Wardrobe Proposal] Failed to parse LLM response as JSON', {
      contentPreview: content.substring(0, 200),
    })
    throw new Error('The AI returned an invalid response. Please try again.')
  }

  if (!parsed || typeof parsed !== 'object' || !('items' in parsed)) {
    throw new Error('The AI returned an unexpected response format. Please try again.')
  }

  const items = (parsed as { items: unknown[] }).items
  if (!Array.isArray(items)) {
    throw new Error('The AI returned an unexpected response format. Please try again.')
  }

  let proposedItems: ProposedWardrobeItem[] = items
    .filter((item): item is Record<string, unknown> => {
      if (!item || typeof item !== 'object') return false
      if (typeof (item as Record<string, unknown>).title !== 'string') return false
      if (typeof (item as Record<string, unknown>).description !== 'string') return false
      return true
    })
    .map((item) => {
      const rawTypes = Array.isArray(item.types) ? item.types : []
      const validatedTypes = rawTypes.filter(
        (t): t is WardrobeItemType => typeof t === 'string' && VALID_TYPES.has(t),
      )

      const title = String(item.title).trim()
      const imagePrompt =
        clampWardrobeImagePrompt(typeof item.imagePrompt === 'string' ? item.imagePrompt : '') ||
        clampWardrobeImagePrompt(title)
      if (typeof item.imagePrompt !== 'string' || !item.imagePrompt.trim()) {
        moduleLogger.debug('[Wardrobe Proposal] Model omitted an imagePrompt; the title stands in', { title })
      }

      return {
        title,
        description: String(item.description).trim(),
        imagePrompt,
        types: validatedTypes.length > 0 ? validatedTypes : ['accessories' as WardrobeItemType],
        appropriateness: typeof item.appropriateness === 'string' ? String(item.appropriateness).trim() : '',
      }
    })

  if (opts.maxItems !== undefined && proposedItems.length > opts.maxItems) {
    moduleLogger.debug('[Wardrobe Proposal] Model proposed more pieces than allowed; the rest are dropped', {
      proposed: proposedItems.length,
      kept: opts.maxItems,
    })
    proposedItems = proposedItems.slice(0, opts.maxItems)
  }

  const rawOutfit = (parsed as { outfit?: unknown }).outfit
  const reuse = opts.reuseCount !== undefined ? parseReuse(rawOutfit, opts.reuseCount) : []
  const proposedOutfit = parseProposedOutfit(rawOutfit, proposedItems.length + reuse.length)

  const rawNotes = (parsed as { notes?: unknown }).notes
  const notes =
    opts.reuseCount !== undefined && typeof rawNotes === 'string'
      ? rawNotes.trim().slice(0, WARDROBE_PROPOSAL_NOTES_MAX)
      : ''

  return {
    proposedItems,
    proposedOutfit,
    // Reused pieces belong to an outfit; without one there is nothing to put them in.
    reuse: proposedOutfit ? reuse : [],
    notes,
  }
}

/** `outfit.reuse`: whole numbers in range, each once, in the order given. */
function parseReuse(rawOutfit: unknown, reuseCount: number): number[] {
  if (!rawOutfit || typeof rawOutfit !== 'object') return []
  const raw = (rawOutfit as Record<string, unknown>).reuse
  if (!Array.isArray(raw)) return []
  const kept: number[] = []
  const dropped: unknown[] = []
  for (const entry of raw) {
    if (typeof entry === 'number' && Number.isInteger(entry) && entry >= 1 && entry <= reuseCount && !kept.includes(entry)) {
      kept.push(entry)
    } else {
      dropped.push(entry)
    }
  }
  if (dropped.length > 0) {
    moduleLogger.debug('[Wardrobe Proposal] Dropped reuse entries that name no listed piece', {
      dropped: dropped.length,
      reuseCount,
    })
  }
  return kept
}

/**
 * The outfit is optional garnish: a missing, malformed, or untitled one is
 * dropped rather than failing the proposal, and an ensemble of fewer than two
 * pieces (new and reused together) is no ensemble at all.
 */
function parseProposedOutfit(raw: unknown, pieceCount: number): ProposedOutfit | null {
  if (pieceCount < MIN_OUTFIT_PIECES || !raw || typeof raw !== 'object') return null
  const outfit = raw as Record<string, unknown>
  const title = typeof outfit.title === 'string' ? outfit.title.trim() : ''
  if (!title) {
    moduleLogger.debug('[Wardrobe Proposal] Model returned an outfit without a title; dropping it')
    return null
  }
  return {
    title,
    description: typeof outfit.description === 'string' ? outfit.description.trim() : '',
    appropriateness: typeof outfit.appropriateness === 'string' ? outfit.appropriateness.trim() : '',
  }
}
