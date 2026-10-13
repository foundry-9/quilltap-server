/**
 * The Maintenance dialog (memory refactor Phase G): one dialog for the
 * settings card and the character page — rehearse with `?action=maintain`
 * `dryRun: true` and show the report, or queue the real run.
 */

import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MaintenanceDialog } from '@/components/memory/maintenance-dialog'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { showSuccessToast } from '@/lib/toast'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

const CHAR = '550e8400-e29b-41d4-a716-446655440001'
const mockFetch = global.fetch as jest.Mock

function json(data: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => data, text: async () => JSON.stringify(data) } as Response
}

function requestBody(call: number): Record<string, unknown> {
  return JSON.parse(mockFetch.mock.calls[call][1].body)
}

const REPORT = {
  characterId: CHAR,
  characterName: 'Ariadne',
  reason: 'manual',
  dryRun: true,
  startedAt: '2026-10-13T00:00:00.000Z',
  finishedAt: '2026-10-13T00:00:01.000Z',
  durationMs: 1000,
  phases: [
    { phase: 'fold-near-duplicates', status: 'ran', durationMs: 10 },
    { phase: 'consolidate', status: 'skipped', skippedBecause: 'not-requested', durationMs: 0 },
    { phase: 'demote', status: 'ran', durationMs: 10 },
    { phase: 'retire', status: 'skipped', skippedBecause: 'no-retention-window', durationMs: 0 },
    { phase: 'mirror', status: 'skipped', skippedBecause: 'not-requested', durationMs: 0 },
  ],
  fold: { eligible: 40, deferred: 0, groups: [{ survivorId: 'a', absorbedIds: ['b'], minCosine: 0.93 }], folded: 1, groupsFailed: 0, groupsDeferred: 0 },
  demote: { cap: 100, hotTotal: 130, demotable: 120, protected: 10, excess: 20, demoted: 20, demotedIds: [], highestScoreDemoted: 0.1 },
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('MaintenanceDialog', () => {
  it('rehearses the chosen phases for a fixed character and shows the report', async () => {
    mockFetch.mockResolvedValue(json({ success: true, dryRun: true, report: REPORT }))
    renderWithQuery(<MaintenanceDialog characterId={CHAR} characterName="Ariadne" onClose={jest.fn()} />)

    // Leave consolidation out of the rehearsal.
    fireEvent.click(screen.getByRole('checkbox', { name: /consolidate/i }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /dry run/i }))
    })

    await waitFor(() => expect(screen.getByText('Would archive')).toBeInTheDocument())
    expect(requestBody(0)).toEqual({ characterId: CHAR, phases: ['fold-near-duplicates', 'demote', 'retire'], dryRun: true })
    expect(screen.getByText(/no archive retention window is set/i)).toBeInTheDocument()
  })

  it('sends a cap for this run only when demotion is asked for', async () => {
    mockFetch.mockResolvedValue(json({ success: true, dryRun: true, report: REPORT }))
    renderWithQuery(<MaintenanceDialog characterId={CHAR} onClose={jest.fn()} />)
    fireEvent.change(screen.getByLabelText(/cap for this run/i), { target: { value: '500' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /dry run/i }))
    })
    expect(requestBody(0)).toMatchObject({ settings: { cap: 500 } })
  })

  it('will not rehearse consolidation for every character, but will queue it', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.includes('character-memory-counts')
        ? json({ characters: [{ id: CHAR, name: 'Ariadne', demotable: 12 }] })
        : json({ success: true, dryRun: false, jobIds: ['j1', 'j2'] }),
    )
    const onClose = jest.fn()
    const onQueued = jest.fn()
    renderWithQuery(<MaintenanceDialog onClose={onClose} onQueued={onQueued} />)
    await waitFor(() => expect(screen.getByRole('option', { name: /ariadne/i })).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/^character$/i), { target: { value: '__all__' } })
    expect(screen.getByRole('button', { name: /dry run/i })).toBeDisabled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /run for real/i }))
    })
    const post = mockFetch.mock.calls.find(([url]) => String(url).includes('action=maintain'))!
    expect(JSON.parse(post[1].body)).toEqual({
      phases: ['fold-near-duplicates', 'consolidate', 'demote', 'retire'],
      dryRun: false,
    })
    expect(showSuccessToast).toHaveBeenCalledWith(expect.stringContaining('2 characters'))
    expect(onQueued).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
