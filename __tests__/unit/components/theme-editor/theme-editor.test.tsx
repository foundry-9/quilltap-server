/**
 * Calliope's Atelier — the theme-editor tab (Calliope Live, Spec D §2.2).
 *
 *  - the draft list: names, issue counts, the empty state;
 *  - "New theme": the dialog posts name and start-from, and opens the draft;
 *  - editing a colour previews CSS carrying the new value, and saves it;
 *  - reset drops the theme's value; a dark value lands in the dark block;
 *  - a stale revision reloads the draft and says so;
 *  - install is disabled, with the errors listed, while the draft has errors;
 *  - the panel wears the default theme and the tab's own mode class.
 */

// Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
// resolves on the global `expect` under tsc.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical'
import { $getCodeBlock, $selectOffsets } from '@/components/code-editor/lexical-text'
import { ThemeEditorView } from '@/app/calliope/ThemeEditorView'
import { buildPreview, setTokenValue } from '@/components/theme-editor/model'
import type { DraftDetail, DraftSummary } from '@/lib/themes/drafts/service'
import type { ThemeTokensDocument } from '@/lib/themes/engine/client'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { tokenRow, waitForCardRow } from '../../../helpers/theme-editor-queries'

const mockSetPreview = jest.fn()
const mockRefreshThemes = jest.fn(async () => {})
const mockSetTheme = jest.fn(async () => {})

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

jest.mock('@/components/providers/theme-provider', () => ({
  useTheme: () => ({
    availableThemes: [
      { id: 'default', name: 'Professional Neutral', source: 'default' },
      { id: 'earl-grey', name: 'Earl Grey', source: 'bundle' },
    ],
    resolvedColorMode: 'light',
    setPreview: mockSetPreview,
    refreshThemes: mockRefreshThemes,
    setTheme: mockSetTheme,
  }),
}))

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

const toast = require('@/lib/toast') as { showWarningToast: jest.Mock; showErrorToast: jest.Mock; showInfoToast: jest.Mock }

const EMPTY: ThemeTokensDocument = { primitives: {}, tokens: {}, choices: {} }

function detail(overrides: Partial<DraftDetail> = {}): DraftDetail {
  return {
    id: 'my-theme',
    manifest: { id: 'my-theme', name: 'My Theme', version: '0.1.0' },
    tokens: EMPTY,
    revision: 'rev-1',
    uri: 'qtap://Quilltap General/Themes/my-theme',
    compiled: { fontFaces: '', icons: '', custom: '' },
    subsystems: {},
    issues: [],
    images: [],
    manifestRevision: 'mrev-1',
    files: [],
    totals: { files: 2, bytes: 1000, limits: { files: 200, bytes: 26214400, fileBytes: 5242880 } },
    mountPointId: 'mp-general',
    updatedAt: '2026-11-14T12:00:00.000Z',
    version: '0.1.0',
    styles: null,
    ...overrides,
  }
}

interface Call {
  url: string
  method: string
  body?: unknown
}

let calls: Call[]
let drafts: DraftSummary[]
let current: DraftDetail
let onPut: (body: { revision?: string; tokens?: ThemeTokensDocument; stylesRevision?: string; css?: string }) => { status: number; json: unknown }
let onImport: (form: FormData) => { status: number; json: unknown }

const realFetch = global.fetch

function respond(status: number, json: unknown) {
  return { ok: status >= 200 && status < 300, status, statusText: String(status), json: async () => json }
}

beforeEach(() => {
  jest.clearAllMocks()
  calls = []
  drafts = [{ id: 'my-theme', name: 'My Theme', updatedAt: '2026-11-14T12:00:00.000Z', errorCount: 1, warningCount: 2 }]
  current = detail()
  onPut = (body) => {
    if (body.css !== undefined) {
      current = {
        ...current,
        styles: { path: current.styles?.path ?? 'styles.css', text: body.css, revision: `${current.styles?.revision}+` },
        compiled: { ...current.compiled, custom: `/*custom ${body.css.length}*/` },
      }
      return { status: 200, json: { draft: current } }
    }
    current = { ...current, tokens: body.tokens ?? current.tokens, revision: `${current.revision}+` }
    return { status: 200, json: { draft: current } }
  }
  onImport = () => ({ status: 404, json: { error: 'not stubbed' } })
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    if (url === '/api/v1/theme-drafts?action=import' && method === 'POST') {
      const r = onImport(body as FormData)
      return respond(r.status, r.json)
    }
    if (url === '/api/v1/theme-drafts' && method === 'GET') return respond(200, { drafts })
    if (url === '/api/v1/theme-drafts' && method === 'POST') {
      current = detail({ id: 'new-one', manifest: { id: 'new-one', name: body.name, version: '0.1.0' } })
      return respond(201, { draft: current })
    }
    if (url.startsWith('/api/v1/theme-drafts/') && method === 'GET') return respond(200, { draft: current })
    if (url.startsWith('/api/v1/theme-drafts/') && method === 'PUT') {
      const r = onPut(body)
      return respond(r.status, r.json)
    }
    return respond(404, { error: 'not stubbed' })
  }) as unknown as typeof fetch
})

afterAll(() => {
  global.fetch = realFetch
})

function lastPreviewCss(): string {
  const calls = mockSetPreview.mock.calls.filter((c) => c[0] !== null)
  return calls.length ? (calls[calls.length - 1][0] as { css: string }).css : ''
}

async function openEditor(d: DraftDetail = detail()) {
  current = d
  const utils = renderWithQuery(<ThemeEditorView payload={{ draftId: d.id }} />)
  await waitForCardRow()
  return utils
}

describe('the draft list', () => {
  it('shows each draft with its issue counts', async () => {
    renderWithQuery(<ThemeEditorView />)
    const list = await screen.findByRole('list', { name: 'Theme drafts' })
    expect(within(list).getByText('My Theme', { selector: 'p' })).toBeInTheDocument()
    expect(within(list).getByText('1 error')).toBeInTheDocument()
    expect(within(list).getByText('2 warnings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete My Theme' })).toBeInTheDocument()
  })

  it('says so when there are none', async () => {
    drafts = []
    renderWithQuery(<ThemeEditorView />)
    expect(await screen.findByText('The atelier stands empty.')).toBeInTheDocument()
  })

  it('wears the default theme and the global mode', async () => {
    renderWithQuery(<ThemeEditorView />)
    const panel = screen.getByTestId('theme-editor-panel')
    expect(panel).toHaveAttribute('data-theme', 'default')
    expect(panel).toHaveClass('light')
  })
})

describe('a new theme', () => {
  it('posts the name and start-from, then opens the draft', async () => {
    renderWithQuery(<ThemeEditorView />)
    fireEvent.click(await screen.findByRole('button', { name: /New theme/ }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Smoking Room' } })
    const from = screen.getByLabelText('Start from')
    expect(within(from).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'A blank canvas (the house default)',
      'A copy of Earl Grey',
    ])
    fireEvent.change(from, { target: { value: 'earl-grey' } })
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }))

    await waitForCardRow()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Smoking Room', from: 'earl-grey' })
  })

  it('sends no start-from for a blank canvas', async () => {
    renderWithQuery(<ThemeEditorView />)
    fireEvent.click(await screen.findByRole('button', { name: /New theme/ }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Plain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }))
    await waitForCardRow()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Plain' })
  })
})

describe('editing a colour', () => {
  it('previews CSS carrying the new value, and saves it with the revision', async () => {
    await openEditor()
    await waitFor(() => expect(mockSetPreview).toHaveBeenCalled())
    expect(lastPreviewCss()).not.toContain('#123456')

    const field = tokenRow('--theme-card').getByLabelText('Card, light value')
    fireEvent.change(field, { target: { value: '#123456' } })
    fireEvent.blur(field)

    await waitFor(() => expect(lastPreviewCss()).toContain('--theme-card: #123456;'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true), { timeout: 3000 })
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.body).toEqual({ revision: 'rev-1', tokens: { primitives: {}, tokens: { '--theme-card': '#123456' }, choices: {} } })
  })

  it('ignores text that is not a colour', async () => {
    await openEditor()
    const field = tokenRow('--theme-card').getByLabelText('Card, light value')
    fireEvent.change(field, { target: { value: 'not a colour' } })
    fireEvent.blur(field)
    expect(screen.getByText(/Not a colour the atelier recognises/)).toBeInTheDocument()
    expect(lastPreviewCss()).not.toContain('not a colour')
  })

  it('resets a value the theme sets', async () => {
    await openEditor(detail({ tokens: setTokenValue(EMPTY, '--theme-card', 'light', '#abcdef') }))
    await waitFor(() => expect(lastPreviewCss()).toContain('#abcdef'))
    fireEvent.click(tokenRow('--theme-card').getByRole('button', { name: 'Reset Card to the house default' }))
    await waitFor(() => expect(lastPreviewCss()).not.toContain('#abcdef'))
    expect(tokenRow('--theme-card').getByRole('button', { name: 'Reset Card to the house default' })).toBeDisabled()
  })

  it('writes a dark value into the dark block', async () => {
    await openEditor()
    const field = tokenRow('--theme-card').getByLabelText('Card, dark value')
    fireEvent.change(field, { target: { value: '#0a0b0c' } })
    fireEvent.blur(field)
    await waitFor(() => expect(lastPreviewCss()).toContain('#0a0b0c'))
    const css = lastPreviewCss()
    const darkBlock = css.slice(css.indexOf('[data-theme="my-theme"].dark {'))
    expect(darkBlock).toContain('--theme-card: #0a0b0c;')
  })

  it('reloads the draft and says so on a stale revision', async () => {
    const theirs = setTokenValue(EMPTY, '--theme-card', 'light', '#fedcba')
    onPut = () => {
      current = { ...current, tokens: theirs, revision: 'rev-theirs' }
      return { status: 409, json: { error: 'stale', details: { currentRevision: 'rev-theirs' } } }
    }
    await openEditor()
    const field = tokenRow('--theme-card').getByLabelText('Card, light value')
    fireEvent.change(field, { target: { value: '#123456' } })
    fireEvent.blur(field)

    await waitFor(() => expect(toast.showWarningToast).toHaveBeenCalled(), { timeout: 3000 })
    await waitFor(() => expect(tokenRow('--theme-card').getByLabelText('Card, light value')).toHaveValue('#fedcba'))
    await waitFor(() => expect(lastPreviewCss()).toContain('#fedcba'))
  })

  it('switches the panel mode for this tab only', async () => {
    await openEditor()
    const panel = screen.getByTestId('theme-editor-panel')
    expect(panel).toHaveClass('light')
    fireEvent.click(screen.getByRole('button', { name: /Dark/, pressed: false }))
    expect(panel).toHaveClass('dark')
    expect(mockSetTheme).not.toHaveBeenCalled()
  })

  it('clears the preview when the tab goes', async () => {
    const { unmount } = await openEditor()
    await waitFor(() => expect(mockSetPreview).toHaveBeenCalled())
    unmount()
    expect(mockSetPreview).toHaveBeenLastCalledWith(null)
  })
})

describe('installing', () => {
  it('is disabled while the draft has errors, which are listed', async () => {
    await openEditor(detail({ issues: [{ severity: 'error', message: 'The manifest has no author' }] }))
    expect(screen.getByRole('button', { name: /Install/ })).toBeDisabled()
    expect(screen.getByText('The manifest has no author')).toBeInTheDocument()
  })

  it('installs, and offers to wear the theme', async () => {
    await openEditor()
    const fetchMock = global.fetch as jest.Mock
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('?action=install')) {
        return respond(200, { result: { themeId: 'my-theme', version: '0.1.0', draftVersion: '0.1.1', conversion: { converted: {}, reencoded: [], skippedAnimated: [] }, fontConversion: {}, leftOut: [] } })
      }
      return base(input, init)
    })
    fireEvent.click(screen.getByRole('button', { name: /Install/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Wear it now' }))
    await waitFor(() => expect(mockSetTheme).toHaveBeenCalledWith('my-theme'))
    expect(mockRefreshThemes).toHaveBeenCalled()
  })
})

describe('buildPreview', () => {
  it('joins the compiled parts around the tokens in injector order', () => {
    const preview = buildPreview(
      { id: 'my-theme', version: '0.1.0', compiled: { fontFaces: '@font-face{}', icons: '/*icons*/', custom: '/*custom*/' }, subsystems: {} },
      setTokenValue(EMPTY, '--theme-card', 'light', '#abcdef'),
    )
    const order = ['@font-face{}', '[data-theme="my-theme"]', '/*icons*/', '/*custom*/'].map((s) => preview.css.indexOf(s))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(preview.subsystems).toBeNull()
    expect(preview.themeId).toBe('my-theme')
  })
})

// ---------------------------------------------------------------------------
// Custom CSS (Spec G, Stage 2)

const CSS = '.qt-card {\n  color: red;\n}\n'
const withStyles = (overrides: Partial<DraftDetail> = {}) =>
  detail({
    manifest: { id: 'my-theme', name: 'My Theme', version: '0.1.0', stylesPath: 'styles.css' },
    styles: { path: 'styles.css', text: CSS, revision: 'srev-1' },
    compiled: { fontFaces: '', icons: '', custom: '/*custom good*/' },
    ...overrides,
  })

function codeEditor(): LexicalEditor {
  const root = document.querySelector('.qt-code-editor [contenteditable]') as (HTMLElement & { __lexicalEditor?: LexicalEditor }) | null
  if (!root?.__lexicalEditor) throw new Error('no code editor mounted')
  return root.__lexicalEditor
}

function typeCss(offset: number, text: string) {
  const editor = codeEditor()
  act(() => {
    editor.update(
      () => {
        const code = $getCodeBlock()!
        $selectOffsets(code, offset)
        const selection = $getSelection()
        if ($isRangeSelection(selection)) selection.insertRawText(text)
      },
      { discrete: true },
    )
  })
}

async function openCss(d: DraftDetail) {
  await openEditor(d)
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Custom CSS' }))
  await screen.findByRole('textbox', { name: 'styles.css' })
}

describe('custom CSS', () => {
  beforeAll(() => {
    // jsdom has no layout: the section list scrolls to a section, and Lexical asks a Range for its rectangle.
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
    const rect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect
    if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = rect
    if (!Range.prototype.getClientRects) {
      Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
    }
  })

  it('saves typed CSS with its revision, and previews what the save compiled', async () => {
    await openCss(withStyles())
    await waitFor(() => expect(lastPreviewCss()).toContain('/*custom good*/'))
    typeCss(CSS.length, '.qt-button { margin: 0; }\n')

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true), { timeout: 4000 })
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.body).toEqual({ stylesRevision: 'srev-1', css: `${CSS}.qt-button { margin: 0; }\n` })
    await waitFor(() => expect(lastPreviewCss()).toContain(`/*custom ${CSS.length + 26}*/`))
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('keeps the last good custom CSS in the preview while the stylesheet has errors', async () => {
    onPut = (body) => {
      current = {
        ...current,
        styles: { path: 'styles.css', text: body.css!, revision: 'srev-2' },
        compiled: { fontFaces: '', icons: '', custom: '' },
        issues: [{ severity: 'error', message: 'styles.css: custom CSS does not parse (line 4): Unclosed block', file: 'styles.css', line: 4 }],
      }
      return { status: 200, json: { draft: current } }
    }
    await openCss(withStyles())
    await waitFor(() => expect(lastPreviewCss()).toContain('/*custom good*/'))
    typeCss(CSS.length, '.broken {')

    await screen.findByText(/goes on wearing the last stylesheet that compiled/, undefined, { timeout: 4000 })
    expect(document.querySelectorAll('.qt-code-editor-marker-error')).toHaveLength(1)
    expect(lastPreviewCss()).toContain('/*custom good*/')
    expect(screen.getByRole('button', { name: /Install/ })).toBeDisabled()
  })

  it('takes the newer stylesheet and says so when it changed elsewhere', async () => {
    const theirs = '.qt-card { color: blue; }\n'
    onPut = () => {
      current = { ...current, styles: { path: 'styles.css', text: theirs, revision: 'srev-theirs' } }
      return { status: 409, json: { error: 'stale', details: { currentRevision: 'srev-theirs' } } }
    }
    await openCss(withStyles())
    typeCss(0, '/* mine */\n')

    await waitFor(() => expect(toast.showWarningToast).toHaveBeenCalled(), { timeout: 4000 })
    await waitFor(() => expect(codeEditor().getEditorState().read(() => $getCodeBlock()!.getTextContent())).toBe(theirs))
    expect(screen.getByText(/Changed elsewhere/)).toBeInTheDocument()
  })

  it('saves pending CSS before an operation on the draft', async () => {
    await openCss(withStyles())
    const fetchMock = global.fetch as jest.Mock
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('?action=clear-styles-file')) {
        calls.push({ url: String(input), method: 'POST', body: JSON.parse(String(init?.body)) })
        current = { ...current, styles: null, manifest: { id: 'my-theme', name: 'My Theme', version: '0.1.0' } }
        return respond(200, { draft: current, deleted: ['styles.css'] })
      }
      return base(input, init)
    })
    typeCss(0, '/* last words */\n')
    fireEvent.click(screen.getByRole('button', { name: 'Remove the stylesheet' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove it' }))

    await screen.findByRole('button', { name: 'Begin a stylesheet' }, { timeout: 4000 })
    const put = calls.findIndex((c) => c.method === 'PUT')
    const clear = calls.findIndex((c) => c.url.endsWith('?action=clear-styles-file'))
    expect(put).toBeGreaterThanOrEqual(0)
    expect(calls[put].body).toEqual({ stylesRevision: 'srev-1', css: `/* last words */\n${CSS}` })
    expect(clear).toBeGreaterThan(put)
  })

  it('saves pending CSS on the way back to the list', async () => {
    await openCss(withStyles())
    typeCss(0, '/* parting */\n')
    fireEvent.click(screen.getByRole('button', { name: /All drafts/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ stylesRevision: 'srev-1', css: `/* parting */\n${CSS}` })
  })

  it('saves pending CSS, kept alive, when the tab goes', async () => {
    current = withStyles()
    const view = renderWithQuery(<ThemeEditorView payload={{ draftId: 'my-theme' }} />)
    await waitForCardRow()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Custom CSS' }))
    await screen.findByRole('textbox', { name: 'styles.css' })
    typeCss(0, '/* gone */\n')
    view.unmount()
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const fetchMock = global.fetch as jest.Mock
    const putInit = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')![1] as RequestInit
    expect(JSON.parse(String(putInit.body))).toEqual({ stylesRevision: 'srev-1', css: `/* gone */\n${CSS}` })
    expect(putInit.keepalive).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Opening a theme file (Spec G, Stage 2)

describe('opening a theme file', () => {
  function chooseThemeFile(name = 'rains.qtap-theme') {
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*=".qtap-theme"]')!
    fireEvent.change(input, { target: { files: [new File(['PK'], name, { type: 'application/zip' })] } })
  }

  it('posts the file and opens the new draft, saying when its id differs', async () => {
    onImport = (form) => {
      expect(form.get('file')).toBeInstanceOf(File)
      current = detail({ id: 'rains-2', manifest: { id: 'rains-2', name: 'Rains', version: '2.0.0' } })
      return { status: 201, json: { draft: current, bundleId: 'rains', idChanged: true } }
    }
    renderWithQuery(<ThemeEditorView />)
    await screen.findByRole('list', { name: 'Theme drafts' })
    chooseThemeFile()
    await waitForCardRow()
    expect(toast.showInfoToast).toHaveBeenCalledWith(expect.stringContaining('“rains”, and that name was already taken, so this draft is “rains-2”'), 12000)
  })

  it('says nothing of the id when it was free', async () => {
    onImport = () => {
      current = detail({ id: 'rains', manifest: { id: 'rains', name: 'Rains', version: '2.0.0' } })
      return { status: 201, json: { draft: current, bundleId: 'rains', idChanged: false } }
    }
    renderWithQuery(<ThemeEditorView />)
    await screen.findByRole('list', { name: 'Theme drafts' })
    chooseThemeFile()
    await waitForCardRow()
    expect(toast.showInfoToast).not.toHaveBeenCalled()
  })

  it('shows the refusal of a version 1 theme in one sentence', async () => {
    const sentence = '“Old Thing” was tailored for an earlier Quilltap, and the present establishment can no longer wear it.'
    onImport = () => ({ status: 422, json: { error: sentence, details: { errors: [sentence], reason: 'refused' } } })
    renderWithQuery(<ThemeEditorView />)
    await screen.findByRole('list', { name: 'Theme drafts' })
    chooseThemeFile('old.qtap-theme')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(`“old.qtap-theme” could not be opened. ${sentence}`)
    expect(within(alert).queryByRole('list')).toBeNull()
  })

  it('lists the reasons a file would not install', async () => {
    onImport = () => ({
      status: 422,
      json: { error: 'The archive is not a theme that would install: x', details: { errors: ['styles.css: @import is not allowed (line 2)'], reason: 'invalid' } },
    })
    renderWithQuery(<ThemeEditorView />)
    await screen.findByRole('list', { name: 'Theme drafts' })
    chooseThemeFile('bad.qtap-theme')
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('listitem')).toHaveTextContent('styles.css: @import is not allowed (line 2)')
  })

  it('says when a file is too large', async () => {
    onImport = () => ({ status: 413, json: { error: 'The archive is larger than a theme may be (50 MB).' } })
    renderWithQuery(<ThemeEditorView />)
    await screen.findByRole('list', { name: 'Theme drafts' })
    chooseThemeFile('huge.qtap-theme')
    expect(await screen.findByRole('alert')).toHaveTextContent('larger than a theme may be')
  })
})
