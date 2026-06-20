/**
 * Tests for ComposeMailDialog (The Post Office composer modal).
 *
 * Verifies the From/To/In-reply-to field logic and the Send gating:
 *  - From is fixed (disabled) with one player-character, a dropdown with ≥2,
 *    and only lists `controlledBy: 'user'` participants.
 *  - To excludes the chosen From character.
 *  - In-reply-to defaults to "No quoted reply." and lists the From mailbox.
 *  - Send is disabled on an empty body and enabled once a body is typed.
 *  - Changing From resets the reply selection and refetches that mailbox.
 *  - Empty-state when the operator plays no one.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import React from 'react'
import ComposeMailDialog from '@/components/chat/ComposeMailDialog'

// Lexical is too heavy for jsdom; swap in a plain textarea keyed by aria-label.
jest.mock('@/components/markdown-editor/MarkdownLexicalEditor', () => ({
  __esModule: true,
  default: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

// FloatingDialog uses portals / ResizeObserver — render a simple passthrough.
jest.mock('@/components/ui/FloatingDialog', () => ({
  __esModule: true,
  FloatingDialog: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
    isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null,
}))

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

const PLAYER_A = 'aaaa1111'
const PLAYER_B = 'bbbb2222'
const NPC = 'cccc3333'

const REGINALD = 'dddd4444'

interface RouteOpts {
  mailbox?: Record<string, Array<{ path: string; from: string; sentAt: string }>>
  characters?: Array<{ id: string; name: string; controlledBy?: 'llm' | 'user'; title?: string | null }>
}

function routeFetch(opts: RouteOpts = {}) {
  return jest
    .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
    .mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      const mailboxMatch = url.match(/action=mailbox&characterId=([^&]+)/)
      if (mailboxMatch) {
        const charId = decodeURIComponent(mailboxMatch[1])
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ letters: opts.mailbox?.[charId] ?? [] }),
        } as Response)
      }
      if (url.includes('action=send-mail')) {
        return Promise.resolve({ ok: true, status: 201, json: async () => ({ success: true, path: 'Mail/x.md' }) } as Response)
      }
      if (url.startsWith('/api/v1/characters')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ characters: opts.characters ?? [] }) } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
    })
}

function participant(id: string, name: string, controlledBy: 'llm' | 'user') {
  return { id, name, controlledBy, avatarUrl: null }
}

/** A workspace-character entry for the `/api/v1/characters` list. */
function char(id: string, name: string, controlledBy: 'llm' | 'user' = 'llm') {
  return { id, name, controlledBy }
}

describe('ComposeMailDialog', () => {
  let fetchSpy: ReturnType<typeof routeFetch>

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('shows a fixed (disabled) From with one player-character and excludes it from To', async () => {
    fetchSpy = routeFetch({ characters: [char(PLAYER_A, 'Bertie', 'user'), char(NPC, 'Jeeves', 'llm')] })
    renderWithQuery(
      <ComposeMailDialog
        isOpen
        onClose={() => {}}
        chatId="chat-1"
        onPosted={() => {}}
        participants={[participant(PLAYER_A, 'Bertie', 'user'), participant(NPC, 'Jeeves', 'llm')]}
      />,
    )

    const from = screen.getByLabelText('Signed by') as HTMLSelectElement
    expect(from.disabled).toBe(true)
    expect(from.value).toBe(PLAYER_A)

    // The To list loads from /api/v1/characters.
    await screen.findByRole('option', { name: /Jeeves/ })
    const to = screen.getByLabelText('Addressed to') as HTMLSelectElement
    const toValues = Array.from(to.options).map((o) => o.value)
    expect(toValues).toContain(NPC)
    expect(toValues).not.toContain(PLAYER_A)
  })

  it('lists workspace characters who are NOT in the chat as recipients', async () => {
    // Reginald is in the workspace but not a participant of this chat.
    fetchSpy = routeFetch({
      characters: [char(PLAYER_A, 'Bertie', 'user'), char(NPC, 'Jeeves', 'llm'), char(REGINALD, 'Reginald', 'llm')],
    })
    renderWithQuery(
      <ComposeMailDialog
        isOpen
        onClose={() => {}}
        chatId="chat-1"
        onPosted={() => {}}
        participants={[participant(PLAYER_A, 'Bertie', 'user'), participant(NPC, 'Jeeves', 'llm')]}
      />,
    )

    await screen.findByRole('option', { name: /Reginald/ })
    const to = screen.getByLabelText('Addressed to') as HTMLSelectElement
    const toValues = Array.from(to.options).map((o) => o.value)
    expect(toValues).toContain(REGINALD)
    expect(toValues).toContain(NPC)
    expect(toValues).not.toContain(PLAYER_A) // From is excluded
  })

  it('lists only user-controlled participants in the From dropdown when there are ≥2', () => {
    fetchSpy = routeFetch()
    renderWithQuery(
      <ComposeMailDialog
        isOpen
        onClose={() => {}}
        chatId="chat-1"
        onPosted={() => {}}
        participants={[
          participant(PLAYER_A, 'Bertie', 'user'),
          participant(PLAYER_B, 'Wooster', 'user'),
          participant(NPC, 'Jeeves', 'llm'),
        ]}
      />,
    )

    const from = screen.getByLabelText('Signed by') as HTMLSelectElement
    expect(from.disabled).toBe(false)
    const fromValues = Array.from(from.options).map((o) => o.value)
    expect(fromValues).toEqual(expect.arrayContaining([PLAYER_A, PLAYER_B]))
    expect(fromValues).not.toContain(NPC)
  })

  it('defaults In-reply-to to "No quoted reply." and lists the From mailbox', async () => {
    fetchSpy = routeFetch({
      mailbox: { [PLAYER_A]: [{ path: 'Mail/1.md', from: 'Aunt Agatha', sentAt: '2026-06-14T10:00:00.000Z' }] },
    })
    renderWithQuery(
      <ComposeMailDialog
        isOpen
        onClose={() => {}}
        chatId="chat-1"
        onPosted={() => {}}
        participants={[participant(PLAYER_A, 'Bertie', 'user'), participant(NPC, 'Jeeves', 'llm')]}
      />,
    )

    const reply = screen.getByLabelText('In reply to') as HTMLSelectElement
    expect(reply.value).toBe('') // "No quoted reply."

    // The mailbox letter shows up as an option once the query resolves.
    await screen.findByRole('option', { name: /Aunt Agatha/ })
    const replyValues = Array.from(reply.options).map((o) => o.value)
    expect(replyValues).toContain('Mail/1.md')
  })

  it('disables Send on an empty body and enables it once a body is typed', async () => {
    fetchSpy = routeFetch({ characters: [char(PLAYER_A, 'Bertie', 'user'), char(NPC, 'Jeeves', 'llm')] })
    renderWithQuery(
      <ComposeMailDialog
        isOpen
        onClose={() => {}}
        chatId="chat-1"
        onPosted={() => {}}
        participants={[participant(PLAYER_A, 'Bertie', 'user'), participant(NPC, 'Jeeves', 'llm')]}
      />,
    )

    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)

    // Send also needs a recipient — wait for the workspace character list.
    await screen.findByRole('option', { name: /Jeeves/ })
    fireEvent.change(screen.getByLabelText('The body of your letter'), { target: { value: 'Dear Jeeves' } })
    expect(send.disabled).toBe(false)
  })

  it('refetches the mailbox when From changes', async () => {
    fetchSpy = routeFetch({
      mailbox: {
        [PLAYER_A]: [{ path: 'Mail/a.md', from: 'Aunt', sentAt: '2026-06-14T10:00:00.000Z' }],
        [PLAYER_B]: [{ path: 'Mail/b.md', from: 'Uncle', sentAt: '2026-06-13T10:00:00.000Z' }],
      },
    })
    renderWithQuery(
      <ComposeMailDialog
        isOpen
        onClose={() => {}}
        chatId="chat-1"
        onPosted={() => {}}
        participants={[
          participant(PLAYER_A, 'Bertie', 'user'),
          participant(PLAYER_B, 'Wooster', 'user'),
          participant(NPC, 'Jeeves', 'llm'),
        ]}
      />,
    )

    await screen.findByRole('option', { name: /Aunt/ })

    fireEvent.change(screen.getByLabelText('Signed by'), { target: { value: PLAYER_B } })

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(`action=mailbox&characterId=${PLAYER_B}`),
        expect.anything(),
      ),
    )
  })

  it('shows an empty-state and disables Send when the operator plays no one', () => {
    fetchSpy = routeFetch()
    renderWithQuery(
      <ComposeMailDialog
        isOpen
        onClose={() => {}}
        chatId="chat-1"
        onPosted={() => {}}
        participants={[participant(NPC, 'Jeeves', 'llm')]}
      />,
    )

    expect(screen.getByText(/aren.t playing anyone/i)).toBeInTheDocument()
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
