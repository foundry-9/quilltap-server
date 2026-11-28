/**
 * #279: a background change to a chat's state must not discard JSON the user is
 * typing, nor leave edit mode.
 */
import React from 'react'
import { screen, act, fireEvent } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import StateEditorModal from '@/components/state/StateEditorModal'
import { queryKeys } from '@/lib/query/keys'

jest.mock('@/components/ui/BaseModal', () => ({
  BaseModal: ({ children, footer }: any) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}))

describe('StateEditorModal draft', () => {
  it('keeps typed text and edit mode when state changes on the server', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ state: { a: 1 } }) }))
    const { queryClient } = renderWithQuery(
      <StateEditorModal isOpen onClose={jest.fn()} entityType="chat" entityId="c1" />,
    )
    const textarea = (await screen.findByLabelText(/State \(JSON\)/)) as HTMLTextAreaElement
    await screen.findByDisplayValue(/"a": 1/)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(textarea, { target: { value: '{"typed": true}' } })

    act(() => {
      queryClient.setQueryData(queryKeys.chats.state('c1'), { state: { a: 2 } })
    })

    const after = screen.getByLabelText(/State \(JSON\)/) as HTMLTextAreaElement
    expect(after.value).toBe('{"typed": true}')
    expect(after.readOnly).toBe(false)
  })
})
