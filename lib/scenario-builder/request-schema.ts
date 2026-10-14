/**
 * Scenario Builder request schema — the body of
 * `POST /api/v1/scenario-builder?action=build`. Shared by the route and the
 * dialog's streaming hook so the two cannot drift.
 *
 * @module scenario-builder/request-schema
 */

import { z } from 'zod'
import { UUIDSchema } from '@/lib/schemas/common.types'

export const scenarioBuildRequestSchema = z
  .object({
    mode: z.enum(['real', 'in-world']),
    location: z.string().trim().min(1).max(500),
    time: z.string().trim().min(1).max(200),
    details: z.string().trim().max(4000).default(''),
    connectionProfileId: UUIDSchema,
    projectId: UUIDSchema.nullish(),
    /** Cast character ids: New Chat selection, or the chat's participants. */
    characterIds: z.array(UUIDSchema).max(32).default([]),
    /** Groups named outright — the builder launched from a group's Scenarios card. */
    groupIds: z.array(UUIDSchema).max(32).default([]),
    /** Present when launched from the in-chat control. Adds the chat's own context. */
    chatId: UUIDSchema.nullish(),
    /** Revise: the draft as currently edited, and the instruction. Both or neither. */
    priorDraft: z.string().max(20_000).nullish(),
    revision: z.string().trim().max(2000).nullish(),
  })
  .refine((r) => (r.priorDraft == null) === (r.revision == null), {
    message: 'priorDraft and revision travel together',
  })

export type ScenarioBuildRequest = z.infer<typeof scenarioBuildRequestSchema>

/** The body as a client sends it (defaults not yet applied). */
export type ScenarioBuildRequestInput = z.input<typeof scenarioBuildRequestSchema>
