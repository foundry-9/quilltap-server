import type { Message } from './types'

/**
 * One piece of an assistant message's interleaved body: either a run of prose
 * or a group of one-or-more tool calls that fired at the same point in it.
 */
export type ToolLayoutPart =
  | { kind: 'text'; text: string }
  | { kind: 'tools'; messages: Message[] }

/**
 * Read the `anchorOffset` a tool message carries inside its JSON `content`.
 * Returns `undefined` when the content can't be parsed or the field is absent
 * or non-finite — those rows render at the bottom of the bubble (the behaviour
 * from before tool calls were spliced into the prose).
 */
export function readToolAnchorOffset(content: string): number | undefined {
  try {
    const parsed = JSON.parse(content) as { anchorOffset?: unknown }
    return typeof parsed.anchorOffset === 'number' && Number.isFinite(parsed.anchorOffset)
      ? parsed.anchorOffset
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Build an interleaved [text, tools, text, tools, …] layout for an assistant
 * message whose character-initiated tool calls have been folded into it (see
 * group-tool-messages.ts).
 *
 * Tool calls carrying a usable `anchorOffset` (0…content.length) are spliced
 * into the prose at that offset, splitting it into the runs the model actually
 * emitted between calls. Because each run was a separate model response, this
 * also keeps per-run Markdown well-formed — e.g. a `*…project*` action that ran
 * together into `**` with the next run's opening `*` is cleanly separated again.
 * Consecutive calls sharing an offset stack in order.
 *
 * Tool calls with no usable anchor (legacy rows, or offsets the finalizer
 * dropped) are returned in `trailingTools` for the caller to render after the
 * prose — the pre-interspersing layout. When no call is anchored, the result is
 * a single text part plus every tool in `trailingTools`, i.e. identical to the
 * old bottom-of-bubble rendering.
 *
 * Purely a rendering transform — no message is mutated.
 */
export function buildInterspersedToolLayout(
  content: string,
  toolMessages: Message[],
): { parts: ToolLayoutPart[]; trailingTools: Message[] } {
  const anchored: Array<{ offset: number; message: Message; seq: number }> = []
  const trailingTools: Message[] = []

  toolMessages.forEach((message, seq) => {
    const offset = readToolAnchorOffset(message.content)
    if (offset === undefined || offset < 0 || offset > content.length) {
      trailingTools.push(message)
    } else {
      anchored.push({ offset, message, seq })
    }
  })

  if (anchored.length === 0) {
    const parts: ToolLayoutPart[] = content.length > 0 ? [{ kind: 'text', text: content }] : []
    return { parts, trailingTools }
  }

  // Sort by offset, keeping original order for calls that share one (stable).
  anchored.sort((a, b) => a.offset - b.offset || a.seq - b.seq)

  const parts: ToolLayoutPart[] = []
  let cursor = 0
  let i = 0
  while (i < anchored.length) {
    const offset = anchored[i].offset
    const text = content.slice(cursor, offset)
    if (text.trim().length > 0) parts.push({ kind: 'text', text })

    const group: Message[] = []
    while (i < anchored.length && anchored[i].offset === offset) {
      group.push(anchored[i].message)
      i++
    }
    parts.push({ kind: 'tools', messages: group })
    cursor = offset
  }

  const tail = content.slice(cursor)
  if (tail.trim().length > 0) parts.push({ kind: 'text', text: tail })

  return { parts, trailingTools }
}
