/**
 * The memory settings façade (memory refactor §3.1, Phase A): one typed read
 * of every memory knob, every default from its Zod schema, one cap resolver.
 */

jest.mock('@/lib/instance-settings', () => ({
  getMemoryExtractionLimits: jest.fn(),
  getMemoryExtractionModeSettings: jest.fn(),
  getMemoryRecallSettings: jest.fn(),
  getMemoryConsolidationSettings: jest.fn(),
  getMemoryMaintenanceSettings: jest.fn(),
}))

import * as instanceSettings from '@/lib/instance-settings'
import {
  resolveMemorySettings,
  resolveMemoryCap,
  MEMORY_SETTING_DEFAULTS,
  ADMISSION_THRESHOLDS,
  MEMORY_CAP_BOUNDS,
} from '@/lib/memory/settings'
import {
  MemoryConsolidationSettingsSchema,
  MemoryExtractionLimitsSchema,
  MemoryExtractionModeSettingsSchema,
  MemoryMaintenanceSettingsSchema,
  MemoryRecallSettingsSchema,
} from '@/lib/schemas/settings.types'
import { DEFAULT_RECALL_TUNING } from '@/lib/memory/recall-tuning'
import { MAX_REINFORCEMENT_FOOTNOTES } from '@/lib/memory/reinforcement-footnotes'

const mocked = instanceSettings as unknown as Record<string, jest.Mock>

function primeDefaults(maintenance = MemoryMaintenanceSettingsSchema.parse({})) {
  mocked.getMemoryExtractionLimits.mockResolvedValue(MemoryExtractionLimitsSchema.parse({}))
  mocked.getMemoryExtractionModeSettings.mockResolvedValue(MemoryExtractionModeSettingsSchema.parse({}))
  mocked.getMemoryRecallSettings.mockResolvedValue(MemoryRecallSettingsSchema.parse({}))
  mocked.getMemoryConsolidationSettings.mockResolvedValue(MemoryConsolidationSettingsSchema.parse({}))
  mocked.getMemoryMaintenanceSettings.mockResolvedValue(maintenance)
}

describe('MEMORY_SETTING_DEFAULTS', () => {
  it('equals the Zod defaults, key by key', () => {
    expect(MEMORY_SETTING_DEFAULTS.maintenance).toEqual(MemoryMaintenanceSettingsSchema.parse({}))
    expect(MEMORY_SETTING_DEFAULTS.consolidation).toEqual(MemoryConsolidationSettingsSchema.parse({}))
    expect(MEMORY_SETTING_DEFAULTS.recall).toEqual(MemoryRecallSettingsSchema.parse({}))
    expect(MEMORY_SETTING_DEFAULTS.extractionMode).toEqual(MemoryExtractionModeSettingsSchema.parse({}))
    expect(MEMORY_SETTING_DEFAULTS.extractionLimits).toEqual(MemoryExtractionLimitsSchema.parse({}))
    expect(MEMORY_SETTING_DEFAULTS.maintenance).toEqual({ enabled: false, perCharacterCap: 2000, perCharacterCapOverrides: {} })
  })

  it('the admission thresholds live in the façade alone', () => {
    expect(ADMISSION_THRESHOLDS).toEqual({ nearDuplicate: 0.9, reinforce: 0.85, related: 0.7, dateGuardDays: 7, footnoteCap: 8 })
    expect(MAX_REINFORCEMENT_FOOTNOTES).toBe(ADMISSION_THRESHOLDS.footnoteCap)
  })

  it('one cap bound, 100–100,000, which the schema enforces on overrides too', () => {
    expect(MEMORY_CAP_BOUNDS).toEqual({ min: 100, max: 100_000 })
    expect(MemoryMaintenanceSettingsSchema.safeParse({ perCharacterCap: 99 }).success).toBe(false)
    expect(MemoryMaintenanceSettingsSchema.safeParse({ perCharacterCap: 100_001 }).success).toBe(false)
    expect(MemoryMaintenanceSettingsSchema.safeParse({ perCharacterCapOverrides: { a: 10 } }).success).toBe(false)
    expect(MemoryMaintenanceSettingsSchema.safeParse({ perCharacterCapOverrides: { a: 500 } }).success).toBe(true)
  })
})

describe('resolveMemorySettings', () => {
  beforeEach(() => jest.clearAllMocks())

  it('with nothing stored, every value is its schema default', async () => {
    primeDefaults()
    const settings = await resolveMemorySettings('u1')
    expect(settings.extraction.limits).toEqual(MEMORY_SETTING_DEFAULTS.extractionLimits)
    expect(settings.extraction.mode).toEqual(MEMORY_SETTING_DEFAULTS.extractionMode)
    expect(settings.recall).toMatchObject(MEMORY_SETTING_DEFAULTS.recall)
    expect(settings.recall.tuning).toBe(DEFAULT_RECALL_TUNING)
    expect(settings.recall.minCosine).toEqual({ neural: 0.3, tfidf: 0.1 })
    expect(settings.admission).toBe(ADMISSION_THRESHOLDS)
    expect(settings.maintenance.consolidation).toEqual(MEMORY_SETTING_DEFAULTS.consolidation)
    expect(settings.maintenance.coldRetentionDays).toBeNull()
    expect(settings.maintenance.capFor('anyone')).toBe(2000)
  })

  it('capFor: override → perCharacterCap', async () => {
    primeDefaults({ enabled: true, perCharacterCap: 5000, perCharacterCapOverrides: { friday: 10000 } })
    const { maintenance } = await resolveMemorySettings()
    expect(maintenance.capFor('friday')).toBe(10000)
    expect(maintenance.capFor('someone-else')).toBe(5000)
    expect(maintenance.enabled).toBe(true)
  })

  it('resolveMemoryCap falls back to the schema default', () => {
    expect(resolveMemoryCap(null, 'x')).toBe(2000)
    expect(resolveMemoryCap({ perCharacterCap: 700, perCharacterCapOverrides: {} }, 'x')).toBe(700)
  })
})
