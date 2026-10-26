/**
 * Shared, client-safe diagram configuration for markdown pipelines.
 *
 * A fenced code block in one of the languages below renders as a diagram in
 * the Salon instead of as code (see `components/chat/diagrams/`). The message
 * keeps the source text, so a diagram is stored, searched, exported and backed
 * up as ordinary markdown — nothing about it lives anywhere else.
 *
 * This module is the single source of truth for which fence languages count as
 * diagrams, and for the two values a character's `diagramStyle` may take. It
 * is pure: no DOM, no imports, safe on the server and in the client bundle.
 */

/** Fence language → the engine that draws it. Keys are lower-case. */
export const DIAGRAM_LANGUAGES = {
  mermaid: 'mermaid',
  dot: 'graphviz',
  graphviz: 'graphviz',
  svg: 'svg',
} as const;

export type DiagramEngine = (typeof DIAGRAM_LANGUAGES)[keyof typeof DIAGRAM_LANGUAGES];

/**
 * How a character's diagrams look. `handDrawn` sketches Mermaid (its own
 * hand-drawn look) and Graphviz (re-drawn with rough.js); `clean` leaves both
 * as their engines drew them. Raw SVG ignores the style.
 */
export const DIAGRAM_STYLES = ['handDrawn', 'clean'] as const;

export type DiagramStyle = (typeof DIAGRAM_STYLES)[number];

/** What an absent (or unrecognized) `diagramStyle` reads as. */
export const DEFAULT_DIAGRAM_STYLE: DiagramStyle = 'handDrawn';

/**
 * Read a stored `diagramStyle` leniently: `properties.json` is hand-editable,
 * so anything that isn't one of the two known values reads as the default
 * rather than failing the strict parse and hollowing every managed field.
 */
export function diagramStyleOrDefault(value: unknown): DiagramStyle {
  return value === 'handDrawn' || value === 'clean' ? value : DEFAULT_DIAGRAM_STYLE;
}

/** The engine for a fence language, or null when the fence is ordinary code. */
export function diagramEngineFor(language: string | null | undefined): DiagramEngine | null {
  if (!language) return null;
  const key = language.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(DIAGRAM_LANGUAGES, key)
    ? DIAGRAM_LANGUAGES[key as keyof typeof DIAGRAM_LANGUAGES]
    : null;
}

/**
 * An opening fence: three or more backticks or tildes, then the info string.
 * Leading whitespace and blockquote markers are allowed generously — saying
 * "yes" to a fence react-markdown would not render as one only costs a full
 * render, while saying "no" to one it would loses the diagram to the
 * pre-rendered fast path. A backtick fence's info string may not contain a
 * backtick (CommonMark), which is also what keeps an inline ``` ```x``` ```
 * span from counting.
 */
const OPENING_FENCE = /^[\s>]*(`{3,}|~{3,})(.*)$/;

/**
 * True if the markdown contains at least one *closed* diagram fence.
 *
 * An unterminated fence never counts, so a message still streaming (whose
 * fence has not closed yet) isn't routed oddly. Fences are matched line by
 * line the way CommonMark matches them — the same ``` and ~~~ families that
 * `MATH_SKIP_PATTERN` in `lib/markdown/math.ts` protects — so a diagram fence
 * quoted inside some other fence is part of that fence's text, not a diagram,
 * and a language mentioned in prose or an inline code span is not a fence.
 */
export function hasDiagramFence(markdown: string): boolean {
  if (!markdown || !/(`{3}|~{3})/.test(markdown)) return false;

  const lines = markdown.split(/\r?\n/);
  let open: { char: string; length: number; isDiagram: boolean } | null = null;

  for (const line of lines) {
    if (open) {
      const closing = new RegExp(`^[\\s>]*\\${open.char}{${open.length},}\\s*$`);
      if (closing.test(line)) {
        if (open.isDiagram) return true;
        open = null;
      }
      continue;
    }

    const match = OPENING_FENCE.exec(line);
    if (!match) continue;
    const fence = match[1];
    const info = match[2];
    if (fence[0] === '`' && info.includes('`')) continue;
    const language = info.trim().split(/\s+/)[0] ?? '';
    open = {
      char: fence[0],
      length: fence.length,
      isDiagram: diagramEngineFor(language) !== null,
    };
  }

  return false;
}
