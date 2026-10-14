/**
 * The cosine cut-offs follow the embedding provider: the Built-in (TF-IDF)
 * profile scores far lower than a neural one (builtin-tfidf-memory-tuning §3, §5).
 */

import {
  ADMISSION_THRESHOLDS,
  ADMISSION_THRESHOLDS_TFIDF,
  admissionThresholdsForProvider,
  resolveClusterThreshold,
} from '@/lib/memory/settings-defaults'
import { decideAdmission } from '@/lib/memory/admission/decide'
import { MemoryConsolidationSettingsSchema } from '@/lib/schemas/settings.types'
import type { Memory } from '@/lib/schemas/types'

const candidate = { holderId: 'c-1', aboutId: null, kind: 'semantic' as const, source: 'AUTO' as const, occurredAt: null }
const row = (id: string) => ({ id, characterId: 'c-1', kind: 'semantic', source: 'AUTO', tier: 'hot' }) as unknown as Memory

describe('admissionThresholdsForProvider', () => {
  it('picks the TF-IDF set for BUILTIN and the neural set otherwise', () => {
    expect(admissionThresholdsForProvider('BUILTIN')).toBe(ADMISSION_THRESHOLDS_TFIDF)
    expect(admissionThresholdsForProvider('OPENAI')).toBe(ADMISSION_THRESHOLDS)
    expect(admissionThresholdsForProvider(undefined)).toBe(ADMISSION_THRESHOLDS)
  })

  it('keeps the bands ordered and shares the date guard and footnote cap', () => {
    const t = ADMISSION_THRESHOLDS_TFIDF
    expect(t.related).toBeLessThan(t.reinforce)
    expect(t.reinforce).toBeLessThan(t.nearDuplicate)
    expect(t.dateGuardDays).toBe(ADMISSION_THRESHOLDS.dateGuardDays)
    expect(t.footnoteCap).toBe(ADMISSION_THRESHOLDS.footnoteCap)
  })

  it('a TF-IDF restatement (0.45) reinforces, a different fact (0.08) is ignored, same topic (0.29) links', () => {
    const decide = (cosine: number) =>
      decideAdmission({ candidate, neighbours: [{ memory: row('m'), cosine }], thresholds: ADMISSION_THRESHOLDS_TFIDF }).action.kind
    expect(decide(0.45)).toBe('reinforce')
    expect(decide(0.85)).toBe('absorb')
    expect(decide(0.29)).toBe('insert-linked')
    expect(decide(0.08)).toBe('insert')
  })
})

describe('resolveClusterThreshold', () => {
  const settings = MemoryConsolidationSettingsSchema.parse({})

  it('defaults to 0.72 for neural profiles and 0.30 for Built-in', () => {
    expect(resolveClusterThreshold(settings, 'OPENAI')).toBe(0.72)
    expect(resolveClusterThreshold(settings, 'BUILTIN')).toBe(0.3)
    expect(resolveClusterThreshold(settings, null)).toBe(0.72)
  })

  it('honours each stored value and a per-run override on either provider', () => {
    const custom = { ...settings, clusterThreshold: 0.65, tfidfClusterThreshold: 0.25 }
    expect(resolveClusterThreshold(custom, 'OLLAMA')).toBe(0.65)
    expect(resolveClusterThreshold(custom, 'BUILTIN')).toBe(0.25)
    expect(resolveClusterThreshold(custom, 'BUILTIN', 0.12)).toBe(0.12)
    expect(resolveClusterThreshold(custom, 'OPENAI', 0.5)).toBe(0.5)
  })

  it('older stored settings without the new field parse to its default', () => {
    expect(MemoryConsolidationSettingsSchema.parse({ clusterThreshold: 0.7 }).tfidfClusterThreshold).toBe(0.3)
  })
})
