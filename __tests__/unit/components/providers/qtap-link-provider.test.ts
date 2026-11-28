/**
 * #248: a qtap:// link outside a chat opened the document into whatever Salon
 * was open in any pane. The chat a link belongs to is now the tab it is
 * rendered in, and nothing else.
 */

jest.mock('next/navigation', () => ({ usePathname: jest.fn(), useRouter: jest.fn() }))
jest.mock('@/components/chat/ImageModal', () => ({ __esModule: true, default: () => null }))

import { chatIdForLink } from '@/components/providers/qtap-link-provider'
import type { WorkspaceState, WorkspaceTab } from '@/lib/workspace/types'

function tab(id: string, kind: WorkspaceTab['kind'], payload?: unknown): WorkspaceTab {
  return { id, kind, payload, title: id } as WorkspaceTab
}

/** A files tab focused on the left, a Salon in the right pane's order. */
const state: WorkspaceState = {
  tabs: {
    files: tab('files', 'scriptorium'),
    help: tab('help', 'help'),
    salon: tab('salon', 'salon', { chatId: 'chat-1' }),
    doc: tab('doc', 'document', { chatId: 'chat-1' }),
  },
  panes: {
    left: { order: ['files', 'help'], activeTabId: 'files' },
    right: { order: ['salon', 'doc'], activeTabId: 'salon' },
  },
  focusedPane: 'left',
  splitRatio: 0.5,
}

describe('chatIdForLink (#248)', () => {
  it('chooses no chat for a link in a non-chat tab, though a Salon is open in the other pane', () => {
    expect(chatIdForLink(state, '/workspace', 'files')).toBeNull()
    expect(chatIdForLink(state, '/workspace', 'help')).toBeNull()
  })

  it('chooses the chat of the Salon (or its document pane) the link is in', () => {
    expect(chatIdForLink(state, '/workspace', 'salon')).toBe('chat-1')
    expect(chatIdForLink(state, '/workspace', 'doc')).toBe('chat-1')
  })

  it('without a tab id, reads only the focused pane’s active tab', () => {
    expect(chatIdForLink(state, '/workspace', null)).toBeNull()
    expect(chatIdForLink({ ...state, focusedPane: 'right' }, '/workspace', null)).toBe('chat-1')
  })

  it('on a legacy /salon route, the route names the chat', () => {
    expect(chatIdForLink(undefined, '/salon/chat-9', null)).toBe('chat-9')
  })
})
