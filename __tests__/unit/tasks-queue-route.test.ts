/**
 * Unit tests for Tasks Queue API route (app/api/tools/tasks-queue/route.ts)
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { BackgroundJob } from '@/lib/schemas/types'
import { getServerSession } from '@/lib/auth/session'
import { startProcessor, stopProcessor, getProcessorStatus } from '@/lib/background-jobs/processor'
import { BackgroundJobsRepository } from '@/lib/mongodb/repositories/background-jobs.repository'

jest.mock('@/lib/auth/session', () => ({
  getServerSession: jest.fn(),
}))

jest.mock('@/lib/background-jobs/processor', () => ({
  __esModule: true,
  startProcessor: jest.fn(),
  stopProcessor: jest.fn(),
  getProcessorStatus: jest.fn(),
}))

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>
let getStatsSpy: jest.SpyInstance<Promise<any>, [string?]>
let findByUserIdSpy: jest.SpyInstance<Promise<any>, [string, string?]>
const processorMock = jest.requireMock('@/lib/background-jobs/processor') as {
  startProcessor: jest.Mock
  stopProcessor: jest.Mock
  getProcessorStatus: jest.Mock
}
const mockStartProcessor = processorMock.startProcessor
const mockStopProcessor = processorMock.stopProcessor
const mockGetProcessorStatus = processorMock.getProcessorStatus
let GET: typeof import('@/app/api/tools/tasks-queue/route').GET
let POST: typeof import('@/app/api/tools/tasks-queue/route').POST

describe('Tasks Queue API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.isolateModules(() => {
      const repoModule = require('@/lib/mongodb/repositories/background-jobs.repository')
      getStatsSpy = jest.spyOn(repoModule.BackgroundJobsRepository.prototype, 'getStats').mockResolvedValue({
        pending: 1,
        processing: 1,
        failed: 1,
        completed: 5,
        dead: 0,
        paused: 1,
      })
      findByUserIdSpy = jest.spyOn(repoModule.BackgroundJobsRepository.prototype, 'findByUserId').mockResolvedValue([])
      const routesModule = require('@/app/api/tools/tasks-queue/route')
      GET = routesModule.GET
      POST = routesModule.POST
    })
    mockStartProcessor.mockReset()
    mockStopProcessor.mockReset()
    mockGetProcessorStatus.mockReset()
    mockStartProcessor.mockImplementation(() => {})
    mockStopProcessor.mockImplementation(() => {})
    mockGetProcessorStatus.mockReturnValue({ running: false, processing: false })
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123', email: 'u@example.com' },
    } as any)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const buildJob = (overrides: Partial<BackgroundJob>): BackgroundJob => ({
    id: overrides.id ?? 'job-1',
    userId: 'user-123',
    type: overrides.type ?? 'MEMORY_EXTRACTION',
    status: overrides.status ?? 'PENDING',
    priority: overrides.priority ?? 0,
    attempts: overrides.attempts ?? 0,
    maxAttempts: overrides.maxAttempts ?? 3,
    createdAt: overrides.createdAt ?? '2024-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2024-01-01T00:00:00.000Z',
    scheduledAt: overrides.scheduledAt ?? '2024-01-01T00:00:00.000Z',
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    lastError: overrides.lastError ?? null,
    payload: overrides.payload ?? {},
    tags: overrides.tags ?? [],
  })

  describe('GET', () => {
    it('returns queue stats, active jobs, and estimated tokens', async () => {
      const pendingJob = buildJob({
        id: 'pending-job',
        type: 'MEMORY_EXTRACTION',
        status: 'PENDING',
        payload: {
          userMessage: 'hello world', // 3 tokens (ceil(11/4))
          assistantMessage: 'response', // 2 tokens
        },
      })
      const processingJob = buildJob({
        id: 'processing-job',
        type: 'TITLE_UPDATE',
        status: 'PROCESSING',
      })
      const failedJob = buildJob({
        id: 'failed-job',
        type: 'INTER_CHARACTER_MEMORY',
        status: 'FAILED',
        attempts: 1,
        maxAttempts: 3,
        payload: {},
      })
      const pausedJob = buildJob({
        id: 'paused-job',
        type: 'MEMORY_EXTRACTION',
        status: 'PAUSED',
        payload: { userMessage: '', assistantMessage: '' },
      })

      findByUserIdSpy.mockImplementation(async (_userId: string, status?: string) => {
        switch (status) {
          case 'PENDING':
            return [pendingJob]
          case 'PROCESSING':
            return [processingJob]
          case 'FAILED':
            return [failedJob]
          case 'PAUSED':
            return [pausedJob]
          default:
            return []
        }
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.stats).toEqual(
        expect.objectContaining({
          pending: 1,
          processing: 1,
          failed: 1,
          completed: 5,
          dead: 0,
          activeTotal: 4,
        })
      )
      expect(body.jobs).toHaveLength(4)
      // Token calc:
      // pendingJob -> 500 + 3 + 2 + 300 = 805
      // processingJob -> 500 + 300 = 800
      // failedJob -> 500 + 0 + 0 + 400 = 900
      // pausedJob -> 500 + 0 + 0 + 300 = 800
      expect(body.totalEstimatedTokens).toBe(3305)
      expect(body.processorStatus).toEqual({ running: false, processing: false })
      expect(findByUserIdSpy).toHaveBeenCalled()
    })

    it('returns 401 when session is missing', async () => {
      mockGetServerSession.mockResolvedValueOnce(null as any)

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body).toEqual({ error: 'Unauthorized' })
      expect(getStatsSpy).not.toHaveBeenCalled()
    })
  })

  describe('POST', () => {
    it('starts the processor when action is start', async () => {
      const request = {
        json: async () => ({ action: 'start' }),
      } as any
      mockGetProcessorStatus.mockReturnValue({ running: true, processing: false })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(mockStartProcessor).toHaveBeenCalled()
      expect(mockStopProcessor).not.toHaveBeenCalled()
      expect(body).toEqual({
        success: true,
        action: 'start',
        processorStatus: { running: true, processing: false },
      })
    })

    it('stops the processor when action is stop', async () => {
      const request = {
        json: async () => ({ action: 'stop' }),
      } as any
      mockGetProcessorStatus.mockReturnValue({ running: false, processing: false })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(mockStopProcessor).toHaveBeenCalled()
      expect(mockStartProcessor).not.toHaveBeenCalled()
      expect(body.processorStatus.running).toBe(false)
    })

    it('validates action input', async () => {
      const request = {
        json: async () => ({ action: 'invalid' }),
      } as any

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toEqual({ error: 'Invalid action. Must be "start" or "stop"' })
      expect(mockStartProcessor).not.toHaveBeenCalled()
    })

    it('returns 401 for unauthenticated requests', async () => {
      mockGetServerSession.mockResolvedValueOnce(null as any)
      const request = {
        json: async () => ({ action: 'start' }),
      } as any

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body).toEqual({ error: 'Unauthorized' })
    })
  })
})
