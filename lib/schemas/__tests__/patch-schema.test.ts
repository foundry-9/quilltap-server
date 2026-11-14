/**
 * Bug 244 — Zod 4's `.partial()` keeps each field's default, so a one-field
 * settings write parsed through it came back carrying every other field at
 * its default and reset them when merged over the stored value.
 */

import { z } from 'zod'
import { patchSchemaOf } from '../patch-schema'
import {
  MemoryConsolidationSettingsSchema,
  MemoryExtractionModeSettingsSchema,
  MemoryMaintenancePhaseTogglesSchema,
} from '../settings.types'
import { TextReplacementRulePatchSchema } from '../text-replacement.types'

describe('patchSchemaOf', () => {
  it('leaves omitted keys omitted (where .partial() would default them)', () => {
    expect(MemoryConsolidationSettingsSchema.partial().parse({ watermark: 200 })).toHaveProperty('enabled', false)
    expect(patchSchemaOf(MemoryConsolidationSettingsSchema).parse({ watermark: 200 })).toEqual({ watermark: 200 })
    expect(patchSchemaOf(MemoryExtractionModeSettingsSchema).parse({ otherPass: 'turn' })).toEqual({ otherPass: 'turn' })
    expect(patchSchemaOf(MemoryMaintenancePhaseTogglesSchema).parse({ demote: false })).toEqual({ demote: false })
    expect(TextReplacementRulePatchSchema.parse({ enabled: false })).toEqual({ enabled: false })
  })

  it('keeps bounds, enums, nullability and field refinements', () => {
    const patch = patchSchemaOf(MemoryConsolidationSettingsSchema)
    expect(patch.safeParse({ clusterThreshold: 2 }).success).toBe(false)
    expect(patch.safeParse({ coldRetentionDays: null }).success).toBe(true)
    expect(patch.safeParse({ coldRetentionDays: 0 }).success).toBe(false)
    expect(patchSchemaOf(MemoryExtractionModeSettingsSchema).safeParse({ otherPass: 'never' }).success).toBe(false)
    expect(TextReplacementRulePatchSchema.safeParse({ fromText: ' padded ' }).success).toBe(false)
  })

  it('unwraps a prefault and strips unknown keys', () => {
    const schema = z.object({ nested: z.object({ a: z.boolean().default(true) }).prefault({}), n: z.number().default(1) })
    expect(patchSchemaOf(schema).parse({ stray: 1 })).toEqual({})
    expect(patchSchemaOf(schema).parse({ nested: {} })).toEqual({ nested: { a: true } })
  })

  // `.default(256).optional()` still yields 256 for an absent key in Zod 4, so
  // a default under an optional or nullable wrapper must go too — otherwise
  // every chat-settings PUT reset the sidebar width.
  it('strips a default nested under optional or nullable, keeping the wrapper', () => {
    const schema = z.object({
      width: z.number().min(256).default(256).optional(),
      label: z.string().default('x').nullable(),
    })
    const patch = patchSchemaOf(schema)
    expect(patch.parse({})).toEqual({})
    expect(patch.parse({ label: null })).toEqual({ label: null })
    expect(patch.safeParse({ width: 10 }).success).toBe(false)
  })
})
