/** #277: the badge is a link beside a button, never a button inside a link; the button names its real verb. */
import { screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { AutonomousRoomBadges } from '@/components/layout/autonomous-room-badges'

jest.mock('@/hooks/useRealtime', () => ({ useRealtimeRefetchInterval: () => false }))
jest.mock('@/hooks/useNow', () => ({ useNow: () => 0 }))
jest.mock('@/lib/query/fetcher', () => ({
  ...jest.requireActual('@/lib/query/fetcher'),
  apiFetch: jest.fn().mockResolvedValue({
    rooms: [
      {
        id: 'r1', title: 'Idle Room', projectId: null, projectName: null, runState: 'idle',
        runStateMessage: null, runStartedAt: null, runEndedAt: null, runPausedAccumMs: 0,
        runTurnsConsumed: 0, runTokensConsumed: 0,
      },
    ],
  }),
}))

describe('AutonomousRoomBadges', () => {
  it('names an idle room button "Start" and keeps it outside the link', async () => {
    renderWithQuery(<AutonomousRoomBadges />)
    const button = await waitFor(() => screen.getByRole('button', { name: /^Start/ }))
    expect(button.closest('a')).toBeNull()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/salon/r1')
  })
})
