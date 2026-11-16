'use client'

/**
 * CodeEditor — a plain-text Lexical editor for one JSON or CSS file, with
 * Prism highlighting, line numbers, problem markers and keyboard indentation.
 *
 * Decisions of record (docs/developer/features/complete/calliope-live-spec-g-custom-css.md):
 *
 * - **It hands back exactly what it was given** (decision 5). Tabs, line
 *   endings and the final newline survive; mounting, or a refetch that
 *   brings back what it last emitted, emits nothing. Line endings are
 *   handled in `./text.ts`.
 * - **It owns its text.** The parent hears about edits through a debounced
 *   `onChange` (and may `flush()` it); no React state follows the keystrokes.
 *   A new `value` replaces the document only when it differs from what the
 *   editor last emitted, so a save's echo does not move the caret.
 * - **Undo is Lexical's own** (decision 2), cleared when the parent replaces
 *   the document.
 * - **Tab indents, Shift+Tab outdents, Escape then Tab leaves**, and the
 *   accessible description says so.
 *
 * @module components/code-editor/CodeEditor
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { CodeHighlightNode, CodeNode } from '@lexical/code'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  KEY_BACKSPACE_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  RootNode,
  mergeRegister,
  type LexicalEditor,
} from 'lexical'
import { Icon, type IconName } from '@/components/ui/icon'
import { registerCodeHighlighting } from './prism'
import { ReusingPrismTokenizer } from './tokenizer'
import { codeEditorTheme } from './theme'
import {
  countLines,
  detectIndentUnit,
  detectLineEnding,
  fromEditorText,
  leadingIndentAt,
  lineStarts,
  planIndent,
  planOutdent,
  toEditorText,
  type LineEnding,
} from './text'
import {
  $applyEdits,
  $getCodeBlock,
  $getEditorText,
  $getSelectionOffsets,
  $insertTextAt,
  $normaliseDocument,
  $replaceDocument,
  $selectOffsets,
  $createCodeBlock,
} from './lexical-text'

export type CodeEditorLanguage = 'json' | 'css'

export type CodeEditorSeverity = 'error' | 'warning' | 'info'

export interface CodeEditorMarker {
  /** 1-based line number. A line past the end is shown on the last line. */
  line: number
  severity: CodeEditorSeverity
  message: string
}

export interface CodeEditorHandle {
  /** Emit a pending change now, if there is one. */
  flush: () => void
  /** Insert text at the caret (or where it last was), replacing any selection, and focus the editor. */
  insertAtCursor: (text: string) => void
  /**
   * Move the caret to the start of a 1-based line, scroll it into view and
   * focus the editor. With `{ focus: false }` it only scrolls the line into
   * view, leaving the caret and the focus where they are (a request from
   * elsewhere — a character's `doc_focus` — must not take the keyboard).
   */
  revealLine: (line: number, options?: { focus?: boolean }) => void
  /** Focus the editor without moving the caret. */
  focus: () => void
  /** The element that scrolls, for a host that keeps its scroll position. */
  scrollElement: () => HTMLDivElement | null
}

export interface CodeEditorProps {
  value: string
  language: CodeEditorLanguage
  /** Called after a pause in typing with the whole text, in the file's own line endings. */
  onChange: (value: string) => void
  readOnly?: boolean
  markers?: readonly CodeEditorMarker[]
  /** The accessible name. One of `ariaLabel` / `ariaLabelledBy` is required. */
  ariaLabel?: string
  ariaLabelledBy?: string
  /** Milliseconds of quiet before `onChange` fires. Default 400. */
  debounceMs?: number
  /** CSS height of the scrolling area; when absent it grows from `minHeight` to `maxHeight`. */
  height?: string
  minHeight?: string
  maxHeight?: string
  className?: string
}

const SEVERITY_LABEL: Record<CodeEditorSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Note',
}

const SEVERITY_ICON: Record<CodeEditorSeverity, IconName> = {
  error: 'alert-circle',
  warning: 'alert-triangle',
  info: 'info',
}

const SEVERITY_RANK: Record<CodeEditorSeverity, number> = { error: 0, warning: 1, info: 2 }

/** Markers on lines that exist (a line past the end moves to the last), in line order. */
function clampMarkers(markers: readonly CodeEditorMarker[], lineCount: number): CodeEditorMarker[] {
  return markers
    .map((marker) => ({ ...marker, line: Math.min(Math.max(1, Math.floor(marker.line) || 1), lineCount) }))
    .sort((a, b) => a.line - b.line || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}

/** The worst marker on each line, with every message on it. */
function markersByLine(markers: readonly CodeEditorMarker[]) {
  const lines = new Map<number, { severity: CodeEditorSeverity; messages: string[] }>()
  for (const marker of markers) {
    const entry = lines.get(marker.line)
    if (!entry) {
      lines.set(marker.line, { severity: marker.severity, messages: [marker.message] })
    } else {
      entry.messages.push(marker.message)
      if (SEVERITY_RANK[marker.severity] < SEVERITY_RANK[entry.severity]) entry.severity = marker.severity
    }
  }
  return [...lines.entries()]
}

// ============================================================================
// Plugins (inside the composer)
// ============================================================================

interface Shape {
  language: CodeEditorLanguage
  indentUnit: string
}

/** Prism highlighting, the one-code-block invariant and the keyboard. */
function CodeBehaviourPlugin({ shapeRef }: { shapeRef: React.RefObject<Shape> }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    // Escape arms a Tab that leaves the editor instead of indenting.
    let leaveArmed = false
    // Re-highlighting keeps only the caret, collapsing a selection; an
    // indent over a selection puts it back once the update has committed.
    let reselect: { anchor: number; focus: number } | null = null

    return mergeRegister(
      registerCodeHighlighting(editor, ReusingPrismTokenizer),
      editor.registerUpdateListener(() => {
        if (!reselect) return
        const { anchor, focus } = reselect
        reselect = null
        editor.update(
          () => {
            const code = $getCodeBlock()
            if (code) $selectOffsets(code, anchor, focus)
          },
          { discrete: true, tag: 'history-merge' },
        )
      }),
      editor.registerNodeTransform(RootNode, () => {
        $normaliseDocument(shapeRef.current.language)
      }),
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          if (event.key !== 'Escape' && event.key !== 'Tab' && event.key !== 'Shift') leaveArmed = false
          return false
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          leaveArmed = true
          return false
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          // Returning true without preventDefault stops Lexical's own code
          // indent and lets the browser move focus.
          if (leaveArmed || !editor.isEditable()) {
            leaveArmed = false
            return true
          }
          const code = $getCodeBlock()
          const offsets = code ? $getSelectionOffsets(code) : null
          if (!code || !offsets) return false
          event.preventDefault()
          const text = $getEditorText()
          const plan = event.shiftKey
            ? planOutdent(text, offsets.anchor, offsets.focus, shapeRef.current.indentUnit)
            : planIndent(text, offsets.anchor, offsets.focus, shapeRef.current.indentUnit)
          $applyEdits(code, plan.edits)
          $selectOffsets(code, plan.anchor, plan.focus)
          if (plan.anchor !== plan.focus) reselect = { anchor: plan.anchor, focus: plan.focus }
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (event?.isComposing) return false
          const code = $getCodeBlock()
          const offsets = code ? $getSelectionOffsets(code) : null
          if (!code || !offsets) return false
          event?.preventDefault()
          const start = Math.min(offsets.anchor, offsets.focus)
          // Keep the line's indentation on the new line.
          $insertTextAt(code, offsets.anchor, offsets.focus, '\n' + leadingIndentAt($getEditorText(), start))
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => {
          // At the very start, Lexical would turn the code block into a paragraph.
          const selection = $getSelection()
          const code = $getCodeBlock()
          if (!code || !$isRangeSelection(selection) || !selection.isCollapsed()) return false
          const offsets = $getSelectionOffsets(code)
          if (offsets && offsets.anchor === 0) {
            event.preventDefault()
            return true
          }
          return false
        },
        COMMAND_PRIORITY_HIGH,
      ),
    )
  }, [editor, shapeRef])

  return null
}

interface SyncProps {
  value: string
  readOnly: boolean
  debounceMs: number
  onChange: (value: string) => void
  shapeRef: React.RefObject<Shape>
  /** What was last handed to the parent (or given by it): the source of truth for "changed". */
  lastEmittedRef: React.RefObject<string>
  lineEndingRef: React.RefObject<LineEnding>
  lastSelectionRef: React.RefObject<{ anchor: number; focus: number } | null>
  flushRef: React.RefObject<() => void>
  editorRef: React.RefObject<LexicalEditor | null>
  onLineCount: (count: number) => void
}

/** Debounced emission, external replacement and the bookkeeping the handle needs. */
function SyncPlugin({
  value,
  readOnly,
  debounceMs,
  onChange,
  shapeRef,
  lastEmittedRef,
  lineEndingRef,
  lastSelectionRef,
  flushRef,
  editorRef,
  onLineCount,
}: SyncProps) {
  const [editor] = useLexicalComposerContext()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onChange)
  const onLineCountRef = useRef(onLineCount)
  useLayoutEffect(() => {
    onChangeRef.current = onChange
    onLineCountRef.current = onLineCount
  }, [onChange, onLineCount])

  useEffect(() => {
    editorRef.current = editor
    return () => {
      editorRef.current = null
    }
  }, [editor, editorRef])

  useEffect(() => {
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  const emit = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const text = fromEditorText(editor.getEditorState().read($getEditorText), lineEndingRef.current)
    if (text === lastEmittedRef.current) return
    lastEmittedRef.current = text
    onChangeRef.current(text)
  }, [editor, lastEmittedRef, lineEndingRef])

  useEffect(() => {
    flushRef.current = () => {
      if (timerRef.current) emit()
    }
  }, [emit, flushRef])

  useEffect(() => {
    let lines = -1
    const unregister = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      editorState.read(() => {
        const code = $getCodeBlock()
        const offsets = code ? $getSelectionOffsets(code) : null
        if (offsets) lastSelectionRef.current = offsets
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return
        const count = countLines($getEditorText())
        if (count !== lines) {
          lines = count
          onLineCountRef.current(count)
        }
      })
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(emit, debounceMs)
    })
    return () => {
      unregister()
      // Whatever was typed in the last pause still reaches the parent.
      if (timerRef.current) emit()
    }
  }, [editor, debounceMs, emit, lastSelectionRef])

  // A new value from outside: replace the document only when it differs
  // from what the editor last emitted.
  useEffect(() => {
    if (value === lastEmittedRef.current) return
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    lastEmittedRef.current = value
    lineEndingRef.current = detectLineEnding(value)
    const text = toEditorText(value)
    shapeRef.current = { ...shapeRef.current, indentUnit: detectIndentUnit(text) }
    editor.update(
      () => {
        const code = $getCodeBlock()
        const caret = code ? $getSelectionOffsets(code) : null
        $replaceDocument(text, shapeRef.current.language)
        const fresh = $getCodeBlock()
        if (fresh && caret && $getSelection() !== null) {
          $selectOffsets(fresh, Math.min(caret.anchor, text.length), Math.min(caret.focus, text.length))
        }
      },
      { tag: 'external-value' },
    )
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
  }, [value, editor, lastEmittedRef, lineEndingRef, shapeRef])

  return null
}

// ============================================================================
// The component
// ============================================================================

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  {
    value,
    language,
    onChange,
    readOnly = false,
    markers = [],
    ariaLabel,
    ariaLabelledBy,
    debounceMs = 400,
    height,
    minHeight = '8rem',
    maxHeight = '32rem',
    className,
  },
  ref,
) {
  const baseId = useId()
  const descriptionId = `${baseId}-keys`
  const problemsId = `${baseId}-problems`

  // Captured once: the composer reads its initial state on first render only.
  const [initial] = useState(() => {
    const text = toEditorText(value)
    return { text, lineEnding: detectLineEnding(value), indentUnit: detectIndentUnit(text), lines: countLines(text) }
  })
  const shapeRef = useRef<Shape>({ language, indentUnit: initial.indentUnit })
  useLayoutEffect(() => {
    shapeRef.current.language = language
  }, [language])
  const lastEmittedRef = useRef(value)
  const lineEndingRef = useRef<LineEnding>(initial.lineEnding)
  const lastSelectionRef = useRef<{ anchor: number; focus: number } | null>(null)
  const flushRef = useRef<() => void>(() => {})
  const editorRef = useRef<LexicalEditor | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const numbersRef = useRef<HTMLPreElement | null>(null)
  const [lineCount, setLineCount] = useState(initial.lines)

  const initialConfig = useMemo(
    () => ({
      namespace: 'CodeEditor',
      theme: codeEditorTheme,
      nodes: [CodeNode, CodeHighlightNode],
      editable: !readOnly,
      onError: (error: Error) => {
        console.error('[CodeEditor] Lexical error', error)
      },
      editorState: () => {
        $getRoot().append($createCodeBlock(initial.text, language))
      },
    }),
    // The composer reads its config once; later changes go through the plugins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const scrollToLine = useCallback((line: number) => {
    const scroller = scrollRef.current
    const numbers = numbersRef.current
    if (!scroller || !numbers) return
    const style = getComputedStyle(numbers)
    const lineHeight = parseFloat(style.lineHeight) || 20
    const padTop = parseFloat(style.paddingTop) || 0
    const top = padTop + (line - 1) * lineHeight
    if (top < scroller.scrollTop || top + lineHeight > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 2 + lineHeight / 2)
    }
  }, [])

  const revealLine = useCallback(
    (line: number, options?: { focus?: boolean }) => {
      const editor = editorRef.current
      if (!editor) return
      if (options?.focus === false) {
        const count = editor.getEditorState().read(() => countLines($getEditorText()))
        scrollToLine(Math.min(Math.max(1, Math.floor(line) || 1), count))
        return
      }
      let target = 1
      editor.update(
        () => {
          const code = $getCodeBlock()
          if (!code) return
          const starts = lineStarts($getEditorText())
          target = Math.min(Math.max(1, Math.floor(line) || 1), starts.length)
          $selectOffsets(code, starts[target - 1])
        },
        { tag: 'reveal-line' },
      )
      editor.focus(undefined, { defaultSelection: 'rootStart' })
      scrollToLine(target)
      // Lexical's focus may scroll the caret into view on its own; land on the line regardless.
      requestAnimationFrame(() => scrollToLine(target))
    },
    [scrollToLine],
  )

  useImperativeHandle(
    ref,
    () => ({
      flush: () => flushRef.current(),
      insertAtCursor: (text: string) => {
        const editor = editorRef.current
        if (!editor || !editor.isEditable()) return
        editor.update(() => {
          const code = $getCodeBlock()
          if (!code) return
          const offsets = $getSelectionOffsets(code) ??
            lastSelectionRef.current ?? { anchor: code.getTextContentSize(), focus: code.getTextContentSize() }
          $insertTextAt(code, offsets.anchor, offsets.focus, toEditorText(text))
        })
        editor.focus()
      },
      revealLine,
      focus: () => editorRef.current?.focus(),
      scrollElement: () => scrollRef.current,
    }),
    [revealLine],
  )

  const lineNumbers = useMemo(() => {
    let out = '1'
    for (let i = 2; i <= lineCount; i++) out += '\n' + i
    return out
  }, [lineCount])

  const problems = useMemo(() => clampMarkers(markers, lineCount), [markers, lineCount])
  const marked = useMemo(() => markersByLine(problems), [problems])

  const scrollStyle: React.CSSProperties = height ? { height } : { minHeight, maxHeight }

  return (
    <div className={`qt-code-editor${className ? ` ${className}` : ''}`} data-language={language}>
      <div className="qt-code-editor-scroll" ref={scrollRef} style={scrollStyle}>
        <div className="qt-code-editor-body">
          <div className="qt-code-editor-gutter">
            <pre className="qt-code-editor-line-numbers" ref={numbersRef} aria-hidden="true">
              {lineNumbers}
            </pre>
            {marked.map(([line, entry]) => {
              const label = `Line ${line}: ${SEVERITY_LABEL[entry.severity]}: ${entry.messages.join('; ')}`
              return (
                <button
                  key={line}
                  type="button"
                  className={`qt-code-editor-marker qt-code-editor-marker-${entry.severity}`}
                  style={{ '--qt-code-editor-marker-line': line - 1 } as React.CSSProperties}
                  aria-label={label}
                  onClick={() => revealLine(line)}
                >
                  <Icon name={SEVERITY_ICON[entry.severity]} className="qt-code-editor-marker-icon" />
                  <span className="qt-code-editor-tooltip" aria-hidden="true">
                    {entry.messages.map((message, i) => (
                      <span key={i} className="qt-code-editor-tooltip-line">
                        {message}
                      </span>
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="qt-code-editor-text">
            {marked.map(([line, entry]) => (
              <div
                key={line}
                aria-hidden="true"
                className={`qt-code-editor-band qt-code-editor-band-${entry.severity}`}
                style={{ '--qt-code-editor-marker-line': line - 1 } as React.CSSProperties}
              />
            ))}
            <LexicalComposer initialConfig={initialConfig}>
              <PlainTextPlugin
                contentEditable={
                  <ContentEditable
                    className="qt-code-editor-content"
                    aria-label={ariaLabelledBy ? undefined : ariaLabel}
                    aria-labelledby={ariaLabelledBy}
                    aria-describedby={descriptionId}
                    aria-multiline
                    aria-readonly={readOnly || undefined}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                }
                placeholder={null}
                ErrorBoundary={LexicalErrorBoundary}
              />
              <HistoryPlugin />
              <CodeBehaviourPlugin shapeRef={shapeRef} />
              <SyncPlugin
                value={value}
                readOnly={readOnly}
                debounceMs={debounceMs}
                onChange={onChange}
                shapeRef={shapeRef}
                lastEmittedRef={lastEmittedRef}
                lineEndingRef={lineEndingRef}
                lastSelectionRef={lastSelectionRef}
                flushRef={flushRef}
                editorRef={editorRef}
                onLineCount={setLineCount}
              />
            </LexicalComposer>
          </div>
        </div>
      </div>
      <p id={descriptionId} className="sr-only">
        Tab indents and Shift+Tab outdents. To step out of the editor, press Escape and then Tab.
      </p>
      {problems.length > 0 && (
        <ul id={problemsId} className="qt-code-editor-problems" aria-label="Problems in this file">
          {problems.map((problem, i) => (
            <li key={i}>
              <button
                type="button"
                className={`qt-code-editor-problem qt-code-editor-problem-${problem.severity}`}
                onClick={() => revealLine(problem.line)}
              >
                <Icon name={SEVERITY_ICON[problem.severity]} className="qt-code-editor-marker-icon" />
                <span className="sr-only">{SEVERITY_LABEL[problem.severity]}, </span>
                <span className="qt-code-editor-problem-line">Line {problem.line}</span>
                <span className="qt-code-editor-problem-message">{problem.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})

export default CodeEditor
