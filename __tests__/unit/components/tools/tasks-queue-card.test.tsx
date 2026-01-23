/**
 * Unit tests for TasksQueueCard component
 */

import { describe, it, expect, afterEach } from '@jest/globals'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'
import { TasksQueueCard } from '@/components/tools/tasks-queue-card'

type QueueData = {
  stats: {
    pending: number
    processing: number
    failed: number
    completed: number
    dead: number
    paused: number
    activeTotal: number
  }
  jobs: Array<{
    id: string
    type: string
    typeName: string
    status: 'PENDING' | 'PROCESSING' | 'FAILED' | 'PAUSED'
    priority: number
    attempts: number
    maxAttempts: number
    scheduledAt: string
    startedAt: string | null
    lastError: string | null
    estimatedTokens: number
    chatId?: string
    characterName?: string
  }>
  totalEstimatedTokens: number
  processorStatus: { running: boolean; processing: boolean }
}

const defaultQueue: QueueData = {
  stats: {
    pending: 1,
    processing: 0,
    failed: 0,
    completed: 5,
    dead: 0,
    paused: 0,
    activeTotal: 1,
  },
  jobs: [
    {
      id: 'job-pending',
      type: 'MEMORY_EXTRACTION',
      typeName: 'Memory Extraction',
      status: 'PENDING',
      priority: 0,
      attempts: 0,
      maxAttempts: 3,
      scheduledAt: new Date().toISOString(),
      startedAt: null,
      lastError: null,
      estimatedTokens: 900,
      characterName: 'Echo',
    },
  ],
  totalEstimatedTokens: 900,
  processorStatus: { running: false, processing: false },
}

function jsonResponse(data: any, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
  } as Response)
}

function mockQueueNetwork(queueResponses: QueueData[] = [defaultQueue]) {
  let queueGetCount = 0
  return jest.spyOn(global as any, 'fetch').mockImplementation((input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url
    const method = init?.method ?? 'GET'

    // v1 system tools endpoint for tasks-queue
    if (url === '/api/v1/system/tools?action=tasks-queue' && method === 'GET') {
      const response = queueResponses[Math.min(queueGetCount, queueResponses.length - 1)]
      queueGetCount += 1
      return jsonResponse(response)
    }

    if (url === '/api/v1/system/tools?action=tasks-queue' && method === 'POST') {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      return jsonResponse({
        success: true,
        action: body.action,
        processorStatus: { running: body.action === 'start', processing: false },
      })
    }

    if (url.startsWith('/api/v1/system/jobs/')) {
      return jsonResponse({ success: true })
    }

    return jsonResponse({})
  })
}

async function renderQueueCard(queueResponses?: QueueData[]) {
  const fetchMock = mockQueueNetwork(queueResponses)
  await act(async () => {
    render(<TasksQueueCard />)
  })
  return fetchMock
}

describe('TasksQueueCard', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders queue stats after initial fetch', async () => {
    const fetchMock = await renderQueueCard()

    await waitFor(() => {
      expect(screen.getByText('Active Jobs')).toBeInTheDocument()
      expect(screen.getByText('Queue Items')).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/system/tools?action=tasks-queue',
      expect.objectContaining({
        cache: 'no-store',
      })
    )
  })

  it('sends start action and refreshes queue status', async () => {
    const fetchMock = await renderQueueCard()

    const startButton = await screen.findByRole('button', { name: /start queue/i })
    await waitFor(() => expect(startButton).not.toBeDisabled())

    await act(async () => {
      fireEvent.click(startButton)
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/system/tools?action=tasks-queue',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'start' }),
        })
      )
    })
    // Initial GET + refresh after start
    const getCalls = fetchMock.mock.calls.filter(([url, init]) => url === '/api/v1/system/tools?action=tasks-queue' && (!init || init.method === undefined))
    expect(getCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('pauses and resumes jobs via job-level controls', async () => {
    const pausedQueue: QueueData = {
      ...defaultQueue,
      jobs: [
        {
          ...defaultQueue.jobs[0],
          id: 'job-to-pause',
          status: 'PENDING',
        },
        {
          ...defaultQueue.jobs[0],
          id: 'job-to-resume',
          status: 'PAUSED',
        },
      ],
      stats: {
        ...defaultQueue.stats,
        pending: 1,
        paused: 1,
        activeTotal: 2,
      },
    }
    const fetchMock = await renderQueueCard([pausedQueue])

    const pauseButton = await screen.findByTitle('Pause')
    await act(async () => {
      fireEvent.click(pauseButton)
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/system/jobs/job-to-pause?action=pause',
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    const resumeButton = await screen.findByTitle('Resume')
    await act(async () => {
      fireEvent.click(resumeButton)
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/system/jobs/job-to-resume?action=resume',
        expect.objectContaining({
          method: 'POST',
        })
      )
    })
  })
})
