/**
 * Tests for ImpersonationVoiceDialog — the In Their Own Words review dialog.
 *
 * Verifies:
 *  - the draft state (the `ask` mode) offers Send as written as the primary
 *    action and Restate in their voice beside it, and no Send / Regenerate;
 *  - Cmd/Ctrl+Enter in the draft sends it as written;
 *  - the review state offers Send / Regenerate / Send as written, and Send
 *    posts the proposal;
 *  - an empty draft cannot be sent or restated.
 */

import { screen, fireEvent, render } from '@testing-library/react'
import React from 'react'
import ImpersonationVoiceDialog from '@/components/chat/ImpersonationVoiceDialog'

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

function renderDialog(overrides: Partial<React.ComponentProps<typeof ImpersonationVoiceDialog>> = {}) {
  const props = {
    isOpen: true,
    characterName: 'Evangeline',
    seed: 'I tell him I will take the job.',
    onSeedChange: jest.fn(),
    proposal: '',
    onProposalChange: jest.fn(),
    stage: 'draft' as const,
    profileOverride: null,
    systemPromptOverride: null,
    onSend: jest.fn(),
    onSendAsWritten: jest.fn(),
    onRestate: jest.fn(),
    onChangeProfile: jest.fn(),
    onChangeSystemPrompt: jest.fn(),
    onEditOriginal: jest.fn(),
    onCancel: jest.fn(),
    ...overrides,
  }
  render(<ImpersonationVoiceDialog {...props} />)
  return props
}

describe('ImpersonationVoiceDialog', () => {
  beforeEach(() => {
    // jsdom has no layout, so no scrollIntoView.
    Element.prototype.scrollIntoView = jest.fn()
    jest
      .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
      .mockImplementation(() =>
        Promise.resolve({ ok: true, status: 200, json: async () => ({ profiles: [] }) } as Response),
      )
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('the draft state — nothing has been sent to a model', () => {
    it('offers Send as written and Restate, and neither Send nor Regenerate', () => {
      renderDialog()
      expect(screen.getByRole('button', { name: 'Send as written' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Restate in their voice' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull()
      expect(screen.queryByLabelText('What Evangeline will say')).toBeNull()
    })

    it('makes Send as written the primary action', () => {
      renderDialog()
      expect(screen.getByRole('button', { name: 'Send as written' }).className).toContain('qt-button-primary')
      expect(screen.getByRole('button', { name: 'Restate in their voice' }).className).toContain('qt-button-secondary')
    })

    it('sends as written on click', () => {
      const props = renderDialog()
      fireEvent.click(screen.getByRole('button', { name: 'Send as written' }))
      expect(props.onSendAsWritten).toHaveBeenCalledTimes(1)
      expect(props.onRestate).not.toHaveBeenCalled()
    })

    it('asks for a restatement only when Restate is pressed', () => {
      const props = renderDialog()
      fireEvent.click(screen.getByRole('button', { name: 'Restate in their voice' }))
      expect(props.onRestate).toHaveBeenCalledTimes(1)
      expect(props.onSendAsWritten).not.toHaveBeenCalled()
    })

    it('sends as written on Cmd/Ctrl+Enter in the draft', () => {
      const props = renderDialog()
      fireEvent.keyDown(screen.getByLabelText('Your draft'), { key: 'Enter', metaKey: true })
      expect(props.onSendAsWritten).toHaveBeenCalledTimes(1)
      fireEvent.keyDown(screen.getByLabelText('Your draft'), { key: 'Enter', ctrlKey: true })
      expect(props.onSendAsWritten).toHaveBeenCalledTimes(2)
      expect(props.onRestate).not.toHaveBeenCalled()
    })

    it('cannot send or restate an empty draft', () => {
      const props = renderDialog({ seed: '   ' })
      expect((screen.getByRole('button', { name: 'Send as written' }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: 'Restate in their voice' }) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.keyDown(screen.getByLabelText('Your draft'), { key: 'Enter', metaKey: true })
      expect(props.onSendAsWritten).not.toHaveBeenCalled()
    })
  })

  describe('the review state — a restatement is on screen', () => {
    it('offers Send, Regenerate and Send as written', () => {
      renderDialog({ stage: 'review', proposal: 'Very well. I shall take it.' })
      expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Regenerate' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Send as written' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Restate in their voice' })).toBeNull()
    })

    it('Send posts the proposal; Regenerate asks again', () => {
      const props = renderDialog({ stage: 'review', proposal: 'Very well. I shall take it.' })
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      expect(props.onSend).toHaveBeenCalledWith('Very well. I shall take it.')
      fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
      expect(props.onRestate).toHaveBeenCalledTimes(1)
    })

    it('keeps Send as written open after a failed restatement', () => {
      renderDialog({ stage: 'review', proposal: '' })
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: 'Send as written' }) as HTMLButtonElement).disabled).toBe(false)
    })
  })
})
