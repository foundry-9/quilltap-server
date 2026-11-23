/**
 * Import from Instructions — the body of
 * `POST /api/v1/wardrobe?action=design-from-instructions`, and the shape of
 * the result the stream ends with. Shared by the route and the wizard so the
 * two cannot drift.
 *
 * Client-safe.
 *
 * @module wardrobe/instruction-design/request-schema
 */

import { z } from 'zod'
import { UUIDSchema } from '@/lib/schemas/common.types'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import type { ProposedOutfit, ProposedWardrobeItem } from '@/lib/wardrobe/proposal/types'
import { wardrobeProposalSchema } from '@/lib/wardrobe/proposal/types'

export const WARDROBE_DESIGN_INSTRUCTIONS_MAX = 4000
export const WARDROBE_DESIGN_REVISION_MAX = 2000

/** The most pieces one design may propose. */
export const WARDROBE_DESIGN_MAX_ITEMS = 12

/** The wardrobe the design will be filed in: `{ scope: 'general' }` or a scope and its id. */
export const wardrobeDesignTargetSchema = z
  .object({
    scope: z.enum(['character', 'group', 'project', 'general']),
    id: UUIDSchema.nullish(),
  })
  .refine((t) => (t.scope === 'general') === (t.id == null), {
    message: 'A general target carries no id; every other target needs one',
  })

export const wardrobeDesignRequestSchema = z
  .object({
    /** What the operator wants designed. */
    instructions: z.string().trim().min(1).max(WARDROBE_DESIGN_INSTRUCTIONS_MAX),
    /** Whether Aurora may read the document stores and the database. */
    searchStores: z.boolean().default(true),
    /** Whether Aurora may search the web and fetch pages (where either is reachable). */
    searchWeb: z.boolean().default(true),
    connectionProfileId: UUIDSchema,
    target: wardrobeDesignTargetSchema,
    /** Revise: the proposal as currently edited, and the instruction. Both or neither. */
    priorProposal: wardrobeProposalSchema.nullish(),
    revision: z.string().trim().min(1).max(WARDROBE_DESIGN_REVISION_MAX).nullish(),
  })
  .strict()
  .refine((r) => (r.priorProposal == null) === (r.revision == null), {
    message: 'priorProposal and revision travel together',
  })

export type WardrobeDesignTarget = z.infer<typeof wardrobeDesignTargetSchema>
export type WardrobeDesignRequest = z.infer<typeof wardrobeDesignRequestSchema>
/** The body as a client sends it (defaults not yet applied). */
export type WardrobeDesignRequestInput = z.input<typeof wardrobeDesignRequestSchema>

/** An existing piece of the target wardrobe the outfit should include. */
export interface WardrobeDesignReusedPiece {
  id: string
  title: string
  /** The slots it covers, so the outfit's coverage can be worked out without another read. */
  types: WardrobeItemType[]
}

/** What the stream's terminal `done` event carries. */
export interface WardrobeDesignResult {
  items: ProposedWardrobeItem[]
  outfit: ProposedOutfit | null
  /** Existing pieces named for the outfit, resolved to ids and titles. */
  reuse: WardrobeDesignReusedPiece[]
  /** Aurora's short note on what the design rests on; may be empty. */
  notes: string
}

/** `GET /api/v1/wardrobe?action=design-defaults`. */
export interface WardrobeDesignDefaults {
  /** The user's default connection profile, or null. */
  defaultProfileId: string | null
  webSearchConfigured: boolean
  curlConfigured: boolean
}
