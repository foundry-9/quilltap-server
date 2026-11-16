/**
 * The code editor against a real Lexical editor: fidelity (decision 5 of
 * Spec G — every bundled theme file, tabs, CRLF, no final newline and an
 * empty file come back byte for byte, and mounting alone emits nothing),
 * the external-value rule, and the keyboard.
 */

import CodeEditor, { type CodeEditorHandle } from '@/components/code-editor/CodeEditor'

import React, { createRef } from 'react'
import fs from 'fs'
import path from 'path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor,
} from 'lexical'
import { $getCodeBlock, $getSelectionOffsets, $selectOffsets } from '@/components/code-editor/lexical-text'

type Mounted = {
  editor: LexicalEditor
  handle: CodeEditorHandle
  onChange: jest.Mock
  rerender: (value: string) => void
  unmount: () => void
}

function getEditor(container: HTMLElement): LexicalEditor {
  const root = container.querySelector('[contenteditable]') as (HTMLElement & { __lexicalEditor?: LexicalEditor }) | null
  if (!root?.__lexicalEditor) throw new Error('no Lexical editor mounted')
  return root.__lexicalEditor
}

function mount(value: string, language: 'json' | 'css' = 'css', extra: Partial<React.ComponentProps<typeof CodeEditor>> = {}): Mounted {
  const onChange = jest.fn()
  const ref = createRef<CodeEditorHandle>()
  const view = render(
    <CodeEditor ref={ref} value={value} language={language} onChange={onChange} ariaLabel="Source" debounceMs={50} {...extra} />,
  )
  return {
    editor: getEditor(view.container),
    handle: ref.current!,
    onChange,
    rerender: (next: string) =>
      view.rerender(
        <CodeEditor ref={ref} value={next} language={language} onChange={onChange} ariaLabel="Source" debounceMs={50} {...extra} />,
      ),
    unmount: view.unmount,
  }
}

function settle(editor: LexicalEditor) {
  act(() => {
    editor.update(() => {}, { discrete: true })
    jest.advanceTimersByTime(200)
  })
}

function editorText(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent())
}

function update(editor: LexicalEditor, fn: () => void) {
  act(() => {
    editor.update(fn, { discrete: true })
  })
}

function typeAt(editor: LexicalEditor, offset: number, text: string) {
  update(editor, () => {
    const code = $getCodeBlock()!
    $selectOffsets(code, offset)
    const selection = $getSelection()
    if ($isRangeSelection(selection)) selection.insertRawText(text)
  })
}

function key(editor: LexicalEditor, command: typeof KEY_TAB_COMMAND, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init })
  act(() => {
    editor.update(() => {
      editor.dispatchCommand(command, event)
    }, { discrete: true })
  })
  return event
}

function caret(editor: LexicalEditor) {
  return editor.getEditorState().read(() => $getSelectionOffsets($getCodeBlock()!))
}

/** Every bundled theme's styles.css, tokens.json and theme.json. */
function bundledFiles(): [string, string, 'json' | 'css'][] {
  const dir = path.join(process.cwd(), 'themes/bundled')
  const out: [string, string, 'json' | 'css'][] = []
  for (const theme of fs.readdirSync(dir)) {
    const themeDir = path.join(dir, theme)
    if (!fs.statSync(themeDir).isDirectory()) continue
    for (const file of ['styles.css', 'tokens.json', 'theme.json']) {
      const full = path.join(themeDir, file)
      if (fs.existsSync(full)) out.push([`${theme}/${file}`, fs.readFileSync(full, 'utf8'), file.endsWith('.css') ? 'css' : 'json'])
    }
  }
  return out
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
})

afterEach(() => {
  jest.useRealTimers()
})

describe('fidelity', () => {
  const files = bundledFiles()

  it('finds the bundled theme files', () => {
    // Old School has no stylesheet of its own.
    expect(files.filter(([name]) => name.endsWith('styles.css')).length).toBeGreaterThanOrEqual(5)
    expect(files.filter(([name]) => name.endsWith('tokens.json')).length).toBeGreaterThanOrEqual(6)
    expect(files.filter(([name]) => name.endsWith('theme.json')).length).toBeGreaterThanOrEqual(6)
  })

  const samples: [string, string, 'json' | 'css'][] = [
    ...files,
    ['tabs', 'a {\n\tcolor: red;\n\t\tbackground: blue;\n}\n', 'css'],
    ['CRLF', '{\r\n  "a": 1,\r\n  "b": [\r\n    true\r\n  ]\r\n}\r\n', 'json'],
    ['no final newline', '{\n  "a": 1\n}', 'json'],
    ['empty', '', 'css'],
    ['only a newline', '\n', 'css'],
    ['blank lines at the end', 'a {}\n\n\n', 'css'],
    ['trailing spaces and a lone CR', 'a {   \n  color: red;\r  }\n', 'css'],
  ]

  it.each(samples)('%s comes back byte for byte, and mounting emits nothing', (_name, text, language) => {
    const m = mount(text, language)
    settle(m.editor)
    act(() => m.handle.flush())
    expect(m.onChange).not.toHaveBeenCalled()

    // What it holds is the text, in the editor's own line endings.
    const held = editorText(m.editor)
    expect(held).toBe(text.replace(/\r\n/g, '\n'))

    // An edit undone hands back nothing new either.
    typeAt(m.editor, 0, 'x')
    typeAt(m.editor, 1, '')
    update(m.editor, () => {
      const code = $getCodeBlock()!
      $selectOffsets(code, 0, 1)
      const selection = $getSelection()
      if ($isRangeSelection(selection)) selection.removeText()
    })
    settle(m.editor)
    act(() => m.handle.flush())
    expect(m.onChange).not.toHaveBeenCalled()
    m.unmount()
  })

  it('hands an edit back in the file’s own line endings', () => {
    const text = '{\r\n  "a": 1\r\n}\r\n'
    const m = mount(text, 'json')
    settle(m.editor)
    typeAt(m.editor, text.replace(/\r\n/g, '\n').indexOf('1') + 1, ',\n  "b": 2')
    settle(m.editor)
    expect(m.onChange).toHaveBeenCalledTimes(1)
    expect(m.onChange).toHaveBeenLastCalledWith('{\r\n  "a": 1,\r\n  "b": 2\r\n}\r\n')
    m.unmount()
  })

  it('debounces, and flush emits a pending change at once', () => {
    const m = mount('a {}\n')
    settle(m.editor)
    typeAt(m.editor, 0, 'b')
    expect(m.onChange).not.toHaveBeenCalled()
    act(() => m.handle.flush())
    expect(m.onChange).toHaveBeenCalledWith('ba {}\n')
    act(() => {
      jest.advanceTimersByTime(500)
    })
    expect(m.onChange).toHaveBeenCalledTimes(1)
    m.unmount()
  })

  it('emits a pending change when it unmounts', () => {
    const m = mount('a {}\n')
    settle(m.editor)
    typeAt(m.editor, 0, 'b')
    m.unmount()
    expect(m.onChange).toHaveBeenCalledWith('ba {}\n')
  })
})

describe('a value from outside', () => {
  it('leaves the document and caret alone when it is what the editor last emitted', () => {
    const m = mount('a {}\n')
    settle(m.editor)
    typeAt(m.editor, 0, 'b')
    act(() => m.handle.flush())
    const emitted = m.onChange.mock.calls[0][0] as string
    update(m.editor, () => $selectOffsets($getCodeBlock()!, 3))
    m.rerender(emitted)
    settle(m.editor)
    expect(editorText(m.editor)).toBe('ba {}\n')
    expect(caret(m.editor)).toEqual({ anchor: 3, focus: 3 })
    m.unmount()
  })

  it('replaces the document when it differs, emits nothing, and cannot be undone into the old file', () => {
    const m = mount('a {}\n')
    settle(m.editor)
    m.rerender('b {\r\n  color: red;\r\n}\r\n')
    settle(m.editor)
    expect(editorText(m.editor)).toBe('b {\n  color: red;\n}\n')
    expect(m.onChange).not.toHaveBeenCalled()
    act(() => {
      m.editor.dispatchCommand(UNDO_COMMAND, undefined)
    })
    settle(m.editor)
    expect(editorText(m.editor)).toBe('b {\n  color: red;\n}\n')
    // Its line endings are the new file's.
    typeAt(m.editor, editorText(m.editor).length, 'c {}\n')
    act(() => m.handle.flush())
    expect(m.onChange).toHaveBeenLastCalledWith('b {\r\n  color: red;\r\n}\r\nc {}\r\n')
    m.unmount()
  })
})

describe('keyboard', () => {
  it('Tab indents by the file’s unit and Shift+Tab outdents', () => {
    const m = mount('a {\n    color: red;\n}\n')
    settle(m.editor)
    update(m.editor, () => $selectOffsets($getCodeBlock()!, 0, 6))
    const tab = key(m.editor, KEY_TAB_COMMAND, { key: 'Tab' })
    expect(tab.defaultPrevented).toBe(true)
    expect(editorText(m.editor)).toBe('    a {\n        color: red;\n}\n')
    // The selection survives the re-highlight, now over the indented text.
    expect(caret(m.editor)).toEqual({ anchor: 0, focus: 14 })
    key(m.editor, KEY_TAB_COMMAND, { key: 'Tab', shiftKey: true })
    expect(editorText(m.editor)).toBe('a {\n    color: red;\n}\n')
    m.unmount()
  })

  it('Escape then Tab leaves the editor without indenting', () => {
    const m = mount('a {}\n')
    settle(m.editor)
    update(m.editor, () => $selectOffsets($getCodeBlock()!, 0))
    key(m.editor, KEY_ESCAPE_COMMAND, { key: 'Escape' })
    const tab = key(m.editor, KEY_TAB_COMMAND, { key: 'Tab' })
    expect(tab.defaultPrevented).toBe(false)
    expect(editorText(m.editor)).toBe('a {}\n')
    // The next Tab indents again.
    const again = key(m.editor, KEY_TAB_COMMAND, { key: 'Tab' })
    expect(again.defaultPrevented).toBe(true)
    expect(editorText(m.editor)).toBe('  a {}\n')
    m.unmount()
  })

  it('Enter keeps the line’s indentation', () => {
    const m = mount('a {\n  color: red;\n}\n')
    settle(m.editor)
    update(m.editor, () => $selectOffsets($getCodeBlock()!, 'a {\n  color: red;'.length))
    key(m.editor, KEY_ENTER_COMMAND, { key: 'Enter' })
    expect(editorText(m.editor)).toBe('a {\n  color: red;\n  \n}\n')
    expect(caret(m.editor)).toEqual({ anchor: 20, focus: 20 })
    m.unmount()
  })

  it('undo and redo are Lexical’s own', () => {
    const m = mount('a {}\n')
    settle(m.editor)
    typeAt(m.editor, 0, 'b')
    act(() => {
      jest.advanceTimersByTime(1500)
    })
    act(() => {
      m.editor.dispatchCommand(UNDO_COMMAND, undefined)
    })
    settle(m.editor)
    expect(editorText(m.editor)).toBe('a {}\n')
    act(() => {
      m.editor.dispatchCommand(REDO_COMMAND, undefined)
    })
    settle(m.editor)
    expect(editorText(m.editor)).toBe('ba {}\n')
    m.unmount()
  })

  it('keeps one code block when everything is selected and replaced', () => {
    const m = mount('a {}\nb {}\n')
    settle(m.editor)
    update(m.editor, () => {
      $getRoot().select(0, $getRoot().getChildrenSize())
      const selection = $getSelection()
      if ($isRangeSelection(selection)) selection.insertText('c')
    })
    settle(m.editor)
    const shape = m.editor.getEditorState().read(() => $getRoot().getChildren().map((n) => n.getType()))
    expect(shape).toEqual(['code'])
    expect(editorText(m.editor)).toBe('c')
    m.unmount()
  })
})

describe('handle and markers', () => {
  it('insertAtCursor replaces the selection and revealLine moves the caret', () => {
    const m = mount('a {\n  color: red;\n}\n')
    settle(m.editor)
    update(m.editor, () => $selectOffsets($getCodeBlock()!, 13, 16))
    act(() => m.handle.insertAtCursor('var(--x)'))
    settle(m.editor)
    expect(editorText(m.editor)).toBe('a {\n  color: var(--x);\n}\n')
    act(() => m.handle.revealLine(3))
    settle(m.editor)
    expect(caret(m.editor)).toEqual({ anchor: 23, focus: 23 })
    m.unmount()
  })

  it('shows each marker in the gutter and the list, and a list entry moves to its line', () => {
    const m = mount('a {\n  colr: red;\n}\n', 'css', {
      markers: [
        { line: 2, severity: 'error', message: 'Unknown property' },
        { line: 9, severity: 'warning', message: 'Past the end' },
      ],
    })
    settle(m.editor)
    expect(screen.getByRole('button', { name: 'Line 2: Error: Unknown property' })).toBeInTheDocument()
    // A line past the end is shown on the last line.
    expect(screen.getByRole('button', { name: 'Line 4: Warning: Past the end' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Problems in this file' })
    const entry = Array.from(list.querySelectorAll('button')).find((b) => b.textContent?.includes('Unknown property'))!
    fireEvent.click(entry)
    settle(m.editor)
    expect(caret(m.editor)).toEqual({ anchor: 4, focus: 4 })
    m.unmount()
  })

  it('names the editor and states how to leave it', () => {
    const m = mount('a {}\n')
    const box = screen.getByRole('textbox', { name: 'Source' })
    const description = document.getElementById(box.getAttribute('aria-describedby')!)
    expect(description?.textContent).toMatch(/Escape and then Tab/)
    m.unmount()
  })

  it('highlights CSS and JSON tokens with the qt-code-token classes', () => {
    const css = mount('a { color: red; } /* note */\n', 'css')
    settle(css.editor)
    expect(document.querySelector('.qt-code-token-selector')?.textContent).toBe('a')
    expect(document.querySelector('.qt-code-token-property')?.textContent).toBe('color')
    expect(document.querySelector('.qt-code-token-comment')?.textContent).toBe('/* note */')
    css.unmount()
    const json = mount('{"a": 1, "b": true}\n', 'json')
    settle(json.editor)
    expect(document.querySelector('.qt-code-token-property')?.textContent).toBe('"a"')
    expect(document.querySelector('.qt-code-token-number')?.textContent).toBe('1')
    expect(document.querySelector('.qt-code-token-keyword')?.textContent).toBe('true')
    json.unmount()
  })
})
