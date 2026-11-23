/**
 * Pure text helpers for the code editor: line endings, indentation and the
 * arithmetic of lines and offsets. No Lexical, no React — the editor's
 * fidelity rests on these, so they are tested on their own.
 *
 * The editor holds its text with `\n` line breaks (Lexical turns a `\r\n` into
 * a line break and does not keep the `\r`). A file whose every line ends in
 * `\r\n` is therefore opened as `\n` and handed back as `\r\n`. A file that
 * mixes the two cannot be held exactly; it is handed back in whichever ending
 * it used more (ties go to `\n`). That only matters once it is edited: an
 * editor that has not been typed in hands nothing back at all.
 *
 * @module components/code-editor/text
 */

export type LineEnding = 'lf' | 'crlf'

/** The ending a text is handed back with: `crlf` when most of its line breaks are `\r\n`. */
export function detectLineEnding(text: string): LineEnding {
  let crlf = 0
  let lf = 0
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++
    else lf++
  }
  return crlf > lf ? 'crlf' : 'lf'
}

/** The text as the editor holds it: every `\r\n` as `\n`. A lone `\r` is kept. */
export function toEditorText(text: string): string {
  return text.includes('\r\n') ? text.replace(/\r\n/g, '\n') : text
}

/** The editor's text in the file's own line ending. */
export function fromEditorText(text: string, ending: LineEnding): string {
  return ending === 'crlf' ? text.replace(/\n/g, '\r\n') : text
}

/**
 * The unit one Tab indents by: a tab when the file indents with tabs, else
 * the smallest run of leading spaces it uses (two when it has none).
 */
export function detectIndentUnit(text: string): string {
  let tabs = 0
  let spaced = 0
  let smallest = Infinity
  let start = 0
  while (start <= text.length) {
    const end = text.indexOf('\n', start)
    const line = text.slice(start, end === -1 ? text.length : end)
    if (line.startsWith('\t')) {
      tabs++
    } else if (line.startsWith(' ')) {
      let n = 0
      while (n < line.length && line.charCodeAt(n) === 32) n++
      // A line of spaces alone says nothing about the indent.
      if (n < line.length) {
        spaced++
        if (n < smallest) smallest = n
      }
    }
    if (end === -1) break
    start = end + 1
  }
  if (tabs > spaced) return '\t'
  if (spaced === 0) return '  '
  return ' '.repeat(Math.min(Math.max(smallest, 1), 8))
}

/** The offset each line starts at; `lineStarts(t)[0]` is 0, and there is always one more line than `\n`s. */
export function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  return starts
}

/** The 0-based line an offset falls on, given {@link lineStarts}. */
export function lineOfOffset(starts: readonly number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** The number of lines in a text: one more than its `\n`s. */
export function countLines(text: string): number {
  let n = 1
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++
  return n
}

/** One edit to a text: replace `[from, to)` with `insert`. */
export interface TextEdit {
  from: number
  to: number
  insert: string
}

/** The result of an indentation command: the edits, last first, and where the selection lands. */
export interface IndentPlan {
  /** Ordered from the end of the text to the start, so each applies without moving the next. */
  edits: TextEdit[]
  anchor: number
  focus: number
}

function linesSpanned(starts: readonly number[], start: number, end: number): [number, number] {
  const first = lineOfOffset(starts, start)
  let last = lineOfOffset(starts, end)
  // A selection that ends at the very start of a line does not take that line in.
  if (last > first && starts[last] === end) last--
  return [first, last]
}

function mapThrough(offset: number, edits: readonly TextEdit[]): number {
  // `edits` are ordered last-first; walk them first-last.
  let shift = 0
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i]
    if (offset < e.from) break
    if (offset >= e.to) {
      shift += e.insert.length - (e.to - e.from)
    } else {
      // Inside a removed run: land at its start.
      shift += e.from - offset + e.insert.length
      break
    }
  }
  return offset + shift
}

/**
 * Tab: with a collapsed caret, insert one unit there; with a selection that
 * spans lines or covers a whole line, indent each non-empty line it touches.
 */
export function planIndent(text: string, anchor: number, focus: number, unit: string): IndentPlan {
  const start = Math.min(anchor, focus)
  const end = Math.max(anchor, focus)
  const starts = lineStarts(text)
  const [first, last] = linesSpanned(starts, start, end)
  const lineEnd = (line: number) => (line + 1 < starts.length ? starts[line + 1] - 1 : text.length)

  const wholeLine = start === starts[first] && end >= lineEnd(first) && end > start
  if (start === end || (first === last && !wholeLine)) {
    const edits = [{ from: start, to: end, insert: unit }]
    const caret = start + unit.length
    return { edits, anchor: caret, focus: caret }
  }

  const edits: TextEdit[] = []
  for (let line = last; line >= first; line--) {
    if (lineEnd(line) > starts[line]) edits.push({ from: starts[line], to: starts[line], insert: unit })
  }
  // Each edge moves by the indents inserted before it; an edge at the very
  // start of the first line stays there, so the selection takes the new indent in.
  const move = (offset: number) => {
    let shift = 0
    for (const e of edits) if (e.from < offset) shift += e.insert.length
    return offset + shift
  }
  return { edits, anchor: move(anchor), focus: move(focus) }
}

/**
 * Shift+Tab: take one unit of indentation (a tab, or up to the unit's width
 * in spaces) off the start of every line the selection touches.
 */
export function planOutdent(text: string, anchor: number, focus: number, unit: string): IndentPlan {
  const start = Math.min(anchor, focus)
  const end = Math.max(anchor, focus)
  const starts = lineStarts(text)
  const [first, last] = linesSpanned(starts, start, end)
  const width = unit === '\t' ? 1 : unit.length
  const edits: TextEdit[] = []
  for (let line = last; line >= first; line--) {
    const from = starts[line]
    let n = 0
    if (text.charCodeAt(from) === 9) {
      n = 1
    } else {
      while (n < width && text.charCodeAt(from + n) === 32) n++
    }
    if (n > 0) edits.push({ from, to: from + n, insert: '' })
  }
  return { edits, anchor: mapThrough(anchor, edits), focus: mapThrough(focus, edits) }
}

/** Apply edits (ordered last-first) to a text. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  let out = text
  for (const e of edits) out = out.slice(0, e.from) + e.insert + out.slice(e.to)
  return out
}

/** The leading spaces and tabs of the line an offset is on, up to that offset. */
export function leadingIndentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  let i = lineStart
  while (i < offset && (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9)) i++
  return text.slice(lineStart, i)
}

/**
 * What kind of token the character at an offset belongs to, as the editor's
 * highlighter has it (`'punctuation'`, `'string'`, `'comment'`, ...), or
 * undefined for plain text. The brace planners ask this instead of parsing.
 */
export type TokenTypeAt = (offset: number) => string | undefined

const CLOSER_OF: Record<string, string> = { '{': '}', '[': ']' }

function isBlank(text: string, i: number): boolean {
  const c = text.charCodeAt(i)
  return c === 32 || c === 9
}

/** A `{` `[` `}` `]` that is structure: the highlighter calls it punctuation, so it is not in a string or a comment. */
function isBracketAt(text: string, offset: number, brackets: string, typeAt: TokenTypeAt): boolean {
  return offset >= 0 && offset < text.length && brackets.includes(text[offset]) && typeAt(offset) === 'punctuation'
}

/**
 * Enter: a line break and the line's indentation, replacing any selection.
 * After an opening `{` or `[` the new line is one unit deeper, and when the
 * matching closing bracket follows the caret it goes to a line of its own
 * below, at the line's indentation. Nothing else is touched, except the
 * spaces between the caret and text that moves down with it.
 */
export function planEnter(text: string, anchor: number, focus: number, unit: string, typeAt: TokenTypeAt): IndentPlan {
  const start = Math.min(anchor, focus)
  const end = Math.max(anchor, focus)
  const indent = leadingIndentAt(text, start)

  let before = start - 1
  while (before >= 0 && isBlank(text, before)) before--
  if (!isBracketAt(text, before, '{[', typeAt)) {
    const caret = start + 1 + indent.length
    return { edits: [{ from: start, to: end, insert: '\n' + indent }], anchor: caret, focus: caret }
  }

  let after = end
  while (after < text.length && isBlank(text, after)) after++
  const followed = after < text.length && text[after] !== '\n'
  const closes = followed && text[after] === CLOSER_OF[text[before]] && typeAt(after) === 'punctuation'
  const head = '\n' + indent + unit
  const caret = start + head.length
  return {
    edits: [{ from: start, to: followed ? after : end, insert: closes ? head + '\n' + indent : head }],
    anchor: caret,
    focus: caret,
  }
}

/** The opening bracket that encloses an offset, or -1. Brackets in strings and comments do not count. */
function enclosingOpener(text: string, offset: number, typeAt: TokenTypeAt): number {
  let depth = 0
  for (let i = offset - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch !== '{' && ch !== '[' && ch !== '}' && ch !== ']') continue
    if (typeAt(i) !== 'punctuation') continue
    if (ch === '}' || ch === ']') depth++
    else if (depth === 0) return i
    else depth--
  }
  return -1
}

/**
 * A closing `}` or `]` typed on a line that holds only indentation: the
 * bracket goes in one unit shallower. Null when the line holds anything else,
 * when the caret is in a string or a comment, or when the line is already no
 * deeper than the line its opening bracket is on (so a bracket typed where it
 * belongs stays there) — the bracket is then typed as any other character.
 * A selection is replaced first.
 */
export function planCloseBracket(
  text: string,
  anchor: number,
  focus: number,
  unit: string,
  bracket: string,
  typeAt: TokenTypeAt,
): IndentPlan | null {
  const start = Math.min(anchor, focus)
  const end = Math.max(anchor, focus)
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  if (start === lineStart) return null
  for (let i = lineStart; i < start; i++) if (!isBlank(text, i)) return null
  for (let i = end; i < text.length && text[i] !== '\n'; i++) if (!isBlank(text, i)) return null
  const type = typeAt(start - 1)
  if (type === 'comment' || type === 'string') return null

  const opener = enclosingOpener(text, lineStart, typeAt)
  if (opener === -1) return null
  const openerLine = text.lastIndexOf('\n', opener - 1) + 1
  let openerIndent = 0
  while (isBlank(text, openerLine + openerIndent)) openerIndent++
  if (start - lineStart <= openerIndent) return null

  let n = 0
  if (text.charCodeAt(start - 1) === 9) {
    n = 1
  } else {
    const width = unit === '\t' ? 1 : unit.length
    while (n < width && text.charCodeAt(start - 1 - n) === 32) n++
  }
  const caret = start - n + bracket.length
  return { edits: [{ from: start - n, to: end, insert: bracket }], anchor: caret, focus: caret }
}
