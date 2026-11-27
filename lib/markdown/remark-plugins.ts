/**
 * The remark (Markdown-side) plugins every message render runs, in order: the
 * Salon's client renderer (`components/chat/MessageContent.tsx`) and the
 * server's pre-render (`lib/services/markdown-renderer.service.ts`). One list,
 * because a message whose two pipelines disagree changes appearance the moment
 * it stops streaming.
 *
 * - remark-gfm: tables, strikethrough, task lists, autolinks.
 * - remark-math: `$$…$$` math only (see ./math.ts); rehype-katex draws it.
 * - remark-breaks: a single newline is a hard break, as chat authors mean it.
 * - remark-smartypants (when `curlQuotes`): quotes only, never dashes (see
 *   ./typography.ts). It sits after remark-breaks and before remark-rehype so
 *   it works on mdast text nodes, which keeps it out of code, math and URLs.
 *
 * The rehype half is not shared: the server adds URL hardening and syntax
 * highlighting, the client mention chips; both run rehype-katex.
 *
 * @module markdown/remark-plugins
 */

import type { PluggableList } from 'unified'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkMath from 'remark-math'
import remarkSmartypants from 'remark-smartypants'
import { REMARK_MATH_OPTIONS } from './math'
import { SMARTYPANTS_OPTIONS } from './typography'

const BASE: PluggableList = [remarkGfm, [remarkMath, REMARK_MATH_OPTIONS], remarkBreaks]
const WITH_CURLY_QUOTES: PluggableList = [...BASE, [remarkSmartypants, SMARTYPANTS_OPTIONS]]

/** The ordered remark plugins for one typographer state (stable references). */
export function remarkPluginsFor(curlQuotes: boolean): PluggableList {
  return curlQuotes ? WITH_CURLY_QUOTES : BASE
}
