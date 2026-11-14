/**
 * ChatToolSettingsModal — a chat refetch hands the modal new (equal) arrays;
 * that must not reset the toggles the operator has changed but not saved.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '../../../helpers/renderWithQuery'
import ChatToolSettingsModal from '@/components/chat/ChatToolSettingsModal'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))
jest.mock('@/components/ui/BaseModal', () => ({
  BaseModal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
}))
jest.mock('@/components/tools/tool-settings', () => ({
  ToolSettingsContent: ({
    disabledTools,
    onDisabledToolsChange,
  }: {
    disabledTools: Set<string>
    onDisabledToolsChange: (next: Set<string>) => void
  }) => (
    <div>
      <span data-testid="disabled">{Array.from(disabledTools).sort().join(',')}</span>
      <button onClick={() => onDisabledToolsChange(new Set([...disabledTools, 'search_web']))}>disable search</button>
    </div>
  ),
}))

const mockFetch = global.fetch as jest.Mock
const client = createTestQueryClient()
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

describe('ChatToolSettingsModal draft', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ tools: [] }) })
  })

  it('keeps unsaved toggles when the chat is refetched', async () => {
    const props = { isOpen: true, onClose: jest.fn(), chatId: 'c1', disabledToolGroups: [] as string[] }
    const { rerender } = render(<ChatToolSettingsModal {...props} disabledTools={['rng']} />, { wrapper })

    fireEvent.click(screen.getByText('disable search'))
    expect(screen.getByTestId('disabled').textContent).toBe('rng,search_web')

    // The chat refetch: same values, new array identities.
    rerender(<ChatToolSettingsModal {...props} disabledTools={['rng']} disabledToolGroups={[]} />)
    expect(screen.getByTestId('disabled').textContent).toBe('rng,search_web')

    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/chats/c1?action=update-tool-settings',
      expect.objectContaining({ method: 'POST' }),
    ))
    const body = JSON.parse(mockFetch.mock.calls.find(([u]) => String(u).includes('update-tool-settings'))![1].body)
    expect(body.disabledTools.sort()).toEqual(['rng', 'search_web'])
  })

  it('adopts a server change while nothing is edited', () => {
    const props = { isOpen: true, onClose: jest.fn(), chatId: 'c1', disabledToolGroups: [] as string[] }
    const { rerender } = render(<ChatToolSettingsModal {...props} disabledTools={['rng']} />, { wrapper })
    rerender(<ChatToolSettingsModal {...props} disabledTools={['rng', 'image']} />)
    expect(screen.getByTestId('disabled').textContent).toBe('image,rng')
  })
})
