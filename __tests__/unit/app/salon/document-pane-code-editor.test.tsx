/**
 * Document Mode's code editor (Calliope Live, Spec G, Stage 3).
 *
 * The branch choice — Markdown to the rich editor, JSON and CSS to the code
 * editor, everything else (and a file over the size limit) to the textarea —
 * and the pane's contract in the code editor: the text reaches
 * `onContentChange`; the "AI editing" lock makes it read-only; a change from
 * outside replaces the text; `doc_focus` scrolls without taking focus; the
 * status bar names the kind; a blur or a close hands up the pending text
 * first; and a file opened and closed without edits is never handed up.
 */

import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical'
import DocumentPane from '@/app/salon/[id]/components/DocumentPane'
import {
  CODE_EDITOR_MAX_CHARS,
  documentEditorKind,
  documentTypeLabel,
  focusLineInText,
  lineOfText,
} from '@/app/salon/[id]/components/document-editor-kind'
import { $getCodeBlock, $selectOffsets } from '@/components/code-editor/lexical-text'
import type { ActiveDocument, FocusRequest } from '@/app/salon/[id]/hooks/useDocumentMode'

jest.mock('@/hooks/useChatSettingsQuery', () => ({ useChatSettingsQuery: () => ({ data: false }) }))
jest.mock('@/components/workspace/workspace-tab-context', () => ({ useWorkspaceTabId: () => 'tab-1' }))
jest.mock('@/lib/alert', () => ({ showConfirmation: jest.fn() }))
jest.mock('@/lib/toast', () => ({ showSuccessToast: jest.fn() }))

const TOKENS = '{\n\t"tokens": {\n\t\t"--theme-card": "#fafafa"\n\t}\n}\n'

function doc(filePath: string, content: string): ActiveDocument {
  return { id: 'doc-1', filePath, scope: 'general', displayTitle: filePath, content }
}

type Props = React.ComponentProps<typeof DocumentPane>

let onContentChange: jest.Mock
let onBlur: jest.Mock
let onCloseDocument: jest.Mock
let onFocusProcessed: jest.Mock

function props(document: ActiveDocument, extra: Partial<Props> = {}): Props {
  return {
    document,
    mode: 'split',
    isDirty: false,
    isSaving: false,
    contentVersion: 1,
    baselineContent: document.content,
    getScrollPosition: () => 0,
    setScrollPosition: jest.fn(),
    onContentChange,
    onBlur,
    onFlushSave: jest.fn(),
    onToggleFocusMode: jest.fn(),
    onCloseDocument,
    onDeleteDocument: jest.fn(),
    focusRequest: null,
    onFocusResolved: jest.fn(),
    onFocusProcessed,
    ...extra,
  }
}

function codeEditor(): LexicalEditor {
  const root = document.querySelector('.qt-code-editor [contenteditable]') as (HTMLElement & { __lexicalEditor?: LexicalEditor }) | null
  if (!root?.__lexicalEditor) throw new Error('no code editor mounted')
  return root.__lexicalEditor
}

const editorText = () => codeEditor().getEditorState().read(() => $getRoot().getTextContent())

/** Let Lexical commit what an effect queued. */
function settle() {
  act(() => {
    codeEditor().update(() => {}, { discrete: true })
  })
}

function typeAt(offset: number, text: string) {
  const editor = codeEditor()
  act(() => {
    editor.update(
      () => {
        $selectOffsets($getCodeBlock()!, offset)
        const selection = $getSelection()
        if ($isRangeSelection(selection)) selection.insertRawText(text)
      },
      { discrete: true },
    )
  })
}

beforeAll(() => {
  // jsdom has no layout; Lexical asks a Range for its rectangle when it scrolls the caret into view.
  const rect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = rect
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
  }
})

beforeEach(() => {
  jest.useFakeTimers()
  onContentChange = jest.fn()
  onBlur = jest.fn()
  onCloseDocument = jest.fn()
  onFocusProcessed = jest.fn()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('which editor a file opens in', () => {
  it('sends Markdown to the rich editor, JSON and CSS to the code editor, the rest to the textarea', () => {
    expect(documentEditorKind('notes/Plan.md', 10)).toBe('markdown')
    expect(documentEditorKind('a.MARKDOWN', 10)).toBe('markdown')
    expect(documentEditorKind('Themes/rains/tokens.json', 10)).toBe('json')
    expect(documentEditorKind('Themes/rains/theme.json', 10)).toBe('json')
    expect(documentEditorKind('Themes/rains/styles.css', 10)).toBe('css')
    expect(documentEditorKind('data/log.jsonl', 10)).toBe('plain')
    expect(documentEditorKind('config.yaml', 10)).toBe('plain')
    expect(documentEditorKind('folder.json/README', 10)).toBe('plain')
    expect(documentEditorKind('no-extension', 10)).toBe('plain')
  })

  it('keeps a JSON or CSS file over the size limit in the textarea, still naming it', () => {
    expect(documentEditorKind('big.json', CODE_EDITOR_MAX_CHARS)).toBe('json')
    expect(documentEditorKind('big.json', CODE_EDITOR_MAX_CHARS + 1)).toBe('plain')
    expect(documentTypeLabel('big.json')).toBe('JSON')
    expect(documentTypeLabel('x.css')).toBe('CSS')
    expect(documentTypeLabel('x.md')).toBe('Markdown')
    expect(documentTypeLabel('x.txt')).toBe('Plain text')
  })

  it('finds the line a focus anchor falls on', () => {
    const text = '.a {}\n.qt-card {\n  color: red;\n}\n'
    expect(lineOfText(text, '.qt-card')).toBe(2)
    expect(lineOfText(text, 'COLOR: RED')).toBe(3)
    expect(lineOfText(text, 'absent')).toBeNull()
    expect(lineOfText(text, '  ')).toBeNull()
  })

  it('reveals the text a focus names before its line, and the line only as a fallback (#309)', () => {
    const text = Array.from({ length: 10 }, (_, i) => `.r${i + 1} { color: red; }`).join('\n')
    expect(focusLineInText(text, { highlight: '.r8 ', line: 2 })).toBe(8)
    expect(focusLineInText(text, { anchor: '.r3 ', line: 9 })).toBe(3)
    expect(focusLineInText(text, { highlight: 'absent', line: 2 })).toBe(2)
    expect(focusLineInText(text, { line: 0 })).toBeNull()
    // A highlight is looked for from the anchor down first.
    const repeated = 'a {}\nb { x: 1 }\nc {}\nd { x: 1 }'
    expect(focusLineInText(repeated, { anchor: 'c {}', highlight: 'x: 1' })).toBe(4)
  })

  it('renders each branch in the pane, with its label in the status bar', () => {
    const { rerender } = render(<DocumentPane {...props(doc('Themes/x/tokens.json', TOKENS))} />)
    expect(document.querySelector('.qt-code-editor')).toHaveAttribute('data-language', 'json')
    expect(screen.queryByRole('textbox', { name: 'Document content' })).toBeInTheDocument()
    expect(screen.getByText('JSON', { selector: '.qt-doc-status-item' })).toBeInTheDocument()

    rerender(<DocumentPane {...props(doc('Themes/x/styles.css', '.a {}\n'), { contentVersion: 2 })} />)
    expect(document.querySelector('.qt-code-editor')).toHaveAttribute('data-language', 'css')
    expect(screen.getByText('CSS', { selector: '.qt-doc-status-item' })).toBeInTheDocument()

    rerender(<DocumentPane {...props(doc('notes.txt', 'plain words'), { contentVersion: 3 })} />)
    expect(document.querySelector('.qt-code-editor')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Document content' }).tagName).toBe('TEXTAREA')
    expect(screen.getByText('Plain text', { selector: '.qt-doc-status-item' })).toBeInTheDocument()

    rerender(<DocumentPane {...props(doc('big.json', `"${'x'.repeat(CODE_EDITOR_MAX_CHARS)}"`), { contentVersion: 4 })} />)
    expect(document.querySelector('.qt-code-editor')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Document content' }).tagName).toBe('TEXTAREA')
    expect(screen.getByText('JSON', { selector: '.qt-doc-status-item' })).toBeInTheDocument()
  })
})

describe('the code editor in the pane', () => {
  it('opens a file byte for byte and hands nothing up when it is not edited', () => {
    const view = render(<DocumentPane {...props(doc('Themes/x/tokens.json', TOKENS))} />)
    expect(editorText()).toBe(TOKENS)
    act(() => {
      jest.advanceTimersByTime(2000)
    })
    view.unmount()
    expect(onContentChange).not.toHaveBeenCalled()
  })

  it('hands typed text to onContentChange, keeping the file’s tabs', () => {
    render(<DocumentPane {...props(doc('Themes/x/tokens.json', TOKENS))} />)
    typeAt(TOKENS.indexOf('\t}\n}'), '\t\t"--theme-text": "#111111",\n')
    act(() => {
      jest.advanceTimersByTime(300)
    })
    expect(onContentChange).toHaveBeenLastCalledWith(TOKENS.replace('\t}\n}', '\t\t"--theme-text": "#111111",\n\t}\n}'))
  })

  it('hands up pending text before a blur saves, and before closing', () => {
    render(<DocumentPane {...props(doc('Themes/x/styles.css', '.a {}\n'))} />)
    typeAt(0, '/* b */\n')
    expect(onContentChange).not.toHaveBeenCalled()
    fireEvent.blur(document.querySelector('.qt-code-editor [contenteditable]')!)
    expect(onContentChange).toHaveBeenCalledWith('/* b */\n.a {}\n')
    expect(onBlur).toHaveBeenCalled()
    expect(onContentChange.mock.invocationCallOrder[0]).toBeLessThan(onBlur.mock.invocationCallOrder[0])

    typeAt(0, '/* c */\n')
    fireEvent.click(screen.getByRole('button', { name: 'Exit document mode' }))
    expect(onContentChange).toHaveBeenLastCalledWith('/* c */\n/* b */\n.a {}\n')
    expect(onContentChange.mock.invocationCallOrder.at(-1)!).toBeLessThan(onCloseDocument.mock.invocationCallOrder[0])
  })

  it('takes a change from outside without handing it back', () => {
    const d = doc('Themes/x/styles.css', '.a {}\n')
    const { rerender } = render(<DocumentPane {...props(d)} />)
    rerender(<DocumentPane {...props({ ...d, content: '.a {}\n.b { color: blue; }\n' }, { contentVersion: 2 })} />)
    settle()
    expect(editorText()).toBe('.a {}\n.b { color: blue; }\n')
    act(() => {
      jest.advanceTimersByTime(2000)
    })
    expect(onContentChange).not.toHaveBeenCalled()
  })

  it('answers doc_focus by scrolling to the line, without taking the focus', () => {
    const lines = Array.from({ length: 80 }, (_, i) => `.r${i + 1} { color: red; }`).join('\n')
    const d = doc('Themes/x/styles.css', lines)
    const { rerender } = render(<DocumentPane {...props(d)} />)
    const scroller = document.querySelector<HTMLDivElement>('.qt-code-editor-scroll')!
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 })
    const before = document.activeElement

    const request: FocusRequest = { anchor: '.r60 ' }
    rerender(<DocumentPane {...props(d, { focusRequest: request })} />)
    expect(scroller.scrollTop).toBeGreaterThan(0)
    expect(onFocusProcessed).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(before)
  })

  it('keeps the scroll position the pane remembers', () => {
    const setScrollPosition = jest.fn()
    render(<DocumentPane {...props(doc('Themes/x/styles.css', '.a {}\n'), { setScrollPosition })} />)
    const scroller = document.querySelector<HTMLDivElement>('.qt-code-editor-scroll')!
    scroller.scrollTop = 120
    fireEvent.scroll(scroller)
    act(() => {
      jest.advanceTimersByTime(150)
    })
    expect(setScrollPosition).toHaveBeenCalledWith('Themes/x/styles.css', 120)
  })
})
