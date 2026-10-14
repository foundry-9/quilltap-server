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
})
