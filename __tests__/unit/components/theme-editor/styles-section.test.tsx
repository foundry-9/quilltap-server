/**
 * Calliope's Atelier — the Custom CSS section (Calliope Live, Spec G, Stage 2).
 *
 * The section inside the real operations provider over a fake saver, with a
 * real code editor; the draft operations themselves are mocked. Covered:
 * beginning a stylesheet, typing handing the text up, markers and the
 * problems list, the held-preview notice, each reference list inserting at
 * the caret (and a hook's variant), removal behind an alertdialog, and the
 * pending text flushed when the section closes.
 */

// Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
// resolves on the global `expect` under tsc.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React, { useMemo, useRef, useState } from 'react'
import { $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical'
import { StylesSection, type StylesStatus } from '@/components/theme-editor/assets/StylesSection'
import { DraftOperationsContext, useDraftOperationsState } from '@/components/theme-editor/assets/use-draft-operations'
import { $getCodeBlock, $selectOffsets } from '@/components/code-editor/lexical-text'
import { analyse } from '@/components/theme-editor/model'
import { cssUrlFor, hookGroups, hookSelectors, stylesheetMarkers, tokenEntries } from '@/components/theme-editor/assets/styles-model'
import { getHook } from '@/lib/themes/hooks'
import type { DraftDetail } from '@/lib/themes/drafts/service'
import type { ThemeTokensDocument } from '@/lib/themes/engine/client'

jest.mock('@/components/theme-editor/use-theme-drafts', () => ({
  ...jest.requireActual('@/components/theme-editor/use-theme-drafts'),
  themeDraftAction: jest.fn(),
  fetchThemeDraft: jest.fn(),
}))

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

const drafts = require('@/components/theme-editor/use-theme-drafts') as { themeDraftAction: jest.Mock; fetchThemeDraft: jest.Mock }

const TOKENS: ThemeTokensDocument = {
  primitives: { ink: { type: 'color', value: '#112233' } },
  tokens: { '--theme-card': '#fafafa' },
  choices: {},
} as ThemeTokensDocument

const CSS = '.qt-card {\n  color: red;\n}\n'

function detail(overrides: Partial<DraftDetail> = {}): DraftDetail {
  return {
    id: 'my-theme',
    manifest: { id: 'my-theme', name: 'My Theme', version: '0.1.0', stylesPath: 'styles.css' },
    tokens: TOKENS,
    revision: 'rev-1',
    uri: 'qtap://Quilltap General/Themes/my-theme',
    compiled: { fontFaces: '', icons: '', custom: '' },
    subsystems: {},
    issues: [],
    images: [{ path: 'images/paper.png', type: 'image/png', url: '/draft/images/paper.png' }],
    manifestRevision: 'mrev-1',
    files: [],
    totals: { files: 3, bytes: 1000, limits: { files: 200, bytes: 52428800, fileBytes: 10485760 } },
    mountPointId: 'mp-general',
    updatedAt: '2026-11-15T12:00:00.000Z',
    version: '0.1.0',
    styles: { path: 'styles.css', text: CSS, revision: 'srev-1' },
    ...overrides,
  }
}

let onChange: jest.Mock
let flushRef: { current: (() => void) | null }

/** The section inside the real operations provider, over a saver that only adopts, holding the edited text. */
function Harness({ initial, status = 'saved' }: { initial: DraftDetail; status?: StylesStatus }) {
  const [current, setCurrent] = useState(initial)
  const [css, setCss] = useState(initial.styles?.text ?? '')
  const ref = useRef(initial)
  const saver = useMemo(
    () => ({
      flush: async () => {},
      current: () => ref.current,
      adopt: (fresh: DraftDetail) => {
        ref.current = fresh
        setCurrent(fresh)
        setCss(fresh.styles?.text ?? '')
      },
    }),
    [],
  )
  const ops = useDraftOperationsState(saver, () => {})
  const { resolved } = useMemo(() => analyse(current.tokens ?? TOKENS), [current.tokens])
  return (
    <DraftOperationsContext.Provider value={ops}>
      <StylesSection
        detail={current}
        value={css}
        onChange={(text) => {
          setCss(text)
          onChange(text)
        }}
        status={status}
        flushRef={flushRef}
        tokens={current.tokens ?? TOKENS}
        resolved={resolved}
        mode="light"
      />
    </DraftOperationsContext.Provider>
  )
}

function lexical(): LexicalEditor {
  const root = document.querySelector('[contenteditable]') as (HTMLElement & { __lexicalEditor?: LexicalEditor }) | null
  if (!root?.__lexicalEditor) throw new Error('no code editor mounted')
  return root.__lexicalEditor
}

/** Put the caret at `offset` (as if the author had clicked there) and type `text`. */
function typeAt(offset: number, text: string) {
  const editor = lexical()
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

/** Put the caret at `offset` without typing. */
function caretAt(offset: number) {
  const editor = lexical()
  act(() => {
    editor.update(() => $selectOffsets($getCodeBlock()!, offset), { discrete: true })
  })
}

const lastEmitted = () => onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as string | undefined

beforeAll(() => {
  // jsdom has no layout; Lexical asks a Range for its rectangle when it scrolls the caret into view.
  const rect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = rect
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
  }
})

beforeEach(() => {
  jest.clearAllMocks()
  onChange = jest.fn()
  flushRef = { current: null }
})

describe('the model', () => {
  it('writes a hook as each of its selectors', () => {
    const hook = getHook('qt-input')!
    expect(hookSelectors(hook).map((s) => s.selector)).toEqual(['.qt-input', '.qt-input.qt-input-error'])
    const withVariants = hookGroups('').flatMap((g) => g.hooks).find((h) => h.variants?.some((v) => v.values !== 'open'))!
    const variant = withVariants.variants!.find((v) => v.values !== 'open')!
    expect(hookSelectors(withVariants).map((s) => s.selector)).toContain(
      `.${withVariants.className}[${variant.attribute}="${(variant.values as readonly string[])[0]}"]`,
    )
  })

  it('narrows the catalogue by label or class, keeping the surface order', () => {
    const byClass = hookGroups('qt-card-title').flatMap((g) => g.hooks.map((h) => h.className))
    expect(byClass).toContain('qt-card-title')
    expect(hookGroups('card title').flatMap((g) => g.hooks.map((h) => h.className))).toContain('qt-card-title')
    const surfaces = hookGroups('').map((g) => g.surface)
    expect(surfaces[0]).toBe('app-shell')
    expect(surfaces[surfaces.length - 1]).toBe('common')
    expect(hookGroups('nothing answers to this')).toEqual([])
  })

  it('lists the primitives first, with the value in force, then the registry', () => {
    const { resolved } = analyse(TOKENS)
    const entries = tokenEntries(TOKENS, resolved, 'light')
    expect(entries[0]).toMatchObject({ name: '--p-ink', kind: 'primitive', value: '#112233', insert: 'var(--p-ink)' })
    expect(entries.find((e) => e.name === '--theme-card')).toMatchObject({ value: '#fafafa', insert: 'var(--theme-card)' })
  })

  it('takes markers only from the stylesheet’s issues that know their line', () => {
    const issues: DraftDetail['issues'] = [
      { severity: 'error', message: 'styles.css: @import is not allowed (line 2)', file: 'styles.css', line: 2 },
      { severity: 'warning', message: 'tokens.json: odd', file: 'tokens.json' },
      { severity: 'warning', message: 'styles.css: whole-file note', file: 'styles.css' },
    ]
    expect(stylesheetMarkers(issues, 'styles.css')).toEqual([{ line: 2, severity: 'error', message: 'styles.css: @import is not allowed (line 2)' }])
  })

  it('quotes an image path for url()', () => {
    expect(cssUrlFor('images/paper.png')).toBe("url('images/paper.png')")
    expect(cssUrlFor("images/it's.png")).toBe("url('images/it\\'s.png')")
  })
})

describe('with no stylesheet', () => {
  it('explains custom CSS and begins one through set-styles-file', async () => {
    const before = detail({ styles: null, manifest: { id: 'my-theme', name: 'My Theme', version: '0.1.0' } })
    const after = detail({ styles: { path: 'styles.css', text: '', revision: 'srev-empty' }, manifestRevision: 'mrev-2' })
    drafts.themeDraftAction.mockResolvedValue({ draft: after, path: 'styles.css', created: true })
    render(<Harness initial={before} />)

    expect(screen.getByText(/written as CSS of your own/)).toBeInTheDocument()
    expect(screen.getByText(/must name one of this draft/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Begin a stylesheet' }))

    await waitFor(() => expect(drafts.themeDraftAction).toHaveBeenCalledWith('my-theme', 'set-styles-file', { manifestRevision: 'mrev-1' }))
    expect(await screen.findByRole('textbox', { name: 'styles.css' })).toBeInTheDocument()
  })
})

describe('the editor', () => {
  it('hands typed text up after a pause, and flushes it on the way out', async () => {
    const view = render(<Harness initial={detail()} />)
    await screen.findByRole('textbox', { name: 'styles.css' })
    typeAt(CSS.length, '.qt-button { margin: 0; }\n')
    await waitFor(() => expect(lastEmitted()).toBe(`${CSS}.qt-button { margin: 0; }\n`))

    typeAt(0, '/* note */\n')
    expect(flushRef.current).toEqual(expect.any(Function))
    view.unmount()
    expect(lastEmitted()).toBe(`/* note */\n${CSS}.qt-button { margin: 0; }\n`)
  })

  it('shows markers on their lines, a list of the problems, and that the preview is held', async () => {
    render(
      <Harness
        initial={detail({
          issues: [
            { severity: 'error', message: 'styles.css: custom CSS does not parse (line 3): Unclosed block', file: 'styles.css', line: 3 },
            { severity: 'warning', message: 'tokens.json: elsewhere', file: 'tokens.json' },
          ],
        })}
      />,
    )
    await screen.findByRole('textbox', { name: 'styles.css' })
    expect(document.querySelectorAll('.qt-code-editor-marker-error')).toHaveLength(1)
    const problems = screen.getByRole('list', { name: 'Problems in the stylesheet' })
    expect(within(problems).getAllByRole('listitem')).toHaveLength(1)
    expect(within(problems).getByRole('button', { name: 'Line 3' })).toBeInTheDocument()
    expect(screen.getByText(/goes on wearing the last stylesheet that compiled/)).toBeInTheDocument()
  })

  it('says where the save stands', async () => {
    render(<Harness initial={detail()} status="conflict" />)
    expect(await screen.findByText(/Changed elsewhere/)).toBeInTheDocument()
  })
})

describe('the reference panel', () => {
  async function ready() {
    render(<Harness initial={detail()} />)
    await screen.findByRole('textbox', { name: 'styles.css' })
    caretAt(0)
  }

  it('inserts a hook’s class at the caret', async () => {
    await ready()
    fireEvent.change(screen.getByLabelText('Search the hooks'), { target: { value: 'qt-card-title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert .qt-card-title' }))
    await waitFor(() => expect(lastEmitted()).toBe(`.qt-card-title${CSS}`))
  })

  it('inserts a hook with a chosen state', async () => {
    await ready()
    fireEvent.change(screen.getByLabelText('Search the hooks'), { target: { value: 'qt-input-error' } })
    fireEvent.change(screen.getByLabelText('Which text input to select'), { target: { value: '.qt-input.qt-input-error' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert .qt-input.qt-input-error' }))
    await waitFor(() => expect(lastEmitted()).toBe(`.qt-input.qt-input-error${CSS}`))
  })

  it('inserts a token or a primitive as var()', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Tokens' }))
    fireEvent.change(screen.getByLabelText('Search the tokens and primitives'), { target: { value: 'ink' } })
    expect(screen.getByText('In light: #112233')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Insert var(--p-ink)' }))
    await waitFor(() => expect(lastEmitted()).toBe(`var(--p-ink)${CSS}`))
  })

  it('starts each list with a clear search', async () => {
    await ready()
    fireEvent.change(screen.getByLabelText('Search the hooks'), { target: { value: 'Home card title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Images' }))
    expect(screen.getByLabelText('Search the images')).toHaveValue('')
    expect(screen.getByRole('button', { name: "Insert url('images/paper.png')" })).toBeInTheDocument()
  })

  it('inserts an image as url()', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Images' }))
    fireEvent.click(screen.getByRole('button', { name: "Insert url('images/paper.png')" }))
    await waitFor(() => expect(lastEmitted()).toBe(`url('images/paper.png')${CSS}`))
  })
})

describe('removing the stylesheet', () => {
  it('asks in an alertdialog, then clears it, deleting the file by default', async () => {
    const after = detail({ styles: null, manifestRevision: 'mrev-2' })
    drafts.themeDraftAction.mockResolvedValue({ draft: after, deleted: ['styles.css'] })
    render(<Harness initial={detail()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove the stylesheet' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('checkbox', { name: /Throw away styles.css as well/ })).toBeChecked()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove it' }))
    await waitFor(() =>
      expect(drafts.themeDraftAction).toHaveBeenCalledWith('my-theme', 'clear-styles-file', { manifestRevision: 'mrev-1', deleteFile: true }),
    )
    expect(await screen.findByRole('button', { name: 'Begin a stylesheet' })).toBeInTheDocument()
  })

  it('keeps the file when asked', async () => {
    drafts.themeDraftAction.mockResolvedValue({ draft: detail({ styles: null }), deleted: [] })
    render(<Harness initial={detail()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove the stylesheet' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Throw away/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove it' }))
    await waitFor(() =>
      expect(drafts.themeDraftAction).toHaveBeenCalledWith('my-theme', 'clear-styles-file', { manifestRevision: 'mrev-1', deleteFile: false }),
    )
  })
})
