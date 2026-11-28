/**
 * The Almanack card survives being collapsed mid-run (#325): `CollapsibleCard`
 * unmounts its body, so the run lives outside the card. A card that mounts
 * mid-run shows the progress bar with Generate disabled, and the finished
 * report's dialog opens when the run completes.
 */

import React from 'react'
import { screen, fireEvent, act, waitFor } from '@testing-library/react'
import { CapabilitiesReportCard } from '@/components/tools/capabilities-report-card'
import { renderWithQuery, createTestQueryClient } from '../../../helpers/renderWithQuery'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

jest.mock('@/lib/alert', () => ({
  showConfirmation: jest.fn(),
}))

jest.mock('@/components/tools/capabilities-report-dialog', () => ({
  CapabilitiesReportDialog: ({ isOpen, filename }: { isOpen: boolean; filename: string }) =>
    isOpen ? <div role="dialog">Report: {filename}</div> : null,
}))

const mockFetch = global.fetch as jest.Mock

function respond(data: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: '',
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response
}

describe('CapabilitiesReportCard', () => {
  let resolveGenerate: (value: Response) => void

  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('capabilities-report-list')) return Promise.resolve(respond({ reports: [] }))
      // The progress stream: no body, so the reader stops quietly.
      if (u.includes('capabilities-report-progress')) return Promise.resolve(respond({}, 404))
      if (u.includes('capabilities-report-generate') && init?.method === 'POST') {
        return new Promise<Response>(resolve => {
          resolveGenerate = resolve
        })
      }
      return Promise.resolve(respond({}))
    })
    if (!globalThis.crypto?.randomUUID) {
      Object.defineProperty(globalThis, 'crypto', {
        value: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
        configurable: true,
      })
    }
  })

  it('keeps the run across an unmount and remount, and shows the report when it finishes', async () => {
    const queryClient = createTestQueryClient()
    const first = renderWithQuery(<CapabilitiesReportCard />, { queryClient })

    fireEvent.click(await screen.findByRole('button', { name: 'Compile the Almanack' }))
    expect(await screen.findByRole('button', { name: 'Compiling the Almanack…' })).toBeDisabled()

    // Collapse the card mid-run, then reopen it.
    first.unmount()
    renderWithQuery(<CapabilitiesReportCard />, { queryClient })

    const generate = await screen.findByRole('button', { name: 'Compiling the Almanack…' })
    expect(generate).toBeDisabled()

    await act(async () => {
      resolveGenerate(
        respond({
          success: true,
          reportId: 'r1',
          filename: 'almanack-2026-11-27.md',
          storageKey: 'k',
          size: 10,
          content: '# Almanack',
        }),
      )
    })

    expect(await screen.findByRole('dialog')).toHaveTextContent('almanack-2026-11-27.md')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Compile the Almanack' })).not.toBeDisabled(),
    )
  })

  it('shows a report that finished while no card was mounted on the next mount', async () => {
    const queryClient = createTestQueryClient()
    const first = renderWithQuery(<CapabilitiesReportCard />, { queryClient })

    fireEvent.click(await screen.findByRole('button', { name: 'Compile the Almanack' }))
    await screen.findByRole('button', { name: 'Compiling the Almanack…' })
    first.unmount()

    await act(async () => {
      resolveGenerate(
        respond({
          success: true,
          reportId: 'r2',
          filename: 'almanack-late.md',
          storageKey: 'k',
          size: 10,
          content: '# Late',
        }),
      )
    })

    renderWithQuery(<CapabilitiesReportCard />, { queryClient })
    expect(await screen.findByRole('dialog')).toHaveTextContent('almanack-late.md')
  })
})
