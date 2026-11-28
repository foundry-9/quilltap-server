/**
 * #302: a refetch of a running room's status (its counters move every turn)
 * must not overwrite budget edits the user has typed but not saved.
 */
import React from 'react'
import { screen, act, fireEvent } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { EditEnclaveModal } from '@/components/new-chat/EditEnclaveModal'
import { queryKeys } from '@/lib/query/keys'

jest.mock('@/components/ui/BaseModal', () => ({
  BaseModal: ({ children, footer }: any) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}))
jest.mock('@/hooks/useChatSettingsQuery', () => ({
  useChatSettingsQuery: () => ({ data: undefined }),
}))
jest.mock('@/components/new-chat/AutonomousRoomCard', () => ({
  AutonomousRoomCard: ({ value, onChange }: any) => (
    <input
      aria-label="Max turns"
      value={value.budgetMaxTurns ?? ''}
      onChange={(e) => onChange({ budgetMaxTurns: Number(e.target.value) })}
    />
  ),
}))

const status = (turns: number | null, consumed: number) => ({
  scheduleCron: null,
  scheduleFreshnessWindowMs: null,
  budgetMaxTurns: turns,
  budgetMaxTokens: null,
  budgetMaxWallClockMs: null,
  budgetEstimatedSpendCapUSD: null,
  budgetExcludeCacheHits: 1,
  runVisibility: null,
  runDestructiveToolsAllowed: 0,
  runTurnsConsumed: consumed,
})

describe('EditEnclaveModal draft', () => {
  it('keeps typed edits when the status is re-read with new counters', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => status(10, 1) }))
    const { queryClient } = renderWithQuery(
      <EditEnclaveModal isOpen onClose={jest.fn()} chatId="c1" currentTitle="Room" />,
    )
    const input = (await screen.findByLabelText('Max turns')) as HTMLInputElement
    expect(input.value).toBe('10')

    fireEvent.change(input, { target: { value: '42' } })
    expect(input.value).toBe('42')

    act(() => {
      queryClient.setQueryData(queryKeys.chats.autonomousRoom('c1'), status(10, 7))
    })
    expect((screen.getByLabelText('Max turns') as HTMLInputElement).value).toBe('42')
  })
})
