/**
 * Calliope's Atelier — the editor's structure (Calliope Live, Spec E, Stage 1):
 * search across levels, "changed only", the density choice, undo and redo by
 * button and key, the text control's type check, following a primitive, and
 * that an edit in one row does not re-render the others.
 */

// Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
// resolves on the global `expect` under tsc.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { ThemeEditorView } from '@/app/calliope/ThemeEditorView'
import { createEditorStore, useEditorSelector } from '@/components/theme-editor/editor-store'
import { analyse, setTokenValue, tokenRowView, type EditorSnapshot } from '@/components/theme-editor/model'
import type { DraftDetail } from '@/lib/themes/drafts/service'
import { THEME_TOKENS, type ThemeTokensDocument } from '@/lib/themes/engine/client'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

const mockSetPreview = jest.fn()

jest.mock('@/components/providers/theme-provider', () => ({
  useTheme: () => ({
    availableThemes: [{ id: 'default', name: 'Professional Neutral', source: 'default' }],
    resolvedColorMode: 'light',
    setPreview: mockSetPreview,
    refreshThemes: jest.fn(async () => {}),
    setTheme: jest.fn(async () => {}),
  }),
}))

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

const EMPTY: ThemeTokensDocument = { primitives: {}, tokens: {}, choices: {} }
let current: DraftDetail
const realFetch = global.fetch

function detail(tokens: ThemeTokensDocument = EMPTY): DraftDetail {
  return {
    id: 'my-theme',
    manifest: { id: 'my-theme', name: 'My Theme', version: '0.1.0' },
    tokens,
    revision: 'rev-1',
    uri: 'qtap://Quilltap General/Themes/my-theme',
    compiled: { fontFaces: '', icons: '', custom: '' },
    subsystems: {},
    issues: [],
    updatedAt: '2026-11-14T12:00:00.000Z',
    version: '0.1.0',
    images: [],
  }
}

function respond(status: number, json: unknown) {
  return { ok: status >= 200 && status < 300, status, statusText: String(status), json: async () => json }
}

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.startsWith('/api/v1/theme-drafts/') && method === 'GET') return respond(200, { draft: current })
    if (url.startsWith('/api/v1/theme-drafts/') && method === 'PUT') {
      const body = JSON.parse(String(init!.body))
      current = { ...current, tokens: body.tokens ?? current.tokens, revision: `${current.revision}+` }
      return respond(200, { draft: current })
    }
    return respond(404, { error: 'not stubbed' })
  }) as unknown as typeof fetch
})

afterAll(() => {
  global.fetch = realFetch
})

function lastPreview(): { css: string; choices: Record<string, string> } | undefined {
  const calls = mockSetPreview.mock.calls.filter((c) => c[0] !== null)
  return calls.length ? calls[calls.length - 1][0] : undefined
}

function lastPreviewCss(): string {
  const calls = mockSetPreview.mock.calls.filter((c) => c[0] !== null)
  return calls.length ? (calls[calls.length - 1][0] as { css: string }).css : ''
}

async function openEditor(tokens: ThemeTokensDocument = EMPTY) {
  current = detail(tokens)
  renderWithQuery(<ThemeEditorView payload={{ draftId: 'my-theme' }} />)
  await screen.findByLabelText('Card, light value')
}

const search = (text: string) => fireEvent.change(screen.getByLabelText('Search the tokens'), { target: { value: text } })

function commit(label: string, value: string) {
  const field = screen.getByLabelText(label)
  fireEvent.change(field, { target: { value } })
  fireEvent.blur(field)
}

describe('finding a token', () => {
  it('finds one behind the advanced disclosure of a closed section', async () => {
    await openEditor()
    expect(screen.queryByLabelText('Card background, light value')).not.toBeInTheDocument()
    search('card background')
    expect(await screen.findByLabelText('Card background, light value')).toBeInTheDocument()
    expect(screen.queryByLabelText('Focus ring width, light, amount')).not.toBeInTheDocument()
  })

  it('shows only what the theme sets', async () => {
    await openEditor(setTokenValue(EMPTY, '--theme-focus-ring-width', 'light', '3px'))
    fireEvent.click(screen.getByLabelText('Changed only'))
    expect(await screen.findByLabelText('Focus ring width, light, amount')).toHaveValue(3)
    expect(screen.queryByLabelText('Card, light value')).not.toBeInTheDocument()
  })

  it('says so when nothing is changed', async () => {
    await openEditor()
    fireEvent.click(screen.getByLabelText('Changed only'))
    expect(await screen.findByText(/This theme has changed nothing yet/)).toBeInTheDocument()
  })
})

describe('the density choice', () => {
  it('sets the choice, previews it, and names it as the source', async () => {
    await openEditor()
    fireEvent.click(screen.getByLabelText(/comfortable/))
    await waitFor(() => expect(lastPreview()?.choices).toEqual({ density: 'comfortable' }))
    search('card padding')
    expect(await screen.findByText(/Set by the density choice \(comfortable\)/)).toBeInTheDocument()
  })
})

describe('undo and redo', () => {
  it('undoes and redoes by button', async () => {
    await openEditor()
    commit('Card, light value', '#123456')
    await waitFor(() => expect(lastPreviewCss()).toContain('#123456'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByLabelText('Card, light value')).not.toHaveValue('#123456'))
    expect(lastPreviewCss()).not.toContain('#123456')
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    await waitFor(() => expect(screen.getByLabelText('Card, light value')).toHaveValue('#123456'))
  })

  it('undoes by key outside a text field, and leaves a text field its own undo', async () => {
    await openEditor()
    commit('Card, light value', '#123456')
    await waitFor(() => expect(lastPreviewCss()).toContain('#123456'))
    fireEvent.keyDown(screen.getByLabelText('Card, light value'), { key: 'z', ctrlKey: true })
    expect(screen.getByLabelText('Card, light value')).toHaveValue('#123456')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reset Card to the house default' }), { key: 'z', metaKey: true })
    await waitFor(() => expect(screen.getByLabelText('Card, light value')).not.toHaveValue('#123456'))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reset Card to the house default' }), { key: 'z', metaKey: true, shiftKey: true })
    await waitFor(() => expect(screen.getByLabelText('Card, light value')).toHaveValue('#123456'))
  })
})

describe('the text control', () => {
  it('refuses a value that is not of the token type', async () => {
    await openEditor()
    search('focus ring width')
    fireEvent.click(await screen.findByRole('button', { name: 'Focus ring width, light: edit as text' }))
    commit('Focus ring width, light value', 'wide')
    expect(screen.getByText(/The atelier demurs: .*length.*It will not be applied/)).toBeInTheDocument()
    expect(lastPreviewCss()).not.toContain('--theme-focus-ring-width: wide')
    commit('Focus ring width, light value', '3px')
    await waitFor(() => expect(lastPreviewCss()).toContain('--theme-focus-ring-width: 3px;'))
  })
})

describe('the typed controls in the editor', () => {
  it('writes a length from its controls', async () => {
    await openEditor()
    search('focus ring width')
    fireEvent.change(await screen.findByLabelText('Focus ring width, light, amount'), { target: { value: '4' } })
    await waitFor(() => expect(lastPreviewCss()).toContain('--theme-focus-ring-width: 4px;'))
  })

  it('opens a value beyond the controls as text and leaves it alone', async () => {
    const tokens = setTokenValue(EMPTY, '--theme-focus-ring-width', 'light', 'clamp(1px, 0.2vw, 3px)')
    await openEditor(tokens)
    search('focus ring width')
    expect(await screen.findByLabelText('Focus ring width, light value')).toHaveValue('clamp(1px, 0.2vw, 3px)')
    expect(screen.getAllByText(/beyond the controls/).length).toBeGreaterThan(0)
    expect(current.tokens).toEqual(tokens)
  })
})

describe('the primitives panel', () => {
  const withInk: ThemeTokensDocument = {
    ...EMPTY,
    primitives: { ink: { type: 'color', value: '#112233' } },
    tokens: { '--theme-card': 'var(--p-ink)' },
  }

  it('edits a value, and every token following it repaints', async () => {
    await openEditor(withInk)
    commit('ink, light value', '#445566')
    await waitFor(() => expect(lastPreviewCss()).toContain('--p-ink: #445566'))
  })

  it('adds one', async () => {
    await openEditor()
    fireEvent.change(screen.getByLabelText('Name of the new primitive'), { target: { value: 'brass-ink' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add the primitive' }))
    expect(await screen.findByLabelText('Name of primitive brass-ink')).toBeInTheDocument()
    await waitFor(() => expect(lastPreviewCss()).toContain('--p-brass-ink'))
  })

  it('refuses a name that is taken, and renames to a free one', async () => {
    await openEditor(withInk)
    const name = screen.getByLabelText('Name of primitive ink')
    fireEvent.change(name, { target: { value: 'Bad Name' } })
    expect(screen.getByText(/kebab-case.*the old name stands/)).toBeInTheDocument()
    fireEvent.change(name, { target: { value: 'quill' } })
    fireEvent.blur(name)
    await waitFor(() => expect(lastPreviewCss()).toContain('var(--p-quill)'))
  })

  it('confirms before removing, naming what follows it, and hands them its value', async () => {
    await openEditor(withInk)
    fireEvent.click(screen.getByRole('button', { name: 'Remove primitive ink' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('One value follows it')
    expect(dialog).toHaveTextContent('--theme-card')
    fireEvent.click(screen.getByRole('button', { name: 'Remove the primitive' }))
    await waitFor(() => expect(lastPreviewCss()).not.toContain('--p-ink'))
    expect(lastPreviewCss()).toContain('#112233')
  })

  it('gives dark a value apart', async () => {
    await openEditor(withInk)
    fireEvent.click(screen.getByRole('button', { name: 'Give primitive ink a dark value of its own' }))
    expect(await screen.findByLabelText('ink, dark value')).toHaveValue('#112233')
  })
})

describe('following a primitive', () => {
  it('points a token at a primitive of its type, and back', async () => {
    await openEditor({ ...EMPTY, primitives: { ink: { type: 'color', value: '#112233' } } })
    const follows = screen.getAllByLabelText('Follows')[0]
    fireEvent.change(follows, { target: { value: 'ink' } })
    await waitFor(() => expect(lastPreviewCss()).toContain('var(--p-ink)'))
    fireEvent.change(screen.getAllByLabelText('Follows')[0], { target: { value: '' } })
    await waitFor(() => expect(lastPreviewCss()).not.toContain('var(--p-ink)'))
  })
})

describe('rendering cost', () => {
  it('re-renders only the row whose view changed', () => {
    const tokens = THEME_TOKENS.filter((t) => t.name === '--theme-card' || t.name === '--theme-focus-ring-width')
    const snapshot = (doc: ThemeTokensDocument): EditorSnapshot => ({ tokens: doc, ...analyse(doc), mode: 'light' })
    const store = createEditorStore(snapshot(EMPTY))
    const renders: Record<string, number> = {}
    function Row({ name }: { name: string }) {
      const token = tokens.find((t) => t.name === name)!
      const select = React.useCallback((s: EditorSnapshot) => tokenRowView(token, s), [token])
      useEditorSelector(store, select)
      renders[name] = (renders[name] ?? 0) + 1
      return null
    }
    const Memo = React.memo(Row)
    render(
      <>
        {tokens.map((t) => (
          <Memo key={t.name} name={t.name} />
        ))}
      </>,
    )
    const before = { ...renders }
    act(() => store.set(snapshot(setTokenValue(EMPTY, '--theme-card', 'light', '#123456'))))
    expect(renders['--theme-card']).toBe(before['--theme-card'] + 1)
    expect(renders['--theme-focus-ring-width']).toBe(before['--theme-focus-ring-width'])
  })
})
