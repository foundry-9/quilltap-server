/**
 * Lightweight Markdown Parser
 *
 * Purpose-built parser for heading trees and YAML frontmatter.
 * Provides the structural parsing needed by Tier 2 editing tools
 * (read_heading, update_heading, read_frontmatter, update_frontmatter).
 *
 * NOT a full AST parser — just heading + frontmatter extraction.
 *
 * @module doc-edit/markdown-parser
 */

import YAML from 'yaml';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('DocEdit:MarkdownParser');

// --- Frontmatter ---

export interface ParsedFrontmatter {
  /** Parsed YAML data, or null if no frontmatter block */
  data: Record<string, unknown> | null;
  /** Line index where the body content starts (after closing ---) */
  bodyStartLine: number;
  /** Character offset where the body content starts */
  bodyStartOffset: number;
}

/**
 * Parse YAML frontmatter from file content.
 * Frontmatter must start at the very beginning of the file with `---`.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith('---\n')) {
    return {
      data: null,
      bodyStartLine: 0,
      bodyStartOffset: 0,
    };
  }

  const lines = content.split('\n');
  let closingIndex = -1;

  // Find the closing --- delimiter (must be on its own line)
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      closingIndex = i;
      break;
    }
  }

  // No closing delimiter found
  if (closingIndex === -1) {
    logger.warn('Frontmatter block has no closing --- delimiter');
    return {
      data: null,
      bodyStartLine: 0,
      bodyStartOffset: 0,
    };
  }

  // Extract YAML content between delimiters
  const yamlLines = lines.slice(1, closingIndex);
  const yamlContent = yamlLines.join('\n');

  let parsedData: Record<string, unknown> | null = null;
  try {
    const parsed = YAML.parse(yamlContent);
    // Ensure we have a plain object (YAML.parse can return primitives or null)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      parsedData = parsed as Record<string, unknown>;
    } else if (parsed === null || yamlContent.trim() === '') {
      // Empty frontmatter is valid
      parsedData = {};
    } else {
      logger.warn('Frontmatter did not parse to a plain object');
      parsedData = null;
    }
  } catch (err) {
    logger.warn(`Failed to parse frontmatter YAML: ${err instanceof Error ? err.message : String(err)}`);
    parsedData = null;
  }

  // Calculate body start position
  const bodyStartLine = closingIndex + 1;
  const bodyStartOffset = lines.slice(0, closingIndex + 1).join('\n').length + 1; // +1 for the final newline

  return {
    data: parsedData,
    bodyStartLine,
    bodyStartOffset,
  };
}

/**
 * Serialize a data object to YAML frontmatter string (with --- delimiters).
 */
export function serializeFrontmatter(data: Record<string, unknown>): string {
  const yamlContent = YAML.stringify(data);
  return `---\n${yamlContent}---\n`;
}

/**
 * Update frontmatter in file content. Merges updates with existing frontmatter,
 * or creates a frontmatter block if none exists.
 *
 * @param content - Full file content
 * @param updates - Key-value pairs to set (null value deletes a key)
 * @param replaceAll - If true, replace entire frontmatter instead of merging
 * @returns Updated file content
 */
export function updateFrontmatterInContent(
  content: string,
  updates: Record<string, unknown>,
  replaceAll: boolean = false
): string {
  const parsed = parseFrontmatter(content);

  // Determine new frontmatter data
  let newData: Record<string, unknown>;
  if (replaceAll) {
    newData = updates;
  } else {
    // Merge with existing data
    newData = { ...(parsed.data || {}) };
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        delete newData[key];
      } else {
        newData[key] = value;
      }
    }
  }

  // Serialize new frontmatter
  const newFrontmatter = serializeFrontmatter(newData);

  // Extract body content
  const bodyContent = content.substring(parsed.bodyStartOffset);

  return newFrontmatter + bodyContent;
}

// --- Headings ---

export interface HeadingInfo {
  /** Heading text without # markers */
  text: string;
  /** Heading level (1-6) */
  level: number;
  /** Slugified ID (e.g., "character-backstory") */
  slug: string;
  /** Line number where heading appears (0-based) */
  line: number;
  /** Character offset in full content where heading line starts */
  offset: number;
  /** Character offset where heading content starts (after the heading line itself) */
  contentStart: number;
  /** Character offset where heading section ends (start of next same/higher-level heading, or EOF) */
  contentEnd: number;
}

/**
 * Slugify heading text for stable IDs.
 * "Character Backstory" → "character-backstory"
 * Handles special characters, collapses separators.
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-alphanumeric except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-+|-+$/g, ''); // Trim leading/trailing hyphens
}

/**
 * Parse all headings from markdown content into a tree with section ranges.
 * Each heading's content range extends to the next heading of same or higher level.
 *
 * Headings inside fenced code blocks (``` or ~~~) are ignored.
 */
export function parseHeadingTree(content: string): HeadingInfo[] {
  const lines = content.split('\n');
  const headings: Array<HeadingInfo & { rawSlug: string }> = [];

  // Track fenced code block state
  let inCodeBlock = false;
  let codeBlockDelimiter = '';

  // Character offset tracking
  let currentOffset = 0;
  const lineOffsets: number[] = [0]; // Start of each line

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for code block delimiters (``` or ~~~)
    const tripleBacktick = line.trimStart().startsWith('```');
    const tildeFence = line.trimStart().startsWith('~~~');

    if (tripleBacktick && (!inCodeBlock || codeBlockDelimiter === '```')) {
      inCodeBlock = !inCodeBlock;
      codeBlockDelimiter = inCodeBlock ? '```' : '';
    } else if (tildeFence && (!inCodeBlock || codeBlockDelimiter === '~~~')) {
      inCodeBlock = !inCodeBlock;
      codeBlockDelimiter = inCodeBlock ? '~~~' : '';
    }

    // Only parse headings outside code blocks
    if (!inCodeBlock) {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();
        const rawSlug = slugifyHeading(text);

        headings.push({
          text,
          level,
          rawSlug,
          slug: rawSlug, // Will be updated after deduplication
          line: i,
          offset: currentOffset,
          contentStart: currentOffset + line.length + 1, // +1 for newline
          contentEnd: -1, // Will be computed next
        });
      }
    }

    // Update offset for next line
    currentOffset += line.length + 1; // +1 for newline character
  }

  // Compute contentEnd for each heading
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];

    // Find next heading with same or higher level (lower level number)
    let nextHeadingOffset = currentOffset; // Default to EOF
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= heading.level) {
        nextHeadingOffset = headings[j].offset;
        break;
      }
    }

    heading.contentEnd = nextHeadingOffset;
  }

  // Handle duplicate slugs by appending counters
  const slugCounts = new Map<string, number>();
  const slugSuffixes = new Map<string, number>();

  for (const heading of headings) {
    const count = (slugCounts.get(heading.rawSlug) || 0) + 1;
    slugCounts.set(heading.rawSlug, count);
    if (count > 1) {
      slugSuffixes.set(heading.rawSlug, (slugSuffixes.get(heading.rawSlug) || 1) + 1);
    }
  }

  // Apply slug adjustments
  const firstOccurrence = new Set<string>();
  for (const heading of headings) {
    if (!firstOccurrence.has(heading.rawSlug)) {
      firstOccurrence.add(heading.rawSlug);
      heading.slug = heading.rawSlug;
    } else {
      const suffix = slugSuffixes.get(heading.rawSlug) || 2;
      heading.slug = `${heading.rawSlug}-${suffix}`;
      slugSuffixes.set(heading.rawSlug, suffix + 1);
    }
  }

  // Remove the temporary rawSlug property
  return headings.map(({ rawSlug: _, ...rest }) => rest);
}

/**
 * Find a specific heading section by text and optional level.
 * Returns the heading info if found, or throws with available headings for error messages.
 *
 * Matching is case-insensitive and ignores leading/trailing whitespace.
 * If multiple headings match the text, the level parameter disambiguates.
 * Duplicate headings at the same level get counter suffixes in their slugs.
 */
export function findHeadingSection(
  content: string,
  headingText: string,
  level?: number
): HeadingInfo {
  const headings = parseHeadingTree(content);
  const normalizedSearch = headingText.toLowerCase().trim();

  // Filter by text match
  const textMatches = headings.filter((h) => h.text.toLowerCase().trim() === normalizedSearch);

  if (textMatches.length === 0) {
    const availableHeadings = headings.map((h) => `- Level ${h.level}: "${h.text}"`).join('\n');
    const message = `Heading "${headingText}" not found. Available headings:\n${availableHeadings}`;
    logger.error(message);
    throw new Error(message);
  }

  // If level is specified, filter further
  if (level !== undefined) {
    const levelMatches = textMatches.filter((h) => h.level === level);
    if (levelMatches.length === 0) {
      const availableForText = textMatches.map((h) => `- Level ${h.level}`).join('\n');
      const message = `Heading "${headingText}" found, but not at level ${level}. Found at:\n${availableForText}`;
      logger.error(message);
      throw new Error(message);
    }
    if (levelMatches.length === 1) {
      return levelMatches[0];
    }
    // Multiple matches at same level - ambiguous
    const message = `Multiple headings "${headingText}" at level ${level} found. Please specify level more precisely.`;
    logger.error(message);
    throw new Error(message);
  }

  // No level specified
  if (textMatches.length === 1) {
    return textMatches[0];
  }

  // Multiple matches without level specified
  const levels = textMatches.map((h) => h.level).join(', ');
  const message = `Multiple headings "${headingText}" found at levels: ${levels}. Please specify level to disambiguate.`;
  logger.error(message);
  throw new Error(message);
}

/**
 * Read all content under a heading (from after the heading line to contentEnd).
 */
export function readHeadingContent(content: string, heading: HeadingInfo): string {
  return content.substring(heading.contentStart, heading.contentEnd);
}

/**
 * Replace all content under a heading.
 * If preserveSubheadings is true, only replaces content before the first subheading.
 */
export function replaceHeadingContent(
  content: string,
  heading: HeadingInfo,
  newContent: string,
  preserveSubheadings: boolean = true
): string {
  if (!preserveSubheadings) {
    // Simple case: replace everything from contentStart to contentEnd
    return content.substring(0, heading.contentStart) + newContent + content.substring(heading.contentEnd);
  }

  // Find first subheading (higher level number = deeper nesting) within this heading's section
  const headings = parseHeadingTree(content);
  let firstSubheadingOffset = heading.contentEnd; // Default to section end

  for (const other of headings) {
    if (
      other.level > heading.level &&
      other.offset >= heading.contentStart &&
      other.offset < heading.contentEnd
    ) {
      firstSubheadingOffset = other.offset;
      break; // Take the first one found
    }
  }

  // Replace only content before the first subheading
  return (
    content.substring(0, heading.contentStart) +
    newContent +
    content.substring(firstSubheadingOffset)
  );
}
