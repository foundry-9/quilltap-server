/**
 * Marking where a name chip goes in a rendered message.
 *
 * The Salon puts a chip on an absent character's name at its first mention in
 * the chat (`lib/chat/absent-mentions.ts` says which message and which words).
 * The chip has to land inside the roleplay styling, not split it: a name in the
 * middle of a quoted line must not break the line's dialogue colouring. So
 * instead of making the name an element in the markdown tree (which the inline
 * tokenizer cannot see across), {@link rehypeMentionMarkers} wraps it in three
 * private-use characters inside the same text node, the tokenizer styles the
 * text as usual, and the renderer turns each marked run into a chip
 * ({@link splitMentionMarkers}).
 *
 * Only text that is a direct child of a paragraph, heading, list item or
 * blockquote is marked: that is the text the renderer's inline pass handles.
 * Text in code, links, emphasis or math is skipped, and the next eligible
 * occurrence takes the chip. Pure and client-safe.
 */

import { buildNameMatcher } from '@/lib/chat/name-mentions'

export const MENTION_OPEN = ''
export const MENTION_MID = ''
export const MENTION_CLOSE = ''

const ELIGIBLE_PARENTS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote'])

interface HastNode {
  type: string
  tagName?: string
  value?: string
  children?: HastNode[]
}

/**
 * A rehype plugin: the first eligible occurrence of each `mentions[i].text`
 * becomes `OPEN i MID text CLOSE`. Each mention is marked at most once.
 */
export function rehypeMentionMarkers(mentions: ReadonlyArray<{ text: string }>) {
  return (tree: HastNode) => {
    const pending = mentions
      .map((m, index) => ({ index, matcher: buildNameMatcher([m.text]) }))
      .filter((entry): entry is { index: number; matcher: RegExp } => !!entry.matcher)
    if (pending.length === 0) return

    const walk = (node: HastNode) => {
      if (pending.length === 0 || !node.children) return
      const eligible = node.type === 'element' && ELIGIBLE_PARENTS.has(node.tagName ?? '')
      for (const child of node.children) {
        if (pending.length === 0) return
        if (child.type === 'text' && eligible && child.value) {
          child.value = markText(child.value, pending)
        } else if (child.type === 'element' && child.tagName !== 'code' && child.tagName !== 'pre') {
          walk(child)
        }
      }
    }
    walk(tree)
  }
}

/** Mark every pending mention found in `text`, removing each from `pending`. */
function markText(text: string, pending: Array<{ index: number; matcher: RegExp }>): string {
  let out = text
  for (let i = 0; i < pending.length; ) {
    const { index, matcher } = pending[i]
    matcher.lastIndex = 0
    let hit: RegExpExecArray | null
    let placed = false
    while ((hit = matcher.exec(out)) !== null) {
      // Never inside a run another mention already marked.
      const before = out.slice(0, hit.index)
      if (before.lastIndexOf(MENTION_OPEN) > before.lastIndexOf(MENTION_CLOSE)) continue
      out = `${before}${MENTION_OPEN}${index}${MENTION_MID}${hit[0]}${MENTION_CLOSE}${out.slice(hit.index + hit[0].length)}`
      placed = true
      break
    }
    if (placed) pending.splice(i, 1)
    else i++
  }
  return out
}

/** One run of rendered text: plain, or a marked mention by its index. */
export type MentionRun = string | { index: number; text: string }

/** Split marked text into plain runs and mention runs. */
export function splitMentionMarkers(text: string): MentionRun[] {
  if (!text.includes(MENTION_OPEN)) return [text]
  const runs: MentionRun[] = []
  const pattern = new RegExp(`${MENTION_OPEN}(\\d+)${MENTION_MID}([^${MENTION_CLOSE}]*)${MENTION_CLOSE}`, 'g')
  let last = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) runs.push(text.slice(last, m.index))
    runs.push({ index: Number(m[1]), text: m[2] })
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push(text.slice(last))
  return runs
}

/**
 * When a message renders in several runs (prose split around tool calls), give
 * each mention to the first run that names it. `runs[i]` is null for a run
 * that is not prose. Returns the mentions for each run, by index.
 */
export function assignMentionsToRuns<M extends { text: string }>(
  runs: ReadonlyArray<string | null>,
  mentions: ReadonlyArray<M>,
): Array<M[] | undefined> {
  const out: Array<M[] | undefined> = runs.map(() => undefined)
  for (const mention of mentions) {
    const matcher = buildNameMatcher([mention.text])
    if (!matcher) continue
    const at = runs.findIndex(run => {
      if (run === null) return false
      matcher.lastIndex = 0
      return matcher.test(run)
    })
    if (at >= 0) (out[at] ??= []).push(mention)
  }
  return out
}
