/**
 * The code editor's bridge between Lexical's nodes and plain text offsets.
 *
 * The editor's document is one `CodeNode` under the root, whose children are
 * flat: highlight (text) nodes, tabs and line breaks. Every command the editor
 * adds — indent, outdent, Enter, insert at the cursor, reveal a line — is
 * worked out on the text (`./text.ts`) and applied here, so the arithmetic is
 * testable without a DOM.
 *
 * Every function here is a `$` function: call it inside `editor.update` or
 * `editor.read`.
 *
 * @module components/code-editor/lexical-text
 */

import { $createCodeNode, $isCodeNode, type CodeNode } from '@lexical/code'
import {
  $createRangeSelection,
  $generateNodesFromRawText,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type PointType,
} from 'lexical'
import type { TextEdit } from './text'

/** The single code block, or null while the document is not in shape. */
export function $getCodeBlock(): CodeNode | null {
  const first = $getRoot().getFirstChild()
  return $isCodeNode(first) ? first : null
}

/** The document's text, as the editor holds it (`\n` line breaks). */
export function $getEditorText(): string {
  return $getRoot().getTextContent()
}

/** A fresh code block holding exactly `text`. */
export function $createCodeBlock(text: string, language: string): CodeNode {
  const code = $createCodeNode(language)
  const nodes = $generateNodesFromRawText(text)
  if (nodes.length > 0) code.append(...nodes)
  return code
}

/** Replace the whole document with one code block holding `text`. */
export function $replaceDocument(text: string, language: string): void {
  const root = $getRoot()
  root.clear()
  root.append($createCodeBlock(text, language))
}

/** The text offset of a selection point inside the code block, or null if it is elsewhere. */
export function $offsetOfPoint(code: CodeNode, point: PointType): number | null {
  if (point.type === 'element') {
    if (point.key === code.getKey()) {
      let offset = 0
      const children = code.getChildren()
      for (let i = 0; i < point.offset && i < children.length; i++) offset += children[i].getTextContentSize()
      return offset
    }
    if (point.key === $getRoot().getKey()) return point.offset === 0 ? 0 : code.getTextContentSize()
    return null
  }
  const node = point.getNode()
  if (node.getParent() !== code) return null
  let offset = point.offset
  for (let sibling = node.getPreviousSibling(); sibling !== null; sibling = sibling.getPreviousSibling()) {
    offset += sibling.getTextContentSize()
  }
  return offset
}

/** Set a point to the place `offset` characters into the code block. */
function $setPointAt(point: PointType, code: CodeNode, offset: number): void {
  const children = code.getChildren()
  let remaining = Math.max(0, offset)
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if ($isTextNode(child)) {
      const size = child.getTextContentSize()
      if (remaining <= size) {
        point.set(child.getKey(), remaining, 'text')
        return
      }
      remaining -= size
    } else {
      // A line break: a caret before it is an element point on the code block.
      if (remaining === 0) {
        point.set(code.getKey(), i, 'element')
        return
      }
      remaining -= child.getTextContentSize()
    }
  }
  point.set(code.getKey(), children.length, 'element')
}

/** Select `[anchor, focus]` by text offset. */
export function $selectOffsets(code: CodeNode, anchor: number, focus: number = anchor): void {
  const selection = $createRangeSelection()
  $setPointAt(selection.anchor, code, anchor)
  $setPointAt(selection.focus, code, focus)
  $setSelection(selection)
}

/** The current selection as text offsets into the code block, or null when it is not in it. */
export function $getSelectionOffsets(code: CodeNode): { anchor: number; focus: number } | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return null
  const anchor = $offsetOfPoint(code, selection.anchor)
  const focus = $offsetOfPoint(code, selection.focus)
  if (anchor === null || focus === null) return null
  return { anchor, focus }
}

/** Replace `[from, to)` with `insert` at the current state. */
function $applyEdit(code: CodeNode, edit: TextEdit): void {
  $selectOffsets(code, edit.from, edit.to)
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return
  if (edit.insert === '') selection.removeText()
  else selection.insertRawText(edit.insert)
}

/** Apply edits ordered last-first (as `planIndent` / `planOutdent` return them). */
export function $applyEdits(code: CodeNode, edits: readonly TextEdit[]): void {
  for (const edit of edits) $applyEdit(code, edit)
}

/** Insert `text` at the selection (replacing it) and leave the caret after it. */
export function $insertTextAt(code: CodeNode, anchor: number, focus: number, text: string): void {
  const from = Math.min(anchor, focus)
  const to = Math.max(anchor, focus)
  $applyEdit(code, { from, to, insert: text })
  $selectOffsets(code, from + text.length)
}

/**
 * Put the document back into shape when an edit has left the root holding
 * anything but one code block (a select-all-and-type, a delete at the very
 * start). The text is kept; each block's text is joined with a line break.
 */
export function $normaliseDocument(language: string): boolean {
  const root = $getRoot()
  const children = root.getChildren()
  if (children.length === 1 && $isCodeNode(children[0])) return false

  const selection = $getSelection()
  let caret: number | null = null
  let consumed = 0
  const parts: string[] = []
  for (const child of children) {
    const text = child.getTextContent()
    if (caret === null && $isRangeSelection(selection)) {
      const anchorNode = selection.anchor.getNode()
      if (anchorNode === child || ($isElementNode(child) && child.isParentOf(anchorNode))) {
        caret = consumed + text.length
      }
    }
    parts.push(text)
    consumed += text.length + 1
  }
  const text = parts.join('\n')
  const code = $createCodeBlock(text, language)
  root.clear()
  root.append(code)
  $selectOffsets(code, caret ?? text.length)
  return true
}
