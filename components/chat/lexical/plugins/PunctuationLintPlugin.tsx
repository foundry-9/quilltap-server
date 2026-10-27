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
 * **Prose mode** (`proseMode`, for a template like Novel — see
 * `lib/punctuation-lint/prose-mode.ts`) adds two things on the same terms: a
 * softer `qt-punctuation-no-dialogue` tint over every narrated run while the
 * draft has no dialogue at all, and a preview of how the message will be set —
 * `qt-composer-narration` over narration and `qt-composer-ooc` over
 * `((out of character))` asides — because neither is otherwise visible while
 * typing. The preview ignores the warnings toggle; it is not a warning.
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
  classifyProse,
  lintPunctuation,
  PUNCTUATION_RULE_MESSAGES,
  type LintCaret,
} from '@/lib/punctuation-lint/engine'

/** The `::highlight()` name the stylesheet paints. */
export const PUNCTUATION_HIGHLIGHT_NAME = 'qt-punctuation-warning'
/** Prose mode: the whole-draft "no dialogue yet" tint. */
export const NO_DIALOGUE_HIGHLIGHT_NAME = 'qt-punctuation-no-dialogue'
/** Prose mode: the narration preview. */
export const NARRATION_HIGHLIGHT_NAME = 'qt-composer-narration'
/** Prose mode: the out-of-character preview. */
export const OOC_HIGHLIGHT_NAME = 'qt-composer-ooc'

/**
 * Paint order where highlights overlap: a specific warning over the
 * no-dialogue tint over the preview.
 */
const HIGHLIGHT_PRIORITY: Record<string, number> = {
  [PUNCTUATION_HIGHLIGHT_NAME]: 3,
  [NO_DIALOGUE_HIGHLIGHT_NAME]: 2,
  [OOC_HIGHLIGHT_NAME]: 1,
  [NARRATION_HIGHLIGHT_NAME]: 0,
}
const HIGHLIGHT_NAMES = Object.keys(HIGHLIGHT_PRIORITY)

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

/** Everything one paint produces, by highlight name. */
interface Painting {
  /** Warnings in hover order: specific marks first, the no-dialogue tint last. */
  explained: PaintedIssue[]
  ranges: Record<string, Range[]>
}

const EMPTY_PAINTING: Painting = { explained: [], ranges: {} }

// ---------------------------------------------------------------------------
// Highlight registry — one shared Highlight, many composers
// ---------------------------------------------------------------------------

/**
 * Several composers can be mounted at once (workspace panes), and a highlight
 * name is global to the document, so each plugin contributes its ranges to one
 * shared set per name rather than replacing it.
 */
const contributions = new Map<string, Map<symbol, Range[]>>()

function highlightsSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
}

function publishRanges(owner: symbol, painting: Painting): void {
  for (const name of HIGHLIGHT_NAMES) {
    const ranges = painting.ranges[name] ?? []
    let byOwner = contributions.get(name)
    if (!byOwner) {
      byOwner = new Map()
      contributions.set(name, byOwner)
    }
    if (ranges.length > 0) byOwner.set(owner, ranges)
    else byOwner.delete(owner)
    if (!highlightsSupported()) continue
    const all = [...byOwner.values()].flat()
    if (all.length === 0) {
      CSS.highlights.delete(name)
    } else {
      const highlight = new Highlight(...all)
      highlight.priority = HIGHLIGHT_PRIORITY[name]
      CSS.highlights.set(name, highlight)
    }
  }
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

/** A DOM range over a block's `[start, end)`, or null when it cannot be mapped. */
function rangeFor(
  editor: LexicalEditor,
  blocks: LintBlock[],
  span: { block: number; start: number; end: number },
): Range | null {
  const segments = blocks[span.block]?.segments ?? []
  const start = domPoint(editor, segments, span.start, 'start')
  const end = domPoint(editor, segments, span.end, 'end')
  if (!start || !end) return null
  const range = document.createRange()
  try {
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
  } catch {
    return null
  }
  return range
}

function paint(editor: LexicalEditor, warnings: boolean, proseMode: boolean): Painting {
  if ((!warnings && !proseMode) || !editor.getRootElement()) return EMPTY_PAINTING

  const { blocks, caret } = editor.getEditorState().read(() => {
    const collected = $collectBlocks()
    return { blocks: collected, caret: $caretFor(collected) }
  })
  const texts = blocks.map((b) => b.text)

  const ranges: Record<string, Range[]> = {}
  const add = (name: string, range: Range) => (ranges[name] ??= []).push(range)
  const specific: PaintedIssue[] = []
  const general: PaintedIssue[] = []

  if (warnings) {
    for (const issue of lintPunctuation(texts, { caret, proseMode })) {
      const range = rangeFor(editor, blocks, issue)
      if (!range) continue
      const message = PUNCTUATION_RULE_MESSAGES[issue.rule]
      if (issue.rule === 'no-dialogue') {
        add(NO_DIALOGUE_HIGHLIGHT_NAME, range)
        general.push({ range, message })
      } else {
        add(PUNCTUATION_HIGHLIGHT_NAME, range)
        specific.push({ range, message })
      }
    }
  }

  if (proseMode) {
    for (const span of classifyProse(texts)) {
      const range = rangeFor(editor, blocks, span)
      if (range) add(span.kind === 'ooc' ? OOC_HIGHLIGHT_NAME : NARRATION_HIGHLIGHT_NAME, range)
    }
  }

  return { explained: [...specific, ...general], ranges }
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

interface PunctuationLintPluginProps {
  /**
   * The chat's template leaves narration unmarked and quotes its dialogue
   * (`isProseTemplate`): flag a draft with no dialogue, and preview narration
   * and out-of-character asides.
   */
  proseMode?: boolean
}

export function PunctuationLintPlugin({ proseMode = false }: PunctuationLintPluginProps = {}): null {
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

    console.debug('[punctuation-lint] mounted', { warnings: enabled, proseMode })
    let lastCount = -1
    const refresh = () => {
      const painting = paint(editor, enabled, proseMode)
      paintedRef.current = painting.explained
      publishRanges(owner, painting)
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
      publishRanges(owner, EMPTY_PAINTING)
    }
  }, [editor, enabled, proseMode])

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
