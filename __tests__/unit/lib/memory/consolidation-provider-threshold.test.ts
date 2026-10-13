/**
 * Consolidation clusters on the default embedding profile's scale: the
 * TF-IDF threshold for a Built-in profile, the neural one otherwise, and an
 * explicit per-run threshold on either (builtin-tfidf-memory-tuning §5).
 * Driven through the maintenance run's consolidate phase (memory refactor
 * Phase F), which must pass only the run's own overrides.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/instance-settings', () => {
  const schemas = jest.requireActual('@/lib/schemas/settings.types')
  return {
    getMemoryConsolidationSettings: jest.fn(async () => schemas.MemoryConsolidationSettingsSchema.parse({})),
    getMemoryMaintenanceSettings: jest.fn(async () => schemas.MemoryMaintenanceSettingsSchema.parse({})),
    getMemoryExtractionLimits: jest.fn(async () => ({})),
    getMemoryExtractionModeSettings: jest.fn(async () => ({})),
    getMemoryRecallSettings: jest.fn(async () => ({})),
  }
})

import { runMaintenance } from '@/lib/memory/maintenance/run'
import type { ConsolidationReport } from '@/lib/memory/consolidation'

/** The consolidate phase alone, dry. */
async function runConsolidation(
  characterId: string,
  opts: { dryRun: true; settings?: { clusterThreshold: number } },
): Promise<ConsolidationReport> {
  const run = await runMaintenance({
    characterId,
    reason: 'manual',
    dryRun: opts.dryRun,
    phases: ['consolidate'],
    ...(opts.settings ? { settings: { consolidation: opts.settings } } : {}),
  })
  return run.consolidation as ConsolidationReport
}
import { getRepositories } from '@/lib/repositories/factory'

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>

function withProvider(provider: string | null) {
  const character = { id: 'c-1', userId: 'u-1', name: 'Lorian', archivedAt: null }
  mockGetRepositories.mockReturnValue({
    characters: {
      findByIdRaw: jest.fn().mockResolvedValue(character),
      findById: jest.fn().mockResolvedValue(character),
    },
    embeddingProfiles: {
      findDefault: jest.fn().mockResolvedValue(provider ? { id: 'p', provider } : null),
    },
    memories: {
      findByCharacterIdInBatches: async function* () {},
    },
  } as never)
}

describe('consolidate phase: cluster threshold by provider', () => {
  it('uses the TF-IDF threshold when the default profile is Built-in', async () => {
    withProvider('BUILTIN')
    const report = await runConsolidation('c-1', { dryRun: true })
    expect(report.settings.clusterThreshold).toBe(0.3)
  })

  it('uses the neural threshold otherwise', async () => {
    withProvider('OPENAI')
    expect((await runConsolidation('c-1', { dryRun: true })).settings.clusterThreshold).toBe(0.72)
    withProvider(null)
    expect((await runConsolidation('c-1', { dryRun: true })).settings.clusterThreshold).toBe(0.72)
  })

  it('an explicit per-run threshold wins', async () => {
    withProvider('BUILTIN')
    const report = await runConsolidation('c-1', { dryRun: true, settings: { clusterThreshold: 0.12 } })
    expect(report.settings.clusterThreshold).toBe(0.12)
  })
})
