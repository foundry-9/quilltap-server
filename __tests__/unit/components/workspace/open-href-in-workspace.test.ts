/**
 * `openHrefInWorkspace` — the one place an in-app href becomes a workspace tab,
 * shared by the link interceptor and `useWorkspaceNavigate`.
 */
import { openHrefInWorkspace } from '@/components/workspace/open-href-in-workspace'
import { requestMessageReveal } from '@/lib/chat/message-navigation'

jest.mock('@/lib/chat/message-navigation', () => ({
  ...jest.requireActual('@/lib/chat/message-navigation'),
  requestMessageReveal: jest.fn(),
}))

const mockReveal = requestMessageReveal as jest.Mock

describe('openHrefInWorkspace', () => {
  beforeEach(() => mockReveal.mockReset())

  it('opens the tab an href maps to and reports it handled', () => {
    const openTab = jest.fn()
    expect(openHrefInWorkspace('/settings', openTab)).toBe(true)
    expect(openTab).toHaveBeenCalledTimes(1)
    expect(openTab.mock.calls[0][0]).toBe('settings')
  })

  it('leaves an href with no tab equivalent alone', () => {
    const openTab = jest.fn()
    expect(openHrefInWorkspace('/unlock', openTab)).toBe(false)
    expect(openTab).not.toHaveBeenCalled()
  })

  it("asks the Salon to reveal a message named by ?msg=", () => {
    const openTab = jest.fn()
    expect(openHrefInWorkspace('/salon/chat-1?msg=m-9', openTab)).toBe(true)
    expect(mockReveal).toHaveBeenCalledWith('chat-1', 'm-9')
  })

  it('pops the New Chat modal for a character ?action=chat only when the caller can', () => {
    const openTab = jest.fn()
    const openNewChat = jest.fn()
    openHrefInWorkspace('/aurora/c-1?action=chat', openTab, openNewChat)
    expect(openNewChat).toHaveBeenCalledWith({ characterId: 'c-1' })

    const second = jest.fn()
    expect(() => openHrefInWorkspace('/aurora/c-1?action=chat', second)).not.toThrow()
    expect(second).toHaveBeenCalled()
  })
})
