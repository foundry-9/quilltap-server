import type { Message } from './types'
import { readToolAnchorOffset } from './intersperse-tool-messages'

/**
 * One piece of an assistant message's interleaved body: a run of prose, a group
 * of tool calls that fired together, or a reasoning ("thinking") block. Built by
 * {@link buildInterleavedLayout}, which merges tool calls and reasoning segments
 * into a single offset-ordered layout so the Salon can splice both back into the
 * prose at the points they fired.
 */
export type InterleavedPart =
  | { kind: 'text'; text: string }
  | { kind: 'tools'; messages: Message[] }
  | { kind: 'reasoning'; content: string }

/** A reasoning block positioned in the prose. DISPLAY ONLY. */
export interface ReasoningSegmentLike {
  anchorOffset: number
  content: string
  seq: number
}

/**
 * Read the turn-monotonic `seq` a tool message carries in its JSON `content`
 * (written alongside `anchorOffset`). Shared with reasoning segments so
 * same-offset items order by emission. Undefined on legacy rows.
 */
export function readToolSeq(content: string): number | undefined {
  try {
    const parsed = JSON.parse(content) as { seq?: unknown }
    return typeof parsed.seq === 'number' && Number.isFinite(parsed.seq) ? parsed.seq : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve a message's reasoning into positioned segments for display. Prefers
 * the stored `reasoningSegments`; when those are absent but flat
 * `reasoningContent` exists (non-streaming path, the pseudo-tool path, or rows
 * where offsets were dropped), synthesises a single leading block at offset 0
 * with `seq = -1` so it sorts before any tool at the same offset (the model
 * thinks first). Returns an empty array when there is no reasoning. DISPLAY ONLY.
 */
export function resolveReasoningSegments(message: Message): ReasoningSegmentLike[] {
  const segments = message.reasoningSegments
  if (segments && segments.length > 0) {
    return segments.map((s) => ({ anchorOffset: s.anchorOffset, content: s.content, seq: s.seq }))
  }
  if (message.reasoningContent && message.reasoningContent.trim().length > 0) {
    return [{ anchorOffset: 0, content: message.reasoningContent, seq: -1 }]
  }
  return []
}

/**
 * Build an interleaved [text, (tools|reasoning), text, …] layout for an
 * assistant message, merging character-initiated tool calls and reasoning
 * segments into one stream ordered by `(anchorOffset, seq)`.
 *
 * Each anchored item is spliced into the prose at its offset, splitting the
 * prose into the runs the model emitted between them. At equal offsets, items
 * order by their shared turn `seq` — so Anthropic interleaved thinking
 * (`thinking1 → tool → thinking2`, all at offset 0) renders in true emission
 * order. Tool calls with no usable anchor (legacy rows, dropped offsets) are
 * returned in `trailingTools` for the caller to render after the prose.
 *
 * Reasoning segments are expected to be in range (the finalizer clamps them);
 * a defensive clamp keeps any stray offset inside the prose. Purely a rendering
 * transform — no message is mutated.
 */
export function buildInterleavedLayout(
  content: string,
  toolMessages: Message[],
  reasoningSegments: ReasoningSegmentLike[],
): { parts: InterleavedPart[]; trailingTools: Message[] } {
  type Anchored =
    | { offset: number; order: number; kind: 'tool'; message: Message }
    | { offset: number; order: number; kind: 'reasoning'; content: string }

  const anchored: Anchored[] = []
  const trailingTools: Message[] = []

  toolMessages.forEach((message, idx) => {
    const offset = readToolAnchorOffset(message.content)
    if (offset === undefined || offset < 0 || offset > content.length) {
      trailingTools.push(message)
      return
    }
    const seq = readToolSeq(message.content)
    anchored.push({ offset, order: seq ?? idx, kind: 'tool', message })
  })

  reasoningSegments.forEach((segment) => {
    const offset = Math.max(0, Math.min(content.length, segment.anchorOffset))
    anchored.push({ offset, order: segment.seq, kind: 'reasoning', content: segment.content })
  })

  if (anchored.length === 0) {
    const parts: InterleavedPart[] = content.length > 0 ? [{ kind: 'text', text: content }] : []
    return { parts, trailingTools }
  }

  // Sort by offset, then by the shared turn sequence (stable for equal keys).
  anchored.sort((a, b) => a.offset - b.offset || a.order - b.order)

  const parts: InterleavedPart[] = []
  let cursor = 0
  for (const item of anchored) {
    const text = content.slice(cursor, item.offset)
    if (text.trim().length > 0) parts.push({ kind: 'text', text })
    cursor = Math.max(cursor, item.offset)

    if (item.kind === 'reasoning') {
      parts.push({ kind: 'reasoning', content: item.content })
    } else {
      // Coalesce consecutive tool calls at the same offset into one group so
      // sibling calls stack together (matches the tool-only layout).
      const last = parts[parts.length - 1]
      if (last && last.kind === 'tools') {
        last.messages.push(item.message)
      } else {
        parts.push({ kind: 'tools', messages: [item.message] })
      }
    }
  }

  const tail = content.slice(cursor)
  if (tail.trim().length > 0) parts.push({ kind: 'text', text: tail })

  return { parts, trailingTools }
}
