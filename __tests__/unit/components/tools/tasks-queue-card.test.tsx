/**
 * Unit tests for TasksQueueCard component
 */

import { describe, it, expect, afterEach } from '@jest/globals'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '../../../helpers/renderWithQuery'
import { TasksQueueCard } from '@/components/tools/tasks-queue'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast } from '@/lib/toast'

jest.mock('@/lib/alert', () => ({
  showConfirmation: jest.fn(),
}))

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

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

function mockQueueNetwork(
  queueResponses: QueueData[] = [defaultQueue],
  failJobActions = false,
) {
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

    const control = /^\/api\/v1\/system\/tools\?action=tasks-queue-(start|stop)$/.exec(url)
    if (control && method === 'POST') {
      const action = control[1]
      return jsonResponse({
        success: true,
        action,
        processorStatus: { running: action === 'start', processing: false },
      })
    }

    if (url.startsWith('/api/v1/system/jobs/')) {
      if (failJobActions) return jsonResponse({ error: 'The job ledger is locked' }, false)
      return jsonResponse({ success: true })
    }

    if (url === '/api/v1/system/tools?action=job-concurrency' && method === 'POST') {
      return jsonResponse({ success: true })
    }

    return jsonResponse({})
  })
}

async function renderQueueCard(queueResponses?: QueueData[], failJobActions = false) {
  const fetchMock = mockQueueNetwork(queueResponses, failJobActions)
  const queryClient = createTestQueryClient()
  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <TasksQueueCard />
      </QueryClientProvider>
    )
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
      expect.anything()
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
        '/api/v1/system/tools?action=tasks-queue-start',
        expect.objectContaining({ method: 'POST' })
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

  it('saves the concurrency slider when changed from the keyboard (#259)', async () => {
    const fetchMock = await renderQueueCard([{ ...defaultQueue, maxConcurrentJobs: 4 } as QueueData])

    const slider = await screen.findByLabelText(/Simultaneous Labours/)
    await waitFor(() => expect(slider).toHaveValue('4'))

    await act(async () => {
      slider.focus()
      fireEvent.keyDown(slider, { key: 'ArrowRight' })
      fireEvent.change(slider, { target: { value: '5' } })
      fireEvent.keyUp(slider, { key: 'ArrowRight' })
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/system/tools?action=job-concurrency',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ concurrency: 5 }) }),
      )
    })
    // One release, one save — the trailing blur does not save twice.
    act(() => slider.blur())
    const saves = fetchMock.mock.calls.filter(([url]) => url === '/api/v1/system/tools?action=job-concurrency')
    expect(saves).toHaveLength(1)
  })

  it('reports a failed pause instead of failing silently (#327)', async () => {
    await renderQueueCard([defaultQueue], true)

    const pauseButton = await screen.findByTitle('Pause')
    await act(async () => {
      fireEvent.click(pauseButton)
    })

    expect(await screen.findByText('The job ledger is locked')).toBeInTheDocument()
    expect(showErrorToast).toHaveBeenCalledWith('The job ledger is locked')
  })

  it('asks before deleting a job, and deletes nothing when declined (#327)', async () => {
    const confirm = showConfirmation as jest.Mock
    confirm.mockResolvedValueOnce(false)
    const fetchMock = await renderQueueCard()

    const deleteButton = await screen.findByTitle('Delete')
    await act(async () => {
      fireEvent.click(deleteButton)
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    const deletes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')
    expect(deletes()).toHaveLength(0)

    confirm.mockResolvedValueOnce(true)
    await act(async () => {
      fireEvent.click(deleteButton)
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/system/jobs/job-pending',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
    expect(deletes()).toHaveLength(1)
  })
})
