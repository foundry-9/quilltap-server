/**
 * Unit tests for BackupRestoreCard component
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import React from 'react'
import BackupRestoreCard from '@/components/tools/backup-restore-card'

const backups = [
  {
    key: 'backup-1',
    filename: 'chat-2024-01-01.quilltap',
    createdAt: '2024-01-01T12:00:00.000Z',
    size: 2048,
  },
]

function jsonResponse(data: any, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
  } as Response)
}

describe('BackupRestoreCard', () => {
  beforeEach(() => {
    // no-op
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('lists cloud backups returned by the API', async () => {
    const fetchMock = jest.spyOn(global as any, 'fetch').mockImplementation((input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url
      if (url === '/api/tools/backup/list') {
        return jsonResponse({ backups })
      }
      if (url === '/api/tools/backup/delete' && init?.method === 'DELETE') {
        return jsonResponse({ success: true })
      }
      return jsonResponse({})
    })

    await act(async () => {
      render(<BackupRestoreCard />)
    })

    await waitFor(() => {
      expect(screen.getByText(backups[0].filename)).toBeInTheDocument()
      expect(screen.getByText(/Cloud Backups/)).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/tools/backup/list', expect.any(Object))
  })

  it('sends delete request after confirmation and refreshes list', async () => {
    let listCall = 0
    const fetchMock = jest.spyOn(global as any, 'fetch').mockImplementation((input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url
      if (url === '/api/tools/backup/list') {
        listCall += 1
        return jsonResponse({ backups: listCall === 1 ? backups : [] })
      }
      if (url === '/api/tools/backup/delete' && init?.method === 'DELETE') {
        return jsonResponse({ success: true })
      }
      return jsonResponse({})
    })

    await act(async () => {
      render(<BackupRestoreCard />)
    })

    const deleteButton = await screen.findByRole('button', { name: /delete/i })
    await act(async () => {
      fireEvent.click(deleteButton)
    })
    expect(screen.getByText('Delete?')).toBeInTheDocument()

    const confirmButton = screen.getByRole('button', { name: 'Yes' })
    await act(async () => {
      fireEvent.click(confirmButton)
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/tools/backup/delete',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ s3Key: backups[0].key }),
        })
      )
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/tools/backup/list', expect.any(Object))
      expect(listCall).toBeGreaterThanOrEqual(2)
    })
  })
})
