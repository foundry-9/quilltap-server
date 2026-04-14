import fs from 'fs/promises';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('MountIndex:MarkdownConverter');

/**
 * Strip YAML frontmatter delimited by `---` at the very start of the file.
 */
function stripFrontmatter(text: string): string {
  // Frontmatter must start at the very beginning of the file
  if (!text.startsWith('---')) {
    return text;
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    return text;
  }
  // Skip past the closing --- and the newline after it
  return text.slice(end + 4).replace(/^\n/, '');
}

/**
 * Remove markdown syntax while preserving the textual content.
 */
function stripMarkdownSyntax(text: string): string {
  let result = text;

  // Remove code fences (``` or ~~~) but keep their content
  result = result.replace(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1\s*$/gm, '$2');

  // Remove images ![alt](url) — keep alt text
  result = result.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Remove links [text](url) — keep text
  result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Remove reference-style links [text][ref] — keep text
  result = result.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');

  // Remove reference definitions [ref]: url
  result = result.replace(/^\[[^\]]*\]:\s+.*$/gm, '');

  // Remove HTML tags but keep content
  result = result.replace(/<[^>]+>/g, '');

  // Remove heading markers (keep text)
  result = result.replace(/^#{1,6}\s+/gm, '');

  // Remove bold/italic markers (keep text) — handle *** / ** / * and ___ / __ / _
  result = result.replace(/(\*{1,3}|_{1,3})([^\s*_](?:.*?[^\s*_])?)(\1)/g, '$2');

  // Remove inline code backticks (keep content)
  result = result.replace(/`([^`]+)`/g, '$1');

  // Remove horizontal rules
  result = result.replace(/^[-*_]{3,}\s*$/gm, '');

  // Remove blockquote markers (keep text)
  result = result.replace(/^>\s?/gm, '');

  // Remove unordered list markers
  result = result.replace(/^[ \t]*[-*+]\s+/gm, '');

  // Remove ordered list markers
  result = result.replace(/^[ \t]*\d+\.\s+/gm, '');

  // Collapse multiple blank lines to a single blank line
  result = result.replace(/\n{3,}/g, '\n\n');

  // Trim leading/trailing whitespace
  return result.trim();
}

/**
 * Convert a Markdown file to plain text by stripping frontmatter and
 * markdown syntax while preserving readable content.
 *
 * Returns an empty string (with a warning log) on read errors.
 */
export async function convertMarkdownToText(absolutePath: string): Promise<string> {
  logger.debug('Converting Markdown to text', { path: absolutePath });

  try {
    const raw = await fs.readFile(absolutePath, 'utf-8');

    if (raw.trim().length === 0) {
      logger.debug('Markdown file is empty', { path: absolutePath });
      return '';
    }

    const withoutFrontmatter = stripFrontmatter(raw);
    const plainText = stripMarkdownSyntax(withoutFrontmatter);

    logger.debug('Markdown conversion complete', {
      path: absolutePath,
      originalLength: raw.length,
      textLength: plainText.length,
    });

    return plainText;
  } catch (error) {
    logger.warn('Failed to read Markdown file', {
      path: absolutePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}
