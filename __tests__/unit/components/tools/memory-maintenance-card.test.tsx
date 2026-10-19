/**
 * The Maintenance card (memory refactor Phase G, decision 11): one card for
 * the maintenance job. Each switch saves one field — the phase toggles as a
 * phases patch, consolidation's through its own document — and the ledger
 * reads `?action=maintenance-status`.
 */

import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryMaintenanceCard } from '@/components/tools/memory-maintenance-card'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

jest.mock('@/hooks/useConnectionProfiles', () => ({
  useConnectionProfiles: () => ({ profiles: [] }),
}))

const CHAR = '550e8400-e29b-41d4-a716-446655440001'
const mockFetch = global.fetch as jest.Mock

function json(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) } as Response
}

const MAINTENANCE = {
  enabled: true,
  perCharacterCap: 2000,
  perCharacterCapOverrides: {},
  phases: { foldNearDuplicates: true, demote: true, retire: true },
}
const CONSOLIDATION = {
  enabled: false,
  connectionProfileId: 'profile-1',
  clusterThreshold: 0.72,
  tfidfClusterThreshold: 0.3,
  minClusterSize: 3,
  maxClusterSize: 30,
  matureAfterDays: 7,
  maxClustersPerRun: 40,
  watermark: 150,
  coldRetentionDays: 90,
}

function route(url: string, init?: RequestInit) {
  if (url.includes('maintenance-config')) {
    if (init?.method === 'POST') {
      const patch = JSON.parse(String(init.body))
      return json({ settings: { ...MAINTENANCE, ...patch } })
    }
    return json({ settings: MAINTENANCE })
  }
  if (url.includes('consolidation-config')) {
    if (init?.method === 'POST') return json({ settings: { ...CONSOLIDATION, ...JSON.parse(String(init.body)) } })
    return json({ settings: CONSOLIDATION })
  }
  if (url.includes('character-memory-counts')) {
    return json({ characters: [{ id: CHAR, name: 'Ariadne', demotable: 2100, protected: 5 }] })
  }
  if (url.includes('maintenance-status')) {
    return json({
      ledger: [
        {
          characterId: CHAR,
          lastRun: { demote: { at: '2026-10-13T10:00:00.000Z', reason: 'watermark' } },
          lastSummary: {
            characterId: CHAR,
            reason: 'watermark',
            dryRun: false,
            finishedAt: '2026-10-13T10:00:00.000Z',
            durationMs: 50,
            phases: [],
            demote: { cap: 2000, hotTotal: 2105, demotable: 2100, protected: 5, excess: 100, demoted: 100, highestScoreDemoted: 0.2 },
          },
          lastDemotion: null,
        },
      ],
    })
  }
  return json({})
}

function posts(fragment: string) {
  return mockFetch.mock.calls
    .filter(([url, init]) => String(url).includes(fragment) && init?.method === 'POST')
    .map(([, init]) => JSON.parse(init.body))
}

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => route(url, init))
})

describe('MemoryMaintenanceCard', () => {
  it('saves one phase toggle as a phases patch, and consolidation through its own document', async () => {
    renderWithQuery(<MemoryMaintenanceCard />)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /demote over the cap/i })).toBeInTheDocument())

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /demote over the cap/i }))
    })
    expect(posts('maintenance-config')).toEqual([{ phases: { foldNearDuplicates: true, demote: false, retire: true } }])

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /^consolidate/i }))
    })
    expect(posts('consolidation-config')).toEqual([{ enabled: true }])
  })

  it('clears the archive retention with a blank, as null', async () => {
    renderWithQuery(<MemoryMaintenanceCard />)
    const input = await screen.findByLabelText(/archive retention/i)
    // The card renders its defaults first; wait for the loaded document.
    await waitFor(() => expect(input).toHaveValue(90))
    fireEvent.change(input, { target: { value: '' } })
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(posts('consolidation-config')).toEqual([{ coldRetentionDays: null }])
  })

  it('saves a typed per-character cap on blur (review of PR 98)', async () => {
    renderWithQuery(<MemoryMaintenanceCard />)
    const input = await screen.findByLabelText(/per-character cap/i)
    await waitFor(() => expect(input).toHaveValue(2000))
    fireEvent.change(input, { target: { value: '3000' } })
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(posts('maintenance-config')).toEqual([{ perCharacterCap: 3000 }])
    expect(input).toHaveValue(3000)
  })

  it('shows the ledger by character name with the last run’s outcome', async () => {
    renderWithQuery(<MemoryMaintenanceCard />)
    await waitFor(() => expect(screen.getByText(/100 archived \(2100\/2000 counted\)/)).toBeInTheDocument())
    expect(screen.getAllByText('Ariadne').length).toBeGreaterThan(0)
  })
})
