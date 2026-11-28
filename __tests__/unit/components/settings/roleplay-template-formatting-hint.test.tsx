/**
 * #249: "Draft formatting instructions" appended its hint to the form state
 * only; the rich prompt editor reads its value on mount, so nothing appeared
 * and the next keystroke wrote the hint away. The tab now remounts the editor.
 */

import React, { useState } from 'react'
import { screen, fireEvent, within, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import RoleplayTemplatesTab from '@/components/settings/roleplay-templates'

/** Like the real editor: reads `value` once per mount, remounts on `remountKey`. */
function MountOnceEditor({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  const [text, setText] = useState(value)
  return (
    <textarea
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        onChange(e.target.value)
      }}
    />
  )
}

jest.mock('@/components/markdown-editor/MarkdownLexicalEditor', () => ({
  __esModule: true,
  default: (props: { value: string; onChange: (v: string) => void; ariaLabel: string; remountKey?: string | number }) => (
    <MountOnceEditor key={props.remountKey} {...props} />
  ),
}))

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

function respond(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response
}

describe('Draft formatting instructions (#249)', () => {
  beforeEach(() => {
    jest.spyOn(global as unknown as { fetch: typeof fetch }, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      return Promise.resolve(respond(url.startsWith('/api/v1/roleplay-templates') ? [] : {}))
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('shows the drafted hint in the prompt editor and keeps it through the next edit', async () => {
    renderWithQuery(<RoleplayTemplatesTab />)
    fireEvent.click(await screen.findByRole('button', { name: 'Create Template' }))
    const dialog = await screen.findByRole('dialog')

    const editor = () => within(dialog).getByLabelText('Template LLM prompt') as HTMLTextAreaElement
    fireEvent.change(editor(), { target: { value: 'Speak in shadows.' } })

    const draft = within(dialog).getByRole('button', { name: 'Draft formatting instructions' })
    expect(draft).toBeEnabled()
    fireEvent.click(draft)

    await waitFor(() => expect(editor().value.length).toBeGreaterThan('Speak in shadows.'.length))
    const withHint = editor().value
    expect(withHint.startsWith('Speak in shadows.')).toBe(true)

    // Typing after the hint keeps it: the editor's text now includes it.
    fireEvent.change(editor(), { target: { value: `${withHint}!` } })
    expect(editor().value).toBe(`${withHint}!`)
  })
})
