/**
 * Consolidation clusters on the default embedding profile's scale: the
 * TF-IDF threshold for a Built-in profile, the neural one otherwise, and an
 * explicit per-run threshold on either (builtin-tfidf-memory-tuning §5).
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/instance-settings', () => ({
  getMemoryConsolidationSettings: jest.fn(async () =>
    jest.requireActual('@/lib/schemas/settings.types').MemoryConsolidationSettingsSchema.parse({}),
  ),
}))

import { runConsolidation } from '@/lib/memory/consolidation'
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

describe('runConsolidation cluster threshold by provider', () => {
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
