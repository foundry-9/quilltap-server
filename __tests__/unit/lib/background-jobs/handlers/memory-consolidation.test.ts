/** @jest-environment node */
import {
  handleMemoryConsolidation,
  CONSOLIDATION_JOB_TIME_BUDGET_MS,
} from '@/lib/background-jobs/handlers/memory-consolidation'
import { getMemoryConsolidationSettings } from '@/lib/instance-settings'
import { runConsolidation } from '@/lib/memory/consolidation'
import { logger } from '@/lib/logger'

jest.mock('@/lib/logger', () => {
  const child = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return {
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => child, __child: child },
  }
})
jest.mock('@/lib/instance-settings', () => ({ getMemoryConsolidationSettings: jest.fn() }))
jest.mock('@/lib/memory/consolidation', () => ({ runConsolidation: jest.fn() }))

const childLog = (logger as unknown as { __child: Record<string, jest.Mock> }).__child
const settingsMock = getMemoryConsolidationSettings as jest.Mock
const runMock = runConsolidation as jest.Mock

const stats = {
  digestsCreated: 1, digestsUpdated: 2, membersSuperseded: 3,
  clustersFailed: 0, clustersDeferred: 4, durationMs: 10,
}
function report(over: Record<string, unknown> = {}) {
  return { dryRun: false, clusters: [], stats, skippedReason: undefined, ...over }
}
function job(payload: unknown): any {
  return { id: 'job-1', userId: 'user-1', payload }
}

describe('handleMemoryConsolidation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    settingsMock.mockResolvedValue({ enabled: true })
    runMock.mockResolvedValue(report())
  })

  it('exports a budget safely under the ten-minute stuck-job threshold', () => {
    expect(CONSOLIDATION_JOB_TIME_BUDGET_MS).toBe(7 * 60 * 1000)
    expect(CONSOLIDATION_JOB_TIME_BUDGET_MS).toBeLessThan(10 * 60 * 1000)
  })

  it('warns and does nothing when the payload has no characterId', async () => {
    await handleMemoryConsolidation(job({}))
    await handleMemoryConsolidation(job(undefined))
    expect(runMock).not.toHaveBeenCalled()
    expect(childLog.warn).toHaveBeenCalledTimes(2)
  })

  it('treats a missing trigger as manual: runs without consulting settings', async () => {
    await handleMemoryConsolidation(job({ characterId: 'c1' }))
    expect(settingsMock).not.toHaveBeenCalled()
    expect(runMock).toHaveBeenCalledWith('c1', {
      dryRun: false,
      userId: 'user-1',
      timeBudgetMs: CONSOLIDATION_JOB_TIME_BUDGET_MS,
      trigger: 'manual',
    })
  })

  it('runs an explicit manual job even when consolidation is disabled', async () => {
    settingsMock.mockResolvedValue({ enabled: false })
    await handleMemoryConsolidation(job({ characterId: 'c1', trigger: 'manual' }))
    expect(runMock).toHaveBeenCalledTimes(1)
  })

  it.each(['scheduled', 'watermark'])('%s trigger exits without running when disabled', async (trigger) => {
    settingsMock.mockResolvedValue({ enabled: false })
    await handleMemoryConsolidation(job({ characterId: 'c1', trigger }))
    expect(runMock).not.toHaveBeenCalled()
    expect(childLog.debug).toHaveBeenCalled()
  })

  it.each(['scheduled', 'watermark'])('%s trigger runs when enabled and passes the trigger through', async (trigger) => {
    await handleMemoryConsolidation(job({ characterId: 'c1', trigger }))
    expect(runMock).toHaveBeenCalledWith('c1', expect.objectContaining({ trigger, timeBudgetMs: CONSOLIDATION_JOB_TIME_BUDGET_MS }))
  })

  it('forwards maxClustersPerRun only when supplied (including 0) and dryRun only when strictly true', async () => {
    await handleMemoryConsolidation(job({ characterId: 'c1', maxClustersPerRun: 0, dryRun: 'yes' }))
    const opts = runMock.mock.calls[0][1]
    expect(opts.maxClustersPerRun).toBe(0)
    expect(opts.dryRun).toBe(false)

    await handleMemoryConsolidation(job({ characterId: 'c1', dryRun: true }))
    expect(runMock.mock.calls[1][1].dryRun).toBe(true)
    expect('maxClustersPerRun' in runMock.mock.calls[1][1]).toBe(false)
  })

  it('logs each cluster of a dry run and then the completion line', async () => {
    runMock.mockResolvedValue(report({
      dryRun: true,
      clusters: [{
        bucket: { kind: 'person', subjectName: 'Ada' },
        clusterKind: 'subject', status: 'ok', memberIds: ['a', 'b'], existingDigestId: null,
        digests: [{ action: 'create', summary: 's', memberIds: ['a'] }],
        keepStandalone: ['b'], contradictions: [], error: undefined,
      }],
    }))
    await handleMemoryConsolidation(job({ characterId: 'c1', dryRun: true }))
    expect(childLog.info).toHaveBeenCalledWith('[Dry run] Consolidation cluster', expect.objectContaining({
      bucket: 'person:Ada', members: 2, keepStandalone: 1, contradictions: 0,
    }))
    expect(childLog.info).toHaveBeenCalledWith('Consolidation job complete', expect.objectContaining({
      dryRun: true, digestsCreated: 1, clustersDeferred: 4,
    }))
  })

  it('does not emit dry-run lines for a real run', async () => {
    await handleMemoryConsolidation(job({ characterId: 'c1' }))
    expect(childLog.info).toHaveBeenCalledTimes(1)
    expect(childLog.info).toHaveBeenCalledWith('Consolidation job complete', expect.any(Object))
  })

  it('propagates a failure from the service', async () => {
    runMock.mockRejectedValue(new Error('boom'))
    await expect(handleMemoryConsolidation(job({ characterId: 'c1' }))).rejects.toThrow('boom')
  })
})
