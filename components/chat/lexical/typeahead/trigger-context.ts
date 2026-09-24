/**
 * Shared cursor context for the composer's inline typeaheads.
 *
 * The `:` / `\` character typeahead and the `@` mention typeahead ask the same
 * two questions of the editor before opening a menu — what text precedes the
 * cursor, and is the trigger glued to the previous inline run — so they share
 * one answer rather than keeping copies that drift.
 *
 * @module components/chat/lexical/typeahead/trigger-context
 */

import { $getSelection, $isRangeSelection, $isTextNode, type TextNode } from 'lexical'

import { isTriggerOpenerContext } from '@/lib/char-insert/trigger'
import { $isInCodeContext } from '../utils/code-context'

/**
 * The text of the anchor node up to the cursor — the same slice Lexical's own
 * trigger machinery works from, so our offsets and its node-splitting agree.
 *
 * Returns null in every position a typing aid must stay out of. Must run inside
 * a read/update context.
 */
export function $textBeforeCursor(): { node: TextNode; text: string } | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
  if ($isInCodeContext(selection)) return null

  const anchor = selection.anchor
  if (anchor.type !== 'text') return null

  const node = anchor.getNode()
  if (!$isTextNode(node) || !node.isSimpleText()) return null

  return { node, text: node.getTextContent().slice(0, anchor.offset) }
}

/**
 * A trigger at offset 0 of the anchor node is only really at a word opening if
 * nothing is glued to it in the preceding inline run — `**bold**:smi` must not
 * open a menu. The rule itself comes from Tier B rather than being re-derived.
 */
export function $isGluedToPreviousRun(node: TextNode, start: number): boolean {
  if (start !== 0) return false

  const previous = node.getPreviousSibling()
  if (!previous) return false

  const previousText = previous.getTextContent()
  const lastChar = previousText[previousText.length - 1]
  if (!lastChar) return false

  return !isTriggerOpenerContext(lastChar)
}
