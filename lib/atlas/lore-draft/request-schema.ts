/**
 * Atlas lore draft — the body of `POST /api/v1/atlas?action=draft-from-lore`.
 * Shared by the route and the wizard's streaming hook so the two cannot drift.
 *
 * Client-safe.
 *
 * @module atlas/lore-draft/request-schema
 */

import { z } from 'zod'
import { UUIDSchema } from '@/lib/schemas/common.types'
import { AtlasScopeSchema } from '@/lib/schemas/atlas.types'

export const ATLAS_LORE_SUBJECT_MAX = 500
export const ATLAS_LORE_DETAILS_MAX = 4000
export const ATLAS_LORE_REVISION_MAX = 2000

/** The tier the entry will be filed in: `{ scope: 'general' }` or a scope and its id. */
export const atlasLoreTargetSchema = z
  .object({
    scope: AtlasScopeSchema,
    id: UUIDSchema.nullish(),
  })
  .refine((t) => (t.scope === 'general') === (t.id == null), {
    message: 'A general target carries no id; every other target needs one',
  })

/** A draft as the wizard holds it, sent back for a revision. */
export const atlasLoreDraftSchema = z.object({
  name: z.string().max(200),
  aliases: z.array(z.string().max(200)).max(50),
  graphicPrompt: z.string().max(4000).nullable(),
  knowledge: z.string().max(40_000).nullable(),
})

export const atlasLoreDraftRequestSchema = z
  .object({
    /** The thing to write up: a name, or a description good enough to find it by. */
    subject: z.string().trim().min(1).max(ATLAS_LORE_SUBJECT_MAX),
    /** Anything more the operator wants Brahma to know or do. */
    details: z.string().trim().max(ATLAS_LORE_DETAILS_MAX).default(''),
    /** Whether Brahma may search the document stores and read the database. */
    searchStores: z.boolean().default(true),
    /** Absent: Brahma's own profile (project → global → default). */
    connectionProfileId: UUIDSchema.nullish(),
    target: atlasLoreTargetSchema,
    /** Revise: the draft as currently edited, and the instruction. Both or neither. */
    priorDraft: atlasLoreDraftSchema.nullish(),
    revision: z.string().trim().min(1).max(ATLAS_LORE_REVISION_MAX).nullish(),
  })
  .strict()
  .refine((r) => (r.priorDraft == null) === (r.revision == null), {
    message: 'priorDraft and revision travel together',
  })

export type AtlasLoreDraft = z.infer<typeof atlasLoreDraftSchema>
export type AtlasLoreDraftRequest = z.infer<typeof atlasLoreDraftRequestSchema>
/** The body as a client sends it (defaults not yet applied). */
export type AtlasLoreDraftRequestInput = z.input<typeof atlasLoreDraftRequestSchema>
