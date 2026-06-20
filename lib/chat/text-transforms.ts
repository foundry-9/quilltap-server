/**
 * Pure text transforms for the formatting toolbar.
 *
 * These operate on a flat `{ value, start, end }` text model (the textarea's
 * value + selection offsets) and return `{ value, cursor }`. They carry NO
 * editor or DOM knowledge, so both toolbar paths — the source `<textarea>` and
 * the Lexical rich-text editor (via `APPLY_DELIMITER_COMMAND`) — call the same
 * functions and can't disagree. They are exhaustively unit-tested.
 *
 * @module lib/chat/text-transforms
 */

/** A flat slice of editable text with a selection range. */
export interface TextState {
  value: string
  /** Selection start offset. */
  start: number
  /** Selection end offset (== start when the selection is collapsed). */
  end: number
}

/** The result of a transform: the new value and a collapsed cursor offset. */
export interface TextResult {
  value: string
  cursor: number
}

/**
 * Toggle wrap/unwrap of `open`…`close` around the current selection.
 * - Selection already wrapped → unwrap (cursor at the end of the inner text).
 * - Selection present, not wrapped → wrap (cursor after the close delimiter).
 * - No selection → insert `open`+`close` and place the cursor between them.
 *
 * Multi-line selections are wrapped as a whole span (one `open` at the start,
 * one `close` at the end), matching the long-standing source-mode behavior.
 */
export function toggleWrap(state: TextState, open: string, close: string): TextResult {
  const { value, start, end } = state
  const selected = value.slice(start, end)

  if (selected) {
    const isWrapped =
      selected.length >= open.length + close.length &&
      selected.startsWith(open) &&
      selected.endsWith(close)

    if (isWrapped) {
      const inner = selected.slice(open.length, selected.length - close.length)
      return { value: value.slice(0, start) + inner + value.slice(end), cursor: start + inner.length }
    }

    const wrapped = `${open}${selected}${close}`
    return { value: value.slice(0, start) + wrapped + value.slice(end), cursor: start + wrapped.length }
  }

  // No selection: insert the delimiters and drop the cursor between them.
  const inserted = `${open}${close}`
  return { value: value.slice(0, start) + inserted + value.slice(end), cursor: start + open.length }
}

/**
 * Toggle a line-start `marker` (e.g. `// `) on every line touched by the
 * selection. Expands a partial-line selection to whole lines first. If every
 * touched line already starts with the marker, it is removed (toggle off);
 * otherwise it is added to each line. The cursor lands at the end of the
 * affected block.
 */
export function toggleLinePrefix(state: TextState, marker: string): TextResult {
  const { value, start, end } = state

  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lineEnd = value.indexOf('\n', end)
  const blockEnd = lineEnd === -1 ? value.length : lineEnd

  const lines = value.slice(lineStart, blockEnd).split('\n')
  const allPrefixed = lines.every((line) => line.startsWith(marker))
  const transformed = (allPrefixed
    ? lines.map((line) => line.slice(marker.length))
    : lines.map((line) => `${marker}${line}`)
  ).join('\n')

  return {
    value: value.slice(0, lineStart) + transformed + value.slice(blockEnd),
    cursor: lineStart + transformed.length,
  }
}

/**
 * Insert a tag prefix `open`+`close` at the START of the current line (expanding
 * a partial-line selection to its line start), and place the cursor between the
 * brackets so the user can type the token (e.g. `CAPTAIN`). The token is NOT
 * validated here — the renderer's `tokenPattern` decides whether a given line
 * actually matches and gets styled.
 */
export function insertTagPrefix(state: TextState, open: string, close: string): TextResult {
  const { value, start } = state
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const inserted = `${open}${close}`
  return {
    value: value.slice(0, lineStart) + inserted + value.slice(lineStart),
    cursor: lineStart + open.length,
  }
}
