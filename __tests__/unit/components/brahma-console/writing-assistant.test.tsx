/**
 * Brahma Console UI — the Writing Assistant switch (launcher only) and badge
 * (in a conversation), the context dialog, the output card's toolbar, and the
 * composer's attachments (with the Help Chat composer unchanged when the prop
 * is absent).
 */

import React from 'react'
import { screen, fireEvent, waitFor, render } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { HelpChatComposer } from '@/components/help-chat/HelpChatComposer'
import { WritingOutputCard } from '@/components/brahma-console/WritingOutputCard'
import { ConsoleContextDialog } from '@/components/brahma-console/ConsoleContextDialog'
import { BrahmaConsolePanel } from '@/components/brahma-console/BrahmaConsolePanel'
import type { ConsoleAttachmentsApi } from '@/components/brahma-console/hooks/useConsoleAttachments'
import type { BrahmaConsoleSession } from '@/components/brahma-console/hooks/useBrahmaConsoleSession'

jest.mock('@/components/chat/MessageContent', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))
jest.mock('@/components/chat/ThinkingBlock', () => ({ ThinkingBlock: () => null }))
jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))
jest.mock('@/components/providers/brahma-console-provider', () => ({
  useBrahmaConsole: () => ({ profiles: [], isEligible: true }),
}))

const CHAT = '11111111-1111-4111-8111-111111111111'

// jsdom has no layout, so no scrollIntoView (the transcript scrolls on load).
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
})

function serve(route: (path: string, method: string) => unknown) {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const payload = route(url.pathname, init?.method ?? 'GET') ?? {}
    return { ok: true, status: 200, statusText: 'OK', json: async () => payload } as Response
  }) as unknown as typeof fetch
}

function attachmentsApi(overrides: Partial<ConsoleAttachmentsApi> = {}): ConsoleAttachmentsApi {
  return {
    pending: [],
    addFiles: jest.fn(),
    remove: jest.fn(),
    uploading: false,
    readyIds: [],
    clearAfterSend: jest.fn(),
    ...overrides,
  }
}

function session(overrides: Partial<BrahmaConsoleSession> = {}): BrahmaConsoleSession {
  return {
    currentChatId: null,
    setCurrentChatId: jest.fn(),
    activeConnectionProfileId: null,
    setActiveConnectionProfileId: jest.fn(),
    setModel: jest.fn(async () => {}),
    pendingWriting: false,
    setPendingWriting: jest.fn(),
    pendingContext: [],
    setPendingContext: jest.fn(),
    clearPending: jest.fn(),
    ...overrides,
  }
}

function renderPanel(s: BrahmaConsoleSession) {
  return renderWithQuery(
    <BrahmaConsolePanel session={s} active>
      {({ headerActions, body }) => (
        <div>
          <header>{headerActions}</header>
          {body}
        </div>
      )}
    </BrahmaConsolePanel>,
  )
}

describe('HelpChatComposer', () => {
  it('is the Help Chat composer when attachments are absent', () => {
    const onSend = jest.fn()
    render(<HelpChatComposer onSend={onSend} />)
    expect(screen.queryByRole('button', { name: 'Attach files' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith('hello')
  })

  it('shows pending chips and lets one be removed', () => {
    const api = attachmentsApi({
      pending: [{ key: 'k1', filename: 'notes.md', mimeType: 'text/markdown', size: 4, previewUrl: null, status: 'ready', id: 'f1', error: null }],
      readyIds: ['f1'],
    })
    render(<HelpChatComposer onSend={jest.fn()} attachments={api} />)
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument()
    expect(screen.getByText('notes.md')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove notes.md' }))
    expect(api.remove).toHaveBeenCalledWith('k1')
  })

  it('holds Send while an upload is in flight', () => {
    const api = attachmentsApi({
      pending: [{ key: 'k1', filename: 'a.png', mimeType: 'image/png', size: 4, previewUrl: null, status: 'uploading', id: null, error: null }],
      uploading: true,
    })
    render(<HelpChatComposer onSend={jest.fn()} attachments={api} />)
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'look' } })
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('sends attachments with no text, then clears them', () => {
    const onSend = jest.fn()
    const api = attachmentsApi({
      pending: [{ key: 'k1', filename: 'a.webp', mimeType: 'image/webp', size: 4, previewUrl: null, status: 'ready', id: 'f1', error: null }],
      readyIds: ['f1'],
    })
    render(<HelpChatComposer onSend={onSend} attachments={api} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith('', ['f1'])
    expect(api.clearAfterSend).toHaveBeenCalled()
  })
})

describe('WritingOutputCard', () => {
  it('copies the stored Markdown verbatim and toggles to the source', async () => {
    const writeText = jest.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    renderWithQuery(<WritingOutputCard chatId={CHAT} messageId="m1" content={'# Title\n\n*Body*'} filename="piece.md" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy the Markdown' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('# Title\n\n*Body*'))

    expect(screen.getByRole('button', { name: 'Download piece.md' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save to a document store' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    expect(screen.getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('pre')?.textContent).toBe('# Title\n\n*Body*')
  })

  it('has no toolbar while it is a draft', () => {
    renderWithQuery(<WritingOutputCard chatId={CHAT} messageId={null} content="Still typing" filename="x.md" draft />)
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(screen.getByText(/Draft/)).toBeInTheDocument()
  })
})

describe('ConsoleContextDialog', () => {
  it('lists conversations with their cast and hands back the picks with labels', async () => {
    serve((path) => {
      if (path === '/api/v1/chats') {
        return { chats: [
          { id: CHAT, title: 'The Night Train', chatType: 'salon', lastMessageAt: null, updatedAt: '2026-10-19T00:00:00Z', participants: [{ character: { name: 'Vivienne' } }] },
          { id: 'help-1', title: 'Help me', chatType: 'help', lastMessageAt: null, updatedAt: '2026-10-19T00:00:00Z', participants: [] },
        ] }
      }
      if (path === '/api/v1/projects') return { projects: [{ id: 'p1', name: 'Ashfall' }] }
      if (path === '/api/v1/mount-points') return { mountPoints: [{ id: 's1', name: 'House Style', enabled: true }] }
      return {}
    })
    const onAdd = jest.fn()
    renderWithQuery(<ConsoleContextDialog isOpen onClose={jest.fn()} existingKeys={new Set()} onAdd={onAdd} />)

    const conv = await screen.findByLabelText(/The Night Train/)
    expect(screen.queryByText('Help me')).toBeNull()
    expect(screen.getByText(/Vivienne/)).toBeInTheDocument()
    fireEvent.click(conv)
    fireEvent.click(await screen.findByLabelText(/Ashfall/))
    fireEvent.click(screen.getByRole('button', { name: /^Add/ }))

    expect(onAdd).toHaveBeenCalledWith([
      { ref: { kind: 'chat', id: CHAT }, label: 'The Night Train', detail: 'Vivienne' },
      { ref: { kind: 'project', id: 'p1' }, label: 'Ashfall' },
    ])
  })
})

describe('BrahmaConsolePanel — the Writing Assistant control', () => {
  it('shows an unchecked switch on the launcher, and no context bar while off', async () => {
    serve(() => ({ chats: [] }))
    const s = session()
    renderPanel(s)
    const sw = screen.getByRole('switch', { name: /Writing Assistant/ })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('button', { name: /Add to context/ })).toBeNull()
    fireEvent.click(sw)
    expect(s.setPendingWriting).toHaveBeenCalledWith(true)
  })

  it('shows the context bar on the launcher when the switch is on', () => {
    serve(() => ({ chats: [] }))
    renderPanel(session({
      pendingWriting: true,
      pendingContext: [{ ref: { kind: 'general' }, label: 'Quilltap General' }],
    }))
    expect(screen.getByRole('switch', { name: /Writing Assistant/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Quilltap General')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Quilltap General from the context' })).toBeInTheDocument()
  })

  it('shows a badge, not a switch, in a Writing Assistant conversation', async () => {
    serve((path) => {
      if (path === `/api/v1/brahma-console/${CHAT}/messages`) return { messages: [] }
      if (path === `/api/v1/brahma-console/${CHAT}`) {
        return { chat: { id: CHAT, title: 'Desk', consoleConnectionProfileId: null, consoleMode: 'writing', contextRefs: [], context: { conversations: [], projects: [], stores: [], general: null, characterVaults: [], missing: [] } } }
      }
      return {}
    })
    renderPanel(session({ currentChatId: CHAT }))
    await screen.findByTitle(/settled when a conversation opens/)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByRole('button', { name: /Add to context/ })).toBeInTheDocument()
  })

  it('shows neither in an ordinary conversation', async () => {
    serve((path) => {
      if (path === `/api/v1/brahma-console/${CHAT}/messages`) return { messages: [] }
      if (path === `/api/v1/brahma-console/${CHAT}`) {
        return { chat: { id: CHAT, title: 'Chat', consoleConnectionProfileId: null, consoleMode: null, contextRefs: null, context: null } }
      }
      return {}
    })
    renderPanel(session({ currentChatId: CHAT }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(`/api/v1/brahma-console/${CHAT}`))
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByTitle(/settled when a conversation opens/)).toBeNull()
  })
})
