/**
 * Render a `.docx` to HTML for viewing — the Scriptorium's and Document
 * Mode's read-only Word viewer. Mammoth maps the document's semantic styles
 * (headings, lists, tables, emphasis, links, images as data URIs) to plain
 * HTML; text is escaped by mammoth itself. Links are the one way a document
 * could carry script, so every `href` that is not `http(s):`, `mailto:` or an
 * in-page `#anchor` is replaced with `#` here. The client still runs the
 * result through DOMPurify before it touches the page — this is defence in
 * depth, not the only line.
 *
 * Server-only (mammoth stays out of the client bundle).
 *
 * @module mount-index/converters/docx-html
 */

import mammoth from 'mammoth';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('MountIndex:DocxHtml');

const SAFE_HREF = /^(https?:|mailto:|#)/i;

/** Neutralise every link target that is not plainly safe. */
export function neutraliseUnsafeHrefs(html: string): string {
  return html.replace(/\shref="([^"]*)"/gi, (whole, href: string) => {
    const decoded = href.replace(/&amp;/g, '&').trim();
    return SAFE_HREF.test(decoded) ? whole : ' href="#"';
  });
}

export interface DocxHtml {
  html: string;
  /** Mammoth's notes on styles it could not map (shown to nobody but the log). */
  warnings: string[];
}

/** Render an in-memory DOCX to HTML. Throws when the bytes are not a readable DOCX. */
export async function renderDocxToHtml(buffer: Buffer): Promise<DocxHtml> {
  const result = await mammoth.convertToHtml({ buffer });
  const warnings = result.messages.map((m) => m.message);
  logger.debug('Rendered DOCX to HTML', { bytes: buffer.length, htmlLength: result.value.length, warnings: warnings.length });
  return { html: neutraliseUnsafeHrefs(result.value), warnings };
}
