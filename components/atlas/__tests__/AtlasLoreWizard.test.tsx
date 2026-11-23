/**
 * Tests for the Atlas lore wizard — "Draft from lore".
 *
 * Global jest (bare jest.mock factories hoist), `renderWithQuery` for the
 * `lore-defaults` read, and a fetch router that tells the streaming draft POST
 * from the JSON defaults GET. Heavy children are stubbed and
 * `useConnectionProfiles` mocked so the Model select is deterministic.
 */

import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from '@/__tests__/helpers/renderWithQuery'
import { AtlasLoreWizard, describeBrahmaActivity } from '../AtlasLoreWizard'

jest.mock('@/components/markdown-editor/MarkdownLexicalEditor', () => ({
  __esModule: true,
  default: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
jest.mock('@/components/chat/ThinkingBlock', () => ({
  ThinkingBlock: ({ content }: { content: string }) => (content ? <div>{content}</div> : null),
}))
jest.mock('@/components/chat/QuillAnimation', () => ({
  QuillAnimation: () => <span data-testid="quill-animation" />,
}))
jest.mock('@/hooks/useConnectionProfiles', () => ({
  useConnectionProfiles: jest.fn(),
}))

import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'

const PROFILES = [
  { id: 'p-default', name: 'The Usual', provider: 'anthropic', modelName: 'm', isDefault: true, allowToolUse: true, allowWebSearch: false },
  { id: 'p-brahma', name: 'Brahma Engine', provider: 'anthropic', modelName: 'm', isDefault: false, allowToolUse: true, allowWebSearch: false },
  { id: 'p-notools', name: 'Cheap', provider: 'anthropic', modelName: 'm', isDefault: false, allowToolUse: false, allowWebSearch: false },
]

const DRAFT = { name: 'The Convertible', aliases: ['the roadster'], graphicPrompt: 'A cream roadster.', knowledge: 'Agatha’s.' }

function sseBody(frames: Array<Record<string, unknown>>) {
  const encoder = new TextEncoder()
  return {
    getReader() {
      let i = 0
      return {
        async read() {
          if (i >= frames.length) return { done: true, value: undefined }
          return { done: false, value: encoder.encode(`data: ${JSON.stringify(frames[i++])}\n\n`) }
        },
        releaseLock() {},
        cancel: async () => {},
      }
    },
  }
}

function installFetch(frames: Array<Array<Record<string, unknown>>>) {
  const bodies: Array<Record<string, unknown>> = []
  ;(global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('action=draft-from-lore')) {
      bodies.push(JSON.parse(String(init?.body)))
      return { ok: true, status: 200, body: sseBody(frames.shift() ?? []) }
    }
    if (url.includes('action=lore-defaults')) {
      return { ok: true, status: 200, json: async () => ({ brahmaProfileId: 'p-brahma' }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  return bodies
}

function renderWizard() {
  const onClose = jest.fn()
  const onDraft = jest.fn()
  renderWithQuery(
    <AtlasLoreWizard
      container={{ scope: 'project', id: '6f9619ff-8b86-4011-b42d-00c04fc964ff' }}
      containerLabel="Project: Ashfall"
      onClose={onClose}
      onDraft={onDraft}
    />,
  )
  return { onClose, onDraft }
}

beforeEach(() => {
  jest.mocked(useConnectionProfiles).mockReturnValue({ profiles: PROFILES, loading: false, getProfileProvider: jest.fn() } as never)
})

describe('AtlasLoreWizard', () => {
  it('needs a subject before it will draft', () => {
    installFetch([])
    renderWizard()
    expect(screen.getByRole('button', { name: 'Draft the entry' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('What shall Brahma write up?'), { target: { value: 'the Convertible' } })
    expect(screen.getByRole('button', { name: 'Draft the entry' })).toBeEnabled()
  })

  it("preselects Brahma's profile and disables tool-less ones while searching", async () => {
    installFetch([])
    renderWizard()
    const select = screen.getByLabelText('Model') as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('p-brahma'))
    expect(screen.getByRole('option', { name: /Cheap/ })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Search the document stores and records'))
    expect(screen.getByRole('option', { name: /Cheap/ })).toBeEnabled()
  })

  it('POSTs the subject, target and profile, shows the draft, and hands it to the editor', async () => {
    const bodies = installFetch([
      [
        { toolsDetected: 1, toolNames: ['search'], toolArguments: [{ query: 'convertible' }] },
        { toolResult: { index: 0, success: true } },
        { done: true, draft: DRAFT, structured: true },
      ],
    ])
    const { onDraft } = renderWizard()
    await waitFor(() => expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('p-brahma'))
    fireEvent.change(screen.getByLabelText('What shall Brahma write up?'), { target: { value: 'the Convertible' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft the entry' }))

    await waitFor(() => expect(screen.getByTestId('atlas-lore-draft')).toBeInTheDocument())
    expect(bodies[0]).toMatchObject({
      subject: 'the Convertible',
      searchStores: true,
      connectionProfileId: 'p-brahma',
      target: { scope: 'project', id: '6f9619ff-8b86-4011-b42d-00c04fc964ff' },
    })
    expect(screen.getByText('the roadster')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open in the editor' }))
    expect(onDraft).toHaveBeenCalledWith(DRAFT)
  })

  it('Revise re-POSTs with the prior draft and the instruction', async () => {
    const bodies = installFetch([
      [{ done: true, draft: DRAFT, structured: true }],
      [{ done: true, draft: { ...DRAFT, knowledge: 'Shorter.' }, structured: true }],
    ])
    renderWizard()
    fireEvent.change(screen.getByLabelText('What shall Brahma write up?'), { target: { value: 'the Convertible' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft the entry' }))
    await waitFor(() => expect(screen.getByTestId('atlas-lore-draft')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Revise'), { target: { value: 'shorter' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revise' }))
    await waitFor(() => expect(screen.getByText('Shorter.')).toBeInTheDocument())
    expect(bodies[1]).toMatchObject({ priorDraft: DRAFT, revision: 'shorter' })
  })

  it('an error lands back on the inputs', async () => {
    installFetch([[{ error: 'No model would answer.' }]])
    renderWizard()
    fireEvent.change(screen.getByLabelText('What shall Brahma write up?'), { target: { value: 'the Convertible' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft the entry' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No model would answer.')
    expect(screen.getByLabelText('What shall Brahma write up?')).toHaveValue('the Convertible')
  })

  it('an unstructured answer is flagged', async () => {
    installFetch([[{ done: true, draft: { name: 'the Convertible', aliases: [], graphicPrompt: null, knowledge: 'prose' }, structured: false }]])
    renderWizard()
    fireEvent.change(screen.getByLabelText('What shall Brahma write up?'), { target: { value: 'the Convertible' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft the entry' }))
    expect(await screen.findByRole('status')).toHaveTextContent('did not come back in proper order')
  })
})

describe('describeBrahmaActivity', () => {
  it('names the tool and its telling argument', () => {
    expect(describeBrahmaActivity({ name: 'search', arguments: { query: '"roadster"' } })).toBe('Searching the stores for “roadster”')
    expect(describeBrahmaActivity({ name: 'lookup_character', arguments: { character: 'Agatha' } })).toBe('Looking up Agatha')
    expect(describeBrahmaActivity({ name: 'run_sql', arguments: {} })).toBe('Consulting the ledgers')
    expect(describeBrahmaActivity({ name: 'mystery', arguments: {} })).toBe('Working with mystery')
  })

  it('gives a phrase quoted inside the query single quotes', () => {
    expect(describeBrahmaActivity({ name: 'lookup_messages', arguments: { query: '"Zbinden Trust" Osage Duchy' } }))
      .toBe('Searching the conversations for “‘Zbinden Trust’ Osage Duchy”')
    expect(describeBrahmaActivity({ name: 'lookup_messages', arguments: { query: '"third signature" pawprint' } }))
      .toBe('Searching the conversations for “‘third signature’ pawprint”')
    expect(describeBrahmaActivity({ name: 'lookup_messages', arguments: { query: '“Duchy”' } }))
      .toBe('Searching the conversations for “Duchy”')
    expect(describeBrahmaActivity({ name: 'lookup_messages', arguments: { query: 'a "stray quote' } }))
      .toBe('Searching the conversations for “a stray quote”')
  })
})
