/**
 * The help chat knows which page the user is on inside the workspace (#247):
 * the focused pane's active tab, not the always-`/workspace` pathname, and a
 * tab switch with a help chat open updates the chat's context once.
 */

import React from 'react'
import { act, render, screen } from '@testing-library/react'
import {
  HelpChatProvider,
  HelpChatWorkspaceBridge,
  useHelpChat,
} from '@/components/providers/help-chat-provider'

let mockPathname = '/workspace'
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }))

// One stable result: a fresh object per render would re-run the provider's
// eligibility sync on every render.
jest.mock('@tanstack/react-query', () => {
  const result = { data: { characters: [] }, isPending: false, refetch: () => Promise.resolve() }
  return { useQuery: () => result }
})

type MockTab = { id: string; kind: string; payload?: unknown; title: string }
let mockWorkspace: {
  hydrated: boolean
  state: { tabs: Record<string, MockTab>; panes: { left: { order: string[]; activeTabId: string | null } }; focusedPane: 'left' }
} | null = null
jest.mock('@/components/providers/workspace-provider', () => ({
  useWorkspaceOptional: () => mockWorkspace,
}))

function workspaceWith(tab: MockTab) {
  return {
    hydrated: true,
    state: {
      tabs: { [tab.id]: tab },
      panes: { left: { order: [tab.id], activeTabId: tab.id } },
      focusedPane: 'left' as const,
    },
  }
}

const latestRef: { current: ReturnType<typeof useHelpChat> | null } = { current: null }
function Probe() {
  const helpChat = useHelpChat()
  React.useEffect(() => {
    latestRef.current = helpChat
  })
  return <div data-testid="url">{helpChat.currentPageUrl}</div>
}

function tree() {
  return (
    <HelpChatProvider>
      <HelpChatWorkspaceBridge />
      <Probe />
    </HelpChatProvider>
  )
}

beforeEach(() => {
  mockPathname = '/workspace'
  mockWorkspace = null
  latestRef.current = null
  localStorage.clear()
  global.fetch = jest.fn(async () => new Response('{}')) as unknown as typeof fetch
  jest.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('HelpChatProvider inside the workspace', () => {
  it('reports the focused tab as the current page', () => {
    mockWorkspace = workspaceWith({ id: 't1', kind: 'settings', payload: { section: 'api-keys' }, title: 'S' })
    render(tree())
    expect(screen.getByTestId('url')).toHaveTextContent('/settings?section=api-keys')
  })

  it('falls back to the pathname outside the workspace', () => {
    mockPathname = '/setup'
    mockWorkspace = workspaceWith({ id: 't1', kind: 'settings', title: 'S' })
    render(tree())
    expect(screen.getByTestId('url')).toHaveTextContent('/setup')
  })

  it('updates an open help chat once when the tab changes', () => {
    mockWorkspace = workspaceWith({ id: 't1', kind: 'settings', title: 'S' })
    const { rerender } = render(tree())
    act(() => latestRef.current!.openHelpChat())
    act(() => latestRef.current!.setCurrentChatId('help-1'))
    ;(global.fetch as jest.Mock).mockClear()

    mockWorkspace = workspaceWith({ id: 't2', kind: 'salon', payload: { chatId: 'c9' }, title: 'C' })
    rerender(tree())

    expect(screen.getByTestId('url')).toHaveTextContent('/salon/c9')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('/api/v1/help-chats/help-1?action=update-context')
    expect(JSON.parse(init.body)).toEqual({ pageUrl: '/salon/c9' })
  })
})
