/**
 * Shared math-rendering configuration for markdown pipelines.
 *
 * Both renderers — the client (`components/chat/MessageContent.tsx`, via
 * react-markdown) and the server (`lib/services/markdown-renderer.service.ts`,
 * via unified) — must produce identical output, so everything either side
 * needs beyond the `remark-math`/`rehype-katex` plugins themselves lives here.
 *
 * Supported delimiters:
 * - `$$...$$` inline and block math (remark-math native)
 * - `\(...\)` inline and `\[...\]` display math (normalized to `$$` form
 *   below, because CommonMark consumes `\(` as a character escape before any
 *   parse-time plugin could see it)
 *
 * Single-dollar inline math (`$x$`) is deliberately DISABLED: Quilltap chat is
 * full of ordinary prose where paired dollar amounts ("He slid $50 across the
 * table, then another $20") would otherwise be swallowed as garbled math.
 */

/**
 * Options passed to `remark-math` on both client and server. Kept in one place
 * so the two pipelines cannot drift.
 */
export const REMARK_MATH_OPTIONS = { singleDollarTextMath: false } as const;

/**
 * Regions the delimiter normalizer must not touch: fenced code blocks, inline
 * code spans, and existing `$$` math (whose LaTeX may legitimately contain
 * `\[`-lookalikes such as `\\[3pt]` row spacing). Unterminated fences and `$$`
 * runs swallow the remainder of the string on purpose — during streaming a
 * region still being received is left alone rather than half-transformed.
 */
const MATH_SKIP_PATTERN = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`|\$\$[\s\S]*?(?:\$\$|$))/g;

/**
 * Convert LaTeX-style `\(...\)` / `\[...\]` math delimiters to the `$$` forms
 * remark-math parses. LLMs emit the backslash forms constantly, but CommonMark
 * treats `\(` as an escaped parenthesis and strips the backslash during
 * parsing, so this rewrite must happen on the raw markdown string *before* the
 * parser runs — it is the first step of both renderers' preprocessing chains,
 * ahead of roleplay-bracket escaping (which would otherwise try to claim
 * `\[...\]` as a roleplay bracket span).
 */
export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown.includes('\\(') && !markdown.includes('\\[')) {
    return markdown;
  }

  // Splitting on a single capture group alternates plain segments (even
  // indices) with protected regions (odd indices).
  const parts = markdown.split(MATH_SKIP_PATTERN);
  return parts
    .map((part, index) => {
      if (index % 2 === 1 || part === undefined) return part;
      return part
        // Display math becomes flow math on its own lines — `\[...\]` is
        // display-mode by definition, so promoting it out of a surrounding
        // paragraph is the correct rendering.
        .replace(/\\\[([\s\S]+?)\\\]/g, (_match, tex: string) => `\n$$\n${tex.trim()}\n$$\n`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_match, tex: string) => `$$${tex.trim()}$$`);
    })
    .join('');
}
