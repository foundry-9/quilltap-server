/**
 * Tests for InformDialog — the out-of-character word to the cast.
 *
 * Verifies:
 *  - user-controlled seats never appear in the audience row;
 *  - Everyone is selected by default and a seat pick deselects it;
 *  - Inform is gated on a non-empty body;
 *  - Everyone posts `targetParticipantIds: null`, a subset posts the ids,
 *    and ticking every seat collapses back to null;
 *  - a successful post calls onPosted and closes.
 */

import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import React from 'react'
import InformDialog from '@/components/chat/InformDialog'

// Lexical is too heavy for jsdom; swap in a plain textarea keyed by aria-label.
jest.mock('@/components/markdown-editor/MarkdownLexicalEditor', () => ({
  __esModule: true,
  default: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

// FloatingDialog uses portals / localStorage geometry — render a passthrough.
jest.mock('@/components/ui/FloatingDialog', () => ({
  __esModule: true,
  FloatingDialog: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
    isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null,
}))

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

const ALICE = 'aaaa1111-1111-1111-1111-111111111111'
const BOB = 'bbbb2222-2222-2222-2222-222222222222'
const PLAYER = 'cccc3333-3333-3333-3333-333333333333'

const CANDIDATES = [
  { participantId: ALICE, name: 'Alice', controlledBy: 'llm' as const, status: 'active' as const },
  { participantId: BOB, name: 'Bob', controlledBy: 'llm' as const, status: 'silent' as const },
  { participantId: PLAYER, name: 'The Operator', controlledBy: 'user' as const, status: 'active' as const },
]

function mockPost() {
  return jest
    .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
    .mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 201,
        json: async () => ({ batchId: 'batch-1', targetParticipantIds: null, message: null }),
      } as Response),
    )
}

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof InformDialog>> = {},
) {
  const onClose = jest.fn()
  const onPosted = jest.fn()
  const result = renderWithQuery(
    <InformDialog
      isOpen
      onClose={onClose}
      chatId="chat-1"
      audienceCandidates={CANDIDATES}
      onPosted={onPosted}
      {...overrides}
    />,
  )
  return { ...result, onClose, onPosted }
}

/**
 * The JSON body of the most recent `?action=inform` POST. Most recent, not
 * first: `jest.spyOn` on an already-mocked `global.fetch` can hand back a spy
 * that still carries the previous test's calls.
 */
function postedBody(spy: jest.SpyInstance): Record<string, unknown> {
  const calls = spy.mock.calls.filter(([url]) => String(url).includes('action=inform'))
  const init = calls[calls.length - 1]?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body ?? '{}'))
}

describe('InformDialog — audience', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('offers every LLM seat and never the user-controlled one', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: /Alice/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Bob/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /The Operator/ })).toBeNull()
  })

  it('shows a silent seat with its status and still lets it be picked', () => {
    renderDialog()
    const bob = screen.getByRole('button', { name: /Bob/ })
    expect(bob.textContent).toContain('(silent)')
    fireEvent.click(bob)
    expect(bob.getAttribute('aria-pressed')).toBe('true')
  })

  it('starts on Everyone and drops it the moment a seat is picked', () => {
    renderDialog()
    const everyone = screen.getByRole('button', { name: 'Everyone' })
    expect(everyone.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: /Alice/ }))
    expect(everyone.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Everyone' }))
    expect(screen.getByRole('button', { name: /Alice/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('says so when no seat is played by a model', () => {
    renderDialog({ audienceCandidates: [CANDIDATES[2]] })
    expect(screen.getByText(/nobody to take/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Inform' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('InformDialog — posting', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('disables Inform until the passage has a body', () => {
    renderDialog()
    const submit = screen.getByRole('button', { name: 'Inform' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('What they are told'), {
      target: { value: 'You notice the clock has stopped.' },
    })
    expect(submit.disabled).toBe(false)
  })

  it('posts null targets for Everyone, then closes and reports', async () => {
    const spy = mockPost()
    const { onClose, onPosted } = renderDialog()

    fireEvent.change(screen.getByLabelText('What they are told'), {
      target: { value: 'You notice the clock has stopped.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Inform' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(postedBody(spy)).toEqual({
      contentMarkdown: 'You notice the clock has stopped.',
      targetParticipantIds: null,
    })
    expect(onPosted).toHaveBeenCalledTimes(1)
  })

  it('posts the chosen ids for a subset', async () => {
    const spy = mockPost()
    const { onClose } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /Alice/ }))
    fireEvent.change(screen.getByLabelText('What they are told'), {
      target: { value: 'You see Bob pocket the key.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Inform' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(postedBody(spy)).toEqual({
      contentMarkdown: 'You see Bob pocket the key.',
      targetParticipantIds: [ALICE],
    })
  })

  it('collapses a full hand-picked selection back to null', async () => {
    const spy = mockPost()
    const { onClose } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /Alice/ }))
    fireEvent.click(screen.getByRole('button', { name: /Bob/ }))
    fireEvent.change(screen.getByLabelText('What they are told'), {
      target: { value: 'You hear the gate close.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Inform' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    // Assert the whole body, so this can only be reading its own POST.
    expect(postedBody(spy)).toEqual({
      contentMarkdown: 'You hear the gate close.',
      targetParticipantIds: null,
    })
  })

  it('stays open and does not report when the post fails', async () => {
    jest
      .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
      .mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ error: 'No LLM-controlled seat to inform.' }),
        } as Response),
      )
    const { onClose, onPosted } = renderDialog()

    fireEvent.change(screen.getByLabelText('What they are told'), {
      target: { value: 'You notice nothing at all.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Inform' }))

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Inform' }) as HTMLButtonElement).disabled).toBe(false),
    )
    expect(onPosted).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
