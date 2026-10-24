'use client'

/**
 * PunctuationLintPlugin
 *
 * Paints a warning over marks in the composer that will probably confuse the
 * formatting engine — a double quote opened inside dialogue that is already
 * open, an asterisk with no partner, and the rest of the list in
 * `lib/punctuation-lint/engine.ts`. Hovering a painted mark shows why.
 *
 * **It never touches the text.** The warnings are drawn with the CSS Custom
 * Highlight API (`CSS.highlights` + `::highlight(qt-punctuation-warning)`),
 * which styles DOM ranges without adding a single node, so Lexical's model,
 * undo history, Markdown export and the caret are all exactly as they would be
 * without the plugin. A browser without the API simply shows nothing.
 *
 * **Every decision lives in the engine.** This file only turns the editor into
 * the engine's input (one string per text block, code masked out, the caret's
 * offset) and turns the engine's offsets back into DOM ranges.
 *
 * @module components/chat/lexical/plugins/PunctuationLintPlugin
 */

import { useEffect, useRef } from 'react'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $isCodeNode } from '@lexical/code'
import {
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical'

import {
  lintPunctuation,
  PUNCTUATION_RULE_MESSAGES,
  type LintCaret,
} from '@/lib/punctuation-lint/engine'

/** The `::highlight()` name the stylesheet paints. */
export const PUNCTUATION_HIGHLIGHT_NAME = 'qt-punctuation-warning'

/** A text node's place in its block's linted string. */
interface Segment {
  key: string
  start: number
  length: number
}

interface LintBlock {
  /** `null` for a code block — a barrier the engine skips. */
  text: string | null
  segments: Segment[]
  /** The element whose inline content this is (resolves an element caret). */
  ownerKey: string
}

/** A painted warning, kept so a hover can explain itself. */
interface PaintedIssue {
  range: Range
  message: string
}

// ---------------------------------------------------------------------------
// Highlight registry — one shared Highlight, many composers
// ---------------------------------------------------------------------------

/**
 * Several composers can be mounted at once (workspace panes), and the highlight
 * name is global to the document, so each plugin contributes its ranges to one
 * shared set rather than replacing it.
 */
const contributions = new Map<symbol, Range[]>()

function highlightsSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
}

function publishRanges(owner: symbol, ranges: Range[]): void {
  if (ranges.length > 0) contributions.set(owner, ranges)
  else contributions.delete(owner)
  if (!highlightsSupported()) return
  const all = [...contributions.values()].flat()
  if (all.length === 0) CSS.highlights.delete(PUNCTUATION_HIGHLIGHT_NAME)
  else CSS.highlights.set(PUNCTUATION_HIGHLIGHT_NAME, new Highlight(...all))
}

// ---------------------------------------------------------------------------
// Editor → engine
// ---------------------------------------------------------------------------

/**
 * Flatten the document into text blocks. A block element's inline content
 * (text, line breaks, links, decorators) is one block; a nested block element
 * (a sub-list inside a list item, a paragraph inside a table cell) ends the
 * current block and contributes its own.
 */
function $collectBlocks(): LintBlock[] {
  const blocks: LintBlock[] = []

  const walk = (element: ElementNode) => {
    const ownerKey = element.getKey()
    const before = blocks.length
    let current: LintBlock | null = null
    const flush = () => {
      if (current) blocks.push(current)
      current = null
    }
    const append = (node: LexicalNode) => {
      current ??= { text: '', segments: [], ownerKey }
      const text = current.text as string
      if ($isTextNode(node)) {
        const content = node.getTextContent()
        if (node.hasFormat('code')) {
          // Inline code is opaque: a run of non-space characters the engine
          // can neither flag nor be misled by.
          current.text = text + 'x'.repeat(content.length)
        } else {
          current.segments.push({ key: node.getKey(), start: text.length, length: content.length })
          current.text = text + content
        }
      } else if ($isLineBreakNode(node)) {
        current.text = text + '\n'
      } else if ($isElementNode(node) && node.isInline()) {
        node.getChildren().forEach(append)
      } else if ($isDecoratorNode(node)) {
        current.text = text + '￼'
      }
    }

    for (const child of element.getChildren()) {
      if ($isCodeNode(child)) {
        flush()
        blocks.push({ text: null, segments: [], ownerKey: child.getKey() })
      } else if ($isElementNode(child) && !child.isInline()) {
        flush()
        walk(child)
      } else {
        append(child)
      }
    }
    flush()
    // An empty paragraph still counts: it is where the caret may be.
    if (blocks.length === before) blocks.push({ text: '', segments: [], ownerKey })
  }

  walk($getRoot())
  return blocks
}

/** Where the caret sits in block coordinates, or null without a collapsed caret. */
function $caretFor(blocks: LintBlock[]): LintCaret | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
  const { key, offset, type } = selection.anchor
  if (type !== 'text') {
    // An element point — typically an empty paragraph. Offset 0 is its start;
    // anything else is past its inline content.
    const block = blocks.findIndex((b) => b.ownerKey === key)
    if (block < 0) return null
    return { block, offset: offset === 0 ? 0 : (blocks[block].text ?? '').length }
  }
  for (let block = 0; block < blocks.length; block++) {
    const segment = blocks[block].segments.find((s) => s.key === key)
    if (segment) return { block, offset: segment.start + offset }
  }
  return null
}

// ---------------------------------------------------------------------------
// Engine → DOM
// ---------------------------------------------------------------------------

function firstTextNode(element: HTMLElement): Text | null {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  return walker.nextNode() as Text | null
}

/** Map a block offset back to a DOM text position. */
function domPoint(
  editor: LexicalEditor,
  segments: Segment[],
  offset: number,
  edge: 'start' | 'end',
): { node: Text; offset: number } | null {
  const segment = segments.find((s) =>
    edge === 'start'
      ? offset >= s.start && offset < s.start + s.length
      : offset > s.start && offset <= s.start + s.length,
  )
  if (!segment) return null
  const element = editor.getElementByKey(segment.key)
  const text = element ? firstTextNode(element) : null
  if (!text) return null
  const local = Math.min(offset - segment.start, text.length)
  return { node: text, offset: local }
}

function paint(editor: LexicalEditor, enabled: boolean): PaintedIssue[] {
  if (!enabled || !editor.getRootElement()) return []

  const { blocks, caret } = editor.getEditorState().read(() => {
    const collected = $collectBlocks()
    return { blocks: collected, caret: $caretFor(collected) }
  })

  const issues = lintPunctuation(
    blocks.map((b) => b.text),
    { caret },
  )

  const painted: PaintedIssue[] = []
  for (const issue of issues) {
    const segments = blocks[issue.block]?.segments ?? []
    const start = domPoint(editor, segments, issue.start, 'start')
    const end = domPoint(editor, segments, issue.end, 'end')
    if (!start || !end) continue
    const range = document.createRange()
    try {
      range.setStart(start.node, start.offset)
      range.setEnd(end.node, end.offset)
    } catch {
      continue
    }
    painted.push({ range, message: PUNCTUATION_RULE_MESSAGES[issue.rule] })
  }
  return painted
}

// ---------------------------------------------------------------------------
// Hover explanation
// ---------------------------------------------------------------------------

function caretPointAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  if (doc.caretPositionFromPoint) {
    const position = doc.caretPositionFromPoint(x, y)
    return position ? { node: position.offsetNode, offset: position.offset } : null
  }
  const range = doc.caretRangeFromPoint?.(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : null
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function PunctuationLintPlugin(): null {
  const [editor] = useLexicalComposerContext()
  const { data: chatSettings } = useChatSettingsQuery()
  const enabled = chatSettings?.smartTypographySettings?.punctuationWarnings ?? true

  const ownerRef = useRef(Symbol('punctuation-lint'))
  const paintedRef = useRef<PaintedIssue[]>([])

  useEffect(() => {
    const owner = ownerRef.current
    if (!highlightsSupported()) {
      console.debug('[punctuation-lint] CSS Custom Highlight API unavailable; warnings disabled')
      return
    }

    let lastCount = -1
    const refresh = () => {
      paintedRef.current = paint(editor, enabled)
      publishRanges(owner, paintedRef.current.map((p) => p.range))
      // One line when the number of warnings changes — never per keystroke.
      if (paintedRef.current.length !== lastCount) {
        lastCount = paintedRef.current.length
        console.debug(`[punctuation-lint] ${lastCount} warning(s)`)
      }
    }

    refresh()
    const unregister = editor.registerUpdateListener(refresh)
    return () => {
      unregister()
      paintedRef.current = []
      publishRanges(owner, [])
    }
  }, [editor, enabled])

  // Explain a painted mark on hover through the editable root's `title`.
  useEffect(() => {
    let root: HTMLElement | null = null
    let shownTitle: string | null = null

    const onMove = (event: MouseEvent) => {
      if (!root) return
      const point = paintedRef.current.length > 0 ? caretPointAt(event.clientX, event.clientY) : null
      const hit = point
        ? paintedRef.current.find((p) => {
            try {
              return p.range.comparePoint(point.node, point.offset) === 0
            } catch {
              return false
            }
          })
        : undefined
      const next = hit?.message ?? null
      if (next === shownTitle) return
      if (next) root.setAttribute('title', next)
      else root.removeAttribute('title')
      shownTitle = next
    }

    return editor.registerRootListener((nextRoot, previousRoot) => {
      previousRoot?.removeEventListener('mousemove', onMove)
      if (previousRoot && shownTitle) previousRoot.removeAttribute('title')
      shownTitle = null
      root = nextRoot
      nextRoot?.addEventListener('mousemove', onMove)
    })
  }, [editor])

  return null
}

export default PunctuationLintPlugin
