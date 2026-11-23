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
