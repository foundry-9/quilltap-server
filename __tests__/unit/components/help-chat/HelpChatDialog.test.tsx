/** #303: a failed new conversation is reported; New Chat ends a streaming reply. */
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { HelpChatDialog } from '@/components/help-chat/HelpChatDialog'

const stopStreaming = jest.fn()
const setCurrentChatId = jest.fn()
let currentChatId: string | null = null

jest.mock('@/components/providers/help-chat-provider', () => ({
  useHelpChat: () => ({
    isOpen: true,
    closeHelpChat: jest.fn(),
    currentChatId,
    setCurrentChatId,
    eligibleCharacters: [{ id: 'c1', name: 'Ada', hasToolCapableProfile: true }],
    selectedCharacterIds: ['c1'],
    toggleCharacter: jest.fn(),
    currentPageUrl: '/',
  }),
}))
jest.mock('@/components/workspace/useWorkspaceNavigate', () => ({ useWorkspaceNavigate: () => jest.fn() }))
jest.mock('@/components/ui/FloatingDialog', () => ({
  FloatingDialog: ({ children, headerActions }: { children: React.ReactNode; headerActions?: React.ReactNode }) => (
    <div>{headerActions}{children}</div>
  ),
}))
jest.mock('@/components/help-chat/hooks/useHelpChatStreaming', () => ({
  useHelpChatStreaming: () => ({
    isStreaming: true,
    streamingContent: 'half an answer',
    streamingParticipantId: null,
    streamingNavigationLinks: [],
    suggestedLinks: [],
    isExecutingTools: false,
    error: null,
    sendMessage: jest.fn(),
    stopStreaming,
  }),
}))
jest.mock('@/components/help-chat/HelpChatMessageList', () => ({ HelpChatMessageList: () => <div /> }))
jest.mock('@/components/help-chat/HelpGuideTab', () => ({ HelpGuideTab: () => <div /> }))
jest.mock('@/components/help-chat/HelpEntityPicker', () => ({
  HelpEntityPicker: () => <div />,
  hasParamSegments: () => false,
}))

describe('HelpChatDialog', () => {
  beforeEach(() => {
    stopStreaming.mockClear()
    currentChatId = null
    sessionStorage.setItem('quilltap:help-tab', 'ask')
    global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Boom from server' }) })
      }
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ chats: [] }), text: async () => '{"chats":[]}' })
    }) as unknown as typeof fetch
  })

  it('shows an error and returns the question when creation fails', async () => {
    renderWithQuery(<HelpChatDialog />)
    const box = await screen.findByPlaceholderText('What would you like help with?')
    fireEvent.change(box, { target: { value: 'How do I export?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('Boom from server')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByPlaceholderText('What would you like help with?')).toHaveValue('How do I export?'),
    )
  })

  it('stops the stream when New Chat is clicked', async () => {
    currentChatId = 'chat-1'
    renderWithQuery(<HelpChatDialog />)
    const btn = await screen.findByRole('button', { name: /new help chat/i })
    fireEvent.click(btn)
    expect(stopStreaming).toHaveBeenCalled()
  })
})
