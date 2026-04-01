/**
 * Unit tests for BackupRestoreCard component
 *
 * Tests the simplified backup/restore UI that supports:
 * - Creating backups (download to local)
 * - Opening the restore dialog for file uploads
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import React from 'react'
import BackupRestoreCard from '@/components/tools/backup-restore-card'

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

  it('renders backup and restore buttons', async () => {
    await act(async () => {
      render(<BackupRestoreCard />)
    })

    expect(screen.getByRole('button', { name: /create backup/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /restore from backup/i })).toBeInTheDocument()
  })

  it('shows info text about backups', async () => {
    await act(async () => {
      render(<BackupRestoreCard />)
    })

    expect(screen.getByText(/backups include all your characters/i)).toBeInTheDocument()
  })

  it('opens backup dialog and triggers download on confirm', async () => {
    const mockBackupId = 'test-backup-id'
    const mockManifest = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      counts: { characters: 5, chats: 10 }
    }

    const fetchMock = jest.spyOn(global as any, 'fetch').mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url
      if (url === '/api/v1/system/backup') {
        return jsonResponse({ success: true, backupId: mockBackupId, manifest: mockManifest }, true)
      }
      if (url === `/api/v1/system/backup/${mockBackupId}`) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['test data'], { type: 'application/zip' })
        } as Response)
      }
      return jsonResponse({})
    })

    await act(async () => {
      render(<BackupRestoreCard />)
    })

    // Click Create Backup to open the dialog
    const createButton = screen.getByRole('button', { name: /create backup/i })
    await act(async () => {
      fireEvent.click(createButton)
    })

    // Dialog should be open - find the Download Backup button in the dialog
    await waitFor(() => {
      expect(screen.getByText(/your backup will include/i)).toBeInTheDocument()
    })

    // Click the Download Backup button in the dialog
    const downloadButton = screen.getByRole('button', { name: /download backup/i })
    await act(async () => {
      fireEvent.click(downloadButton)
    })

    await waitFor(() => {
      // Verify backup creation API was called
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/system/backup', expect.objectContaining({
        method: 'POST'
      }))
    })
  })

  it('opens restore dialog when restore button is clicked', async () => {
    await act(async () => {
      render(<BackupRestoreCard />)
    })

    const restoreButton = screen.getByRole('button', { name: /restore from backup/i })
    await act(async () => {
      fireEvent.click(restoreButton)
    })

    // The restore dialog should now be visible
    await waitFor(() => {
      expect(screen.getByText(/restore backup/i)).toBeInTheDocument()
    })
  })
})
