/**
 * #252: a refused roleplay-template or prompt-template save is shown inside
 * the open modal, not on the page behind it.
 */

import React from 'react'
import { screen, fireEvent, within, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import RoleplayTemplatesTab from '@/components/settings/roleplay-templates'
import PromptsTab from '@/components/settings/prompts'

jest.mock('@/components/markdown-editor/MarkdownLexicalEditor', () => ({
  __esModule: true,
  default: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

jest.mock('@/components/settings/prompts/PreviewModal', () => ({
  PreviewModal: () => null,
}))

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

function respond(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, statusText: ok ? 'OK' : 'Bad Request', json: async () => body } as Response
}

/** GETs answer `lists[url]`; any write is refused with `refusal`. */
function stubRefusingWrites(lists: Record<string, unknown>, refusal: string) {
  return jest
    .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (init?.method && init.method !== 'GET') {
        return Promise.resolve(respond(false, 400, { error: refusal }))
      }
      const key = Object.keys(lists).find((k) => url.startsWith(k))
      return Promise.resolve(respond(true, 200, key ? lists[key] : {}))
    })
}

describe('template save errors (#252)', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('shows a refused roleplay template save inside the modal', async () => {
    stubRefusingWrites(
      { '/api/v1/roleplay-templates': [], '/api/v1/settings/chat': {} },
      'That name is already on the books.',
    )
    renderWithQuery(<RoleplayTemplatesTab />)

    fireEvent.click(await screen.findByRole('button', { name: 'Create Template' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Noir' } })
    fireEvent.change(within(dialog).getByLabelText('Template LLM prompt'), { target: { value: 'Speak in shadows.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Template' }))

    expect(await within(dialog).findByText('That name is already on the books.')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBe(dialog)
  })

  it('shows a refused prompt template save inside the modal, with no dead Retry', async () => {
    stubRefusingWrites({ '/api/v1/prompt-templates': { templates: [] } }, 'The prompt shelf is full.')
    renderWithQuery(<PromptsTab />)

    const createButtons = await screen.findAllByRole('button', { name: 'Create Prompt' })
    fireEvent.click(createButtons[0])
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Greeting' } })
    fireEvent.change(within(dialog).getByLabelText('Prompt content'), { target: { value: 'Say hello.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Prompt' }))

    expect(await within(dialog).findByText('The prompt shelf is full.')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Retry' })).toBeNull()

    // Closing the modal clears the refusal; reopening starts clean.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText('The prompt shelf is full.')).toBeNull()
  })
})
