/**
 * Punctuation warnings — the rule engine.
 *
 * Finds the marks in a draft that will almost certainly confuse the formatting
 * engine: a double quote opened inside dialogue that is already open, a closing
 * quote with nothing to close, a quote stranded between two spaces or glued
 * between two words, a curly quote facing the wrong way, dialogue that never
 * closes and is not carried on by the next paragraph, an asterisk with no
 * partner, and a `((` or `))` with no partner.
 *
 * In **prose mode** — a template whose narration is unmarked prose and whose
 * dialogue sits in double quotes, as Novel's does — it also flags a draft with
 * no dialogue at all (every narrated run lights up: the writer may have meant
 * to speak and forgotten the quote), and `classifyProse` says which runs of the
 * draft are narration and which are `((out of character))`, so the adapter can
 * preview them the way the rendered message will set them.
 *
 * **It only ever points.** Nothing here proposes a fix, because the right fix
 * depends on what the writer meant and a guess would be wrong as often as it is
 * right. The adapter (`components/chat/lexical/plugins/PunctuationLintPlugin.tsx`)
 * paints the returned ranges and never touches the text.
 *
 * **This file imports nothing**, for the same reason `lib/smart-typography/`
 * does: quilltap-v5 copies the engine and rewrites only the editor adapter. An
 * ESLint `no-restricted-imports` override on `lib/punctuation-lint/**` holds it.
 *
 * ### Units
 *
 * The caller supplies a list of *blocks* — one per editor block (a paragraph, a
 * heading, a list item), each a string with soft line breaks as `\n`, or `null`
 * for a block that must not be linted (a code block). A block is split further
 * into *paragraphs* on blank lines, because a blank line is where the Markdown
 * renderer ends a paragraph and therefore where open-ended dialogue stops.
 * Every offset in a returned issue is relative to its block's string.
 *
 * ### Mid-typing
 *
 * A draft is linted on every keystroke, so a mark the writer is still in the
 * middle of must not light up. The optional `caret` exempts:
 * - a quote or asterisk immediately before the caret whose right-hand side is
 *   still empty (it is judged as though a letter follows);
 * - an unclosed asterisk run, `((`, or dialogue opener when the caret sits later
 *   in the same paragraph (the writer has not got to the closer yet);
 * - unclosed dialogue followed by the empty paragraph the caret is in (the
 *   writer may be about to open the continuation).
 *
 * @module lib/punctuation-lint/engine
 */

/** Which rule an issue broke. Stable identifiers — the fixture tests pin them. */
export type PunctuationRule =
  | 'nested-double-quote'
  | 'stray-closing-quote'
  | 'floating-quote'
  | 'glued-quote'
  | 'backwards-curly-quote'
  | 'unclosed-dialogue'
  | 'unpaired-asterisk'
  | 'unpaired-ooc'
  | 'no-dialogue'

/** One flagged mark. `start`/`end` are offsets into the block's string. */
export interface PunctuationIssue {
  block: number
  start: number
  end: number
  rule: PunctuationRule
}

/** Where the caret is, in the same block/offset coordinates as an issue. */
export interface LintCaret {
  block: number
  offset: number
}

export interface PunctuationLintOptions {
  caret?: LintCaret | null
  /** Unmarked narration, quoted dialogue: also flag a draft with no dialogue. */
  proseMode?: boolean
}

/** What a run of the draft will render as in prose mode. Dialogue is the rest. */
export type ProseKind = 'narration' | 'ooc'

/** One classified run. `start`/`end` are offsets into the block's string. */
export interface ProseSpan {
  block: number
  start: number
  end: number
  kind: ProseKind
}

/** Plain-language explanation of each rule, shown when the mark is hovered. */
export const PUNCTUATION_RULE_MESSAGES: Record<PunctuationRule, string> = {
  'nested-double-quote':
    'A double quote inside dialogue that is already open. Quoting someone inside speech? Use single quotes.',
  'stray-closing-quote': 'A closing quote with no opening quote before it.',
  'floating-quote': 'A quote with spaces on both sides — it is unclear whether it opens or closes.',
  'glued-quote': 'A quote jammed between two words — a space is probably missing.',
  'backwards-curly-quote': 'A curly quote facing the wrong way.',
  'unclosed-dialogue':
    'This dialogue never closes, and the next paragraph does not open with a quote to carry it on.',
  'unpaired-asterisk': 'An asterisk with no partner — the emphasis will not end where you expect.',
  'unpaired-ooc': 'A double parenthesis with no partner.',
  'no-dialogue':
    'No dialogue yet — not a single opening quote in the whole draft. Meant to say this aloud? Put the speech in double quotes.',
}

const OPEN_QUOTE_CURLY = '“'
const CLOSE_QUOTE_CURLY = '”'
const DOUBLE_QUOTES = new Set(['"', OPEN_QUOTE_CURLY, CLOSE_QUOTE_CURLY])

/** Characters that may sit just before an opening mark. */
const OPENING_CONTEXT = new Set(['(', '[', '{', '<'])
/** Characters that may sit just after a closing mark. */
const CLOSING_CONTEXT = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '…'])
/** Characters that say nothing about direction on their own side. */
const NEUTRAL_CONTEXT = new Set(['-', '–', '—', '*', '_', "'", '‘', '’', '"', OPEN_QUOTE_CURLY, CLOSE_QUOTE_CURLY])

const SCENE_BREAK = /^\s*(?:\*\s*){3,}$/

function isSpace(ch: string | null): boolean {
  return ch === null || /\s/.test(ch)
}

function isDigit(ch: string | null): boolean {
  return ch !== null && ch >= '0' && ch <= '9'
}

interface Paragraph {
  block: number
  start: number
  text: string
  /** Caret offset within this paragraph, or null when the caret is elsewhere. */
  caret: number | null
}

/** Split blocks into paragraphs on blank lines. A `null` block is a barrier. */
function toParagraphs(
  blocks: readonly (string | null)[],
  caret: LintCaret | null,
): (Paragraph | null)[] {
  const out: (Paragraph | null)[] = []
  blocks.forEach((text, block) => {
    if (text === null) {
      out.push(null)
      return
    }
    const separator = /\n[ \t]*\n/g
    let start = 0
    const push = (end: number) => {
      const caretHere =
        caret && caret.block === block && caret.offset >= start && caret.offset <= end
          ? caret.offset - start
          : null
      out.push({ block, start, text: text.slice(start, end), caret: caretHere })
    }
    let match: RegExpExecArray | null
    while ((match = separator.exec(text)) !== null) {
      push(match.index)
      start = match.index + match[0].length
    }
    push(text.length)
  })
  return out
}

type QuoteShape = 'open' | 'close' | 'floating' | 'glued'

/** Decide which way a double quote faces from what sits either side of it. */
function quoteShape(text: string, i: number, caret: number | null): QuoteShape {
  const prev = i > 0 ? text[i - 1] : null
  let next = i + 1 < text.length ? text[i + 1] : null
  const leftOpen = isSpace(prev) || (prev !== null && OPENING_CONTEXT.has(prev))
  // An opener still being typed: judge it as though a word follows. (A closer
  // just typed already reads as a closer — the empty right side says so.)
  if (leftOpen && caret === i + 1 && isSpace(next)) next = 'a'

  const rightOpen = isSpace(next) || (next !== null && CLOSING_CONTEXT.has(next))

  if (leftOpen && isSpace(next)) return 'floating'
  if (leftOpen) return 'open'
  if (rightOpen) return 'close'
  if (prev !== null && NEUTRAL_CONTEXT.has(prev)) return 'open'
  if (next !== null && NEUTRAL_CONTEXT.has(next)) return 'close'
  return 'glued'
}

interface QuoteResult {
  issues: Map<number, PunctuationRule>
  /** Offset of the outermost opener still open at the end, or null. */
  unclosedOpener: number | null
  /** The paragraph's first mark is a dialogue opener (it continues speech). */
  opensWithQuote: boolean
  /** Outermost dialogue runs, opener through closer (or paragraph end). */
  dialogue: [number, number][]
}

function lintQuotes(p: Paragraph): QuoteResult {
  const issues = new Map<number, PunctuationRule>()
  const flag = (i: number, rule: PunctuationRule) => {
    if (!issues.has(i)) issues.set(i, rule)
  }
  let depth = 0
  let outerOpener: number | null = null
  let opensWithQuote = false
  const dialogue: [number, number][] = []
  const firstMark = p.text.search(/\S/)

  for (let i = 0; i < p.text.length; i++) {
    const ch = p.text[i]
    if (!DOUBLE_QUOTES.has(ch)) continue

    const shape = quoteShape(p.text, i, p.caret)
    let role: 'open' | 'close'
    if (shape === 'floating' || shape === 'glued') {
      flag(i, shape === 'floating' ? 'floating-quote' : 'glued-quote')
      if (ch === OPEN_QUOTE_CURLY) role = 'open'
      else if (ch === CLOSE_QUOTE_CURLY) role = 'close'
      else role = depth === 0 ? 'open' : 'close'
    } else {
      role = shape
      if ((ch === OPEN_QUOTE_CURLY && role === 'close') || (ch === CLOSE_QUOTE_CURLY && role === 'open')) {
        flag(i, 'backwards-curly-quote')
      }
    }

    if (role === 'open') {
      if (i === firstMark) opensWithQuote = true
      if (depth === 0) {
        depth = 1
        outerOpener = i
      } else {
        flag(i, 'nested-double-quote')
        depth = 2
      }
    } else if (depth === 0) {
      // 6" tall — a straight quote after a digit is an inch mark, not speech.
      if (!(ch === '"' && isDigit(i > 0 ? p.text[i - 1] : null))) flag(i, 'stray-closing-quote')
    } else if (depth === 2) {
      flag(i, 'nested-double-quote')
      depth = 1
    } else {
      dialogue.push([outerOpener!, i + 1])
      depth = 0
      outerOpener = null
    }
  }
  if (depth > 0) dialogue.push([outerOpener!, p.text.length])

  return { issues, unclosedOpener: depth > 0 ? outerOpener : null, opensWithQuote, dialogue }
}

/** True when the caret sits later in the same paragraph than `offset`. */
function caretAfter(p: Paragraph, offset: number): boolean {
  return p.caret !== null && p.caret > offset
}

function lintAsterisks(p: Paragraph): Map<number, { end: number; rule: PunctuationRule }> {
  const issues = new Map<number, { end: number; rule: PunctuationRule }>()
  if (SCENE_BREAK.test(p.text)) return issues

  // One stack per run length: `*` partners `*`, `**` partners `**`.
  const stacks = new Map<number, number[]>()
  const runEnd = new Map<number, number>()
  const flag = (i: number) => issues.set(i, { end: runEnd.get(i) ?? i + 1, rule: 'unpaired-asterisk' })

  let i = 0
  while (i < p.text.length) {
    if (p.text[i] !== '*') {
      i++
      continue
    }
    let j = i
    while (j < p.text.length && p.text[j] === '*') j++
    const length = j - i
    runEnd.set(i, j)

    const prev = i > 0 ? p.text[i - 1] : null
    let next = j < p.text.length ? p.text[j] : null
    if (p.caret === j && isSpace(next)) next = 'a'

    const canOpen = !isSpace(next)
    const canClose = !isSpace(prev)
    const stack = stacks.get(length) ?? []
    stacks.set(length, stack)

    if (canOpen && !canClose) stack.push(i)
    else if (canClose && !canOpen) {
      if (stack.length > 0) stack.pop()
      else flag(i)
    } else if (canOpen && canClose) {
      if (stack.length > 0) stack.pop()
      else stack.push(i)
    }
    // Spaces on both sides (`2 * 3`, a bare bullet): not emphasis, not our business.
    i = j
  }

  for (const stack of stacks.values()) {
    for (const opener of stack) if (!caretAfter(p, opener)) flag(opener)
  }
  return issues
}

function lintOoc(p: Paragraph): number[] {
  const flagged: number[] = []
  const open: number[] = []
  let i = 0
  while (i < p.text.length - 1) {
    const pair = p.text.slice(i, i + 2)
    if (pair === '((') {
      open.push(i)
      i += 2
    } else if (pair === '))') {
      if (open.length > 0) open.pop()
      else flagged.push(i)
      i += 2
    } else {
      i++
    }
  }
  for (const opener of open) if (!caretAfter(p, opener)) flagged.push(opener)
  return flagged
}

/**
 * Outermost `((…))` runs, markers included. An unclosed `((` runs to the end of
 * the paragraph — that is where the writer is still typing the aside.
 */
function oocSpans(text: string): [number, number][] {
  const spans: [number, number][] = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < text.length - 1) {
    const pair = text.slice(i, i + 2)
    if (pair === '((') {
      if (depth === 0) start = i
      depth++
      i += 2
    } else if (pair === '))' && depth > 0) {
      depth--
      if (depth === 0) spans.push([start, i + 2])
      i += 2
    } else {
      i++
    }
  }
  if (depth > 0) spans.push([start, text.length])
  return spans
}

/**
 * Classify one paragraph: its `((…))` runs, and the narration — whatever is
 * neither out of character nor inside dialogue — as whitespace-trimmed runs.
 * Quotes inside an aside are masked out so they cannot open dialogue.
 */
function classifyParagraph(p: Paragraph): { ooc: [number, number][]; narration: [number, number][]; hasDialogue: boolean } {
  const ooc = oocSpans(p.text)
  if (SCENE_BREAK.test(p.text)) return { ooc, narration: [], hasDialogue: false }

  const claimed = new Uint8Array(p.text.length)
  let masked = p.text
  for (const [start, end] of ooc) {
    claimed.fill(1, start, end)
    masked = masked.slice(0, start) + ' '.repeat(end - start) + masked.slice(end)
  }
  const { dialogue } = lintQuotes({ ...p, text: masked, caret: null })
  for (const [start, end] of dialogue) claimed.fill(1, start, end)

  const narration: [number, number][] = []
  let i = 0
  while (i < p.text.length) {
    if (claimed[i] || isSpace(p.text[i])) {
      i++
      continue
    }
    let j = i
    let lastInk = i
    while (j < p.text.length && !claimed[j]) {
      if (!isSpace(p.text[j])) lastInk = j
      j++
    }
    narration.push([i, lastInk + 1])
    i = j
  }
  return { ooc, narration, hasDialogue: dialogue.length > 0 }
}

/**
 * Say which runs of a draft are narration and which are out of character, for
 * a template that leaves narration unmarked and puts dialogue in double quotes.
 * Same block/offset coordinates as `lintPunctuation`; sorted by block, offset.
 */
export function classifyProse(blocks: readonly (string | null)[]): ProseSpan[] {
  const spans: ProseSpan[] = []
  for (const p of toParagraphs(blocks, null)) {
    if (!p) continue
    const { ooc, narration } = classifyParagraph(p)
    for (const [start, end] of ooc) spans.push({ block: p.block, start: p.start + start, end: p.start + end, kind: 'ooc' })
    for (const [start, end] of narration) {
      spans.push({ block: p.block, start: p.start + start, end: p.start + end, kind: 'narration' })
    }
  }
  return spans.sort((a, b) => a.block - b.block || a.start - b.start)
}

/**
 * Lint a draft. Pure and deterministic; returns issues sorted by block, then
 * offset. Runs on every keystroke, so it stays a single linear pass per rule.
 */
export function lintPunctuation(
  blocks: readonly (string | null)[],
  options: PunctuationLintOptions = {},
): PunctuationIssue[] {
  const paragraphs = toParagraphs(blocks, options.caret ?? null)
  const quotes = paragraphs.map((p) => (p ? lintQuotes(p) : null))
  const issues: PunctuationIssue[] = []

  paragraphs.forEach((p, index) => {
    if (!p) return
    const q = quotes[index]!

    for (const [offset, rule] of q.issues) {
      issues.push({ block: p.block, start: p.start + offset, end: p.start + offset + 1, rule })
    }

    // An opener already flagged for its shape needs no second complaint.
    if (q.unclosedOpener !== null && !q.issues.has(q.unclosedOpener) && !caretAfter(p, q.unclosedOpener)) {
      const next = paragraphs[index + 1]
      const continued = next ? quotes[index + 1]!.opensWithQuote : false
      const nextIsBeingTyped = !!next && next.caret !== null && next.text.trim() === ''
      if (!continued && !nextIsBeingTyped) {
        issues.push({
          block: p.block,
          start: p.start + q.unclosedOpener,
          end: p.start + q.unclosedOpener + 1,
          rule: 'unclosed-dialogue',
        })
      }
    }

    for (const [offset, { end, rule }] of lintAsterisks(p)) {
      issues.push({ block: p.block, start: p.start + offset, end: p.start + end, rule })
    }

    for (const offset of lintOoc(p)) {
      issues.push({ block: p.block, start: p.start + offset, end: p.start + offset + 2, rule: 'unpaired-ooc' })
    }
  })

  // Prose mode: a draft with narration but not one line of dialogue may be a
  // spoken sentence whose quotes were forgotten. Light up every narrated run.
  // No caret exemption — the point is to see it while typing.
  if (options.proseMode) {
    const classified = paragraphs.map((p) => (p ? classifyParagraph(p) : null))
    if (!classified.some((c) => c?.hasDialogue)) {
      classified.forEach((c, index) => {
        const p = paragraphs[index]
        if (!c || !p) return
        for (const [start, end] of c.narration) {
          issues.push({ block: p.block, start: p.start + start, end: p.start + end, rule: 'no-dialogue' })
        }
      })
    }
  }

  return issues.sort((a, b) => a.block - b.block || a.start - b.start)
}
