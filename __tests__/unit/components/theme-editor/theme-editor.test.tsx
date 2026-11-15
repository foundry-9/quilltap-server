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
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { ThemeEditorView } from '@/app/calliope/ThemeEditorView'
import { buildPreview, setTokenValue } from '@/components/theme-editor/model'
import type { DraftDetail, DraftSummary } from '@/lib/themes/drafts/service'
import type { ThemeTokensDocument } from '@/lib/themes/engine/client'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

const mockSetPreview = jest.fn()
const mockRefreshThemes = jest.fn(async () => {})
const mockSetTheme = jest.fn(async () => {})

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

const toast = require('@/lib/toast') as { showWarningToast: jest.Mock; showErrorToast: jest.Mock }

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
let onPut: (body: { revision: string; tokens?: ThemeTokensDocument }) => { status: number; json: unknown }

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
    current = { ...current, tokens: body.tokens ?? current.tokens, revision: `${current.revision}+` }
    return { status: 200, json: { draft: current } }
  }
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
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
  await screen.findByLabelText('Card, light value')
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

    await screen.findByLabelText('Card, light value')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Smoking Room', from: 'earl-grey' })
  })

  it('sends no start-from for a blank canvas', async () => {
    renderWithQuery(<ThemeEditorView />)
    fireEvent.click(await screen.findByRole('button', { name: /New theme/ }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Plain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }))
    await screen.findByLabelText('Card, light value')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Plain' })
  })
})

describe('editing a colour', () => {
  it('previews CSS carrying the new value, and saves it with the revision', async () => {
    await openEditor()
    await waitFor(() => expect(mockSetPreview).toHaveBeenCalled())
    expect(lastPreviewCss()).not.toContain('#123456')

    const field = screen.getByLabelText('Card, light value')
    fireEvent.change(field, { target: { value: '#123456' } })
    fireEvent.blur(field)

    await waitFor(() => expect(lastPreviewCss()).toContain('--theme-card: #123456;'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true), { timeout: 3000 })
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.body).toEqual({ revision: 'rev-1', tokens: { primitives: {}, tokens: { '--theme-card': '#123456' }, choices: {} } })
  })

  it('ignores text that is not a colour', async () => {
    await openEditor()
    const field = screen.getByLabelText('Card, light value')
    fireEvent.change(field, { target: { value: 'not a colour' } })
    fireEvent.blur(field)
    expect(screen.getByText(/Not a colour the atelier recognises/)).toBeInTheDocument()
    expect(lastPreviewCss()).not.toContain('not a colour')
  })

  it('resets a value the theme sets', async () => {
    await openEditor(detail({ tokens: setTokenValue(EMPTY, '--theme-card', 'light', '#abcdef') }))
    await waitFor(() => expect(lastPreviewCss()).toContain('#abcdef'))
    fireEvent.click(screen.getByRole('button', { name: 'Reset Card to the house default' }))
    await waitFor(() => expect(lastPreviewCss()).not.toContain('#abcdef'))
    expect(screen.getByRole('button', { name: 'Reset Card to the house default' })).toBeDisabled()
  })

  it('writes a dark value into the dark block', async () => {
    await openEditor()
    const field = screen.getByLabelText('Card, dark value')
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
    const field = screen.getByLabelText('Card, light value')
    fireEvent.change(field, { target: { value: '#123456' } })
    fireEvent.blur(field)

    await waitFor(() => expect(toast.showWarningToast).toHaveBeenCalled(), { timeout: 3000 })
    await waitFor(() => expect(screen.getByLabelText('Card, light value')).toHaveValue('#fedcba'))
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
