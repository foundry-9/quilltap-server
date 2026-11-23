/**
 * A wardrobe proposal — what a model offers the operator to review before
 * anything is created: a set of pieces and, optionally, a name for the outfit
 * they make together. Two wizards produce one (Import from Image, Import from
 * Instructions); both are read by `parseWardrobeProposal` (`./parse.ts`) and
 * imported by `useProposalImport` (`components/wardrobe/proposal-review/`).
 *
 * Client-safe: no server imports.
 *
 * @module wardrobe/proposal/types
 */

import { z } from 'zod'
import { UUIDSchema } from '@/lib/schemas/common.types'
import { WardrobeItemTypeEnum } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'

/** A single proposed wardrobe piece. */
export interface ProposedWardrobeItem {
  title: string
  description: string
  /**
   * The terse literal cue image pipelines use in place of the title. Always
   * present: when the model omits one, the title stands in, clamped to the cap.
   */
  imagePrompt: string
  types: WardrobeItemType[]
  appropriateness: string
}

/**
 * A proposed name for the whole look — the ensemble the proposed pieces make
 * together. The client turns it into a composite item whose components are
 * the pieces it just created, so it carries no ids or types of its own.
 */
export interface ProposedOutfit {
  title: string
  description: string
  appropriateness: string
}

/** What `parseWardrobeProposal` returns. */
export interface ParsedWardrobeProposal {
  proposedItems: ProposedWardrobeItem[]
  /** Null when the model named no ensemble, or there are too few pieces for one. */
  proposedOutfit: ProposedOutfit | null
  /**
   * 1-based numbers of existing pieces the outfit should include, from the
   * numbered list the model was shown. Empty unless the caller said how many
   * were listed.
   */
  reuse: number[]
  /** The model's short note on what the design rests on; empty when it gave none. */
  notes: string
}

/** An ensemble needs at least two pieces to be worth bundling. */
export const MIN_OUTFIT_PIECES = 2

/** How many pieces a proposal may carry back to the server for a revision. */
export const WARDROBE_PROPOSAL_MAX_ITEMS = 20
export const WARDROBE_PROPOSAL_NOTES_MAX = 1000

/**
 * A proposal as the wizard holds it (after the operator's edits), sent back
 * for a revision. Reused pieces travel as item ids — the client never sees the
 * numbers the model was shown.
 */
export const wardrobeProposalSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            title: z.string().max(200),
            description: z.string().max(4000),
            imagePrompt: z.string().max(1000),
            types: z.array(WardrobeItemTypeEnum).min(1).max(WardrobeItemTypeEnum.options.length),
            appropriateness: z.string().max(500),
          })
          .strict(),
      )
      .max(WARDROBE_PROPOSAL_MAX_ITEMS),
    outfit: z
      .object({
        title: z.string().max(200),
        description: z.string().max(4000),
        appropriateness: z.string().max(500),
      })
      .strict()
      .nullable(),
    reuseItemIds: z.array(UUIDSchema).max(50).default([]),
  })
  .strict()

export type WardrobeProposal = z.infer<typeof wardrobeProposalSchema>
export type WardrobeProposalInput = z.input<typeof wardrobeProposalSchema>
